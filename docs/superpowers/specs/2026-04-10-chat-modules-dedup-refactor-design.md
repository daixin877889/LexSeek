# 三模块基础设施统一重构设计

> **版本**: v1.2（全局审视修订版）
> **日期**: 2026-04-10
> **范围**: init-analysis 初始化分析、案件分析页、模块对话、小索对话框（共四个消费方）
> **目标**: 共享同一套基础设施（工具/中间件/Session DAO/UI/Composable），保留"工作流"+"Agent 对话"两种顶层模式

## 1. 背景与动机

### 1.1 问题陈述

LexSeek 的 AI 分析功能有**四个前端消费方**，在从分析服务到前端 UI 的完整链路中存在约 450-500 行重复代码：

| 消费方 | 入口文件 | 模式 |
|---|---|---|
| 初始化分析 | `app/pages/dashboard/cases/init-analysis/[sessionId].vue` | 工作流（多模块串行） |
| 案件分析页 | `app/pages/dashboard/analysis/[sessionId].vue` | 工作流（单模块对话） |
| 模块对话 | `app/components/case/AnalysisModuleChat.vue`（挂载于 `[id].vue`） | Agent 对话（多模块浮窗） |
| 小索对话框 | `app/components/caseDetail/CaseDetailXiaosuo.vue`（挂载于 `[id].vue`） | Agent 对话（多 session） |

主要重复集中在：

- **Composable 层**：`useXiaosuoChat`（212 行）和 `useModuleChatManager`（231 行）在 effectScope 管理、stopGeneration 双重取消、reconnect/loadHistory 判定三个关键点的代码相似度 ≥ 90%
- **后端 Session CRUD**：`xiaosuo-session*.ts` 和 `module-session*.ts` 四个 API 文件是典型的模板复制（重复度 85-95%）
- **UI 组件层**：`CaseDetailXiaosuo.vue` 和 `AnalysisModuleChat.vue` 共享 90% 的窗口布局代码
- **中断处理**：三个消费方（init-analysis、案件分析页、小索）各自实现 `__interrupt__` 解包 + `Dialog + InsufficientPointsCard` 包装。**模块对话当前完全没有中断 UI**——触发积分不足时用户看不到任何提示

### 1.2 设计原则

1. **底层不动**：`agentRun.service.ts`、`agentEventBridge.ts`、4 个中间件已良性复用，不做改动
2. **中间层抽象**：新增 Session DAO + `useStreamChat` + `useChatSessionManager` 作为"薄胶水层"
3. **上层保持差异化**：`useInitAnalysis`（工作流模式）和 `useModuleChatManager` / `useXiaosuoChat`（对话模式）保持各自的业务逻辑，但改为**继承**而非**复制**
4. **SSE 入口保留两条**：`/init-analysis`（工作流专用）+ `/chat`（对话共用）不合并

### 1.3 需求变更

- **模块对话多 session 支持**：模块对话从"每案件每模块最多一个 session"改为多 session 模式（与小索对齐），用户可以为同一模块创建多个独立对话，避免老对话上下文污染
- **Session 标题**：自动生成格式 `模块名-YYMMDDHHmm`（例如 `证据清单梳理-2604102055`），支持重命名
- **模块对话新增中断 UI**：当前 `AnalysisModuleChat.vue` 完全没有中断处理——触发积分不足时用户看不到任何提示。本次重构为其**新增** `InterruptHandler` 组件（这不是"去重"而是补齐功能缺失）
- **统一中断调度器**：`InterruptHandler` 按 `InterruptType` 分发，支持全部 4 种中断类型（`insufficient_points` 立即实现，其他 3 种预留框架）
- **thinking 模式说明**：thinking 参数仅对话模式（模块对话/小索）支持。工作流模式（init-analysis）不由用户控制 thinking

### 1.4 约束

- **数据库兼容性**：允许追加式 schema 变化（可加字段/索引），旧字段不删、旧记录不丢，metadata 结构变更需迁移脚本
- `caseSessions.type` 含义保留：1（小索）、2（init-analysis）、3（模块对话）
- `app/components/ui/*` shadcn-vue 组件禁止修改
- **Redis 已有依赖**：项目通过 `server/lib/redis.ts` 提供 Redis 客户端，`agentEventBridge.ts`、`agentRun.service.ts`、`agentWorker.ts` 等均使用 Redis。本次新增的并发防重可直接复用。**Key 命名空间区分**：session 状态存储使用 `session_state:*`（上下文工程优化已有），并发防重使用 `session_dedupe:*`（本次新增），两者 TTL 不同、互不干扰
- **Session DAO 服务范围**：`session.dao.ts` 仅服务 type=1（小索）和 type=3（模块对话）。type=2（init-analysis）由工作流内部管理（`init-analysis.post.ts`），不走 session CRUD API

### 1.5 范围说明

`app/pages/dashboard/analysis/[sessionId].vue`（案件分析页）使用独立的 `reactive(useStream(...))` 创建流，并有自己的 `interrupt` / `interruptData` 解包逻辑（第 157-169 行）和 Dialog 包装（第 15-31 行）。该页面纳入 Phase 4 的对齐范围，改为使用 `useStreamChat` 底层和 `<InterruptHandler>` 组件。**注意**：该页面有独特的三层消息合并逻辑（`historyMessages` / `streamMessages` / `displayMessages`，第 98-147 行）和自定义 `coerceRawMessages` 函数（第 77-95 行），这些**保留不动**，只替换底层 stream 创建和 interrupt 处理。

