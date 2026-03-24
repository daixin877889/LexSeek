# Agent 后台任务队列实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Agent 执行从 HTTP 请求生命周期解耦，实现后台执行、实时推送、断线重连和 Thread 管理 API。

**Architecture:** PostgreSQL `agent_runs` 表作为任务队列，Redis pub/sub 做实时事件广播，Redis Stream 做事件持久化供重连补发。Worker 在 Nuxt Server 进程内运行，通过 Nitro Plugin 管理生命周期。多实例通过 `FOR UPDATE SKIP LOCKED` + Redis 跨实例通信保证安全。

**Tech Stack:** PostgreSQL + Prisma, Redis (ioredis), Nuxt/Nitro Plugin, @langchain/vue FetchStreamTransport, Vitest

**Spec:** `docs/superpowers/specs/2026-03-24-agent-background-queue-design.md`

---

## 文件结构

### 新建文件

| 文件 | 职责 |
|------|------|
| `prisma/models/agentRun.prisma` | AgentRun 数据模型 |
| `prisma/migrations/xxx_add_agent_runs/migration.sql` | 迁移脚本（含 partial unique index） |
| `server/lib/redis.ts` | Redis 连接管理（单例） |
| `server/services/agent/agentRun.service.ts` | AgentRun CRUD + 入队 + 并发检查 |
| `server/services/agent/agentRun.dao.ts` | AgentRun 数据库操作（含 FOR UPDATE SKIP LOCKED） |
| `server/services/agent/agentWorker.ts` | Worker 核心逻辑（取任务、执行、心跳、崩溃恢复） |
| `server/services/agent/agentEventBridge.ts` | Redis ↔ SSE 事件桥接（发布、订阅、补发） |
| `server/plugins/agent-worker.ts` | Nitro Plugin：Worker 生命周期 + 清理定时任务 |
| `server/api/v1/case/analysis/runs/[sessionId].get.ts` | 查询 session 的 run 列表 |
| `server/api/v1/case/analysis/runs/[sessionId]/current.get.ts` | 查询当前活跃 run |
| `server/api/v1/case/analysis/runs/[runId]/cancel.post.ts` | 取消 run |
| `shared/types/agentRun.ts` | AgentRun 相关类型定义 |
| `tests/server/agent/agentRun.service.test.ts` | AgentRun 服务层测试 |
| `tests/server/agent/agentRun.dao.test.ts` | AgentRun DAO 测试 |
| `tests/server/agent/agentWorker.test.ts` | Worker 核心逻辑测试 |
| `tests/server/agent/agentEventBridge.test.ts` | 事件桥接测试 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `server/api/v1/case/analysis/chat.post.ts` | 从直接执行改为入队+订阅+转发 |
| `server/services/agent/caseAgent.ts` | `runCaseChat` 返回 AsyncGenerator 而非 ReadableStream |
| `.env.example` | 新增 `REDIS_URL` 和 `AGENT_*` 环境变量 |
| `nuxt.config.ts` | 新增 runtimeConfig 中的 Agent 环境变量 |

---

## Task 1: 数据模型与迁移

**Files:**
- Create: `prisma/models/agentRun.prisma`
- Create: `shared/types/agentRun.ts`

**依赖:** 无

- [ ] **Step 1: 创建 AgentRun Prisma 模型**

在 `prisma/models/agentRun.prisma` 中定义模型，遵循项目现有模式（参考 `prisma/models/case.prisma`）：

```prisma
model AgentRun {
  id          String    @id @default(uuid())
  sessionId   String    @map("session_id")
  threadId    String    @map("thread_id")
  userId      Int       @map("user_id")
  caseId      Int       @map("case_id")

  input       Json      // { message: string, command?: any }

  status      String    @default("pending")

  workerId    String?   @map("worker_id")
  heartbeatAt DateTime? @map("heartbeat_at") @db.Timestamptz(6)

  startedAt   DateTime? @map("started_at") @db.Timestamptz(6)
  completedAt DateTime? @map("completed_at") @db.Timestamptz(6)
  error       String?

  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt   DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@index([status, createdAt])
  @@index([sessionId, createdAt])
  @@index([userId])
  @@map("agent_runs")
}
```

