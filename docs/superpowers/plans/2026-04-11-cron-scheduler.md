# 定时任务调度器实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为项目注册 5 个定时任务（ASR/MinerU 保底轮询、支付过期清理、分析记录超时清理、Agent runs 历史清理），配合 Redis 分布式锁确保多实例部署下不重复执行。

**Architecture:** 新增 `server/utils/cron.ts` 提供 `withDistributedLock` 和 `CronScheduler` 两个核心能力。新增 `server/plugins/cron-scheduler.ts` 统一注册所有定时任务。将 `agent-worker.ts` 中的清理逻辑和资源关闭迁移至调度器统一管理。

**Tech Stack:** TypeScript, ioredis (Redis SET NX EX + Lua), Nitro server plugins, Vitest

**Spec:** `docs/superpowers/specs/2026-04-11-cron-scheduler-design.md`

---

## Task 1: 分布式锁工具函数 withDistributedLock

**Files:**
- Create: `server/utils/cron.ts`
- Create: `tests/server/cron/cron.test.ts`

### 1.1 编写 withDistributedLock 的测试

- [ ] **Step 1: 创建测试文件骨架**

```typescript
// tests/server/cron/cron.test.ts
/**
 * 定时任务工具测试
 *
 * 测试分布式锁和调度器的核心逻辑
 *
 * **Feature: cron-scheduler**
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// mock logger 全局变量（Nitro 自动导入）
vi.stubGlobal('logger', {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
})

// mock Redis 客户端
const mockRedisClient = {
    set: vi.fn(),
    eval: vi.fn(),
}

vi.mock('~~/server/lib/redis', () => ({
    getRedisClient: () => mockRedisClient,
}))

// 导入被测模块（mock 生效后再导入）
const { withDistributedLock } = await import('../../../server/utils/cron')

describe('withDistributedLock', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('抢锁成功时执行 fn 并返回结果', async () => {
        mockRedisClient.set.mockResolvedValue('OK')
        mockRedisClient.eval.mockResolvedValue(1)

        const fn = vi.fn().mockResolvedValue({ data: 42 })
        const result = await withDistributedLock('test-lock', 60, fn)

        expect(fn).toHaveBeenCalledOnce()
        expect(result).toEqual({ data: 42 })
        // 验证抢锁参数：key, uuid, 'NX', 'EX', ttl
        expect(mockRedisClient.set).toHaveBeenCalledWith(
            'test-lock',
            expect.any(String),
            'NX',
            'EX',
            60,
        )
    })

    it('抢锁失败时返回 null 且不执行 fn', async () => {
        mockRedisClient.set.mockResolvedValue(null)

        const fn = vi.fn()
        const result = await withDistributedLock('test-lock', 60, fn)

        expect(fn).not.toHaveBeenCalled()
        expect(result).toBeNull()
    })

    it('fn 执行异常时释放锁后重新抛出', async () => {
        mockRedisClient.set.mockResolvedValue('OK')
        mockRedisClient.eval.mockResolvedValue(1)

        const error = new Error('任务失败')
        const fn = vi.fn().mockRejectedValue(error)

        await expect(withDistributedLock('test-lock', 60, fn)).rejects.toThrow('任务失败')
        // 验证锁被释放（Lua eval 被调用）
        expect(mockRedisClient.eval).toHaveBeenCalledOnce()
    })

    it('Redis 连接异常时返回 null 且不向上抛出', async () => {
        mockRedisClient.set.mockRejectedValue(new Error('Connection refused'))

        const fn = vi.fn()
        const result = await withDistributedLock('test-lock', 60, fn)

        expect(fn).not.toHaveBeenCalled()
        expect(result).toBeNull()
    })

    it('释放锁时校验 UUID 防止误删', async () => {
        mockRedisClient.set.mockResolvedValue('OK')
        mockRedisClient.eval.mockResolvedValue(1)

        const fn = vi.fn().mockResolvedValue('ok')
        await withDistributedLock('my-key', 30, fn)

        // 验证 Lua eval 参数：script, numkeys, key, uuid
        expect(mockRedisClient.eval).toHaveBeenCalledWith(
            expect.stringContaining('redis.call("get"'),
            1,
            'my-key',
            expect.any(String), // UUID
        )
        // 验证 set 和 eval 使用相同的 UUID
        const setUuid = mockRedisClient.set.mock.calls[0][1]
        const evalUuid = mockRedisClient.eval.mock.calls[0][3]
        expect(setUuid).toBe(evalUuid)
    })

    it('释放锁时 Redis 异常不影响 fn 返回值', async () => {
        mockRedisClient.set.mockResolvedValue('OK')
        mockRedisClient.eval.mockRejectedValue(new Error('Redis eval failed'))

        const fn = vi.fn().mockResolvedValue('success')
        const result = await withDistributedLock('test-lock', 60, fn)

        expect(result).toBe('success')
    })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/server/cron/cron.test.ts --reporter=verbose
```