### 1.6 遗留系统清理（Phase 5）

全局调研发现以下**疑似死代码**（没有任何消费方引用）：

| 文件 | 行数 | 状态 |
|---|---|---|
| `app/composables/useCaseAnalysis.ts` | 1010 | 旧 SSE 客户端（手动 fetch + ReadableStream），被新的 useCaseChat 替代 |
| `app/components/case/InterruptConfirmation.vue` | ~80 | 旧中断 dispatcher，被新的 InterruptHandler 替代 |
| `app/components/case/ConversationList.vue` | ~50 | 旧对话列表，未被引用 |
| `app/components/case/AIResponse.vue` | ~30 | 旧 AI 响应组件，未被引用 |
| `server/api/v1/case/analysis/stream/[sessionId].post.ts` | ~100 | 旧 SSE API，被 `/chat` 替代 |
| `server/api/v1/case/analysis/stream/index.post.ts` | ~80 | 旧 SSE API |

**处理策略**：先验证后清理——在重构 PR 全部合并后，单独的 PR #5 做死代码清理。验证方式：
1. grep 确认无引用
2. 检查 Nuxt auto-import 是否可能隐式加载这些组件
3. 确认旧 stream API 在生产环境无流量
4. `case/interrupt/` 下的 4 个 Handler 组件（CaseInfoCheckHandler、BasicInfoConfirmHandler、ModuleSelectHandler、InsufficientPointsHandler）**不清理**——它们是独立的高质量 UI 组件，可被 InterruptHandler 未来扩展复用

## 2. 整体架构

```
┌─────────────────────────────────────────────────────┐
│              Page / Component Layer                  │
│                                                      │
│  init-analysis/   analysis/     [id].vue             │
│  [sessionId].vue  [sessionId]   ├ ModuleChat         │
│                   .vue          └ Xiaosuo            │
├─────────────────────────────────────────────────────┤
│              UI 基础组件层 (Phase 3)                  │
│                                                      │
│  <ChatWindowShell>  <InterruptHandler>  <AiChat>     │
│       (新增)             (新增)         (现有)        │
├─────────────────────────────────────────────────────┤
│            Composable 管理层 (Phase 2+4)              │
│                                                      │
│  useInitAnalysis   useModuleChatManager  useXiaosuo   │
│  (重写:基于底层)    (重写:基于基类)    (重写:基类)     │
│                          │                           │
│              useChatSessionManager (新增)             │
│                          │                           │
│                  useCaseChat (重写:基于底层)          │
│                          │                           │
│              useStreamChat<T> (新增:泛型底层)         │
├─────────────────────────────────────────────────────┤
│              Server API Layer                        │
│                                                      │
│  /init-analysis (保留)   /chat (保留,共享)            │
│  /xiaosuo-sess*         /module-sess*                │
│       └───────── 统一调用 ─────────┘                  │
│              Session DAO 抽象层 (Phase 1)             │
│                          │                           │
│  agentRun · eventBridge · middleware (现有,不动)       │
└─────────────────────────────────────────────────────┘
```

## 3. Phase 1：后端 Session DAO 抽象层

### 3.1 新增 `server/services/case/session.dao.ts`

提取五个公共 DAO 函数：

#### `validateCaseOwnershipDAO(caseId, userId)`

从 4 个 session API 中提取的公共权限校验。

- 输入：`caseId: number`, `userId: number`
- 输出：`cases | null`
- 逻辑：`prisma.cases.findFirst({ where: { id: caseId, userId, deletedAt: null } })`

#### `listSessionsWithActiveRunDAO(params)`

从 `xiaosuo-sessions.get.ts:19-40` 和 `module-sessions.get.ts:25-42` 提取。

- 输入：
  - `caseId: number`
  - `userId: number`（用于权限校验）
  - `type: number`（1 或 3）
  - `metadataFilter?: { path: string[]; equals: any }`（可选 JSON path 过滤）
  - `select?: Prisma.caseSessionsSelect`
  - `orderBy?: Prisma.caseSessionsOrderByWithRelationInput`
- 输出：`SessionListItem[]`，每项包含 `sessionId`, `type`, `metadata`, `hasActiveRun`, `createdAt`, `updatedAt`
- 逻辑：`validateCaseOwnershipDAO()` + `prisma.caseSessions.findMany(...)` + `Promise.all(sessions.map(s => getActiveRunService(s.sessionId)))`

#### `createSessionDAO(params)`

从 `xiaosuo-session.post.ts:35-45` 和 `module-session.post.ts:50-85` 提取。

- 输入：
  - `caseId: number`
  - `userId: number`
  - `type: number`
  - `metadata: Record<string, any>`（含 title + 业务字段）
  - `dedupeKey?: string`（并发防重 key，如 `${userId}:${caseId}:create`）
  - `dedupeTtlMs?: number`（防重窗口，默认 3000ms）
