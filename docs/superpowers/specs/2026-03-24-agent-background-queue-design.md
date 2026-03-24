# Agent 后台任务队列设计

## 背景

当前 Agent 执行绑定在 HTTP 请求生命周期内，用户关闭页面或断网时 Agent 停止执行。需要将 Agent 执行从 HTTP 生命周期解耦，实现：

1. **后台执行**：用户离开页面后 Agent 继续运行
2. **实时推送**：在线用户实时接收 Agent 事件
3. **断线重连**：用户重连后无缝恢复事件流
4. **Thread 管理 API**：查询 run 状态、取消执行

## 技术选型

**PostgreSQL 任务队列 + Redis 事件分发**（方案 B）

- PostgreSQL（已有）：存储任务记录（`agent_runs` 表），利用 `FOR UPDATE SKIP LOCKED` 实现多实例安全取任务
- Redis（外部服务）：pub/sub 实时事件广播 + Stream 持久化事件供重连补发
- Worker 在 Nuxt Server 进程内运行，无需独立部署

选型理由：
- PG LISTEN/NOTIFY 有 8KB payload 限制，Agent 事件可能超限，需要额外的大事件处理逻辑
- Redis pub/sub 无大小限制，Redis Stream 天然支持 `> lastId` 消费，重连补发逻辑简洁
- 项目已有多实例部署需求，Redis 天然跨实例

## 整体架构

```
┌─────────────┐         ┌──────────────────────────────────────┐
│   浏览器     │  SSE    │       Nuxt Server 实例（多个）         │
│  (Vue App)  │◄───────►│                                      │
│             │         │  ┌──────────┐    ┌────────────────┐  │
│  useStream  │         │  │  API 层   │    │  Agent Worker  │  │
│  reconnect  │         │  │ 入队任务   │    │  消费任务执行   │  │
│             │         │  └─────┬────┘    └───────┬────────┘  │
└─────────────┘         └───────┼──────────────────┼───────────┘
                                │                  │
                   ┌────────────▼──────────────────▼────────────┐
                   │                 Redis                       │
                   │  pub/sub: 实时事件广播（跨实例）              │
                   │  stream: 事件持久化（重连补发）               │
                   │  pub/sub: 任务信号 + 取消信号                │
                   └────────────────────────────────────────────┘
                                │
                   ┌────────────▼───────────────────────────────┐
                   │              PostgreSQL                     │
                   │  agent_runs: 任务队列                       │
                   │  checkpoints: Agent 状态持久化（已有）       │
                   └────────────────────────────────────────────┘
```

## 数据模型

### agent_runs 表

```prisma
model AgentRun {
  id          String    @id @default(uuid())
  sessionId   String    // 关联 caseSession
  threadId    String    // LangGraph thread_id（= sessionId）
  userId      Int
  caseId      Int

  input       Json      // { message, command? }

  status      String    @default("pending")
  // pending → running → completed / failed / cancelled

  workerId    String?   // 执行该任务的实例标识
  heartbeatAt DateTime? // Worker 心跳时间

  startedAt   DateTime?
  completedAt DateTime?
  error       String?

  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  @@index([status, createdAt])
  @@index([sessionId, createdAt])
  @@index([userId])
  @@map("agent_runs")
}
```

### Redis 数据结构

| 用途 | 数据结构 | Key 格式 | 说明 |
|------|---------|---------|------|
| 事件广播 | Pub/Sub | `run:{runId}` | Agent 实时事件，在线客户端立即收到 |
| 事件持久化 | Stream | `run_events:{runId}` | 按 run 隔离的事件流，支持重连补发 |
| 任务通知 | Pub/Sub | `agent_tasks` | 新任务入队时通知 Worker |
| 取消信号 | Pub/Sub | `run_cancel:{runId}` | 跨实例取消任务 |

### Redis 事件格式

```typescript
// Agent 流式事件
{
  type: "stream_event",
  runId: string,
  sessionId: string,
  event: "values" | "messages" | "updates",
  data: object
}

// 状态变更事件
{
  type: "status_change",
  runId: string,
  sessionId: string,
  status: "running" | "completed" | "failed" | "cancelled"
}
```

### Redis Stream 清理策略

- `MAXLEN ~2000`：每个 run 最多保留 2000 条事件（复杂分析单次 run 可能产生数百条事件）
- `EXPIRE 7 天`：过期自动清理

## Worker 设计

### 生命周期