预期：FAIL — 模块 `server/utils/cron` 不存在

### 1.2 实现 withDistributedLock

- [ ] **Step 3: 创建 server/utils/cron.ts 并实现 withDistributedLock**

```typescript
// server/utils/cron.ts
/**
 * 定时任务工具
 *
 * 提供分布式锁和 Cron 调度器，用于多实例部署下的定时任务管理
 */

import { randomUUID } from 'node:crypto'
import { getRedisClient } from '~~/server/lib/redis'

/** 释放锁的 Lua 脚本：校验 value 后删除，防止误删其他实例的锁 */
const RELEASE_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`

/**
 * 使用 Redis 分布式锁执行函数
 *
 * 通过 SET NX EX 原子抢锁，确保多实例环境下同一时刻只有一个实例执行。
 * 锁的 value 为随机 UUID，释放时通过 Lua 脚本校验防止误删。
 *
 * @param lockKey Redis 锁的 key
 * @param ttlSeconds 锁的过期时间（秒）
 * @param fn 需要在锁保护下执行的函数
 * @returns fn 的返回值；未获取到锁或 Redis 异常时返回 null
 */
export async function withDistributedLock<T>(
    lockKey: string,
    ttlSeconds: number,
    fn: () => Promise<T>,
): Promise<T | null> {
    const lockValue = randomUUID()
    let acquired = false

    try {
        const redis = getRedisClient()
        const result = await redis.set(lockKey, lockValue, 'NX', 'EX', ttlSeconds)
        acquired = result === 'OK'
    } catch (error) {
        logger.error(`[${lockKey}] Redis 连接异常，跳过本次执行：`, error)
        return null
    }

    if (!acquired) {
        logger.debug(`[${lockKey}] 锁已被其他实例持有，跳过本次执行`)
        return null
    }

    try {
        return await fn()
    } finally {
        try {
            const redis = getRedisClient()
            await redis.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, lockValue)
        } catch (error) {
            logger.error(`[${lockKey}] 释放锁异常：`, error)
        }
    }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run tests/server/cron/cron.test.ts --reporter=verbose
```

预期：6 个 withDistributedLock 测试全部 PASS

- [ ] **Step 5: 提交**

```bash
git add server/utils/cron.ts tests/server/cron/cron.test.ts
git commit -m "feat(cron): 实现 withDistributedLock 分布式锁工具函数"
```

---

## Task 2: CronScheduler 调度器类

**Files:**
- Modify: `server/utils/cron.ts`
- Modify: `tests/server/cron/cron.test.ts`

### 2.1 编写 CronScheduler 的测试

- [ ] **Step 1: 在测试文件中添加 CronScheduler 测试**

在 `tests/server/cron/cron.test.ts` 末尾追加：

```typescript
// 在文件顶部 import 区域补充：
// const { withDistributedLock, CronScheduler } = await import('../../../server/utils/cron')

