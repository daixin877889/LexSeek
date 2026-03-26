# AiChat 通用 AI 流式对话组件设计

## 概述

将 `/dashboard/analysis/[sessionId]` 页面的流式对话 UI 抽象为通用组件 `AiChat`，实现开箱即用的 AI 对话界面，支持多场景复用。

### 复用场景

1. **案件分析页面** (`/dashboard/analysis/[sessionId]`) — 完整双栏：左侧对话 + 右侧分析结果
2. **初始化分析页面** (`/dashboard/cases/init-analysis/[sessionId]`) — 单栏模式，无输入框
3. **案件详情嵌入** — 精简模式，无标题栏，嵌入现有页面

### 设计原则

- 组件只负责渲染，消息数据由外部 prop 传入（useStream/useInitAnalysis 等由使用方管理）
- 所有功能通过 props 配置开关，开箱即用
- 工具渲染通过映射表扩展，内置常用工具组件

## 文件结构

```
app/components/ai/
├── AiChat.vue                     — 顶层容器（布局、标题栏、面板切换）~200行
├── AiMessageList.vue              — 消息列表渲染 ~150行
├── AiMessageItem.vue              — 单条消息渲染 ~150行
├── AiToolRenderer.vue             — 工具渲染路由 ~80行
├── AiTaskQueue.vue                — 任务队列 ~100行
├── AiPromptInput.vue              — 输入框 ~500行
├── tools/                         — 内置工具组件
│   ├── DefaultTool.vue            — 默认 JSON 展示（fallback）
│   ├── LawSearchTool.vue          — 法条检索
│   ├── MaterialSearchTool.vue     — 案件材料检索
│   ├── MaterialProcessTool.vue    — 材料处理
│   ├── PointsReserveTool.vue      — 积分扣减/预留
│   ├── ConfirmPointsTool.vue      — 积分确认
│   ├── RollbackPointsTool.vue     — 积分回滚
│   ├── WriteTodosTool.vue         — 待办写入
│   ├── ExtractInfoTool.vue        — 基础信息提取/确认
│   ├── MembershipPurchaseTool.vue — 会员购买
│   └── PointsPurchaseTool.vue     — 积分购买
└── composables/
    └── useMessageParser.ts        — 消息解析 ~100行
```

## AiChat.vue 接口设计

### Props

```typescript
interface AiChatProps {
  // === 布局 ===
  title?: string                          // 标题栏文字，默认 "AI 对话"
  showHeader?: boolean                    // 是否显示标题栏，默认 true
  panelMode?: 'left' | 'right' | 'both'  // v-model:panelMode，面板模式，默认 'both'
  defaultLeftSize?: number                // 左侧面板默认宽度百分比，默认 50
  minPanelSize?: number                   // 面板最小宽度百分比，默认 30

  // === 消息 ===
  messages: any[]                         // 消息列表（BaseMessage[] 或原始字典）
  loading?: boolean                       // 是否正在流式输出，默认 false

  // === 输入框 ===
  showPrompt?: boolean                    // 是否显示底部输入框，默认 true
  promptPlaceholder?: string              // 输入框占位文本，默认 "输入消息..."
  promptDisabled?: boolean                // 禁用输入框，默认 false
  showThinkingToggle?: boolean            // 是否显示深度思考开关，默认 true
  enableFileUpload?: boolean              // 启用文件上传（按钮+拖拽），默认 true
  thinking?: boolean                      // v-model:thinking，深度思考状态

  // === 工具 ===
  toolMap?: Record<string, Component>     // 自定义工具映射（与内置 merge，用户优先级更高）
  showToolInterrupt?: boolean             // 是否支持工具中断（confirm/reject），默认 true

  // === 任务队列 ===
  showTaskQueue?: boolean                 // 是否显示任务队列，默认 false
  todos?: TodoItem[]                      // 任务列表数据
}
```

### Events

```typescript
interface AiChatEmits {
  (e: 'submit', data: PromptSubmitData): void
  (e: 'tool-confirm', data: { toolCallId: string; data: any }): void
  (e: 'tool-reject', data: { toolCallId: string }): void
  (e: 'back'): void
  (e: 'update:thinking', value: boolean): void
  (e: 'update:panelMode', value: 'left' | 'right' | 'both'): void
}
```

### Slots

```typescript
interface AiChatSlots {
  'right-panel': () => VNode        // 右侧面板内容
  'header-actions': () => VNode     // 标题栏右侧扩展区域
  'empty': () => VNode              // 消息列表为空时的占位内容
}
```