Worker 通过 Nitro Plugin 注册（`server/plugins/agent-worker.ts`），跟随 Nuxt Server 启动/关闭。

```
Nuxt 启动
  → 生成 workerId（实例唯一标识）
  → 订阅 Redis agent_tasks 频道
  → 订阅 Redis run_cancel:* 频道
  → 启动心跳循环
  → 启动崩溃恢复检查

Nuxt 关闭（graceful shutdown）
  → 设置 isShuttingDown = true，立即停止接受新任务
  → 取消 Redis agent_tasks 订阅
  → 等待正在执行的 Agent 完成（超时 30s 强制终止）
  → 取消剩余 Redis 订阅，释放资源
```

### 并发控制

```typescript
const MAX_CONCURRENT = Number(process.env.AGENT_MAX_CONCURRENT || 3)

// 每个实例各自维护计数
// 总并发 = 实例数 × MAX_CONCURRENT
activeRuns: Map<string, AbortController>
```

取任务时检查 `activeRuns.size < MAX_CONCURRENT`，超限则不消费。

### 任务执行流程

```
1. 收到 agent_tasks 信号 / 定期检查
2. SELECT ... FOR UPDATE SKIP LOCKED 取 pending 任务
3. 设置 status = running, workerId, startedAt, heartbeatAt
4. 调用 runCaseChat(sessionId, message, options)
5. 遍历 Agent stream：
   - PUBLISH run:{runId} （实时广播）
   - XADD run_events:{runId} （持久化）
6. 执行完毕：
   - 成功 → status = completed, completedAt
   - 失败 → status = failed, error
7. 发布 status_change 事件
8. 从 activeRuns 移除
9. 检查是否有新的 pending 任务
```

### 心跳机制

```
每 15s 更新一次 heartbeatAt
  UPDATE agent_runs SET heartbeat_at = NOW()
  WHERE worker_id = :workerId AND status = 'running'

如果 UPDATE 返回 0 affected rows（任务已被崩溃恢复重置），
  → 主动 abort 该 run，停止执行
```

### 取消机制

```
用户发取消请求 → 任意实例收到

pending 状态：
  → UPDATE status = 'cancelled' WHERE id = :runId AND status = 'pending'
  → 直接完成，无需通知 Worker

running 状态：
  → agent_runs.status = cancelled
  → PUBLISH run_cancel:{runId}
  → 执行该任务的实例收到信号 → AbortController.abort()
  → checkpoint 保留当前进度
```

### 崩溃恢复

```
每个实例启动时 + 每 60s 检查一次：
  SELECT * FROM agent_runs
  WHERE status = 'running'
  AND heartbeat_at < NOW() - INTERVAL '60 seconds'

匹配到的任务：
  → UPDATE status = 'pending', workerId = null
    WHERE id = :id AND status = 'running' AND worker_id = :oldWorkerId
    （加 worker_id 条件防止与正常心跳竞态）
  → Worker 自动重新取到并执行
  → Agent 从 checkpoint 恢复，不重复已完成的工作
```

### Agent 执行超时

```
Agent 执行超过 1 小时（可通过 AGENT_TIMEOUT_MS 环境变量配置）
  → Worker 触发 AbortController.abort()
  → status = failed, error = "执行超时"
  → checkpoint 保留当前进度，用户可重新触发继续分析
```

## SSE 端点与前端适配

### chat.post.ts 改造

保持 `FetchStreamTransport` 兼容，前端代码几乎不变。内部逻辑改为：

```
1. 验证参数、权限（不变）
2. 检查重复提交：该 session 是否有 pending/running 的 run
   - 有 → 使用已存在的 runId
   - 无 → 写入 agent_runs（pending），PUBLISH agent_tasks
   - 约束：同一 sessionId 同时只允许一个 pending/running 的 run
     （通过数据库 partial unique index 保证：见下方并发安全章节）
3. SUBSCRIBE run:{runId} 订阅 Redis 事件
4. 返回 SSE 流（把 Redis 事件转为 SSE 格式推给客户端）
   - 在任务 pending 等待期间，定期发送 SSE 心跳注释（: keepalive），
     防止 Nginx/CDN/LB 超时断开连接（通常 60s）
5. 客户端断开 → 取消 Redis 订阅，Agent 继续执行
```

外部行为不变：前端 submit → 收到 SSE 流。内部从"同步执行"变为"入队 + 转发"。

### 重连流程

