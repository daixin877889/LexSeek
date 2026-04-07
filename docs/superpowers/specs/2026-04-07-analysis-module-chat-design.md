# 分析模块对话功能设计

## 概述

在 `/dashboard/cases/[caseId]?tab=analysis&am=detail` 页面，为每个分析模块（如案件摘要、大事记等）提供独立的多轮对话能力。用户可以通过对话与 AI 迭代优化分析结果，每次生成新的分析结果都会在 `case_analyses` 表中创建新版本。

## 需求要点

1. 复用现有 regenerate 按钮（`MessageCircleIcon`）触发模块对话
2. 对话框参考"小索"的悬浮窗样式，对话 UI 使用 `AiChat.vue` 组件
3. 后端 Agent 使用 nodes 表中 type=analysis 且 name 匹配的节点配置
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
  stopGeneration: () => void
}

interface UseModuleChatManager {
  // 模块 chat 实例 Map
  instances: Map<string, ModuleChatInstance>
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

**SSE 连接生命周期**：
- 每个 ModuleChatInstance 内部持有一个 `useCaseChat` 实例
- stream 连接在 instance 创建时建立
- 弹窗关闭/收起不影响 stream 连接
- 页面卸载（`[id].vue` onUnmounted）时统一清理所有 stream

**Session 管理**：
- 首次打开模块对话时，调用 `POST /api/v1/case/analysis/module-session` 获取或创建 session
- sessionId 缓存在 instance 中，后续复用

### 1.4 触发流程

1. 用户在 detail 视图点击 `MessageCircleIcon` 按钮
2. `AnalysisResults.vue` emit `regenerate(result)` 事件
3. `CaseDetailAnalysis.vue` 或 `[id].vue` 接收事件
4. 调用 `moduleChatManager.getOrCreateInstance(result.moduleName, result.title)`
5. 调用 `moduleChatManager.expandModule(result.moduleName)`
6. 渲染 `AnalysisModuleChat` 组件

### 1.5 分析结果联动

- 监听 SSE 事件中的 `analysis_result_saved` 类型事件
- 收到后触发 `useCaseDetail` 的分析结果刷新
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
  command: any | undefined,
  options: { userId: number; caseId: number; moduleName: string; nodeId: number }
): Promise<ReadableStream<Uint8Array>>
```

**初始化流程**：
1. 并发加载 checkpointer、store、节点配置（`getNodeConfigService(moduleName)`）
2. 创建 `createChatModel()` — 根据节点绑定的 model 配置
3. 加载工具列表（根据节点 tools 字段：search_case_materials、search_law 等）
4. 注册自定义工具 `save_analysis_result`
5. 构建 system prompt（节点 prompt + 材料上下文 + 当前最新分析结果）
6. 创建 Agent 并返回流

**中间件**：
- `pointConsumptionMiddleware(userId, 'case_analysis_token')` — 按 token 计费
- `summarizationMiddleware({ model, trigger: [{ tokens: 100000 }] })` — 长对话摘要

**关键设计：材料上下文注入 system prompt**

材料上下文（案件材料的摘要/关键信息）**必须拼接在 system prompt 中**，而非作为对话消息发送。这样：
- 材料上下文不会在前端对话流中显示给用户
- Agent 始终能访问案件材料信息作为分析依据
- 使用 `caseMaterialContextMiddleware` 的逻辑，但将结果拼接到 system prompt 而非消息

```
System Prompt 结构：
┌─────────────────────────────────────────┐
│ [节点原始 System Prompt]                   │
│ （来自 prompts 表，如"你是法律分析专家..."）   │
├─────────────────────────────────────────┤
│ [案件材料上下文]                           │
│ （材料摘要、关键信息，不在对话中显示）          │
├─────────────────────────────────────────┤
│ [当前模块最新分析结果]                      │
│ （作为已有基线，供 Agent 参考和优化）         │
├─────────────────────────────────────────┤
│ [工具使用指令]                             │
│ "当你生成或更新了该模块的分析结果时，           │
│  必须调用 save_analysis_result 工具保存"     │
└─────────────────────────────────────────┘
```

### 2.2 save_analysis_result 工具

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
1. 调用 `saveAnalysisResultService` 创建新版本记录
2. 新版本 `isActive = true`，旧版本 `isActive = false`（事务内切换）
3. 通过 `publishAgentEvent` 发送 `analysis_result_saved` 事件，携带版本号和 moduleName
4. 返回 `{ success: true, version: number, message: "分析结果已保存为第N版" }`

### 2.3 新增 API

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
3. 如无则创建新 session（type=3，metadata: `{ moduleName, nodeId }`）

### 2.4 Worker 执行分支

修改 Worker 中的 Agent 选择逻辑：

```typescript
// 伪代码
const session = await findSessionById(sessionId)
if (session.type === 3) {
  // 模块对话
  const { moduleName, nodeId } = session.metadata
  return runModuleChat(sessionId, message, command, { userId, caseId, moduleName, nodeId })
} else {
  // 主对话（type=1 普通对话, type=2 初始化分析）
  return runCaseChat(sessionId, message, command, { userId, caseId })
}
```

### 2.5 caseSessions 表扩展

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
          → 加载节点配置、创建模型、加载工具
          → 构建 system prompt（节点prompt + 材料上下文 + 最新结果）
          → createAgent.stream()
            → ReAct 循环：LLM 推理 → 工具调用
            → save_analysis_result 工具 → 保存新版本
          → publishAgentEvent → Redis
      → createEventSubscription(runId) → SSE 推送
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
| 页面刷新 | 复用 chat.post.ts 重连机制：有 activeRun + 无新消息 → replay + subscribe |
| 切换 tab 再切回 | moduleChatManager 挂载在 `[id].vue`，tab 切换不影响 |

---

## 四、涉及的文件变更

### 新建文件
| 文件 | 说明 |
|------|------|
| `app/components/case/AnalysisModuleChat.vue` | 模块对话悬浮窗组件 |
| `app/components/case/AnalysisModuleChatBar.vue` | 最小化状态条组件 |
| `app/composables/useModuleChatManager.ts` | 模块对话管理 composable |
| `server/services/workflow/agents/moduleAgent.ts` | 轻量级模块 Agent |
| `server/api/v1/case/analysis/module-session.post.ts` | 模块 session 创建 API |

### 修改文件
| 文件 | 变更说明 |
|------|---------|
| `app/pages/dashboard/cases/[id].vue` | 集成 moduleChatManager、渲染对话组件 |
| `app/components/case/AnalysisResults.vue` | regenerate 事件向上传递（已有） |
| `app/components/caseDetail/CaseDetailAnalysis.vue` | 传递 regenerate 事件到页面级 |
| `server/services/agent/agentWorker.ts`（或等效文件） | Worker 添加 session type=3 分支 |
| `server/services/case/analysis.service.ts` | 可能需要调整 saveAnalysisResultService 以支持通过 moduleName 保存 |
| `shared/types/case.ts` | 新增 session type 枚举值 |

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

1. **材料上下文必须注入 system prompt**：不作为对话消息显示，避免前端泄露
2. **版本自增**：通过 `getNextVersionDao` 确保版本号连续
3. **积分计费**：使用 `case_analysis_token` 积分项，按 token 数计费
4. **Session 唯一性**：每案件每模块最多一个 type=3 的 caseSession
