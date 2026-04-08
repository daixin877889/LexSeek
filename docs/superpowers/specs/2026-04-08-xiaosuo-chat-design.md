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
| `/api/v1/case/analysis/xiaosuo-sessions/[caseId]` | GET | 查询案件所有小索 session |
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

**请求**：`GET /api/v1/case/analysis/xiaosuo-sessions/:caseId`

**逻辑**：
```typescript
const sessions = await prisma.caseSessions.findMany({
  where: {
    caseId,
    type: 1,
    metadata: { path: ['source'], equals: 'xiaosuo' },
  },
  orderBy: { updatedAt: 'desc' },
})
```

**响应**：
```typescript
{
  code: 200,
  data: sessions.map(s => ({
    sessionId: s.sessionId,
    title: s.metadata?.title ?? '新对话',
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    hasActiveRun: boolean,  // 是否有正在运行的 run
  }))
}
```

### 1.4 删除 Session

**请求**：`DELETE /api/v1/case/analysis/xiaosuo-session/:sessionId`

**逻辑**：
1. 验证 session 存在且属于当前用户的案件
2. 验证 session 的 `metadata.source === 'xiaosuo'`（防止误删分析页面 session）
3. 如有活跃 run，先取消
4. 删除 session 记录

### 1.5 对话 API 复用

消息发送/接收**完全复用** `POST /api/v1/case/analysis/chat`。无需修改，因为：
- chat API 通过 `thread_id`（sessionId）路由
- agentWorker 通过 session type=1 路由到 `runCaseChat()` → `caseMainAgent`
- caseMainAgent 已具备：子代理工具委派、积分扣减中间件、材料上下文注入、上下文压缩摘要

### 1.6 agentWorker 路由

**无需修改**。当前 type=1 路由到 `runCaseChat()`，小索的 session 也是 type=1，自动生效。

---

## 2. 前端 Composable — `useXiaosuoChat`

### 2.1 文件位置

`app/composables/useXiaosuoChat.ts`

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
    isLoading: ComputedRef<boolean>,
    interrupt: ComputedRef<any>,

    // 操作
    createSession: (title?: string) => Promise<string>,
    switchSession: (sessionId: string) => Promise<void>,
    deleteSession: (sessionId: string) => Promise<void>,
    sendMessage: (text: string, options?: { thinking?: boolean }) => void,
    resumeInterrupt: (data: any) => void,
    stopGeneration: () => void,

    // 初始化
    init: () => Promise<void>,
  }
}
```

### 2.3 内部实现要点

#### useCaseChat 实例管理

composable 内部维护一个 `useCaseChat` 实例引用（`currentChat`）。切换 session 时：
1. 调用旧实例的 `stopGeneration()`
2. 创建新的 `useCaseChat({ sessionId })` 实例
3. 调用新实例的 `loadHistory()` 加载历史消息
4. 如有活跃 run，调用 `reconnect()` 建立 SSE 订阅

**注意**：`useCaseChat` 内部使用 `useStream` 创建流。由于 `useStream` 依赖 Vue 响应式系统，每次切换 session 需要创建新实例而不是修改 threadId。

#### 对话状态代理

`messages`、`isLoading`、`interrupt` 等响应式属性代理到当前 `useCaseChat` 实例：
```typescript
const messages = computed(() => currentChat.value?.messages.value ?? [])
const isLoading = computed(() => currentChat.value?.isLoading.value ?? false)
const interrupt = computed(() => currentChat.value?.interrupt.value)
```

#### 初始化流程

```
init()
  ↓
GET /api/v1/case/analysis/xiaosuo-sessions/:caseId
  ↓
sessions 列表为空？
  ├─ 是 → createSession() → 自动创建第一个 session
  └─ 否 → switchSession(最近更新的 session)