describe('CronScheduler', () => {
    let scheduler: InstanceType<typeof CronScheduler>

    beforeEach(() => {
        vi.useFakeTimers()
        vi.clearAllMocks()
        scheduler = new CronScheduler()
        // 默认让分布式锁直接执行（抢锁成功）
        mockRedisClient.set.mockResolvedValue('OK')
        mockRedisClient.eval.mockResolvedValue(1)
    })

    afterEach(() => {
        scheduler.shutdown()
        vi.useRealTimers()
    })

    it('注册并启动任务后按间隔执行', async () => {
        const fn = vi.fn().mockResolvedValue(undefined)
        scheduler.register({
            name: 'test-task',
            intervalMs: 1000,
            lockTtlSeconds: 10,
            fn,
        })

        scheduler.start()

        // 初始不执行（runImmediately 默认 false）
        expect(fn).not.toHaveBeenCalled()

        // 前进 1 秒
        await vi.advanceTimersByTimeAsync(1000)
        expect(fn).toHaveBeenCalledTimes(1)

        // 再前进 1 秒
        await vi.advanceTimersByTimeAsync(1000)
        expect(fn).toHaveBeenCalledTimes(2)
    })

    it('注册重复名称抛出错误', () => {
        const task = { name: 'dup', intervalMs: 1000, lockTtlSeconds: 10, fn: vi.fn().mockResolvedValue(undefined) }
        scheduler.register(task)
        expect(() => scheduler.register(task)).toThrow()
    })

    it('runImmediately 为 true 时启动后立即执行一次', async () => {
        const fn = vi.fn().mockResolvedValue(undefined)
        scheduler.register({
            name: 'immediate-task',
            intervalMs: 60000,
            lockTtlSeconds: 10,
            fn,
            runImmediately: true,
        })

        scheduler.start()

        // 等待微任务（立即执行是异步的）
        await vi.advanceTimersByTimeAsync(0)
        expect(fn).toHaveBeenCalledTimes(1)
    })

    it('shutdown 后不再执行任务', async () => {
        const fn = vi.fn().mockResolvedValue(undefined)
        scheduler.register({
            name: 'shutdown-task',
            intervalMs: 1000,
            lockTtlSeconds: 10,
            fn,
        })

        scheduler.start()
        await vi.advanceTimersByTimeAsync(1000)
        expect(fn).toHaveBeenCalledTimes(1)

        scheduler.shutdown()
        await vi.advanceTimersByTimeAsync(5000)
        expect(fn).toHaveBeenCalledTimes(1) // 不再增加
    })

    it('任务异常不影响后续调度', async () => {
        const fn = vi.fn()
            .mockRejectedValueOnce(new Error('boom'))
            .mockResolvedValue('ok')
        scheduler.register({
            name: 'error-task',
            intervalMs: 1000,
            lockTtlSeconds: 10,
            fn,
        })

        scheduler.start()

        // 第一次执行抛错
        await vi.advanceTimersByTimeAsync(1000)
        expect(fn).toHaveBeenCalledTimes(1)

        // 第二次执行正常
        await vi.advanceTimersByTimeAsync(1000)
        expect(fn).toHaveBeenCalledTimes(2)
    })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/server/cron/cron.test.ts --reporter=verbose
```

预期：FAIL — `CronScheduler` 未导出

### 2.2 实现 CronScheduler

- [ ] **Step 3: 在 server/utils/cron.ts 末尾追加 CronScheduler 实现**

```typescript
/** 定时任务配置 */
export interface CronTask {
    /** 任务名称，同时作为锁 key 前缀（必须唯一） */
    name: string
    /** 执行间隔（毫秒） */
    intervalMs: number
    /** 分布式锁过期时间（秒） */
    lockTtlSeconds: number
    /** 任务执行函数 */
    fn: () => Promise<unknown>
    /** 启动时立即执行一次（默认 false） */
    runImmediately?: boolean
}

/**
 * 定时任务调度器
 *
 * 统一管理所有定时任务，每次执行自动包裹分布式锁。
 * 任务异常只记日志，不影响后续调度。
 */
export class CronScheduler {
    private tasks: CronTask[] = []
    private timers: ReturnType<typeof setInterval>[] = []

    /** 注册定时任务（任务名必须唯一） */
    register(task: CronTask): void {
        if (this.tasks.some((t) => t.name === task.name)) {
            throw new Error(`定时任务名称重复：${task.name}`)
        }
        this.tasks.push(task)
    }

    /** 启动所有已注册的定时任务 */
    start(): void {
        for (const task of this.tasks) {
            const execute = async () => {
                try {
                    const lockKey = `cron:lock:${task.name}`
                    await withDistributedLock(lockKey, task.lockTtlSeconds, task.fn)
                } catch (error) {
                    logger.error(`[${task.name}] 执行异常：`, error)
                }
            }

            // 启动时立即执行一次
            if (task.runImmediately) {
                execute()
            }

            const timer = setInterval(execute, task.intervalMs)
            this.timers.push(timer)
        }

        logger.info(`定时任务调度器已启动，注册 ${this.tasks.length} 个任务`)
    }

    /** 停止所有定时任务 */
    shutdown(): void {
        for (const timer of this.timers) {
            clearInterval(timer)
        }
        this.timers = []
        logger.info('定时任务调度器已停止')
    }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run tests/server/cron/cron.test.ts --reporter=verbose
```

预期：11 个测试全部 PASS

- [ ] **Step 5: 提交**

```bash
git add server/utils/cron.ts tests/server/cron/cron.test.ts
git commit -m "feat(cron): 实现 CronScheduler 调度器类"
```

---

## Task 3: 分析记录超时清理 DAO 和 Service

**Files:**
- Modify: `server/services/case/analysis.dao.ts` (追加两个函数)
- Modify: `server/services/case/analysis.service.ts` (追加 cleanupStaleAnalysesService)
- Create: `tests/server/cron/analysis-cleanup.test.ts` (独立测试文件，避免 mock 冲突)

### 3.1 编写 cleanupStaleAnalysesService 的测试

- [ ] **Step 1: 创建独立的测试文件**

```typescript
// tests/server/cron/analysis-cleanup.test.ts
/**
 * 分析记录超时清理测试
 *
 * 测试 cleanupStaleAnalysesService 及其依赖的 DAO 函数
 *
 * **Feature: cron-scheduler**
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// mock logger 全局变量
vi.stubGlobal('logger', {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
})

// mock DAO 模块（直接 mock DAO 函数，避免 prisma 自动导入拦截问题）
const mockFindStale = vi.fn()
const mockBatchUpdate = vi.fn()

vi.mock('../../../server/services/case/analysis.dao', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../server/services/case/analysis.dao')>()
    return {
        ...actual,
        findStaleInProgressAnalysesDao: mockFindStale,
        batchUpdateAnalysisStatusDao: mockBatchUpdate,
    }
})

const { cleanupStaleAnalysesService } = await import(
    '../../../server/services/case/analysis.service'
)
const { AnalysisStatus } = await import(
    '../../../server/services/case/analysis.dao'
)

describe('cleanupStaleAnalysesService', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('无超时记录时返回 0', async () => {
        mockFindStale.mockResolvedValue([])

        const result = await cleanupStaleAnalysesService()

        expect(result).toBe(0)
        expect(mockBatchUpdate).not.toHaveBeenCalled()
    })

    it('有超时记录时标记为 FAILED 并返回处理数量', async () => {
        mockFindStale.mockResolvedValue([1, 2, 3])
        mockBatchUpdate.mockResolvedValue(3)

        const result = await cleanupStaleAnalysesService()

        expect(result).toBe(3)
        expect(mockBatchUpdate).toHaveBeenCalledWith(
            [1, 2, 3],
            AnalysisStatus.FAILED,
        )
    })

    it('未超时记录不受影响', async () => {
        // findStaleInProgressAnalysesDao 只返回超时的 ID，
        // 未超时的记录不在返回列表中，因此不会被 batchUpdate 处理
        mockFindStale.mockResolvedValue([10]) // 只有 ID=10 超时

        await cleanupStaleAnalysesService()

        // batchUpdate 只处理 findStale 返回的 ID
        expect(mockBatchUpdate).toHaveBeenCalledWith(
            [10],
            AnalysisStatus.FAILED,
        )
    })

    it('已软删除记录不受影响', async () => {
        // findStaleInProgressAnalysesDao 查询条件包含 deletedAt: null，
        // 已软删除的记录不会被查出来
        mockFindStale.mockResolvedValue([])

        const result = await cleanupStaleAnalysesService()

        expect(result).toBe(0)
        // 验证 findStale 被正确调用（阈值为 2 小时 = 7200000ms）
        expect(mockFindStale).toHaveBeenCalledWith(2 * 60 * 60 * 1000)
    })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/server/cron/analysis-cleanup.test.ts --reporter=verbose
```

预期：FAIL — `cleanupStaleAnalysesService` 未导出或 DAO 函数不存在

### 3.2 实现 DAO 函数

- [ ] **Step 3: 在 analysis.dao.ts 末尾追加两个 DAO 函数**

在 `server/services/case/analysis.dao.ts` 文件末尾追加：

```typescript
/**
 * 查询超时的 IN_PROGRESS 分析记录
 *
 * 用于定时清理因进程崩溃等原因导致状态永远悬挂的分析记录。
 * 使用 updatedAt 而非 createdAt，只捕获真正僵死（长时间无更新）的记录。
 *
 * @param thresholdMs 超时阈值（毫秒）
 * @returns 超时记录的 ID 列表
 */
export const findStaleInProgressAnalysesDao = async (
    thresholdMs: number,
): Promise<number[]> => {
    try {
        const threshold = new Date(Date.now() - thresholdMs)
        const records = await prisma.caseAnalyses.findMany({
            where: {
                status: AnalysisStatus.IN_PROGRESS,
                updatedAt: { lt: threshold },
                deletedAt: null,
            },
            select: { id: true },
        })
        return records.map((r) => r.id)
    } catch (error) {
        logger.error('查询超时分析记录失败：', error)
        throw error
    }
}

/**
 * 批量更新分析记录状态
 *
 * @param ids 记录 ID 列表
 * @param status 目标状态
 * @returns 更新的记录数
 */
export const batchUpdateAnalysisStatusDao = async (
    ids: number[],
    status: AnalysisStatus,
): Promise<number> => {
    try {
        const result = await prisma.caseAnalyses.updateMany({
            where: { id: { in: ids } },
            data: { status, updatedAt: new Date() },
        })
        return result.count
    } catch (error) {
        logger.error('批量更新分析状态失败：', error)
        throw error
    }
}
```

### 3.3 实现 Service 函数

- [ ] **Step 4: 在 analysis.service.ts 中追加 cleanupStaleAnalysesService**

在 `server/services/case/analysis.service.ts` 的 import 列表中追加新的 DAO 函数导入：

```typescript
// 在现有 import { ... } from './analysis.dao' 中追加：
//   findStaleInProgressAnalysesDao,
//   batchUpdateAnalysisStatusDao,
```

在文件末尾追加：

```typescript
/**
 * 清理超时的 IN_PROGRESS 分析记录
 *
 * 作为进程崩溃导致任务丢失的兜底机制。超过 2 小时仍为 IN_PROGRESS 的记录
 * 判定为僵死，标记为 FAILED。agentRuns 心跳机制处理正常崩溃恢复（秒级），
 * 此函数只是最后一道防线。
 *
 * @returns 清理的记录数
 */
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

- [ ] **Step 5: 运行测试确认通过**

```bash
npx vitest run tests/server/cron/analysis-cleanup.test.ts --reporter=verbose
```

预期：4 个测试全部 PASS

- [ ] **Step 6: 提交**

```bash
git add server/services/case/analysis.dao.ts server/services/case/analysis.service.ts tests/server/cron/analysis-cleanup.test.ts
git commit -m "feat(analysis): 新增超时分析记录清理 DAO 和 Service"
```

---

## Task 4: agent-worker.ts 改造

**Files:**
- Modify: `server/plugins/agent-worker.ts`

- [ ] **Step 1: 移除 setInterval 清理逻辑和资源关闭**

将 `server/plugins/agent-worker.ts` 改造为：

```typescript
/**
 * Agent Worker Nitro Plugin
 *
 * 管理 Agent Worker 的生命周期：启动和优雅关闭。
 * 定时清理逻辑已迁移至 cron-scheduler.ts 统一管理。
 * 资源关闭（Redis/DB）由 cron-scheduler.ts 的 close hook 负责，
 * 确保 Redis 连接在所有定时任务停止后才关闭。
 */

import { AgentWorker } from '~~/server/services/agent/agentWorker'

let worker: AgentWorker | null = null

export default defineNitroPlugin((nitroApp) => {
    const { redis: redisConfig } = useRuntimeConfig()

    if (!redisConfig.url) {
        logger.warn('Redis URL 未配置，Agent Worker 不启动')
        return
    }

    worker = new AgentWorker()
    worker.start().catch((err) => {
        logger.error('Agent Worker 启动失败:', err)
    })

    // Graceful shutdown（仅停止 Worker，资源关闭由 cron-scheduler 负责）
    nitroApp.hooks.hook('close', async () => {
        if (worker) {
            await worker.shutdown()
            worker = null
        }
    })
})
```

变更说明：
- 移除 `import { deleteOldRunsDAO }` — 清理由 cron-scheduler 管理
- 移除 `import { closeAgentDbPool, closeRedisConnections }` — 资源关闭由 cron-scheduler 管理
- 移除 `cleanupTimer` 相关的 `setInterval` 和 `clearInterval`
- close hook 中仅保留 `worker.shutdown()`

- [ ] **Step 2: 类型检查**

```bash
npx nuxi typecheck
```

预期：通过

- [ ] **Step 3: 提交**

```bash
git add server/plugins/agent-worker.ts
git commit -m "refactor(agent): 迁移定时清理和资源关闭到 cron-scheduler"
```

---

## Task 5: cron-scheduler 插件注册

**Files:**
- Create: `server/plugins/cron-scheduler.ts`

- [ ] **Step 1: 创建 cron-scheduler.ts**

```typescript
// server/plugins/cron-scheduler.ts
/**
 * 定时任务调度器 Nitro Plugin
 *
 * 统一注册所有定时任务，配合 Redis 分布式锁确保多实例部署下不重复执行。
 * 同时负责 Redis 和 Agent DB 连接的优雅关闭（确保在所有定时任务停止后才关闭）。
 */

import { closeAgentDbPool, closeRedisConnections } from '~~/server/lib/redis'

export default defineNitroPlugin((nitroApp) => {
    const { redis: redisConfig } = useRuntimeConfig()

    if (!redisConfig.url) {
        logger.warn('Redis URL 未配置，定时任务调度器不启动')
        return
    }

    const scheduler = new CronScheduler()

    // ASR 保底轮询（每 5 分钟，批量检查 pending 状态的 ASR 任务）
    scheduler.register({
        name: 'asr-polling',
        intervalMs: 5 * 60 * 1000,
        lockTtlSeconds: 120,
        fn: pollPendingAsrTasksService,
    })

    // MinerU 保底轮询（每 5 分钟，批量检查 pending 状态的 MinerU 任务）
    scheduler.register({
        name: 'mineru-polling',
        intervalMs: 5 * 60 * 1000,
        lockTtlSeconds: 120,
        fn: pollPendingTasksService,
    })

    // 支付过期清理（每 10 分钟，扫描超时未支付的事务）
    scheduler.register({
        name: 'payment-cleanup',
        intervalMs: 10 * 60 * 1000,
        lockTtlSeconds: 60,
        fn: handleExpiredPaymentTransactionsService,
    })

    // 分析记录超时清理（每 15 分钟，清理僵死的 IN_PROGRESS 记录）
    scheduler.register({
        name: 'analysis-cleanup',
        intervalMs: 15 * 60 * 1000,
        lockTtlSeconds: 60,
        fn: cleanupStaleAnalysesService,
    })

    // Agent runs 历史清理（每 24 小时，清理 90 天前的已终结记录）
    scheduler.register({
        name: 'agent-runs-cleanup',
        intervalMs: 24 * 60 * 60 * 1000,
        lockTtlSeconds: 300,
        fn: () => deleteOldRunsDAO(90),
        runImmediately: true,
    })

    scheduler.start()

    // 优雅关闭（顺序：停调度 → 关 DB 池 → 关 Redis）
    nitroApp.hooks.hook('close', async () => {
        scheduler.shutdown()
        await closeAgentDbPool()
        await closeRedisConnections()
    })
})
```

- [ ] **Step 2: 类型检查**

```bash
npx nuxi typecheck
```

预期：通过

- [ ] **Step 3: 提交**

```bash
git add server/plugins/cron-scheduler.ts
git commit -m "feat(cron): 统一注册 5 个定时任务并管理资源生命周期"
```

---

## Task 6: 最终验证

**Files:** 无新增变更

- [ ] **Step 1: 运行全部 cron 测试**

```bash
npx vitest run tests/server/cron --reporter=verbose
```

预期：所有测试 PASS

- [ ] **Step 2: 类型检查**

```bash
npx nuxi typecheck
```

预期：通过

- [ ] **Step 3: 运行全量测试**

```bash
npx vitest run --reporter=verbose
```

预期：所有测试通过，无回归

- [ ] **Step 4: 启动 dev server 验证日志**

```bash
bun dev
```

观察日志确认：
- `定时任务调度器已启动，注册 5 个任务`
- `agent-runs-cleanup` 立即执行一次（`runImmediately: true`）
- 5 分钟后看到 ASR/MinerU 轮询日志
- 10 分钟后看到支付清理日志
