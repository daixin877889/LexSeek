# 定时任务调度器设计

## 概述

为项目引入统一的定时任务调度机制，配合 Redis 分布式锁确保多实例部署下同一时刻只有一个实例执行同一任务。注册 5 个定时任务：ASR 保底轮询、MinerU 保底轮询、支付过期清理、分析记录超时清理、Agent runs 历史清理。

## 背景

项目中已有多个完整实现但未注册定时触发的后台任务函数，包括 ASR 和 MinerU 的保底轮询、支付过期清理等。同时 `agent-worker.ts` 中的定时清理使用裸 `setInterval`，无分布式锁保护。生产环境多实例部署下，需要统一管理所有定时任务并防止重复执行。

此外，`case_analyses` 表存在进程被杀导致 IN_PROGRESS 状态永远悬挂的风险。虽然 `agentRuns` 已有心跳恢复机制处理正常崩溃，但极端场景下（如 agentRun 本身丢失）仍需兜底清理。

## 架构设计

### 新增文件

| 文件 | 职责 |
|------|------|
| `server/utils/cron.ts` | 分布式锁工具函数 + CronScheduler 调度器类 |
| `server/plugins/cron-scheduler.ts` | 统一注册所有定时任务的 Nitro 插件 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `server/services/case/analysis.service.ts` | 新增 `cleanupStaleAnalysesService` 函数 |
| `server/services/case/analysis.dao.ts` | 新增 `findStaleInProgressAnalysesDao` 和 `batchUpdateAnalysisStatusDao` |
| `server/plugins/agent-worker.ts` | 移除 `setInterval(deleteOldRunsDAO)` 清理逻辑 |

## 详细设计

### 1. 分布式锁工具 — `server/utils/cron.ts`

#### `withDistributedLock<T>(lockKey, ttlSeconds, fn): Promise<T | null>`

- 使用 Redis `SET lockKey uuid NX EX ttl` 原子抢锁
- 锁的 value 为随机 UUID，避免误释放其他实例的锁
- 抢到锁 → 执行 `fn()` → finally 中通过 Lua 脚本校验 value 后 DEL 释放
- 未抢到锁 → 返回 `null`，`logger.debug` 记录跳过
- fn 执行异常 → 日志记录后仍在 finally 中释放锁，异常继续向上抛出
- Redis 连接异常（如 `getRedisClient().set()` 抛出）→ 显式 catch，记录 `logger.error`，返回 `null`（与抢锁失败相同处理），确保不向上抛出

释放锁的 Lua 脚本：

```lua
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
```

#### `CronScheduler` 类

```typescript
interface CronTask {
  name: string          // 任务名称，同时作为锁 key 前缀（注册时校验唯一性）
  intervalMs: number    // 执行间隔（毫秒）
  lockTtlSeconds: number // 锁的过期时间（秒）
  fn: () => Promise<unknown> // 任务执行函数
  runImmediately?: boolean // 启动时立即执行一次（默认 false）
}

class CronScheduler {
  register(task: CronTask): void  // 任务名重复时抛出错误
  start(): void       // 启动所有已注册任务；runImmediately 的任务先立即执行一次再启动 setInterval
  shutdown(): void     // clearInterval 所有定时器
}
```

- `register()` 校验 name 唯一性，重复注册抛出错误
- `start()` 为每个任务创建 `setInterval`，回调中自动包裹 `withDistributedLock`
- 每次执行自动 try-catch，异常只记日志（`logger.error`）不影响后续调度
- 锁 key 格式：`cron:lock:{taskName}`
- `shutdown()` 清理所有 interval 定时器

### 2. 统一定时任务插件 — `server/plugins/cron-scheduler.ts`

```typescript
export default defineNitroPlugin((nitroApp) => {
  // 前置检查：Redis URL 未配置则不启动
  const { redis: redisConfig } = useRuntimeConfig()
  if (!redisConfig.url) {
    logger.warn('Redis URL 未配置，定时任务调度器不启动')
    return
  }

  const scheduler = new CronScheduler()

  // 注册 5 个定时任务
  scheduler.register({ ... })

  scheduler.start()

  // 优雅关闭（顺序：停调度 → 关 DB 池 → 关 Redis）
  nitroApp.hooks.hook('close', async () => {
    scheduler.shutdown()
    await closeAgentDbPool()
    await closeRedisConnections()
  })
})
```

#### 任务注册表

| 任务名 | 函数 | 间隔 | 锁 TTL | 说明 |
|--------|------|------|--------|------|
| `asr-polling` | `pollPendingAsrTasksService` | 5 分钟 | 120s | ASR 保底轮询，批量检查 pending 状态的 ASR 任务（上限 50 条） |
| `mineru-polling` | `pollPendingTasksService` | 5 分钟 | 120s | MinerU 保底轮询，批量检查 pending 状态的 MinerU 任务（上限 50 条） |
| `payment-cleanup` | `handleExpiredPaymentTransactionsService` | 10 分钟 | 60s | 扫描超时未支付的支付事务，标记为过期 |
| `analysis-cleanup` | `cleanupStaleAnalysesService` | 15 分钟 | 60s | 清理超过 2 小时仍为 IN_PROGRESS 的分析记录 |
| `agent-runs-cleanup` | `() => deleteOldRunsDAO(90)` | 24 小时 | 300s | 清理 90 天前的已终结 agent runs（`runImmediately: true`） |

