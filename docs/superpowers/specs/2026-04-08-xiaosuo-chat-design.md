# 小索对话逻辑实现设计

## 目标

将案件详情页的小索 AI 助手从 Mock 状态升级为完整的案件级对话系统。小索使用独立 session，复用现有 caseMainAgent（type=1）后端逻辑，支持多 session 管理、积分扣减、上下文压缩、子代理工具委派等完整能力。

## 架构概述

小索的对话逻辑与 `/dashboard/analysis/[sessionId]` 页面复用相同的后端基础设施（caseMainAgent、积分中间件、材料上下文注入、上下文压缩摘要），但通过独立的 session 与分析页面隔离。前端通过新建 `useXiaosuoChat` composable 管理 session 生命周期，组件改用 `AiChat` 渲染消息以获得 thinking、tool calls、interrupt 等完整能力。

---

## 1. 后端 API

### 1.1 新增端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/v1/case/analysis/xiaosuo-session` | POST | 创建小索 session |
| `/api/v1/case/analysis/xiaosuo-sessions` | GET | 查询案件所有小索 session（query: `?caseId=xxx`） |
| `/api/v1/case/analysis/xiaosuo-session/[sessionId]` | DELETE | 删除小索 session |

### 1.2 创建 Session

**请求**：
```typescript
{ caseId: number, title?: string }
```

**逻辑**：
```typescript
const sessionId = uuid()
await prisma.caseSessions.create({
  data: {
    sessionId,
    caseId,
    type: 1,  // 复用 type=1，agentWorker 路由到 caseMainAgent
    metadata: { source: 'xiaosuo', title: title ?? '新对话' },
  },
})
```

**响应**：
```typescript
{ code: 200, data: { sessionId, title } }
```

注意事项：
- 无并发竞态问题（每次创建新 session，不需要查重）
- `metadata.source = 'xiaosuo'` 用于区分小索 session 和分析页面的 session

### 1.3 查询 Session 列表

**请求**：`GET /api/v1/case/analysis/xiaosuo-sessions?caseId=xxx`

通过 query 参数传递 `caseId`（与 `module-sessions.get.ts` 保持一致）。

**逻辑**：
```typescript
const query = getQuery(event)
const caseId = Number(query.caseId)

// 权限校验：确保案件属于当前用户
const caseRecord = await prisma.cases.findFirst({
  where: { id: caseId, userId: user.id, deletedAt: null },
})
if (!caseRecord) return resError(event, 404, '案件不存在')

const sessions = await prisma.caseSessions.findMany({
  where: {
    caseId,
    type: 1,
    deletedAt: null,
    metadata: { path: ['source'], equals: 'xiaosuo' },
  },
  orderBy: { updatedAt: 'desc' },
})

// 为每个 session 检查活跃 run
const result = await Promise.all(
  sessions.map(async (s) => {
    const activeRun = await getActiveRunService(s.sessionId)
    return {
      sessionId: s.sessionId,
      title: (s.metadata as any)?.title ?? '新对话',
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      hasActiveRun: !!activeRun,
    }
  })
)
```

### 1.4 删除 Session

**请求**：`DELETE /api/v1/case/analysis/xiaosuo-session/:sessionId`

**逻辑**：
1. 验证 session 存在且属于当前用户的案件（`deletedAt: null`）
2. 验证 `metadata.source === 'xiaosuo'`（防止误删分析页面 session）
3. 如有活跃 run，调用 `cancelRunService(runId)` 取消
4. 软删除：`await prisma.caseSessions.update({ where: { sessionId }, data: { deletedAt: new Date() } })`

### 1.5 对话 API 复用

消息发送/接收**完全复用** `POST /api/v1/case/analysis/chat`。无需修改，因为：
- chat API 通过 `thread_id`（sessionId）路由
- agentWorker 通过 session type=1 路由到 `runCaseChat()` → `caseMainAgent`
- caseMainAgent 已具备：子代理工具委派、积分扣减中间件、材料上下文注入、上下文压缩摘要

