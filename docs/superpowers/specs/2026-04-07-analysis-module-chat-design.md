# 分析模块对话功能设计

## 概述

在 `/dashboard/cases/[caseId]?tab=analysis&am=detail` 页面，为每个分析模块（如案件摘要、大事记等）提供独立的多轮对话能力。用户可以通过对话与 AI 迭代优化分析结果，每次生成新的分析结果都会在 `case_analyses` 表中创建新版本。

## 需求要点

1. 复用现有 regenerate 按钮（`MessageCircleIcon`）触发模块对话
2. 对话框参考"小索"的悬浮窗样式，对话 UI 使用 `AiChat.vue` 组件
3. 后端 Agent 使用 nodes 表中 type=analysis 且同 name 的节点配置
4. 支持多轮对话，每次生成分析结果在 case_analyses 表新增新版本
5. 多模块可并发分析，关闭弹窗不断 SSE 连接
6. 页面刷新后支持重连恢复

---

## 一、前端设计

### 1.1 新建组件

#### `app/components/case/AnalysisModuleChat.vue`

模块对话悬浮窗组件，参考 `CaseDetailXiaosuo.vue` 的 UI 结构：

- **Props**：
  - `modelValue: boolean` — 控制窗口展开/收起
  - `caseId: number`
  - `moduleName: string` — 模块标识（如 summary、chronicle）
  - `moduleTitle: string` — 模块显示名称
  - `chatInstance: ModuleChatInstance` — 来自 useModuleChatManager 的 chat 实例

- **桌面端**：
  - 小窗模式：`absolute bottom-14 right-0 w-[380px] h-[500px]`
  - 全屏模式：`fixed inset-0 z-50`
  - 支持小窗/全屏切换

- **移动端**：
  - 底部 Sheet（`h-[90vh]`）

- **对话区域**：使用 `AiChat.vue` 组件
  - `panelMode="left"`（仅左侧消息面板，不需要右侧面板）
  - 传入来自 chatInstance 的 messages、loading 状态

### 1.2 多窗口管理

#### `app/components/case/AnalysisModuleChatBar.vue`

最小化状态条组件，显示在右下角：

- 每个正在分析或有活跃对话的模块显示为一个小状态条
- 状态条展示：模块名 + 状态图标（分析中旋转/已完成绿点）
- 点击状态条 → 展开该模块的对话窗口（同时收起其他窗口）
- 同一时间只展开一个对话窗口

### 1.3 新建 Composable

#### `app/composables/useModuleChatManager.ts`

统一管理所有模块的对话实例，挂载在 `[id].vue` 页面级：

```typescript
interface ModuleChatInstance {
  moduleName: string
  moduleTitle: string
  sessionId: Ref<string | null>
  messages: ComputedRef<BaseMessage[]>
  isLoading: Ref<boolean>
  isExpanded: Ref<boolean>  // 窗口是否展开
  isActive: Ref<boolean>    // 是否有活跃的分析任务
  sendMessage: (message: string) => void
  stopGeneration: () => void  // 中止 SSE + 取消后端 run
}

interface UseModuleChatManager {
  // 模块 chat 实例（使用 reactive Record 而非 Map，确保 Vue 响应式）
  instances: Record<string, ModuleChatInstance>
  // 获取或创建模块 chat 实例
  getOrCreateInstance(moduleName: string, moduleTitle: string): ModuleChatInstance
  // 展开指定模块的对话窗口
  expandModule(moduleName: string): void
  // 收起所有窗口
  collapseAll(): void
  // 当前展开的模块名
  expandedModule: Ref<string | null>
  // 所有活跃的模块列表（用于渲染状态条）
  activeModules: ComputedRef<ModuleChatInstance[]>
}
```

**注意**：`instances` 使用 `reactive<Record<string, ModuleChatInstance>>({})` 而非原生 `Map`，因为 Vue 3 对 `Map` 的响应式支持有限，`computed` 和 `watch` 在 Map 更新时不会可靠触发。

**SSE 连接生命周期**：
- 每个 ModuleChatInstance 内部持有一个 `useCaseChat` 实例
- stream 连接在 sessionId 获取后建立（首次调用 `getOrCreateInstance` 时先请求 session API，拿到 sessionId 后才创建 stream）
- 弹窗关闭/收起不影响 stream 连接
- 页面卸载（`[id].vue` onUnmounted）时统一清理所有 stream