锁 TTL 设置原则：大于任务最大执行时间，但不宜过长（避免实例崩溃后锁长时间无法释放）。ASR 和 MinerU 轮询每次最多处理 50 条记录，每条记录只做一次 API 状态查询，120s 足够覆盖。

### 3. 分析记录超时清理

#### DAO 层 — `server/services/case/analysis.dao.ts`

新增两个函数：

**`findStaleInProgressAnalysesDao(thresholdMs: number)`**
- 查询 `status = IN_PROGRESS` 且 `updatedAt < now() - thresholdMs` 且 `deletedAt = null` 的记录
- 使用 `updatedAt` 而非 `createdAt`，因为只有长时间无任何更新的记录才是真正僵死的
- 返回记录 ID 列表

**`batchUpdateAnalysisStatusDao(ids: number[], status: AnalysisStatus)`**
- 批量更新指定记录的状态，同时更新 `updatedAt: new Date()`

#### Service 层 — `server/services/case/analysis.service.ts`

新增 `cleanupStaleAnalysesService`：

```typescript
export const cleanupStaleAnalysesService = async (): Promise<number> => {
  // 阈值：2 小时
  const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000

  const staleIds = await findStaleInProgressAnalysesDao(STALE_THRESHOLD_MS)
  if (staleIds.length === 0) return 0

  const count = await batchUpdateAnalysisStatusDao(staleIds, AnalysisStatus.FAILED)
  logger.info(`已清理 ${count} 条超时分析记录`)
  return count
}
```

超时阈值选择 2 小时的理由：
- 正常分析流程从排队到完成远不到 2 小时
- 2 小时足以容忍排队等待时间，不会误杀正常任务
- agentRuns 心跳机制处理正常崩溃恢复（秒级），此任务只是最后一道防线

### 4. agent-worker.ts 改造

移除以下代码（约第 28-38 行）：

```typescript
// 移除：每 24 小时清理 90 天前的已终结 run
const cleanupTimer = setInterval(async () => { ... }, 24 * 60 * 60 * 1000)
```

同时移除 `nitroApp.hooks.hook('close')` 中的 `clearInterval(cleanupTimer)`。

该清理逻辑由 `cron-scheduler.ts` 中的 `agent-runs-cleanup` 任务统一管理，具备分布式锁保护。

**关键变更**：将 `closeRedisConnections()` 和 `closeAgentDbPool()` 的调用从 agent-worker.ts 移到 cron-scheduler.ts 的 close hook 中。

原因：Nitro 的 close hook 按插件文件名字母序执行。`agent-worker.ts`（a 开头）先于 `cron-scheduler.ts`（c 开头）。如果 agent-worker 先关闭 Redis 连接，cron-scheduler 中正在执行的任务将无法释放分布式锁。

改造后：
- `agent-worker.ts` close hook：仅负责 `worker.shutdown()`
- `cron-scheduler.ts` close hook：先 `scheduler.shutdown()`，再 `closeAgentDbPool()`，最后 `closeRedisConnections()`

这样确保 Redis 连接在所有定时任务停止后才关闭。

agent-worker.ts 保留的职责：
- AgentWorker 生命周期管理（start/shutdown）
- 优雅关闭时停止 Worker

## 依赖关系

```
server/utils/cron.ts
  └─ import { getRedisClient } from '~~/server/lib/redis'

server/plugins/cron-scheduler.ts
  └─ 自动导入（server/utils/*）：CronScheduler, withDistributedLock
  └─ 自动导入（server/services/*/*）：pollPendingAsrTasksService, pollPendingTasksService,
  │             handleExpiredPaymentTransactionsService, cleanupStaleAnalysesService, deleteOldRunsDAO
```

注意：`server/lib/*` 不自动导入，需显式 import。`server/utils/*` 和 `server/services/*/*` 自动导入。

## 错误处理策略

| 场景 | 处理方式 |
|------|---------|
| Redis 未配置 | 整个调度器不启动，warn 日志 |
| Redis 连接异常 | 抢锁失败，跳过本次执行，error 日志 |
| 抢锁失败（其他实例持有） | 静默跳过，debug 日志 |
| 任务执行异常 | catch 记录 error 日志，释放锁，不影响后续调度 |
| 进程关闭 | scheduler.shutdown() 清理所有 interval |

## 日志示例

```
[INFO]  定时任务调度器已启动，注册 5 个任务
[DEBUG] [asr-polling] 锁已被其他实例持有，跳过本次执行
[INFO]  [asr-polling] 执行完成 (12ms): checked=3, completed=1, failed=0
[INFO]  [payment-cleanup] 执行完成 (5ms): 处理 2 个过期支付单
[INFO]  [analysis-cleanup] 执行完成 (3ms): 清理 0 条超时分析记录
[ERROR] [mineru-polling] 执行异常: Redis connection refused
```