### 1.6 agentWorker 路由修复

**需要修改** `server/services/agent/agentWorker.ts`：当前 else 分支（type=1）调用 `runCaseChat()` 时未传递 `thinking` 参数，需补充：

```typescript
// 第 168-172 行，补充 thinking 参数
stream = await runCaseChat(run.sessionId, input.message, {
  userId: run.userId,
  caseId: run.caseId,
  command: input.command,
  thinking: input.thinking,  // 补充此行
})
```

`runCaseChat` 的 `CaseAgentOptions` 接口已支持 `thinking?: boolean`（默认 `true`），只是 agentWorker 调用时遗漏了传递。

---

## 2. 前端 Composable — `useXiaosuoChat`

### 2.1 文件位置与挂载位置

**文件**：`app/composables/useXiaosuoChat.ts`

**挂载位置**：在父页面 `app/pages/dashboard/cases/[id].vue` 中调用，通过 props 传递给 `CaseDetailXiaosuo` 组件。这样关闭/重开小索窗口时 composable 状态不会丢失（类似 `useModuleChatManager` 的挂载模式）。

```vue
<!-- [id].vue -->
<script setup>
const xiaosuoChat = useXiaosuoChat(caseId)
</script>
<template>
  <CaseDetailXiaosuo v-model="xiaosuoOpen" :xiaosuo-chat="xiaosuoChat" />
</template>
```

### 2.2 接口定义

```typescript
export interface XiaosuoSession {
  sessionId: string
  title: string
  createdAt: string
  updatedAt: string
  hasActiveRun: boolean
}

export function useXiaosuoChat(caseId: MaybeRef<number>) {
  return {
    // Session 管理
    sessions: Ref<XiaosuoSession[]>,
    currentSessionId: Ref<string | null>,
    isSessionLoading: Ref<boolean>,

    // 对话状态（代理当前 useCaseChat 实例）
    messages: ComputedRef<any[]>,
    values: ComputedRef<any>,
    isLoading: ComputedRef<boolean>,
    interrupt: ComputedRef<any>,

    // 操作
    createSession: (title?: string) => Promise<string>,
    switchSession: (sessionId: string) => Promise<void>,
    deleteSession: (sessionId: string) => Promise<void>,
    sendMessage: (text: string, options?: { thinking?: boolean }) => void,
    resumeInterrupt: (data: any) => void,  // 内部调用 stream.submit({ messages: [] }, { command: { resume: data } })
    stopGeneration: () => void,

    // 初始化
    init: () => Promise<void>,
  }
}
```

### 2.3 内部实现要点

#### effectScope 管理

参照 `useModuleChatManager` 的模式，每个 `useCaseChat` 实例必须在独立的 `effectScope` 中创建，切换 session 时清理旧 scope：

```typescript
let currentScope: EffectScope | null = null
let currentChat: ReturnType<typeof useCaseChat> | null = null

function disposeCurrentChat() {
  if (currentScope) {
    currentScope.stop()  // 清理 useStream 内部的 watch/computed
    currentScope = null
    currentChat = null
  }
}

async function switchSession(sessionId: string) {
  disposeCurrentChat()
  currentSessionId.value = sessionId

  currentScope = effectScope()
  currentChat = currentScope.run(() => useCaseChat({ sessionId }))!

  // 检查是否有活跃 run
  const session = sessions.value.find(s => s.sessionId === sessionId)
  if (session?.hasActiveRun) {
    currentChat.reconnect()
  } else {
    currentChat.loadHistory()
  }
}

// 组件卸载时清理
onScopeDispose(() => disposeCurrentChat())
```

#### 对话状态代理

`messages`、`isLoading`、`interrupt` 等响应式属性代理到当前 `useCaseChat` 实例：
```typescript
const messages = computed(() => currentChat?.messages.value ?? [])
const isLoading = computed(() => currentChat?.isLoading.value ?? false)
const interrupt = computed(() => currentChat?.interrupt.value)
```

#### 初始化流程