## 布局结构

```
┌──────────────────────────────────────────────────┐
│ Header                                           │
│ [←返回] [标题]               [⊏] [⊐] [#actions]  │
├─────────────────────┬────────────────────────────┤
│ 左侧面板            │ 右侧面板                    │
│                     │                            │
│ ┌─────────────────┐ │ #right-panel slot          │
│ │ AiMessageList   │ │                            │
│ │ (flex-1 滚动)    │ │                            │
│ ├─────────────────┤ │                            │
│ │ AiTaskQueue     │ │                            │
│ │ (可折叠,可选)    │ │                            │
│ ├─────────────────┤ │                            │
│ │ AiPromptInput   │ │                            │
│ │ (固定底部,可选)  │ │                            │
│ └─────────────────┘ │                            │
├─────────────────────┴────────────────────────────┤
```

### 面板切换逻辑

- 标题栏提供两个切换按钮：左侧面板切换 + 右侧面板切换
- 点击"左侧切换"：`both ↔ right`
- 点击"右侧切换"：`both ↔ left`
- 通过 `v-model:panelMode` 双向绑定，内外均可控制
- 使用 `v-show` 保留组件状态（滚动位置、输入内容）
- 没有 `#right-panel` slot 时自动退化为 `left` 模式，隐藏切换按钮

```typescript
const hasRightSlot = computed(() => !!slots['right-panel'])
const effectivePanelMode = computed(() => {
  if (!hasRightSlot.value) return 'left'
  return props.panelMode
})
const showLeftPanel = computed(() =>
  effectivePanelMode.value === 'left' || effectivePanelMode.value === 'both'
)
const showRightPanel = computed(() =>
  effectivePanelMode.value === 'right' || effectivePanelMode.value === 'both'
)
```

### 返回按钮

只在父组件监听了 `@back` 时才渲染。

## 消息解析 — useMessageParser

```typescript
interface ParsedMessage {
  id: string
  type: 'human' | 'ai' | 'tool' | 'system'
  content: string
  thinking?: string
  toolCalls?: ToolCallWithResult[]
  raw: any
}

interface ToolCallWithResult {
  id: string
  name: string
  args: Record<string, any>
  result?: any
  state: 'pending' | 'input-available' | 'output-available' | 'output-error'
}

function useMessageParser(messages: MaybeRef<any[]>) {
  const parsedMessages = computed<ParsedMessage[]>(() => {
    // 1. 规范化：原始字典 → BaseMessage 实例（复用 coerceRawMessages）
    // 2. 过滤：ToolMessage 合并到对应 AI 消息的 toolCalls
    // 3. 提取 thinking：从 additional_kwargs.reasoning 或 content blocks 中分离
    // 4. 匹配工具结果：AI.tool_calls + ToolMessage → ToolCallWithResult
    // 5. 推断工具状态：pending / input-available / output-available / output-error
  })

  return { parsedMessages }
}
```

### 工具状态推断规则

| 条件 | 状态 |
|------|------|
| 无匹配 ToolMessage | `pending` |
| 有匹配，需人工确认（interrupt） | `input-available` |
| 有匹配，执行成功 | `output-available` |
| 有匹配，执行出错 | `output-error` |

## 子组件接口

### AiMessageList.vue

```typescript
interface Props {
  messages: ParsedMessage[]
  loading?: boolean                       // 显示打字指示器
  toolMap?: Record<string, Component>
  showToolInterrupt?: boolean
}
interface Emits {
  (e: 'tool-confirm', data: { toolCallId: string; data: any }): void
  (e: 'tool-reject', data: { toolCallId: string }): void
}
// Slots: 'empty'
```

自动滚动到底部，流式输出中实时更新。

### AiMessageItem.vue

```typescript
interface Props {
  message: ParsedMessage
  toolMap?: Record<string, Component>
  showToolInterrupt?: boolean
}
```

根据 `message.type` 渲染：human → 右对齐气泡，ai → 左对齐 + Markdown + thinking 折叠 + 工具调用，system → 居中灰色提示。

### AiToolRenderer.vue

```typescript
interface Props {
  toolCall: ToolCallWithResult
  toolMap?: Record<string, Component>
  showInterrupt?: boolean
}
interface Emits {
  (e: 'confirm', data: any): void
  (e: 'reject'): void
}
```

渲染逻辑：`toolMap[toolCall.name] ?? DefaultTool`。