**Session 管理**：
- 首次打开模块对话时，调用 `POST /api/v1/case/analysis/module-session` 获取或创建 session
- sessionId 缓存在 instance 中，后续复用

### 1.4 触发流程

1. 用户在 detail 视图点击 `MessageCircleIcon` 按钮
2. `AnalysisResults.vue` emit `regenerate(result)` 事件
3. `CaseDetailAnalysis.vue` 或 `[id].vue` 接收事件
4. 调用 `moduleChatManager.getOrCreateInstance(result.moduleName, result.moduleTitle)`
5. 调用 `moduleChatManager.expandModule(result.moduleName)`
6. 渲染 `AnalysisModuleChat` 组件

### 1.5 分析结果联动

- `useCaseChat` 的 `useStream` 原生支持 `onCustomEvent` 回调（`@langchain/vue` 内置），可接收自定义事件
- **前置修改**：当前 `useCaseChat` 的 `CaseChatOptions` 只有 `sessionId` 字段，不接受 `onCustomEvent`。需扩展 `CaseChatOptions` 添加 `onCustomEvent` 可选参数，并在内部 `useStream` 调用时透传
- **SSE 事件格式要求**：chat.post.ts 推送自定义事件时，SSE 的 event 名必须是 `custom`（不是 `analysis_result_saved`），具体事件名和数据放在 data 中。因为 `useStream` 内部的 `matchEventType` 匹配规则是 `event === "custom"`
  ```
  event: custom
  data: {"name":"analysis_result_saved","version":3,"moduleName":"summary","analysisId":123}
  ```
- `useModuleChatManager` 在创建 `useCaseChat` 实例时传入 `onCustomEvent` 回调
- 收到 `analysis_result_saved` 事件后触发 `useCaseDetail` 的分析结果刷新
- detail 视图实时更新为最新版本的 Markdown 内容和版本号
- 版本历史 Sheet（CaseAnalysisVersionSheet）自然包含新版本

---

## 二、后端设计

### 2.1 新建 moduleAgent

**文件**：`server/services/workflow/agents/moduleAgent.ts`

使用 LangGraph `createAgent`（ReAct 模式），结构类似 `caseMainAgent` 但更轻量：

```typescript
export async function runModuleChat(
  sessionId: string,
  message: string | undefined,
  options: { userId: number; caseId: number; moduleName: string; nodeId: number; command?: unknown }
): Promise<ReadableStream<Uint8Array>>
```

**初始化流程**：
1. 并发加载 checkpointer、store、节点配置（`getValidNodeConfig(moduleName)`，按名称查找，自带 API 密钥验证）
2. 创建 `createChatModel()` — 根据节点绑定的 model 配置
3. 加载工具列表（根据节点 tools 字段：search_case_materials、search_law 等）
4. 注册自定义工具 `save_analysis_result`
5. 构建 system prompt（仅节点原始 prompt + 工具使用指令，**静态不变**）
6. 创建 Agent 并返回流

**中间件**：
- `pointConsumptionMiddleware(userId, 'case_analysis_token')` — 按 token 计费
- `summarizationMiddleware({ model, trigger: [{ tokens: 100000 }] })` — 长对话摘要
- `moduleContextMiddleware` — **新建**，每轮对话前注入动态上下文（见 2.2）
- **注意：不得挂载 `analysisResultPersistenceMiddleware`**，否则会和 `save_analysis_result` 工具双重写入。该中间件在 afterAgent 中自动提取最后一条 AIMessage 保存，与工具主动调用保存冲突

**关键设计：静态 System Prompt + 动态上下文消息**

为了命中模型供应商的 Prompt Caching 机制（基于消息前缀匹配），system prompt **保持不变**，动态变化的上下文通过 `beforeAgent` 中间件注入：