```
init()
  ↓
GET /api/v1/case/analysis/xiaosuo-sessions?caseId=xxx
  ↓
sessions 列表为空？
  ├─ 是 → createSession() → 自动创建第一个 session
  └─ 否 → switchSession(最近更新的 session)
```

#### Session 生命周期

- `createSession(title?)`：POST API → 加入 sessions 列表 → 切换到新 session
- `switchSession(sessionId)`：清理旧 effectScope → 在新 scope 中创建 useCaseChat → 加载历史/重连
- `deleteSession(sessionId)`：DELETE API → 从列表移除 → 边界处理见下

#### 删除最后一个 session 的处理

当删除导致 sessions 列表为空时，自动调用 `createSession()` 创建一个新 session。始终保证至少有一个 session 可用。

#### 快速切换竞态防护

`switchSession` 使用递增计数器防止快速切换时旧的异步操作覆盖新结果：

```typescript
let switchCounter = 0

async function switchSession(sessionId: string) {
  const currentSwitch = ++switchCounter
  disposeCurrentChat()
  // ... 创建新实例 ...
  if (currentSwitch !== switchCounter) return  // 已被更新的切换取代
  // ... 加载历史 ...
}
```

---

## 3. 前端组件改造 — `CaseDetailXiaosuo.vue`

### 3.1 核心变更

1. **移除 mock 逻辑**：删除本地 `messages` ref、`ChatMessage` 接口、`sendMessage()` mock
2. **接收 xiaosuoChat 实例**：通过 props 接收（非内部创建）
3. **替换消息渲染**：自定义消息 UI 改为 `AiChat` 组件
4. **新增 session 切换 UI**：标题栏添加下拉列表

### 3.2 Props 变更

```typescript
const props = defineProps<{
  xiaosuoChat: ReturnType<typeof useXiaosuoChat>
}>()
```

### 3.3 标题栏 Session 切换 UI

使用 Popover 组件实现下拉列表：

```
┌──────────────────────────────────────────┐
│ [小索图标] ▼ 当前对话标题    [+] [⬜] [✕] │
└──────────────────────────────────────────┘
                ↓ 点击 ▼ 展开
┌──────────────────────────────────────┐
│  新对话 1          2分钟前      [🗑]  │
│  新对话 2          1小时前      [🗑]  │
│  新对话 3          昨天         [🗑]  │
└──────────────────────────────────────┘
```

组件：
- `Popover` + `PopoverTrigger` + `PopoverContent`（shadcn-vue）
- 当前标题显示 + 下拉箭头
- `+` 按钮新建对话
- 每条 session 行显示标题、相对时间、删除按钮

### 3.4 AiChat 集成

三处消息列表+输入框（全屏、小窗、移动端）统一替换为 `AiChat`：

```vue
<AiChat
  :messages="xiaosuoChat.messages.value"
  :loading="xiaosuoChat.isLoading.value"
  panel-mode="left"
  :show-header="false"
  v-model:thinking="thinking"
  :enable-file-upload="false"
  prompt-placeholder="问我任何关于案件的问题..."
  @submit="handleSubmit"
  @stop="xiaosuoChat.stopGeneration()"
/>
```

### 3.5 中断处理

直接复用 `[sessionId].vue` 的中断解包模式，从 `values.__interrupt__` 提取（而非 `stream.interrupt`），确保与参考实现完全一致：

```typescript
// 与 [sessionId].vue 第 157-170 行保持一致
const interrupt = computed(() => {
  const v = xiaosuoChat.values.value as any
  if (!v?.__interrupt__?.length) return undefined
  return v.__interrupt__.length === 1 ? v.__interrupt__[0] : v.__interrupt__
})

const interruptData = computed(() => {
  const raw = interrupt.value
  if (!raw) return null
  const first = Array.isArray(raw) ? raw[0] : raw
  const val = first?.value ?? first
  if (val?.type === 'insufficient_points') return val
  return null
})

// 与 [sessionId].vue 保持一致，传 { messages: [] } 作为第一个参数
function resumeWorkflow() {
  xiaosuoChat.sendMessage('')  // 触发空消息 + command
  // 实际实现：stream.submit({ messages: [] }, { command: { resume: { action: 'continue' } } })
}
```