- 输出：`{ sessionId: string; isNew: boolean }`
- 逻辑：
  1. 若有 `dedupeKey`：通过 `server/lib/redis.ts` 的 Redis 客户端执行 `SET dedupeKey EX dedupeTtlMs NX`
  2. 锁已存在 → 查最近创建的同类 session 返回 `{ sessionId, isNew: false }`
  3. 锁不存在（获取成功）→ `prisma.caseSessions.create(...)` → 返回 `{ sessionId, isNew: true }`
  4. Redis 不可用时降级：跳过防重检查直接创建（日志 warn）

**并发防重 vs 业务幂等区分**：
- **并发防重**（本 DAO 解决）：防止用户快速双击在毫秒级创建两条相同 session。通过 Redis 短时窗口锁实现。
- **业务幂等**（旧版 module-session 的 Serializable 事务）：保证"每案件每模块最多一个 session"。模块对话改为多 session 后**不再需要业务幂等约束**，因此删除 Serializable 事务逻辑。

#### `softDeleteSessionDAO(params)`

从 `xiaosuo-session/[sessionId].delete.ts` 提取，模块对话的 delete API 将复用。

- 输入：`sessionId: string`, `userId: number`, `allowedTypes: number[]`
- 输出：`void`
- 逻辑：
  1. `findFirst({ sessionId, deletedAt: null })` + include case
  2. 权限校验：`case.userId === userId`
  3. 类型校验：`session.type in allowedTypes`（对于小索 allowedTypes=[1]，模块对话 allowedTypes=[3]。当前 type=1 等价于 source=xiaosuo，这里用 type 判断是因为 type 字段是数据库层一等属性，比 JSON path 查询更可靠。）
  4. 若有 activeRun → `cancelRunService(activeRun.id)`
  5. `prisma.update({ deletedAt: new Date() })`

#### `renameSessionDAO(params)`

新增。小索和模块对话共用。

- 输入：`sessionId: string`, `userId: number`, `newTitle: string`
- 输出：`void`
- 逻辑：
  1. 权限校验（同上）
  2. 使用 `$queryRaw` 调用 PostgreSQL `jsonb_set` 原子更新 title 字段，避免先读后写的并发丢失更新风险：
     ```sql
     UPDATE "caseSessions"
     SET metadata = jsonb_set(metadata, '{title}', $1::jsonb)
     WHERE "sessionId" = $2
     ```

### 3.2 改造现有 API

改造后各 API 只保留差异化逻辑（参数校验 + 响应字段映射），公共模式全部委托给 DAO：

- `xiaosuo-sessions.get.ts`（44 行 → ~15 行）
- `module-sessions.get.ts`（46 行 → ~15 行）
- `xiaosuo-session.post.ts`（48 行 → ~20 行）
- `module-session.post.ts`（88 行 → ~25 行）：删除 Serializable 事务逻辑，改为 `createSessionDAO` + dedupeKey 防重

### 3.3 新增 API

- `module-session/[sessionId].delete.ts`（~10 行）：调用 `softDeleteSessionDAO({ sessionId, userId, allowedTypes: [3] })`
- `session/rename/[sessionId].patch.ts`（~15 行）：调用 `renameSessionDAO`，小索和模块对话共用

### 3.4 metadata 追加

模块对话 session 的 metadata 追加 `title` 字段：

```
// 现有
{ moduleName: 'evidence', nodeId: 7 }

// 新增 title
{ moduleName: 'evidence', nodeId: 7, title: '证据清单梳理-2604102055' }
```

历史记录无 title → 前端显示时 fallback 到 `moduleName` 对应的中文名（从 `INIT_ANALYSIS_MODULES` 查询）。无需迁移脚本。

## 4. Phase 2：前端 Composable 基础层

### 4.1 新增 `useStreamChat<T>` — 泛型流管理底层

**文件**：`app/composables/useStreamChat.ts`（~70 行）

将 `useCaseChat` 和 `useInitAnalysis` 共同的 `FetchStreamTransport + useStream + computed 包装 + interrupt 解包` 抽取为泛型 composable。

```typescript
interface StreamChatOptions {
  apiUrl: string              // SSE API 端点
  threadId?: string           // LangGraph thread ID
  messagesKey?: string        // 状态对象中的消息字段名（默认 'messages'）
  onCustomEvent?: (data: any) => void
}

interface StreamChatReturn<T> {
  // 状态（全部为 ComputedRef/ShallowRef，消费方通过 .value 访问）
  messages: ComputedRef<BaseMessage[]>
  values: ComputedRef<T | undefined>
  isLoading: ShallowRef<boolean>
  error: ShallowRef<any>
  interruptData: ComputedRef<any>
  hasHistoryLoaded: Ref<boolean>

  // 操作
  submit: (input?: any, config?: any) => void
  stop: () => void
  reconnect: () => void
  loadHistory: () => void
  getMessagesMetadata: (msg: any, idx?: number) => any
}
```

#### 响应式策略

**关键决策**：`useStreamChat` 内部使用 `useStream`（不加 `reactive()` 包裹），返回 `ComputedRef` 包装。

**与现有实现的差异对照**：

| | 现有 `useCaseChat` | 现有 `useInitAnalysis` | `useStreamChat`（新） |
|---|---|---|---|
| 包装方式 | 裸 `useStream`，computed 包装 getter | `reactive(useStream(...))` | 裸 `useStream`，computed 包装 getter |
| 消费方访问 | `chat.values.value` | `stream.values`（无 .value） | `stream.values.value` |