```
消息结构：
┌─────────────────────────────────────────┐
│ [SystemMessage] 节点原始 System Prompt     │ ← 静态，命中缓存
│ （来自 prompts 表，如"你是法律分析专家..."）   │
│ + 工具使用指令                              │
├─────────────────────────────────────────┤
│ [...历史对话消息]                          │ ← checkpointer 恢复
├─────────────────────────────────────────┤
│ [SystemMessage] 动态上下文（仅变更时注入）    │ ← beforeAgent 按需注入
│ （仅包含自上次注入以来发生变化的部分）          │
├─────────────────────────────────────────┤
│ [HumanMessage] 用户最新输入                │
└─────────────────────────────────────────┘
```

**上下文不可见性保障**：
- 动态上下文作为 SystemMessage 注入，位于最新 HumanMessage 之前
- 前端 `useMessageParser` 过滤 SystemMessage，不在对话 UI 中展示
- 材料、记忆、其他模块结果均不会显示给用户

### 2.2 moduleContextMiddleware（新建）

**文件**：`server/services/workflow/middleware/moduleContext.middleware.ts`

`beforeAgent` hook，每轮对话前执行。**仅在检测到变更时注入**，无变更则零额外 token 消耗。

#### 变更检测机制

通过 `createMiddleware` 的 `stateSchema` 参数声明追踪字段，LangGraph 自动随 checkpoint 持久化（参考 `caseMaterialContextMiddleware` 的 `_injectedSourceIds` 实现模式）：

```typescript
createMiddleware({
  name: 'ModuleContextMiddleware',
  stateSchema: z.object({
    _injectedSourceIds: z.array(z.number()).default([]),
    _lastMemoryHash: z.string().nullable().default(null),
    _injectedResultVersions: z.record(z.string(), z.number()).default({}),
    _currentModuleVersion: z.number().nullable().default(null),
  }),
  // ...
})
```

| 上下文类型 | 检测方式 | 首轮行为 | 后续轮次行为 |
|-----------|---------|---------|------------|
| 案件材料 | 对比 `_injectedSourceIds`，检查是否有新增 sourceId | 全量注入 | 仅注入新增材料（summary 模式） |
| 长期记忆 | 对比 basic_info 内容的 hash 值 | 全量注入 | hash 不同时注入完整记忆 |
| 其他模块结果 | 对比各模块 activeVersion 版本号 | 全量注入（排除当前模块） | 仅注入版本号变化的模块结果 |
| 当前模块结果 | 对比 version 号 | 注入最新结果作为基线 | 版本变化时注入新结果 |

#### 执行流程

1. 从 State 读取追踪字段（首轮为空/null）
2. 并发加载 4 种上下文的当前状态
3. 逐项对比：
   - 材料：当前 sourceIds vs `_injectedSourceIds` → 有新增则构建增量内容
   - 记忆：当前 hash vs `_lastMemoryHash` → 不同则构建完整记忆
   - 其他模块：当前各模块 version vs `_injectedResultVersions` → 变化的模块构建内容
   - 当前模块：当前 version vs `_currentModuleVersion` → 变化则构建内容
4. **全部无变更** → 跳过，不注入任何消息
5. **有变更** → 将变更内容拼接为一条 SystemMessage，插入最新 HumanMessage 之前
6. 更新 State 中的追踪字段

参考实现：`caseMaterialContextMiddleware` 的 `_injectedSourceIds` 增量逻辑。

**关键**：每轮对话前执行变更检测，仅在检测到变化时注入增量内容，无变更则跳过，避免重复注入浪费 token。

### 2.3 save_analysis_result 工具

Agent 的专用工具，用于保存分析结果到 case_analyses 表：

```typescript
// 工具定义
{
  name: 'save_analysis_result',
  description: '保存分析结果。当你生成或更新了该模块的分析结果时，必须调用此工具保存。',
  schema: {
    type: 'object',
    properties: {
      analysisResult: {
        type: 'string',
        description: '分析结果内容，Markdown 格式'
      }
    },
    required: ['analysisResult']
  }
}
```

**执行逻辑**：
1. 在单个事务内完成保存 + 激活：调用 `saveAnalysisResultService` 创建新版本记录，然后调用 `activateVersionDao(newAnalysis.id, caseId, nodeId)` 切换 isActive（注意：`saveAnalysisResultService` 默认 isActive=false，必须在同一事务内额外调用激活，避免中间崩溃导致新版本未激活）。建议封装为 `saveAndActivateAnalysisService`
2. 通过新增的 `publishCustomEvent` 函数（见 2.7 事件扩展）发送 `analysis_result_saved` 事件，携带版本号和 moduleName
3. 返回 `{ success: true, version: number, message: "分析结果已保存为第N版" }`