使用 `Dialog` 覆盖层显示积分不足提示，复用 `InitAnalysisInsufficientPointsCard` 组件。

### 3.6 生命周期

- **首次打开**（`isOpen` 变为 true）：调用 `xiaosuoChat.init()`（幂等，已初始化则跳过）
- **关闭**：composable 在父页面级，状态自然保持
- **切换 session**：调用 `switchSession()`，AiChat 自动响应式更新
- **窗口管理**：拖拽、缩放、全屏保持不变（已实现的 `useDraggableResize`）

---

## 4. 需要修改的现有文件

| 文件 | 变更 |
|------|------|
| `server/services/agent/agentWorker.ts` | else 分支补充 `thinking: input.thinking` |
| `app/pages/dashboard/cases/[id].vue` | 创建 `useXiaosuoChat` 实例并传递给小索组件 |

## 5. 不需要修改的文件

| 文件 | 原因 |
|------|------|
| `server/api/v1/case/analysis/chat.post.ts` | 统一对话端点，通过 sessionId 路由，无需改动 |
| `server/services/workflow/agents/caseMainAgent.ts` | 已有完整功能栈（含 thinking 支持） |
| `server/services/workflow/middleware/pointConsumption.middleware.ts` | 已有积分扣减 |
| `app/composables/useCaseChat.ts` | 底层对话 composable，直接复用 |
| `app/components/ai/AiChat.vue` | 对话渲染组件，直接复用 |

---

## 6. 测试计划

### 6.1 后端 API 测试

- **创建 session**：正常创建、参数校验（caseId 必需）、权限校验（只能操作自己的案件）
- **查询 session 列表**：返回正确列表、按 updatedAt 降序、只返回 source=xiaosuo 的 session、`hasActiveRun` 字段正确（复用 `getActiveRunService`）
- **删除 session**：正常软删除、防止删除非 xiaosuo session、有活跃 run 时先取消后删除

### 6.2 前端 Composable 测试

- **init**：空列表自动创建首个 session、有列表恢复最近 session
- **createSession**：调用 API、更新列表、切换到新 session
- **switchSession**：停止旧 effectScope、创建新 useCaseChat、加载历史；快速连续切换时旧操作被正确丢弃
- **deleteSession**：调用 API、移除列表项、当前 session 被删时切换到下一个、删除最后一个时自动创建新 session

### 6.3 集成验证

1. 打开小索 → 自动创建 session → 显示空对话
2. 发送消息 → 收到 AI 回复 → thinking 展示正常
3. 积分不足 → 显示充值引导 → 充值后继续
4. 新建对话 → 切换到空 session
5. 切换历史对话 → 显示历史消息
6. 删除对话 → 自动切换到下一个
7. 删除最后一个对话 → 自动创建新对话
8. 关闭/重开小索 → 保持上次状态
9. 页面刷新 → 恢复最近 session 和消息

---

## 7. 文件变更清单

| 操作 | 文件 | 说明 |
|------|------|------|
| 新建 | `server/api/v1/case/analysis/xiaosuo-session.post.ts` | 创建 session API |
| 新建 | `server/api/v1/case/analysis/xiaosuo-sessions.get.ts` | 查询 session 列表 API（query param） |
| 新建 | `server/api/v1/case/analysis/xiaosuo-session/[sessionId].delete.ts` | 删除 session API |
| 新建 | `app/composables/useXiaosuoChat.ts` | 小索对话管理 composable |
| 修改 | `app/components/caseDetail/CaseDetailXiaosuo.vue` | 替换 mock 为真实对话 |
| 修改 | `app/pages/dashboard/cases/[id].vue` | 创建 useXiaosuoChat 并传递 |
| 修改 | `server/services/agent/agentWorker.ts` | 补充 thinking 参数传递 |
| 新建 | `tests/server/xiaosuo-session.test.ts` | 后端 API 测试 |