**影响**：`useInitAnalysis` 改造后需要将所有直接访问 `stream.xxx` 的地方改为 `stream.xxx.value`。这是一个明确的、可机械替换的改动，不涉及逻辑变化。**但 `useInitAnalysis` 有 323 行，`watch(values)` 跨越第 101-193 行——这是高风险的大规模替换。Phase 4 必须先写对比测试（TDD），锁定 watch 触发次数和模块状态推断行为，确保替换后行为不变。**

选择此策略的原因：`useCaseChat`（已被小索 + 模块对话 + 案件分析页三个消费方使用）的 ComputedRef 模式更通用，且 Vue 3 Composition API 的主流约定就是通过 `.value` 访问响应式数据。

> **@langchain/vue 响应式机制说明**（基于 `stream.custom.js` 源码分析）：
>
> `useStreamCustom`（FetchStreamTransport 路径）返回的 `values`/`interrupt`/`messages` 是 **ES6 getter**（非 Ref/ComputedRef）。getter 内部读取 `shallowRef.value`，当在 Vue 的 `computed` getter 执行环境中调用时，shallowRef 的依赖会**透过 getter 传播**到外层 computed 的 effect（Vue 的全局 activeEffect 机制）。
>
> 这意味着 `computed(() => stream.values)` **能正确响应更新**——虽然 `stream.values` 不是 Ref，但它的 getter 内部触发了 `streamValues.value` 的 track。
>
> 而 `stream.isLoading` 和 `stream.error` 是直接暴露的 `shallowRef`，可以直接透传（如 `isLoading: stream.isLoading`）。

#### `interruptData` 统一解包（CRITICAL：绕过 Vue 响应式 bug）

> **已知 bug**（记录于 `useInitAnalysis.ts:70-71`，源码确认于 `@langchain/vue@0.4.5` 的 `node_modules/@langchain/vue/dist/stream.custom.js:49-52`）：
>
> `useStreamCustom` 内部的 `interruptComputed = computed(() => { isLoading.value; return orchestrator.interrupt })` **只依赖 `isLoading` shallowRef**。当中断发生在流的中途（`isLoading` 保持 `true` 不变），`interruptComputed` 不会重新计算，导致 `stream.interrupt` getter 返回过时的值。
>
> 而 `stream.values` getter 内部读取的是 `streamValues.value`（shallowRef，每次 orchestrator 更新时重新赋值），因此 `stream.values.__interrupt__` 路径能正确响应中断数据变化。
>
> **解决方案**：`interruptData` **必须从 `stream.values.__interrupt__`** 读取。

完整伪代码：

```typescript
// ⚠️ 不能用 stream.interrupt（有 Vue 响应式 bug）
// 必须从 stream.values.__interrupt__ 读取
interruptData: computed(() => {
  const v = stream.values as any
  if (!v?.__interrupt__?.length) return null
  const raw = v.__interrupt__
  const first = Array.isArray(raw) ? (raw.length === 1 ? raw[0] : raw) : raw
  return first?.value ?? first
})
```

> **与现有实现的行为差异**：现有 `CaseDetailXiaosuo.vue:59-66` 对非 `insufficient_points` 类型返回 `null`（做了类型过滤），而 `useStreamChat.interruptData` **不做中断类型过滤**，所有类型的中断数据都会传递到消费方。类型分发职责由 `InterruptHandler` 组件承担（Section 4.7）。

### 4.2 改造 `useCaseChat` — 基于 useStreamChat 的特化

**文件**：`app/composables/useCaseChat.ts`（98 行 → ~50 行）

```typescript
interface CaseChatOptions {
  sessionId: string
  onCustomEvent?: (data: any) => void
}

interface CaseAgentState {
  messages: BaseMessage[]
}

function useCaseChat(options: CaseChatOptions) {
  const stream = useStreamChat<CaseAgentState>({
    apiUrl: '/api/v1/case/analysis/chat',
    threadId: options.sessionId,
    messagesKey: 'messages',
    onCustomEvent: options.onCustomEvent,
  })

  return {
    ...stream,
    sendMessage(text: string, opts?: { thinking?: boolean }) {
      stream.submit({
        messages: [{ type: 'human', content: text }],
        thinking: opts?.thinking,
      } as any)
    },
    resumeInterrupt(data: any) {
      stream.submit(undefined, { command: { resume: data } })
    },
    stopGeneration: () => stream.stop(),
  }
}
```

### 4.3 新增 `useStopActiveRun` — 双重取消公共函数

**文件**：`app/composables/useStopActiveRun.ts`（~20 行）

```typescript
async function stopActiveRun(sessionId: string): Promise<void> {
  try {
    const runData = await useApiFetch<{ run: { id: string } | null }>(
      `/api/v1/case/analysis/runs/current/${sessionId}`,
    )
    if (runData?.run?.id) {
      await useApiFetch(
        `/api/v1/case/analysis/runs/cancel/${runData.run.id}`,
        { method: 'POST' },
      )
    }
  }
  catch (error) {
    console.error('[stopActiveRun] 取消失败:', error)
  }
}
```

消除 `useXiaosuoChat.ts:149-168` 和 `useModuleChatManager.ts:133-152` 的 20 行×2 重复。

### 4.4 新增 `useChatSessionManager` — 多 session 管理基类

**文件**：`app/composables/useChatSessionManager.ts`（~130 行）