**工具上下文获取**：
- `caseId`、`sessionId`、`moduleName`、`nodeId` 通过工具工厂函数的闭包捕获（同现有 `searchCaseMaterials` 工具的 `createTool(context)` 模式）
- 此处 `sessionId` 是模块对话的 type=3 session（即 `runModuleChat` 的第一个参数），也是 LangGraph 的 `thread_id`。`saveAnalysisResultService` 需要 sessionId 作为必填参数，使用此 sessionId 即可
- `runId`：需扩展现有 `ToolContext` 接口添加 `runId` 字段，由 Worker 在执行 `runModuleChat` 前从 DB 查出并注入。现有 `ToolContext`（`server/services/workflow/tools/types.ts`）只有 `userId`/`caseId`/`sessionId`

### 2.4 新增 API

#### `POST /api/v1/case/analysis/module-session`

创建或获取模块对话 session：

```typescript
// 请求体
{
  caseId: number
  moduleName: string  // 如 "summary", "chronicle"
}

// 响应
{
  code: 200,
  data: {
    sessionId: string
    isNew: boolean  // 是否新创建
  }
}
```

**逻辑**：
1. 查找该案件该模块是否已有 type=3 的 caseSession
2. 如有则返回已有 sessionId
3. 如无则：通过 `getNodeByNameService(moduleName)` 查 nodes 表获取 nodeId，然后创建新 session（type=3，metadata: `{ moduleName, nodeId }`）

**前置依赖**：现有 `createSessionDao`（`case.dao.ts`）的 `CreateSessionInput` 类型不支持 `type` 和 `metadata` 字段，需先扩展 DAO 层，添加这两个可选字段。

### 2.5 Worker 执行分支

修改 Worker 中的 Agent 选择逻辑。Worker 从 `session.metadata`（而非 `run.input`）获取 `moduleName` 和 `nodeId`。**注意**：当前 Worker 查询 session 时 `select: { type: true }`，需扩展为 `select: { type: true, metadata: true }`：

```typescript
// agentWorker.ts 中 executeRun 分支（约第 136-159 行）
const session = await findSessionById(sessionId)
if (session.type === 3) {
  // 模块对话：从 session.metadata 获取模块信息
  const { moduleName, nodeId } = session.metadata as { moduleName: string; nodeId: number }
  return runModuleChat(sessionId, message, { userId, caseId, moduleName, nodeId, command })
} else {
  // 主对话（type=1 普通对话, type=2 初始化分析）
  return runCaseChat(sessionId, message, command, { userId, caseId })
}
```

**interrupt 状态处理**：`agentWorker.ts` 第 222-265 行有 interrupt 检测分支，当前仅处理 `type===2`（调用 `getWorkflowThreadState`）和 `else`（调用 `getChatThreadState`）。type=3 使用 LangGraph `createAgent`（ReAct 模式），interrupt 处理方式与主对话（type=1）相同，应走 `getChatThreadState` 路径。实现时确认该 else 分支覆盖 type=3 即可，无需新增独立分支。

### 2.6 caseSessions 表扩展

新增 type 值：
- type=1：普通对话
- type=2：初始化分析
- type=3：**模块对话**（新增）

metadata 结构（type=3 时）：
```json
{
  "moduleName": "summary",
  "nodeId": 6
}
```

### 2.7 AgentEvent 类型扩展

现有 `AgentEvent` 类型（`shared/types/agentRun.ts`）是封闭 union：`AgentStreamEvent | AgentStatusEvent`。`analysis_result_saved` 无法通过现有类型传递。

**扩展方案**：新增 `AgentCustomEvent` 类型：

```typescript
// shared/types/agentRun.ts
export interface AgentCustomEvent {
  type: 'custom_event'
  runId: string
  sessionId: string
  name: string   // 如 'analysis_result_saved'
  data: unknown  // { version: number, moduleName: string, analysisId: number }
}
export type AgentEvent = AgentStreamEvent | AgentStatusEvent | AgentCustomEvent
```