所有工具组件统一 props 接口：

```typescript
interface ToolProps {
  input: Record<string, any>
  output?: any
  state: ToolCallWithResult['state']
}
```

### AiTaskQueue.vue

```typescript
interface Props {
  todos: TodoItem[]
  collapsible?: boolean                   // 默认 true
  defaultExpanded?: boolean               // 默认 true
}
interface TodoItem {
  id: string
  text: string
  status: 'pending' | 'in_progress' | 'completed'
}
```

排序：in_progress → pending → completed。

### AiPromptInput.vue

```typescript
interface Props {
  loading?: boolean
  disabled?: boolean
  placeholder?: string                    // 默认 "输入消息..."
  enableFileUpload?: boolean              // 默认 true，控制按钮+拖拽
  showThinkingToggle?: boolean            // 默认 true
  thinking?: boolean                      // v-model:thinking
  minRows?: number                        // 默认 1
  maxRows?: number                        // 默认 4
}
interface Emits {
  (e: 'submit', data: PromptSubmitData): void
  (e: 'update:thinking', value: boolean): void
}
defineExpose({
  reset: () => void
  focus: () => void
})
```

与现有 promptInput 的差异：移除材料选择器弹框和 caseAnalysis store 依赖，保留文件上传、拖拽、识别状态轮询、文件预览等核心能力。

## 工具映射策略

组件内置默认工具映射表：

```typescript
const builtInToolMap: Record<string, Component> = {
  search_law: AiToolsLawSearchTool,
  search_case_materials: AiToolsMaterialSearchTool,
  process_materials: AiToolsMaterialProcessTool,
  reserve_points: AiToolsPointsReserveTool,
  confirm_points: AiToolsConfirmPointsTool,
  rollback_points: AiToolsRollbackPointsTool,
  write_todos: AiToolsWriteTodosTool,
  extract_info: AiToolsExtractInfoTool,
  // ...
}
```

与用户传入的 `toolMap` merge，用户优先级更高：

```typescript
const mergedToolMap = computed(() => ({
  ...builtInToolMap,
  ...props.toolMap,
}))
```

## 使用示例

### 案件分析（完整功能）

```vue
<AiChat
  title="案件分析"
  v-model:panel-mode="panelMode"
  v-model:thinking="thinkingEnabled"
  :messages="displayMessages"
  :loading="stream.isLoading"
  :show-prompt="true"
  :show-task-queue="true"
  :todos="allTodos"
  :show-tool-interrupt="true"
  :prompt-disabled="isComplete"
  prompt-placeholder="输入补充信息或问题..."
  @submit="handlePromptSubmit"
  @tool-confirm="handleToolConfirm"
  @tool-reject="handleToolReject"
  @back="goBack"
>
  <template #right-panel>
    <CaseAnalysisResults
      :results="analysisResults"
      v-model:active-index="activeResultIndex"
      :show-regenerate="true"
      :show-copy="true"
      :is-analyzing="stream.isLoading"
      @regenerate="handleRegenerate"
    />
  </template>
  <template #empty>
    <CaseAnalysisWelcome />
  </template>
</AiChat>
```

### 初始化分析（单面板、无输入框）

```vue
<AiChat
  title="初始化分析"
  panel-mode="left"
  :messages="moduleMessages"
  :loading="isLoading"
  :show-prompt="false"
  :show-task-queue="false"
  :show-tool-interrupt="false"
  @back="goBack"
>
  <template #empty>
    <InitAnalysisModuleSelector
      :modules="availableModules"
      @start="startAnalysis"
    />
  </template>
</AiChat>
```

### 案件详情嵌入（精简模式）

```vue
<AiChat
  title="AI 助手"
  v-model:panel-mode="panelMode"
  :messages="messages"
  :loading="loading"
  :show-prompt="true"
  :show-task-queue="false"
  :show-header="false"
  :enable-file-upload="false"
  :show-thinking-toggle="false"
  prompt-placeholder="关于此案件有什么问题？"
  @submit="handleSubmit"
>
  <template #right-panel>
    <CaseDetailPanel :case-id="caseId" />
  </template>
</AiChat>
```

## 迁移策略

1. 先创建 `ai/` 组件体系，实现完整功能
2. 将 `analysis/[sessionId].vue` 改为使用 `AiChat`，验证功能一致性
3. 将 `init-analysis/[sessionId].vue` 改为使用 `AiChat`
4. 清理旧组件中已被 `ai/` 替代的代码