```
页面刷新 / 网络恢复
  → useStream 加载 thread 历史（现有 thread API 不变）
  → 检查是否有 running 的 run（GET /runs/current/{sessionId}）
  → 有 → chat.post.ts 建立 SSE 连接
       → XRANGE run_events:{runId} lastEventId+ 补发缺失事件
       → SUBSCRIBE run:{runId} 接续新事件
  → 无 → 正常等待用户输入
```

## Thread 管理 API

### 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/case/analysis/runs/{sessionId}` | 查询 session 的 run 列表 |
| GET | `/api/v1/case/analysis/runs/current/{sessionId}` | 查询当前活跃 run |
| POST | `/api/v1/case/analysis/runs/cancel/{runId}` | 取消执行中的 run |

### 响应格式

**查询 run 列表**：
```json
{
  "code": 200,
  "data": {
    "runs": [
      { "id": "uuid", "status": "completed", "createdAt": "...", "startedAt": "...", "completedAt": "..." },
      { "id": "uuid", "status": "running", "createdAt": "...", "startedAt": "..." }
    ]
  }
}
```

**查询当前活跃 run**：
```json
{
  "code": 200,
  "data": {
    "run": { "id": "uuid", "status": "running", "startedAt": "..." }
  }
}
```
`run` 为 `null` 表示没有执行中的任务。

**取消 run**：
```json
{
  "code": 200,
  "data": { "runId": "uuid", "status": "cancelled" }
}
```

### 与现有 API 的关系

现有 `GET /api/v1/case/analysis/thread/{sessionId}` 保持不变（从 checkpoint 读取对话历史）。runs API 是补充层：thread API 管对话内容，runs API 管执行状态。

## 数据库连接隔离

Agent 执行长期占用连接，需要与业务连接池隔离：

```env
DATABASE_URL=postgresql://...        # 业务用（Prisma 连接池）
AGENT_DATABASE_URL=postgresql://...  # Agent 用（默认等于 DATABASE_URL）
REDIS_URL=redis://...                # Redis 外部服务
```

- Prisma 连接池：业务 API 专用
- Agent 专用连接池（pg 原生 Pool）：checkpointer + agent_runs 操作
- 当前两者指向同一个库，未来性能瓶颈出现时只需修改 `AGENT_DATABASE_URL` 指向独立 PG 实例

## 错误处理

### 重复提交

同一 session 同时只允许一个 pending/running 的 run。通过数据库 partial unique index 保证多实例安全：

```sql
CREATE UNIQUE INDEX agent_runs_session_active_uq
ON agent_runs (session_id)
WHERE status IN ('pending', 'running');
```

chat.post.ts 检查该 session 是否有 pending/running 的 run，有则返回已存在的 runId，不重复入队。如果发生并发插入竞态，数据库索引会拒绝第二条记录。

### 用户并发限制

单用户跨 session 最多允许 2 个活跃 run（可通过 `AGENT_MAX_USER_CONCURRENT` 配置）。入队时检查：

```sql
SELECT COUNT(*) FROM agent_runs
WHERE user_id = :userId AND status IN ('pending', 'running')
```

超限返回错误提示"您有正在进行的分析任务，请等待完成后再试"。

### Redis 断连

- Worker 侧：Agent 继续执行（不依赖 Redis），事件暂存内存队列（上限 1000 条，超限只保留 status_change 事件）
- SSE 侧：客户端感知断连，自动重连
- Redis 恢复后：内存队列事件补发到 Redis Stream，客户端重连时通过 XRANGE 补发
- 内存队列最大保持 5 分钟，超时丢弃并记录日志

### 数据清理

通过 Nitro Plugin 注册定时清理任务（每天执行一次）：
- `agent_runs`：删除 90 天前的记录
- Redis Stream：`MAXLEN ~2000` + `EXPIRE 7 天`（已在写入时自动控制）

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `AGENT_DATABASE_URL` | 等于 `DATABASE_URL` | Agent 专用数据库连接 |
| `REDIS_URL` | 无（必填） | Redis 连接地址 |
| `AGENT_MAX_CONCURRENT` | `3` | 单实例最大并发 Agent 数 |
| `AGENT_MAX_USER_CONCURRENT` | `2` | 单用户最大并发 Agent 数（跨 session） |
| `AGENT_TIMEOUT_MS` | `3600000` | Agent 执行超时（1 小时） |
| `AGENT_HEARTBEAT_INTERVAL_MS` | `15000` | 心跳间隔 |
| `AGENT_CRASH_THRESHOLD_MS` | `60000` | 心跳超时判定崩溃 |