- [ ] **Step 2: 创建类型定义**

在 `shared/types/agentRun.ts` 中定义共享类型：

```typescript
export const AGENT_RUN_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const

export type AgentRunStatus = typeof AGENT_RUN_STATUS[keyof typeof AGENT_RUN_STATUS]

export interface AgentRunInput {
  message: string
  command?: unknown
}

export interface AgentStreamEvent {
  type: 'stream_event'
  runId: string
  sessionId: string
  event: 'values' | 'messages' | 'updates'
  data: unknown
}

export interface AgentStatusEvent {
  type: 'status_change'
  runId: string
  sessionId: string
  status: AgentRunStatus
}

export type AgentEvent = AgentStreamEvent | AgentStatusEvent
```

- [ ] **Step 3: 生成迁移文件（不立即应用）**

```bash
bun run prisma:migrate -- --name add_agent_runs --create-only
```

- [ ] **Step 4: 在迁移文件末尾追加 partial unique index**

打开生成的 `prisma/migrations/xxx_add_agent_runs/migration.sql`，追加：

```sql
CREATE UNIQUE INDEX agent_runs_session_active_uq
ON agent_runs (session_id)
WHERE status IN ('pending', 'running');
```

- [ ] **Step 5: 应用迁移**

```bash
bun run prisma:migrate
```

- [ ] **Step 6: 验证**

```bash
npx nuxi typecheck
```

- [ ] **Step 7: 提交**

```bash
git add prisma/models/agentRun.prisma prisma/migrations/ shared/types/agentRun.ts
git commit -m "feat(db): 新增 AgentRun 模型和任务队列表"
```

---

## Task 2: Redis 连接管理

**Files:**
- Create: `server/lib/redis.ts`
- Modify: `.env.example`
- Modify: `nuxt.config.ts`

**依赖:** 无

- [ ] **Step 1: 安装 ioredis**

```bash
bun add ioredis
```

- [ ] **Step 2: 创建 Redis 连接管理**

在 `server/lib/redis.ts` 中实现单例 Redis 客户端管理。项目中 `server/lib/` 已有 `payment/`、`oss/`、`storage/` 等库文件，Redis 客户端放此处符合项目模式。

```typescript
import Redis from 'ioredis'

let redisClient: Redis | null = null
let redisSubscriber: Redis | null = null

/** 获取 Redis 客户端（用于 PUBLISH、XADD 等命令） */
export function getRedisClient(): Redis {
  if (!redisClient) {
    const url = process.env.REDIS_URL
    if (!url) throw new Error('REDIS_URL 环境变量未配置')
    redisClient = new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: true })
    redisClient.on('error', (err) => logger.error('Redis client error:', err))
  }
  return redisClient
}

/** 获取独立的 Redis 订阅客户端（SUBSCRIBE 会独占连接） */
export function getRedisSubscriber(): Redis {
  if (!redisSubscriber) {
    const url = process.env.REDIS_URL
    if (!url) throw new Error('REDIS_URL 环境变量未配置')
    redisSubscriber = new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: true })
    redisSubscriber.on('error', (err) => logger.error('Redis subscriber error:', err))
  }
  return redisSubscriber
}

/** 创建新的独立订阅连接（用于 SSE 端点，每个客户端一个） */
export function createRedisSubscription(): Redis {
  const url = process.env.REDIS_URL
  if (!url) throw new Error('REDIS_URL 环境变量未配置')
  const sub = new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: true })
  sub.on('error', (err) => logger.error('Redis subscription error:', err))
  return sub
}

/** 关闭所有 Redis 连接 */
export async function closeRedisConnections(): Promise<void> {
  await Promise.all([
    redisClient?.quit(),
    redisSubscriber?.quit(),
  ])
  redisClient = null
  redisSubscriber = null
}
```

- [ ] **Step 3: 创建 Agent 专用数据库连接池**

在 `server/lib/redis.ts` 末尾（或新建 `server/lib/agentDb.ts`），创建 Agent 专用的 pg Pool：