封装小索和模块对话共同的多 session 生命周期管理模式。

```typescript
interface SessionItem {
  sessionId: string
  title: string
  createdAt: string
  updatedAt: string
  hasActiveRun: boolean
}

interface ChatSessionManagerOptions {
  caseId: MaybeRef<number>
  listUrl: (caseId: number) => string
  createUrl: string
  deleteUrl: (sessionId: string) => string
  buildCreateBody: (caseId: number) => Record<string, any>
  onCustomEvent?: (data: any) => void
}
```

返回值：

```typescript
interface ChatSessionManagerReturn {
  // Session 管理
  sessions: Ref<SessionItem[]>
  currentSessionId: Ref<string | null>
  isSessionLoading: Ref<boolean>

  // 当前对话状态（代理自 useCaseChat）
  messages: ComputedRef<BaseMessage[]>
  values: ComputedRef<any>
  isLoading: ComputedRef<boolean>
  interruptData: ComputedRef<any>

  // Session 操作
  init: () => Promise<void>
  createSession: (title?: string) => Promise<string>
  switchSession: (sessionId: string) => Promise<void>
  deleteSession: (sessionId: string) => Promise<void>
  renameSession: (sessionId: string, title: string) => Promise<void>

  // 消息操作
  sendMessage: (text: string, options?: { thinking?: boolean }) => void
  resumeInterrupt: (data: any) => void
  stopGeneration: () => Promise<void>   // stream.stop() + stopActiveRun(sid)
}
```

内部封装的公共逻辑（从 `useXiaosuoChat` 和 `useModuleChatManager` 提取）：

1. **effectScope 管理**：`currentScope: EffectScope | null` + `currentChat: ShallowRef` + `disposeCurrentChat()`
2. **竞态防护**：`switchCounter` 计数器，防止快速切换导致旧 scope 泄漏
3. **switchSession**：dispose → 新 scope → `useCaseChat(sessionId)` → 按 `hasActiveRun` 自动 reconnect/loadHistory
4. **stopGeneration**：`currentChat.stop()` + `stopActiveRun(currentSessionId)`
5. **init**：幂等保护（`initialized: Ref<boolean>`），确保 `init()` 只执行一次。流程：fetchSessions → 空则 createSession → 否则 switchSession(最新)
6. **onUnmounted** 自动清理

### 4.5 改造 `useXiaosuoChat` — 薄包装

**文件**：`app/composables/useXiaosuoChat.ts`（212 行 → ~30 行）

```typescript
function useXiaosuoChat(caseId: MaybeRef<number>) {
  return useChatSessionManager({
    caseId,
    listUrl: (id) => `/api/v1/case/analysis/xiaosuo-sessions?caseId=${id}`,
    createUrl: '/api/v1/case/analysis/xiaosuo-session',
    deleteUrl: (sid) => `/api/v1/case/analysis/xiaosuo-session/${sid}`,
    buildCreateBody: (id) => ({ caseId: id }),
  })
}
```

### 4.6 改造 `useModuleChatManager` — 保留特有逻辑

**文件**：`app/composables/useModuleChatManager.ts`（231 行 → ~80 行）

**`instances` 数据结构说明**：`instances: Record<string, ChatSessionManagerReturn>` — 每个模块名对应**一个 session manager 实例**。每个 manager 内部管理该模块的**多个 session**（列表、切换、创建、删除）。这意味着 `instances['evidence']` 是"证据清单"模块的 manager，它内部持有该模块的所有 session 列表和当前活跃的 chat 实例。

保留的特有逻辑：
- `instances` — 每模块一个 session manager（manager 内部管理多 session）
- `expandedModule / expandModule / collapseAll` — 窗口展开管理（同一时间只展开一个模块窗口）
- `getOrCreateModuleManager(moduleName, moduleTitle)` — 按需创建 manager 实例
- `activeModules` computed — 活跃模块列表（用于渲染状态条）
- `restoreActiveSessions()` — 页面刷新恢复（遍历各模块 manager，调用各自的 init）
- `onAnalysisSaved` 回调 — 通过 `onCustomEvent` 传入 useCaseChat

删除的逻辑（下沉到基类）：effectScope 管理、stopGeneration 双重取消、hasActiveRun 分支、messages/values 代理。

### 4.7 新增 `<InterruptHandler>` 组件 — 统一中断调度器

**文件**：`app/components/case/interrupt/InterruptHandler.vue`（~50 行）

按 `InterruptType` 分发到不同的子组件。当前立即实现 `insufficient_points`，其他 3 种预留框架。