**同时修改**：
- `agentEventBridge.ts`：**新增独立函数 `publishCustomEvent`**（不修改现有 `publishAgentEvent` 的入参类型，避免破坏已有调用方的类型安全）
- `chat.post.ts`：SSE 转发循环中增加 `evt.type === 'custom_event'` 分支，推送格式必须为 `event: custom\ndata: ${JSON.stringify(evt.data)}\n\n`（event 名为 `custom` 而非具体事件名，`useStream` 的 `matchEventType` 按此规则匹配）。**注意：replay（补发历史事件）和实时转发两处都需要增加该分支**，否则断线重连后 custom 事件会被错误地以 `event: status` 推送

### 2.8 stopGeneration 取消 Worker 任务

前端 `stopGeneration` 除了中止 SSE 连接外，**必须同时调用** `POST /api/v1/case/analysis/runs/cancel/[runId]` 取消 Worker 中正在执行的 run，避免 Worker 继续消耗积分。

`ModuleChatInstance.stopGeneration` 实现：
1. 调用 `stream.stop()` 中止 SSE
2. 调用 `GET /api/v1/case/analysis/runs/current/[sessionId]` 获取当前 runId（已有 API）
3. 调用 `POST /api/v1/case/analysis/runs/cancel/[runId]` 取消后端 run

---

## 三、数据流

### 3.1 完整调用链

```
用户点击 MessageCircleIcon
  → AnalysisResults emit('regenerate', result)
  → moduleChatManager.expandModule(result.moduleName)
  → 首次: POST /api/v1/case/analysis/module-session 获取 sessionId
  → 用户输入消息
  → useCaseChat.sendMessage(message)
    → stream.submit({ messages: [{ type: 'human', content }] })
    → POST /api/v1/case/analysis/chat (FetchStreamTransport)
      → 验证权限 + findCaseBySessionId
      → enqueueRunService() → Redis publish('agent_tasks')
      → Worker 收到任务
        → session.type === 3 → runModuleChat()
          → 加载节点配置（按 moduleName）、创建模型、加载工具
          → 构建静态 system prompt（节点 prompt + 工具指令）
          → moduleContextMiddleware beforeAgent 注入动态上下文
          → createAgent.stream()
            → ReAct 循环：LLM 推理 → 工具调用
            → save_analysis_result 工具 → 保存新版本 + 激活 → publishCustomEvent
          → publishAgentEvent（stream_event）→ Redis
          → publishCustomEvent（custom_event）→ Redis
      → createEventSubscription(runId) → SSE 推送（stream_event/status_change/custom 三种事件）
    → 前端 stream.messages 响应式更新
    → AiChat 渲染对话
    → 收到 analysis_result_saved 事件 → 刷新 detail 视图
```

### 3.2 多模块并发

```
模块A对话（展开）   模块B对话（最小化状态条）   模块C对话（最小化状态条）
    │                      │                        │
    ▼                      ▼                        ▼
useCaseChat A         useCaseChat B            useCaseChat C
    │                      │                        │
    ▼                      ▼                        ▼
SSE stream A          SSE stream B             SSE stream C
（独立 session）      （独立 session）          （独立 session）
```

- 每个模块有独立的 sessionId、stream 连接、消息列表
- 同一时间只展开一个窗口，其余显示为最小化状态条
- 关闭窗口 = 最小化，不断 SSE 连接

### 3.3 重连场景

| 场景 | 处理方式 |
|------|---------|
| 关闭弹窗再打开 | stream 连接仍在，直接恢复显示 |
| 页面刷新 | 见下方恢复流程 |
| 切换 tab 再切回 | moduleChatManager 挂载在 `[id].vue`，tab 切换不影响 |

**页面刷新恢复流程**：

页面刷新后 `moduleChatManager` 状态丢失，需要恢复活跃模块列表：

1. `[id].vue` 页面加载时，调用 `GET /api/v1/case/analysis/module-sessions?caseId=xxx`（**新增 API**）查询该案件所有 type=3 的 caseSession
2. 对每个返回的 session，检查是否有 activeRun（可在同一 API 中返回）
3. 为有 activeRun 的 session 自动重建 `ModuleChatInstance`
4. **重连触发**：`useStream` 初始化时不会自动发请求，需在创建 instance 后显式调用 `stream.submit(undefined)` （空 submit，无新消息）触发 chat.post.ts 的重连分支（有 activeRun + 无新消息 → replay + subscribe）
5. 无 activeRun 的 session 不自动重建，等用户再次点击时按需创建