## 验证方式

1. **类型检查**：`npx nuxi typecheck` 通过
2. **单元测试**：`npx vitest run tests/server/cron` 通过
3. **单实例测试**：启动 dev server，观察日志确认 5 个任务按频率执行
4. **分布式锁验证**：启动两个实例，确认同一时刻只有一个实例执行任务
5. **兜底清理验证**：手动插入一条 2 小时前的 IN_PROGRESS 分析记录，确认被清理

## 单元测试

测试文件：`tests/server/cron/cron.test.ts`

### withDistributedLock 测试用例

| 用例 | 说明 |
|------|------|
| 抢锁成功 — 执行并返回结果 | mock Redis SET 返回 'OK'，验证 fn 被调用，返回 fn 结果 |
| 抢锁失败 — 返回 null | mock Redis SET 返回 null，验证 fn 未被调用，返回 null |
| fn 执行异常 — 释放锁后抛出 | mock fn 抛错，验证 Lua 脚本被调用（释放锁），异常被重新抛出 |
| Redis 连接异常 — 返回 null | mock Redis SET 抛出连接错误，验证返回 null 且不向上抛出 |
| 锁释放校验 UUID — 不误删他人锁 | 验证 Lua 脚本接收正确的 lockKey 和 UUID 参数 |
| 锁释放时 Redis 异常 — 不影响返回值 | mock Lua eval 抛错，验证 fn 结果仍正常返回（finally 中 catch） |

### CronScheduler 测试用例

| 用例 | 说明 |
|------|------|
| register — 正常注册 | 注册一个任务，验证 start 后 setInterval 被调用 |
| register — 重复名称抛错 | 注册两个同名任务，验证第二次抛出错误 |
| start + runImmediately — 立即执行 | 注册 `runImmediately: true` 的任务，验证 start 后立即执行一次 |
| shutdown — 清理定时器 | 启动后 shutdown，验证 clearInterval 被调用，后续不再执行 |
| 任务异常不影响调度 | mock fn 抛错，验证不影响其他任务和后续调度 |

### cleanupStaleAnalysesService 测试用例

| 用例 | 说明 |
|------|------|
| 无超时记录 — 返回 0 | 无 IN_PROGRESS 记录超过阈值，返回 0 |
| 有超时记录 — 标记为 FAILED | 插入超时记录，验证状态被更新为 FAILED |
| 未超时记录不受影响 | 插入未超时的 IN_PROGRESS 记录，验证不被清理 |
| 已软删除记录不受影响 | 插入已删除的超时记录（deletedAt 非 null），验证不被清理 |

## 边界条件分析

### 1. close hook 执行顺序竞态（已处理）

Nitro 的 close hook 按插件文件名字母序执行。`agent-worker.ts` 先于 `cron-scheduler.ts`。

**解决方案**：将 `closeRedisConnections()` 从 agent-worker.ts 移到 cron-scheduler.ts 的 close hook 末尾，确保 Redis 连接在所有定时任务停止后才关闭。详见「4. agent-worker.ts 改造」章节。

### 2. 锁 TTL 过期但任务仍在执行

如果任务执行时间超过锁 TTL，锁自动过期后另一个实例可以抢到锁导致重复执行。

**风险评估**：低。各任务均有处理上限：
- ASR/MinerU 轮询：每次最多 50 条，每条只做一次 API 状态查询，远在 120s 内完成
- 支付清理/分析清理：批量 DB 操作，秒级完成
- Agent runs 清理：单次 DELETE 查询，秒级完成

**容忍策略**：即使极端情况下重复执行，各任务函数本身具有幂等性（查状态/标记状态），不会产生数据损坏。不引入锁续期（watchdog）机制以保持实现简单。

### 3. 同实例 setInterval 回调重叠

如果一个回调耗时超过 interval，下一个 interval 触发时前一个回调还在执行。

**分析**：Node.js 事件循环保证 setInterval 回调串行排队。即使前一个回调未完成，下一个回调也会排入队列等待。当前一个回调完成释放锁后，排队的回调会尝试抢锁——此时可能抢到（正常执行）或被其他实例抢走（跳过）。两种结果都是正确的。

### 4. Redis 短暂不可用

Redis 短暂宕机期间，所有定时任务都会跳过（抢锁失败）。Redis 恢复后，下一个 interval 自动恢复执行。

**风险评估**：低。定时任务本身是兜底机制，偶尔跳过几个周期不影响业务。无需 catch-up 逻辑。

### 5. 进程关闭时正在执行的任务

`scheduler.shutdown()` 只清理 interval 定时器，不会中断正在执行的回调。正在执行的回调会自然完成并释放锁，然后进程退出。

**风险评估**：无。即使极端情况下进程被强制杀死，锁有 TTL 会自动过期，不会造成死锁。