```vue
<script setup lang="ts">
/**
 * 统一中断处理调度器
 *
 * 按 interruptData.type 分发到对应的中断处理 UI：
 * - insufficient_points → Dialog + InitAnalysisInsufficientPointsCard（立即实现）
 * - case_info_check → TODO: 复用 case/interrupt/CaseInfoCheckHandler
 * - basic_info_confirm → TODO: 复用 case/interrupt/BasicInfoConfirmHandler
 * - module_select → TODO: 复用 case/interrupt/ModuleSelectHandler
 *
 * 4 个 Handler 组件（case/interrupt/）是旧系统的遗留，但代码质量高，
 * 类型直接从 #shared/types/case 导入，可独立复用。
 * 当新系统的工作流触发对应中断类型时，在此处接入即可。
 *
 * 注意：积分不足使用 InitAnalysisInsufficientPointsCard（含完整支付流程：
 * 会员套餐展示、积分购买、二维码支付），而非 case/interrupt/InsufficientPointsHandler
 * （旧系统简陋版本，仅文字提示）。
 */
defineProps<{ interruptData: any }>()
const emit = defineEmits<{ resume: [data: any] }>()
</script>

<template>
  <Dialog :open="!!interruptData" @update:open="() => {}">
    <DialogContent
      class="sm:max-w-2xl max-h-[95vh] overflow-y-auto p-0"
      :show-close-button="false"
      @pointer-down-outside.prevent
      @escape-key-down.prevent
      @open-auto-focus.prevent
    >
      <DialogHeader class="sr-only">
        <DialogTitle>操作确认</DialogTitle>
        <DialogDescription>请处理中断请求</DialogDescription>
      </DialogHeader>

      <!-- 积分不足 -->
      <InitAnalysisInsufficientPointsCard
        v-if="interruptData?.type === 'insufficient_points'"
        :is-member="interruptData.data?.isMember ?? false"
        :available-points="interruptData.data?.availablePoints"
        :required-points="interruptData.data?.requiredPoints"
        :reason="interruptData.data?.reason"
        @resume="emit('resume', { action: 'continue' })"
      />

      <!-- 其他中断类型预留（当新系统工作流触发时接入） -->
      <!-- case_info_check: 复用 case/interrupt/CaseInfoCheckHandler -->
      <!-- basic_info_confirm: 复用 case/interrupt/BasicInfoConfirmHandler -->
      <!-- module_select: 复用 case/interrupt/ModuleSelectHandler -->
    </DialogContent>
  </Dialog>
</template>
```

三个已有消费方的 Dialog + InsufficientPointsCard 包装代码替换为单行。**模块对话为新增**（之前没有中断 UI）：
```vue
<CaseInterruptInterruptHandler :interrupt-data="manager.interruptData.value" @resume="manager.resumeInterrupt" />
```

## 5. Phase 3：UI 外壳层

### 5.1 新增 `<ChatWindowShell>` 组件

**文件**：`app/components/case/ChatWindowShell.vue`（~110 行）

承载三种窗口形态的公共结构：

- **桌面全屏**：`fixed inset-0 z-50`
- **桌面小窗**：`fixed` + `useDraggableResize`（可拖拽、可缩放）
- **移动端 Sheet**：`Sheet side="bottom" class="h-dvh"`（100dvh 动态视口高度）

Props：

```typescript
interface ChatWindowShellProps {
  open: boolean                    // v-model
  fullscreen?: boolean             // v-model
  title?: string
  icon?: Component
  showClose?: boolean              // 默认 true
  showFullscreen?: boolean         // 默认 true
  draggable?: boolean              // 默认 true
  resizable?: boolean              // 默认 true
  initialWidth?: number
  initialHeight?: number
  positionOffset?: { x: number; y: number }  // 小窗初始位置偏移（用于多窗口不重叠）
}
```

Emits：`update:open`, `update:fullscreen`

Slots：
- `#titlebar-left`：标题栏左侧自定义区域（session 选择器等）
- `#titlebar-right`：标题栏右侧额外按钮
- `#default`：主内容区（AiChat）

内部封装：`useDraggableResize`（接收 `positionOffset`）、`useDevice` / `isMobile`、关闭/全屏按钮。

### 5.2 新增 `<SessionListPopover>` 组件

**文件**：`app/components/case/SessionListPopover.vue`（~60 行）

小索和模块对话共用的 session 列表 UI。

Props：

```typescript
interface Props {
  sessions: SessionItem[]
  currentId: string | null
  loading?: boolean
}
```

Emits：`select(sessionId)`, `create()`, `delete(sessionId)`, `rename(sessionId, title)`

内部结构：
- Popover 包裹列表
- 每项：title + `dayjs(updatedAt).fromNow()`
- 当前 session 高亮
- 右侧操作按钮：重命名（编辑图标）、删除（需确认）
- 底部"新建对话"按钮

### 5.3 改造消费方

**`CaseDetailXiaosuo.vue`**（290 行 → ~120 行）：使用 `ChatWindowShell` + `SessionListPopover` + `InterruptHandler`（替换现有 Dialog）。

**`AnalysisModuleChat.vue`**（133 行 → ~80 行）：使用 `ChatWindowShell`（传入 `positionOffset` 使模块对话窗口偏移避免与小索重叠）+ `SessionListPopover`（新增多 session 支持）+ `InterruptHandler`（**新增**——当前完全没有中断 UI，这是补齐功能缺失）。

**`AnalysisModuleChatBar.vue`**：多 session 模式下，状态条仅需显示"该模块当前是否有活跃分析"（由 manager 的 `isLoading` computed 提供）。session 列表通过 `SessionListPopover` 在浮窗内展示，状态条本身不展示所有 session。改动量小（~10 行）。

## 6. Phase 4：init-analysis 与案件分析页对齐

### 6.1 改造 `useInitAnalysis` 底层

将 `useInitAnalysis` 中直接创建的 `FetchStreamTransport + useStream` 替换为 `useStreamChat`。