```typescript
import pg from 'pg'

let agentPool: pg.Pool | null = null

/** Agent 专用数据库连接池（独立于 Prisma，避免长事务占用业务连接） */
export function getAgentDbPool(): pg.Pool {
  if (!agentPool) {
    const url = process.env.AGENT_DATABASE_URL || process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL 环境变量未配置')
    agentPool = new pg.Pool({ connectionString: url, max: 5 })
    agentPool.on('error', (err) => logger.error('Agent DB pool error:', err))
  }
  return agentPool
}

export async function closeAgentDbPool(): Promise<void> {
  await agentPool?.end()
  agentPool = null
}
```

DAO 中 `claimPendingRunDAO`（需要 `FOR UPDATE SKIP LOCKED`）和心跳/崩溃恢复查询通过此 Pool 执行原生 SQL，其余 CRUD 操作继续使用 Prisma。
```

- [ ] **Step 3: 添加环境变量配置**

在 `.env.example` 添加：

```env
# Agent 后台任务队列
REDIS_URL=redis://localhost:6379
AGENT_DATABASE_URL=                          # 默认等于 DATABASE_URL
AGENT_MAX_CONCURRENT=3                       # 单实例最大并发 Agent 数
AGENT_MAX_USER_CONCURRENT=2                  # 单用户最大并发（跨 session）
AGENT_TIMEOUT_MS=3600000                     # Agent 执行超时（1小时）
AGENT_HEARTBEAT_INTERVAL_MS=15000            # 心跳间隔
AGENT_CRASH_THRESHOLD_MS=60000               # 心跳超时判定崩溃
```

在 `nuxt.config.ts` 的 `runtimeConfig` 中添加对应项（参考现有配置方式）。

- [ ] **Step 4: 验证**

```bash
npx nuxi typecheck
```

- [ ] **Step 5: 提交**

```bash
git add server/lib/redis.ts .env.example nuxt.config.ts package.json bun.lockb
git commit -m "feat(infra): 添加 Redis 连接管理和 Agent 环境变量配置"
```

---

## Task 3: AgentRun DAO 层

**Files:**
- Create: `server/services/agent/agentRun.dao.ts`
- Create: `tests/server/agent/agentRun.dao.test.ts`

**依赖:** Task 1

- [ ] **Step 1: 编写 DAO 测试**

在 `tests/server/agent/agentRun.dao.test.ts` 中编写测试（参考 `tests/server/case/case.dao.test.ts` 的模式）：

```typescript
import { describe, it, expect, beforeEach } from 'vitest'