```

#### Session 生命周期

- `createSession(title?)`：POST API → 加入 sessions 列表 → 切换到新 session
- `switchSession(sessionId)`：创建新 useCaseChat → 加载历史/重连
- `deleteSession(sessionId)`：DELETE API → 从列表移除 → 如果是当前 session 则切换到下一个

---

## 3. 前端组件改造 — `CaseDetailXiaosuo.vue`

### 3.1 核心变更

1. **移除 mock 逻辑**：删除本地 `messages` ref、`ChatMessage` 接口、`sendMessage()` mock
2. **引入 useXiaosuoChat**：替代所有对话状态管理
3. **替换消息渲染**：自定义消息 UI 改为 `AiChat` 组件
4. **新增 session 切换 UI**：标题栏添加下拉列表

### 3.2 新增 Props

组件需要接收 `caseId`：

```typescript
const props = defineProps<{
  caseId: number
}>()
```

案件详情页 `[id].vue` 需相应传递：
```vue
<CaseDetailXiaosuo v-model="xiaosuoOpen" :case-id="caseId" />
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

复用分析页面的中断处理模式：

```typescript
const interruptData = computed(() => {
  const raw = xiaosuoChat.interrupt.value
  if (!raw) return null
  const first = Array.isArray(raw) ? raw[0] : raw
  const val = first?.value ?? first
  if (val?.type === 'insufficient_points') return val
  return null
})

function resumeWorkflow() {
  xiaosuoChat.resumeInterrupt({ action: 'continue' })
}
```

使用 `Dialog` 覆盖层显示积分不足提示，复用 `InitAnalysisInsufficientPointsCard` 组件。

### 3.6 生命周期

- **首次打开**（`isOpen` 变为 true）：调用 `xiaosuoChat.init()`
- **关闭**：保持 composable 状态不销毁（避免重复加载）
- **切换 session**：调用 `switchSession()`，AiChat 自动响应式更新
- **窗口管理**：拖拽、缩放、全屏保持不变（已实现的 `useDraggableResize`）

---

## 4. 不需要修改的文件

| 文件 | 原因 |
|------|------|
| `server/api/v1/case/analysis/chat.post.ts` | 统一对话端点，通过 sessionId 路由，无需改动 |
| `server/services/agent/agentWorker.ts` | type=1 已路由到 caseMainAgent |
| `server/services/workflow/agents/caseMainAgent.ts` | 已有完整功能栈 |
| `server/services/workflow/middleware/pointConsumption.middleware.ts` | 已有积分扣减 |
| `app/composables/useCaseChat.ts` | 底层对话 composable，直接复用 |
| `app/components/ai/AiChat.vue` | 对话渲染组件，直接复用 |

---

## 5. 测试计划

### 5.1 后端 API 测试

- **创建 session**：正常创建、参数校验（caseId 必需）、权限校验（只能操作自己的案件）
- **查询 session 列表**：返回正确列表、按 updatedAt 降序、只返回 source=xiaosuo 的 session
- **删除 session**：正常删除、防止删除非 xiaosuo session、有活跃 run 时先取消

### 5.2 前端 Composable 测试

- **init**：空列表自动创建首个 session、有列表恢复最近 session
- **createSession**：调用 API、更新列表、切换到新 session
- **switchSession**：停止旧 stream、创建新 useCaseChat、加载历史
- **deleteSession**：调用 API、移除列表项、当前 session 被删时切换

### 5.3 集成验证

1. 打开小索 → 自动创建 session → 显示空对话
2. 发送消息 → 收到 AI 回复 → thinking 展示正常
3. 积分不足 → 显示充值引导 → 充值后继续
4. 新建对话 → 切换到空 session
5. 切换历史对话 → 显示历史消息
6. 删除对话 → 自动切换到下一个
7. 关闭/重开小索 → 保持上次状态
8. 页面刷新 → 恢复最近 session 和消息

---

## 6. 文件变更清单

| 操作 | 文件 | 说明 |
|------|------|------|
| 新建 | `server/api/v1/case/analysis/xiaosuo-session.post.ts` | 创建 session API |
| 新建 | `server/api/v1/case/analysis/xiaosuo-sessions/[caseId].get.ts` | 查询 session 列表 API |
| 新建 | `server/api/v1/case/analysis/xiaosuo-session/[sessionId].delete.ts` | 删除 session API |
| 新建 | `app/composables/useXiaosuoChat.ts` | 小索对话管理 composable |
| 修改 | `app/components/caseDetail/CaseDetailXiaosuo.vue` | 替换 mock 为真实对话 |
| 修改 | `app/pages/dashboard/cases/[id].vue` | 传递 caseId 给小索组件 |
| 新建 | `tests/server/xiaosuo-session.test.ts` | 后端 API 测试 |