**前置条件（TDD 对比测试）**：在任何改造之前，先为 `useInitAnalysis` 编写对比测试，锁定以下行为：
- `watch(values)` 的触发次数和触发值
- `moduleStates` 推断逻辑（idle → streaming → complete/failed 的状态转换）
- `mergedResult` 合并结果（DB 结果 + 流式结果优先级）
- `streamMessages` 合并逻辑（实时消息 vs checkpoint 消息）
- `interrupt` 计算属性在 `values.__interrupt__` 变化时是否正确触发

改造后重跑对比测试，确认行为不变。

变化点：
1. 删除直接的 `FetchStreamTransport` + `reactive(useStream(...))` 创建（约 15 行） → 改为 `useStreamChat<InitAnalysisState>({ apiUrl: '/api/v1/case/init-analysis' })`
2. 删除 `computed` 包装代码（values/isLoading/interrupt，约 10 行） → 从 stream 对象直接获取
3. 将所有 `stream.xxx` 直接访问改为 `stream.xxx.value`（因为 useStreamChat 返回 ComputedRef，不再是 reactive 包装）
4. 删除 interrupt 解包逻辑 → 使用 `stream.interruptData`
5. 页面中删除 Dialog + InsufficientPointsCard 包装 → 使用 `<InterruptHandler>`

保留不变的工作流特有逻辑（约 200 行）：
- `phase` 状态机 (select → running → complete)
- `moduleStates` 推断（第一个非 complete 的模块 → streaming）
- `moduleMessagesMap` 分组（实时流增量 + 重连恢复）
- `mergedResult`（DB 结果 + 流式结果合并）
- `resultFromDB`（页面刷新恢复）
- `startAnalysis` / `resumeWorkflow` / `retryModule`
- `watch(values)` 模块分组与完成检测（注意：`watch(() => stream.values.value, ...)` 替换原有的 `watch(values, ...)`）

### 6.2 改造 `analysis/[sessionId].vue` — 案件分析页

将 `app/pages/dashboard/analysis/[sessionId].vue` 中直接使用 `reactive(useStream(...))` 的代码替换为 `useStreamChat`：

1. 删除第 63 行的 `reactive(useStream({...}))` → 改为 `useStreamChat<AnalysisState>({ apiUrl: '/api/v1/case/analysis/chat', threadId: sessionId })`
2. 删除第 157-169 行的 `interrupt` / `interruptData` 解包逻辑 → 使用 `stream.interruptData`
3. 删除第 15-31 行的 Dialog + InsufficientPointsCard 包装 → 使用 `<InterruptHandler>`
4. 将所有 `stream.xxx` 直接访问改为 `stream.xxx.value`

### 6.3 `useChatSessionManager` 的 stopGeneration 改用 `stopActiveRun`

```typescript
// useChatSessionManager.ts 内部
async function stopGeneration() {
  currentChat.value?.stopGeneration()
  const sid = currentSessionId.value
  if (sid) await stopActiveRun(sid)
}
```

### 6.4 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| `reactive()` → `ComputedRef` 转换导致 `useInitAnalysis` 内 `watch(values)` 触发时机变化 | 中 | 高 | **先写对比测试**：在改造前后分别运行 watch 触发计数，确认次数和值一致。重点验证 `moduleStates` 推断和 `moduleMessagesMap` 分组 |
| `analysis/[sessionId].vue` 的 stream 访问模式改变后模板绑定失败 | 低 | 中 | 此页面较独立，可通过 typecheck + 手动测试覆盖 |
| Phase 1-3 的抽象在适配 init-analysis 时发现不够灵活 | 低 | 中 | Phase 4 在 Phase 1-3 合并后单独开分支，可回退 |

## 7. 测试策略

### 7.1 TDD 原则

先写测试再改代码。每个 PR 需满足以下测试覆盖：

| PR | 测试类型 | 覆盖内容 |
|---|---|---|
| PR #1 | 单元测试 | `validateCaseOwnershipDAO`、`listSessionsWithActiveRunDAO`、`createSessionDAO`（含并发防重 + Redis 降级）、`softDeleteSessionDAO`、`renameSessionDAO`（含 jsonb_set 原子更新） |
| PR #1 | 集成测试 | 4 个瘦化后的 API 端点 + 新增的 delete/rename 端点（确认请求/响应不变）。**边界用例**：验证 `type=1` session 的 `metadata.source` 始终为 `'xiaosuo'`，确认 `softDeleteSessionDAO` 的 type 校验与现有 metadata source 校验等价 |
| PR #2 | 单元测试 | `useStreamChat`（computed 包装、**interruptData 从 values.__interrupt__ 解包而非 stream.interrupt**）、`useChatSessionManager`（session CRUD、switchSession、stopGeneration 双重取消、竞态防护、init 幂等保护）、`useStopActiveRun` |
| PR #3 | 组件测试 | `ChatWindowShell`（三种模式切换 + positionOffset）、`SessionListPopover`（列表渲染、事件 emit、重命名交互）、`InterruptHandler`（按 type 分发渲染）、`AnalysisModuleChatBar`（多 session 模式下的正确渲染回归） |
| PR #4 | **TDD 对比测试** | `useInitAnalysis`：改造前先写对比测试锁定 watch(values) 触发次数、moduleStates 推断、mergedResult 合并、streamMessages 合并、interrupt 触发行为。改造后重跑确认行为不变。`analysis/[sessionId].vue` 的 interrupt + 消息显示验证 |