describe('AgentRun DAO', () => {
  // 测试用例覆盖：
  // 1. createAgentRunDAO - 正常创建
  // 2. createAgentRunDAO - 违反 partial unique index（同 session 已有活跃 run）
  // 3. findActiveRunBySessionIdDAO - 查找活跃 run
  // 4. findActiveRunBySessionIdDAO - 无活跃 run 返回 null
  // 5. claimPendingRunDAO - FOR UPDATE SKIP LOCKED 取任务
  // 6. claimPendingRunDAO - 无 pending 任务返回 null
  // 7. updateRunStatusDAO - 状态变更
  // 8. updateHeartbeatDAO - 心跳更新，返回 affected rows
  // 9. findStaleRunsDAO - 查找心跳超时的任务
  // 10. resetStaleRunDAO - 重置超时任务（含 workerId 条件）
  // 11. countActiveRunsByUserIdDAO - 用户并发计数
  // 12. findRunsBySessionIdDAO - 按 session 查询 run 列表
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/server/agent/agentRun.dao.test.ts --reporter=verbose
```

- [ ] **Step 3: 实现 DAO**

在 `server/services/agent/agentRun.dao.ts` 中实现所有 DAO 函数：

关键函数：
- `createAgentRunDAO(data)` — INSERT 新 run
- `findActiveRunBySessionIdDAO(sessionId)` — WHERE status IN (pending, running)
- `claimPendingRunDAO(workerId)` — `FOR UPDATE SKIP LOCKED` 原子取任务
- `updateRunStatusDAO(id, status, extra?)` — 更新状态和相关时间戳
- `updateHeartbeatDAO(workerId)` — 批量心跳更新
- `findStaleRunsDAO(thresholdMs)` — 查找心跳超时的 running 任务
- `resetStaleRunDAO(id, oldWorkerId)` — 重置超时任务（含 workerId 条件防竞态）
- `countActiveRunsByUserIdDAO(userId)` — 用户活跃 run 计数
- `findRunsBySessionIdDAO(sessionId)` — 按 session 查 run 列表
- `deleteOldRunsDAO(days)` — 清理过期数据

注意：`claimPendingRunDAO` 需要使用 `prisma.$queryRaw` 实现 `FOR UPDATE SKIP LOCKED`，Prisma 不直接支持此语法。

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run tests/server/agent/agentRun.dao.test.ts --reporter=verbose
```

- [ ] **Step 5: 提交**

```bash
git add server/services/agent/agentRun.dao.ts tests/server/agent/agentRun.dao.test.ts
git commit -m "feat(agent): 实现 AgentRun DAO 层（含 FOR UPDATE SKIP LOCKED）"
```

---

## Task 4: AgentRun 服务层

**Files:**
- Create: `server/services/agent/agentRun.service.ts`
- Create: `tests/server/agent/agentRun.service.test.ts`

**依赖:** Task 3

- [ ] **Step 1: 编写服务层测试**

测试覆盖：
1. `enqueueRunService` — 正常入队
2. `enqueueRunService` — 已有活跃 run 时返回已存在的 runId
3. `enqueueRunService` — 用户并发超限时返回错误
4. `getActiveRunService` — 查找当前活跃 run
5. `cancelRunService` — 取消 pending 状态的 run
6. `cancelRunService` — 取消 running 状态的 run（需 mock Redis）
7. `getRunListService` — 查询 run 列表

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/server/agent/agentRun.service.test.ts --reporter=verbose
```

- [ ] **Step 3: 实现服务层**

在 `server/services/agent/agentRun.service.ts` 中实现：

```typescript
/** 入队新 run 或返回已存在的活跃 run */
export async function enqueueRunService(params: {
  sessionId: string
  threadId: string
  userId: number
  caseId: number
  input: AgentRunInput
}): Promise<{ runId: string; isNew: boolean } | { error: string }>

/** 查找 session 的当前活跃 run */
export async function getActiveRunService(sessionId: string): Promise<AgentRun | null>

/** 取消 run（处理 pending 和 running 两种状态） */
export async function cancelRunService(runId: string): Promise<{ success: boolean; error?: string }>

/** 查询 session 的 run 列表 */
export async function getRunListService(sessionId: string): Promise<AgentRun[]>
```

`cancelRunService` 中 running 状态的取消需要调用 Redis PUBLISH，此处导入 `getRedisClient()` 发布取消信号。

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run tests/server/agent/agentRun.service.test.ts --reporter=verbose
```

- [ ] **Step 5: 提交**

```bash
git add server/services/agent/agentRun.service.ts tests/server/agent/agentRun.service.test.ts
git commit -m "feat(agent): 实现 AgentRun 服务层（入队、取消、查询）"
```

---

## Task 5: 事件桥接层（Redis ↔ SSE）

**Files:**
- Create: `server/services/agent/agentEventBridge.ts`
- Create: `tests/server/agent/agentEventBridge.test.ts`

**依赖:** Task 2

- [ ] **Step 1: 编写事件桥接测试**

测试覆盖：
1. `publishAgentEvent` — 发布事件到 pub/sub + 写入 Stream
2. `publishStatusChange` — 发布状态变更事件
3. `replayEvents` — 从 Stream 补发缺失事件（XRANGE）
4. `createEventSubscription` — 创建 pub/sub 订阅，返回 AsyncGenerator
5. 内存队列降级 — Redis 断连时缓存事件，恢复后补发

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/server/agent/agentEventBridge.test.ts --reporter=verbose
```

- [ ] **Step 3: 实现事件桥接**

```typescript
import { getRedisClient, createRedisSubscription } from '~~/server/lib/redis'

/** 发布 Agent 事件（pub/sub + stream 双写） */
export async function publishAgentEvent(event: AgentStreamEvent): Promise<void> {
  const redis = getRedisClient()
  const payload = JSON.stringify(event)
  await Promise.all([
    redis.publish(`run:${event.runId}`, payload),
    redis.xadd(`run_events:${event.runId}`, 'MAXLEN', '~', '2000', '*',
      'payload', payload),
  ])
}

/** 发布状态变更事件 */
export async function publishStatusChange(event: AgentStatusEvent): Promise<void> {
  const redis = getRedisClient()
  const payload = JSON.stringify(event)
  await Promise.all([
    redis.publish(`run:${event.runId}`, payload),
    redis.xadd(`run_events:${event.runId}`, 'MAXLEN', '~', '2000', '*',
      'payload', payload),
  ])
  // 设置 Stream 7 天过期
  await redis.expire(`run_events:${event.runId}`, 7 * 24 * 3600)
}

/** 从 Stream 补发缺失事件 */
export async function replayEvents(
  runId: string,
  lastEventId: string = '0-0'
): Promise<AgentEvent[]>

/** 创建事件订阅（返回 AsyncGenerator，用于 SSE 推送） */
export async function* createEventSubscription(
  runId: string,
  signal: AbortSignal
): AsyncGenerator<AgentEvent>
```

`createEventSubscription` 内部：
1. 创建独立 Redis 连接（`createRedisSubscription()`）
2. SUBSCRIBE `run:{runId}`
3. 通过 Promise + event listener 转为 AsyncGenerator
4. signal.abort 时 unsubscribe 并关闭连接
5. 连接设置 30 分钟空闲超时，防止泄漏

**Redis 断连降级**：在 `publishAgentEvent` 和 `publishStatusChange` 中：
1. 维护进程内内存队列 `pendingEvents: AgentEvent[]`
2. Redis 正常时直接发布；断连时写入内存队列
3. 内存队列上限 1000 条，超限只保留 `status_change` 类型事件
4. 内存队列最大保持 5 分钟，超时丢弃并 `logger.error` 记录
5. Redis 连接恢复时（通过 `ioredis` 的 `reconnecting` 事件），将内存队列补发到 Redis Stream
6. 通过 `getRedisClient().status` 判断连接状态

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run tests/server/agent/agentEventBridge.test.ts --reporter=verbose
```

- [ ] **Step 5: 提交**

```bash
git add server/services/agent/agentEventBridge.ts tests/server/agent/agentEventBridge.test.ts
git commit -m "feat(agent): 实现 Redis 事件桥接（pub/sub + stream 双写 + 订阅）"
```

---

## Task 6: Agent Worker 核心

**Files:**
- Create: `server/services/agent/agentWorker.ts`
- Create: `tests/server/agent/agentWorker.test.ts`

**依赖:** Task 3, Task 4, Task 5

- [ ] **Step 1: 编写 Worker 测试**

测试覆盖：
1. `AgentWorker.start()` — 启动后订阅 agent_tasks 频道
2. `AgentWorker.processNextTask()` — 取到 pending 任务并执行
3. `AgentWorker.processNextTask()` — 并发已满时不取任务
4. `AgentWorker.processNextTask()` — isShuttingDown 时不取任务
5. 心跳机制 — 定期更新 heartbeatAt
6. 心跳失败 — UPDATE 返回 0 时 abort 执行中的 run
7. 崩溃恢复 — 发现 stale runs 并重置为 pending
8. 取消信号 — 收到 run_cancel 后 abort 对应 run
9. 超时处理 — 超过 AGENT_TIMEOUT_MS 后 abort
10. `AgentWorker.shutdown()` — graceful shutdown 等待执行中任务完成

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/server/agent/agentWorker.test.ts --reporter=verbose
```

- [ ] **Step 3: 实现 Worker**

```typescript
export class AgentWorker {
  private workerId: string
  private activeRuns: Map<string, AbortController> = new Map()
  private isShuttingDown = false
  private heartbeatTimer: NodeJS.Timeout | null = null
  private crashCheckTimer: NodeJS.Timeout | null = null

  constructor() {
    this.workerId = `worker-${crypto.randomUUID().slice(0, 8)}`
  }

  /** 启动 Worker */
  async start(): Promise<void>
  // start() 内部流程：
  // 1. 订阅 Redis agent_tasks 和 run_cancel:* 频道
  // 2. 启动心跳循环
  // 3. 启动崩溃恢复检查
  // 4. 主动扫描一次 pending 任务（处理 Worker 重启期间入队的任务）
  //    → 调用 processNextTask() 直到无 pending 任务或并发已满

  /** 处理下一个待执行任务 */
  async processNextTask(): Promise<void>

  /** 执行单个 run（内部方法） */
  private async executeRun(run: AgentRun): Promise<void>

  /** 心跳更新循环 */
  private startHeartbeat(): void

  /** 崩溃恢复检查循环 */
  private startCrashRecovery(): void

  /** 优雅关闭 */
  async shutdown(): Promise<void>
}
```

`executeRun` 核心流程：
1. 创建 AbortController，存入 activeRuns
2. 设置超时计时器（AGENT_TIMEOUT_MS）
3. 调用 `runCaseChat(sessionId, message, options)`
4. 遍历返回的 stream/generator，每个事件：
   - 调用 `publishAgentEvent()` 发到 Redis
5. 完成后更新状态为 completed
6. 异常时更新状态为 failed
7. 从 activeRuns 移除，发布 status_change

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run tests/server/agent/agentWorker.test.ts --reporter=verbose
```

- [ ] **Step 5: 提交**

```bash
git add server/services/agent/agentWorker.ts tests/server/agent/agentWorker.test.ts
git commit -m "feat(agent): 实现 Worker 核心（取任务、执行、心跳、崩溃恢复）"
```

---

## Task 7: runCaseChat 接口适配

**Files:**
- Modify: `server/services/agent/caseAgent.ts`

**依赖:** Task 6

- [ ] **Step 1: 修改 runCaseChat 返回 AsyncGenerator**

当前 `runCaseChat` 返回 `ReadableStream`（SSE 编码），Worker 不需要 SSE 编码，直接消费结构化事件更高效。

添加新函数 `runCaseChatStream`，返回 `AsyncGenerator<StreamEvent>`，保留原 `runCaseChat` 不变（向后兼容），Worker 调用新函数。

```typescript
/** Worker 使用的 Agent 执行入口，返回结构化事件流 */
export async function* runCaseChatStream(
  sessionId: string,
  message: string,
  options: CaseAgentOptions & { signal?: AbortSignal }
): AsyncGenerator<{ event: string; data: unknown }>
```

内部实现：调用 `agent.stream()` 并遍历，`yield` 每个事件的 `{ event, data }` 结构化对象（不做 SSE 编码）。

- [ ] **Step 2: 验证类型检查**

```bash
npx nuxi typecheck
```

- [ ] **Step 3: 提交**

```bash
git add server/services/agent/caseAgent.ts
git commit -m "feat(agent): 新增 runCaseChatStream 返回结构化事件流"
```

---

## Task 8: chat.post.ts 改造

**Files:**
- Modify: `server/api/v1/case/analysis/chat.post.ts`

**依赖:** Task 4, Task 5

- [ ] **Step 1: 改造 chat.post.ts**

将现有的"直接执行 + 返回 SSE 流"改为"入队 + 订阅 Redis + 转发 SSE"：

核心变更（四种分支逻辑）：

```
已有活跃 run + 有新消息 → 返回错误 "请等待当前分析完成"
已有活跃 run + 无新消息 → 进入订阅模式（重连场景）
无活跃 run + 有消息     → 入队新 run + 订阅
无活跃 run + 无消息     → 返回错误 "消息不能为空"
```

详细步骤：
1. 验证参数、权限（不变）
2. 查询活跃 run：`getActiveRunService(sessionId)`
3. 根据上述四种分支处理：
   - 入队场景：调用 `enqueueRunService()` + `PUBLISH agent_tasks`
   - 订阅场景：直接使用已有 runId
4. SUBSCRIBE run:{runId} 订阅 Redis 事件
5. 返回 SSE 流（把 Redis 事件转为 SSE 格式推给客户端）
   - 在任务 pending 等待期间，定期发送 SSE 心跳注释（`: keepalive\n\n`），
     防止 Nginx/CDN/LB 超时断开连接（通常 60s）
6. 客户端断开 → 取消 Redis 订阅，Agent 继续执行

```typescript
export default defineEventHandler(async (event) => {
  // 1-4: 验证参数、权限（不变）
  // ...

  // 5. 入队或获取已有 run
  const result = await enqueueRunService({
    sessionId, threadId: sessionId,
    userId: user.id, caseId: caseInfo.id,
    input: { message: userMessage, command },
  })
  if ('error' in result) return resError(event, 429, result.error)

  const { runId } = result

  // 6. 设置 SSE 响应头
  setResponseHeaders(event, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  // 7. 创建 SSE 流
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const abortController = new AbortController()

      // 心跳定时器
      const keepalive = setInterval(() => {
        controller.enqueue(encoder.encode(': keepalive\n\n'))
      }, 15000)

      try {
        // 补发缺失事件
        const missed = await replayEvents(runId)
        for (const evt of missed) {
          controller.enqueue(encoder.encode(
            `event: ${evt.type === 'stream_event' ? evt.event : 'status'}\ndata: ${JSON.stringify(evt.data)}\n\n`
          ))
        }

        // 订阅实时事件
        for await (const evt of createEventSubscription(runId, abortController.signal)) {
          if (evt.type === 'status_change' && ['completed', 'failed', 'cancelled'].includes(evt.status)) {
            controller.enqueue(encoder.encode(`event: status\ndata: ${JSON.stringify(evt)}\n\n`))
            break  // run 结束，关闭 SSE
          }
          if (evt.type === 'stream_event') {
            controller.enqueue(encoder.encode(
              `event: ${evt.event}\ndata: ${JSON.stringify(evt.data)}\n\n`
            ))
          }
        }
      } finally {
        clearInterval(keepalive)
        abortController.abort()
        controller.close()
      }
    },
    cancel() {
      // 客户端断开，不做其他操作（Agent 继续执行）
    }
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream' },
  })
})
```

**注意**：需确保 SSE 事件格式与 `@langchain/vue` 的 `FetchStreamTransport` 兼容。原来 `toEventStream()` 生成的格式是 `event: values\ndata: {...}\n\n`，新实现需保持一致。

- [ ] **Step 2: 验证类型检查**

```bash
npx nuxi typecheck
```

- [ ] **Step 3: 提交**

```bash
git add server/api/v1/case/analysis/chat.post.ts
git commit -m "refactor(analysis): chat API 改为入队+订阅+转发模式"
```

---

## Task 9: Thread 管理 API

**Files:**
- Create: `server/api/v1/case/analysis/runs/[sessionId].get.ts`
- Create: `server/api/v1/case/analysis/runs/[sessionId]/current.get.ts`
- Create: `server/api/v1/case/analysis/runs/[runId]/cancel.post.ts`

**依赖:** Task 4

- [ ] **Step 1: 实现 run 列表查询 API**

`server/api/v1/case/analysis/runs/[sessionId].get.ts`：

```typescript
export default defineEventHandler(async (event) => {
  const user = event.context.auth?.user
  if (!user) return resError(event, 401, '请先登录')

  const sessionId = getRouterParam(event, 'sessionId')
  if (!sessionId) return resError(event, 400, 'sessionId 不能为空')

  // 验证权限
  const caseInfo = await findCaseBySessionIdService(sessionId)
  if (!caseInfo || user.id !== caseInfo.userId) {
    return resError(event, 403, '无权访问')
  }

  const runs = await getRunListService(sessionId)
  return resSuccess(event, '获取成功', { runs })
})
```

- [ ] **Step 2: 实现当前活跃 run 查询 API**

`server/api/v1/case/analysis/runs/[sessionId]/current.get.ts`：

返回当前 pending/running 的 run，无则 `data: { run: null }`。

- [ ] **Step 3: 实现取消 run API**

`server/api/v1/case/analysis/runs/cancel/[runId].post.ts`：

调用 `cancelRunService(runId)`，返回结果。

- [ ] **Step 4: 验证类型检查**

```bash
npx nuxi typecheck
```

- [ ] **Step 5: 提交**

```bash
git add server/api/v1/case/analysis/runs/
git commit -m "feat(analysis): 新增 Thread 管理 API（run 列表、当前 run、取消）"
```

---

## Task 10: Nitro Plugin — Worker 生命周期

**Files:**
- Create: `server/plugins/agent-worker.ts`

**依赖:** Task 6

- [ ] **Step 1: 实现 Nitro Plugin**

```typescript
import { AgentWorker } from '~~/server/services/agent/agentWorker'

let worker: AgentWorker | null = null

export default defineNitroPlugin((nitroApp) => {
  // 只在 REDIS_URL 配置了的情况下启动 Worker
  if (!process.env.REDIS_URL) {
    logger.warn('REDIS_URL 未配置，Agent Worker 不启动')
    return
  }

  worker = new AgentWorker()
  worker.start().catch((err) => {
    logger.error('Agent Worker 启动失败:', err)
  })

  // 注册清理定时任务（每 24 小时执行一次）
  const cleanupTimer = setInterval(async () => {
    try {
      await deleteOldRunsDAO(90)
      logger.info('Agent runs 清理完成')
    } catch (err) {
      logger.error('Agent runs 清理失败:', err)
    }
  }, 24 * 60 * 60 * 1000)

  // Graceful shutdown
  nitroApp.hooks.hook('close', async () => {
    clearInterval(cleanupTimer)
    if (worker) {
      await worker.shutdown()
      worker = null
    }
    await closeAgentDbPool()
    await closeRedisConnections()
  })
})
```

- [ ] **Step 2: 验证类型检查**

```bash
npx nuxi typecheck
```

- [ ] **Step 3: 提交**

```bash
git add server/plugins/agent-worker.ts
git commit -m "feat(agent): 添加 Worker Nitro Plugin（生命周期管理+定时清理）"
```

---

## Task 11: 前端重连适配

**Files:**
- Modify: `app/pages/dashboard/analysis/[sessionId].vue`

**依赖:** Task 8, Task 9

- [ ] **Step 1: 添加重连逻辑**

页面 `onMounted` 时检查是否有活跃 run，如果有则自动重连：

```typescript
// 页面进入时检查活跃 run
const { data: activeRun } = await useApiFetch(
  `/api/v1/case/analysis/runs/${sessionId}/current`
)

if (activeRun.value?.run?.status === 'running') {
  // 有正在执行的 run，触发 submit 建立 SSE 连接
  // useStream 会通过 chat.post.ts 自动订阅 Redis 事件
  stream.submit(
    { messages: [] },  // 空消息，chat.post.ts 会检测到已有活跃 run
    { streamResumable: true }
  )
}
```

**注意**：具体实现需根据 `@langchain/vue` 的 `useStream` API 适配。核心原则是让 `chat.post.ts` 检测到已有活跃 run 后进入订阅模式而非入队新任务。

- [ ] **Step 2: 验证类型检查**

```bash
npx nuxi typecheck
```

- [ ] **Step 3: 提交**

```bash
git add app/pages/dashboard/analysis/[sessionId].vue
git commit -m "feat(analysis): 前端页面进入时自动检测活跃 run 并重连"
```

---

## Task 12: 集成验证

**依赖:** 所有前序 Task

- [ ] **Step 1: 运行全量测试**

```bash
npx vitest run tests/server/agent/ --reporter=verbose
```

- [ ] **Step 2: 类型检查**

```bash
npx nuxi typecheck
```

- [ ] **Step 3: 手动端到端验证**

启动开发服务器，验证以下场景：
1. 发送消息 → Agent 后台执行 → SSE 实时收到事件
2. 关闭页面 → Agent 继续执行 → 重新打开页面看到完成的结果
3. 执行中刷新页面 → 自动重连 → 继续收到后续事件
4. 取消正在执行的分析 → Agent 停止 → 状态变为 cancelled
5. 多实例模拟 → 启动两个 dev server → 验证任务不重复执行

- [ ] **Step 4: 使用 simplify 技能优化代码**

- [ ] **Step 5: 最终提交**

```bash
git add -A
git commit -m "feat(agent): 完成后台任务队列集成验证"
```