---

## 四、涉及的文件变更

### 新建文件
| 文件 | 说明 |
|------|------|
| `app/components/case/AnalysisModuleChat.vue` | 模块对话悬浮窗组件 |
| `app/components/case/AnalysisModuleChatBar.vue` | 最小化状态条组件 |
| `app/composables/useModuleChatManager.ts` | 模块对话管理 composable |
| `server/services/workflow/agents/moduleAgent.ts` | 轻量级模块 Agent |
| `server/services/workflow/middleware/moduleContext.middleware.ts` | 每轮动态上下文注入中间件 |
| `server/api/v1/case/analysis/module-session.post.ts` | 模块 session 创建/获取 API |
| `server/api/v1/case/analysis/module-sessions.get.ts` | 查询活跃模块 session 列表 API（页面刷新恢复用） |

### 修改文件
| 文件 | 变更说明 |
|------|---------|
| `app/pages/dashboard/cases/[id].vue` | 集成 moduleChatManager、渲染对话组件 |
| `app/composables/useCaseChat.ts` | 扩展 CaseChatOptions 支持 onCustomEvent 等 useStream 回调透传 |
| `app/components/case/AnalysisResults.vue` | regenerate 事件向上传递（已有） |
| `app/components/caseDetail/CaseDetailAnalysis.vue` | 传递 regenerate 事件到页面级 |
| `server/services/agent/agentWorker.ts`（或等效文件） | Worker 添加 session type=3 分支，select 扩展 metadata，注入 runId 到 ToolContext |
| `server/services/case/analysis.service.ts` | 新增 saveAndActivateAnalysisService（事务内保存+激活） |
| `shared/types/agentRun.ts` | 新增 AgentCustomEvent 类型 |
| `shared/types/case.ts` | 新增 session type 枚举值 |
| `server/services/workflow/tools/types.ts` | ToolContext 接口添加 runId 字段 |
| `server/services/agent/agentEventBridge.ts` | 新增 publishCustomEvent 函数（独立于 publishAgentEvent） |
| `server/api/v1/case/analysis/chat.post.ts` | SSE 转发循环中增加 custom_event 分支 |
| `server/services/case/case.dao.ts` | 扩展 CreateSessionInput 类型，添加 type/metadata 字段 |

---

## 五、错误处理

| 场景 | 处理 |
|------|------|
| 积分不足 | Agent 中间件拦截，通过 SSE 事件通知前端展示积分不足提示 |
| 节点配置缺失 | runModuleChat 启动时校验，失败则 SSE 推送错误事件 |
| SSE 断连 | FetchStreamTransport 自动重试 + chat.post.ts replay 机制 |
| 并发对话冲突 | 同一模块 session 已有 activeRun → 返回 429 |
| save_analysis_result 失败 | 工具返回错误信息，Agent 可重试 |

---

## 六、技术约束

1. **动态上下文不可见**：材料、记忆、其他模块结果通过 SystemMessage 注入，前端过滤不显示
2. **静态 System Prompt**：节点原始 prompt 不变，以命中模型供应商的 Prompt Caching
3. **增量上下文注入**：`moduleContextMiddleware` 在 `beforeAgent` 中通过变更检测（sourceIds/hash/version）按需注入，无变更时零额外 token 消耗
4. **版本自增**：通过 `getNextVersionDao` 确保版本号连续
5. **版本激活**：`save_analysis_result` 工具保存后必须调用 `activateVersionDao` 切换 isActive
6. **积分计费**：使用 `case_analysis_token` 积分项，按 token 数计费
7. **Session 唯一性**：每案件每模块最多一个 type=3 的 caseSession。通过应用层幂等事务保障（参考 `agentRun.dao.ts` P2002 处理模式），避免并发竞态创建多个 session
8. **节点配置加载**：使用现有 `getValidNodeConfig(moduleName)`（按名称查找，自带验证），node name 唯一无需按 ID 查找
9. **stopGeneration 双重取消**：前端中止 SSE + 后端取消 run，避免 Worker 继续消耗积分