### 7.2 E2E 验收（手动）

每个 PR 合并前在开发环境验证：
- 小索对话框：打开 → 新建/切换/删除 session → 重命名 → 发消息 → 流式回复 → 停止生成
- 模块对话：重新生成 → 新建 session → 切换 → 删除旧 session → 中断恢复 → 状态条显示正确
- 初始化分析：选择模块 → 开始分析 → 页面刷新恢复 → 积分不足中断 → 支付后继续
- 案件分析页：发消息 → 流式回复 → 积分不足中断 → 恢复

## 8. PR 拆分与实施顺序

```
PR #1: Phase 1 — 后端 Session DAO 抽象
│  新增: session.dao.ts, module-session delete API, rename API
│  改造: 4 个现有 session API 瘦化
│  前置: 无
│
PR #2: Phase 2 — 前端 Composable 基础层
│  新增: useStreamChat.ts, useChatSessionManager.ts, useStopActiveRun.ts, InterruptHandler.vue
│  改造: useCaseChat.ts, useXiaosuoChat.ts, useModuleChatManager.ts
│  前置: PR #1（模块对话多 session 依赖 delete + rename API）
│
PR #3: Phase 3 — UI 外壳层
│  新增: ChatWindowShell.vue, SessionListPopover.vue
│  改造: CaseDetailXiaosuo.vue, AnalysisModuleChat.vue, AnalysisModuleChatBar.vue
│  前置: PR #2
│
PR #4: Phase 4 — init-analysis 与案件分析页对齐
│  改造: useInitAnalysis.ts, init-analysis/[sessionId].vue, analysis/[sessionId].vue
│  前置: PR #2
│  注意: PR #3 和 PR #4 互不依赖，可并行开发
│
PR #5: Phase 5 — 遗留系统验证 + 清理
│  验证: useCaseAnalysis.ts 等 6 个文件确认为死代码
│  清理: 删除确认后的死代码文件
│  前置: PR #1-4 全部合并后
│  注意: 独立 PR，低风险
```

注意：`useCaseChat.ts` 的改造（基于 useStreamChat 重写）完整包含在 PR #2 中，PR #4 不再涉及此文件。

**PR 并行提示**：PR #3 和 PR #4 虽然可并行，但两者都使用 `InterruptHandler` 组件。建议 PR #4 先合并（因为它动 `useInitAnalysis` 是最高风险，优先回归验证），PR #3 后合并。

### 回滚策略

每个 PR 独立可回滚。若 PR #4（最高风险）出问题：
- 回退 PR #4，PR #1-3 的价值已落袋
- init-analysis 回到使用直接 useStream 的旧实现
- 其余模块不受影响

## 9. 交付物总览

### 新增文件

| 文件 | 用途 | 预估行数 |
|---|---|---|
| `server/services/case/session.dao.ts` | Session DAO 抽象 | ~100 |
| `server/api/v1/case/analysis/module-session/[sessionId].delete.ts` | 模块对话 session 删除 | ~10 |
| `server/api/v1/case/analysis/session/rename/[sessionId].patch.ts` | 通用 session 重命名 | ~15 |
| `app/composables/useStreamChat.ts` | 泛型流管理底层 | ~70 |
| `app/composables/useChatSessionManager.ts` | 多 session 管理基类 | ~130 |
| `app/composables/useStopActiveRun.ts` | 双重取消公共函数 | ~20 |
| `app/components/case/ChatWindowShell.vue` | 窗口外壳组件 | ~110 |
| `app/components/case/SessionListPopover.vue` | Session 列表组件 | ~60 |
| `app/components/case/interrupt/InterruptHandler.vue` | 中断处理组件 | ~30 |

### 改造文件

| 文件 | 变化 | PR |
|---|---|---|
| `server/api/v1/case/analysis/xiaosuo-sessions.get.ts` | 44 → ~15 行 | #1 |
| `server/api/v1/case/analysis/module-sessions.get.ts` | 46 → ~15 行 | #1 |
| `server/api/v1/case/analysis/xiaosuo-session.post.ts` | 48 → ~20 行 | #1 |
| `server/api/v1/case/analysis/module-session.post.ts` | 88 → ~25 行 | #1 |
| `app/composables/useCaseChat.ts` | 98 → ~50 行 | #2 |
| `app/composables/useXiaosuoChat.ts` | 212 → ~30 行 | #2 |
| `app/composables/useModuleChatManager.ts` | 231 → ~80 行 | #2 |
| `app/composables/useInitAnalysis.ts` | ~300 → ~220 行 | #4 |
| `app/components/caseDetail/CaseDetailXiaosuo.vue` | 290 → ~120 行 | #3 |
| `app/components/case/AnalysisModuleChat.vue` | 133 → ~80 行 | #3 |
| `app/components/case/AnalysisModuleChatBar.vue` | ~10 行改动 | #3 |
| `app/pages/dashboard/cases/init-analysis/[sessionId].vue` | -15 行 | #4 |
| `app/pages/dashboard/analysis/[sessionId].vue` | -25 行 | #4 |

### 净效果

- **新增**：~545 行基础设施
- **删除**：~920 行重复/冗余代码
- **净减**：~375 行
- **关键收益**：四个消费方首次在流管理、session 管理、UI 外壳、中断处理四个层面共享同一份代码
