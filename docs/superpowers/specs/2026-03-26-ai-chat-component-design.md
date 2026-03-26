# AiChat 通用 AI 流式对话组件设计

## 概述

将 `/dashboard/analysis/[sessionId]` 页面的流式对话 UI 抽象为通用组件 `AiChat`，实现开箱即用的 AI 对话界面，支持多场景复用。

### 复用场景

1. **案件分析页面** (`/dashboard/analysis/[sessionId]`) — 完整双栏：左侧对话 + 右侧分析结果
2. **初始化分析页面** (`/dashboard/cases/init-analysis/[sessionId]`) — 单栏模式，无输入框，自定义消息列表（按模块分组）
3. **案件详情嵌入** — 精简模式，无标题栏，嵌入现有页面

### 设计原则

- 组件只负责渲染，消息数据由外部 prop 传入（useStream/useInitAnalysis 等由使用方管理）
- 所有功能通过 props 配置开关，开箱即用
- 工具渲染通过映射表扩展，内置常用工具组件
- 关键区域提供 slot 覆盖点，允许使用方替换默认渲染

## 文件结构

```
app/components/ai/
├── AiChat.vue                     — 顶层容器（布局、标题栏、面板切换）~200行
├── AiMessageList.vue              — 消息列表渲染 ~150行
├── AiMessageItem.vue              — 单条消息渲染 ~150行
├── AiToolRenderer.vue             — 工具渲染路由（适配层 + 映射）~100行
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
    ├── useMessageParser.ts        — 消息解析（含 coerceRawMessages 导出）~150行
    └── useTaskQueueParser.ts      — 从消息流提取 TodoItem[] ~80行
```

## AiChat.vue 接口设计

### Props

```typescript
interface AiChatProps {
  // === 布局 ===
  title?: string                          // 标题栏文字，默认 "AI 对话"
  showHeader?: boolean                    // 是否显示标题栏，默认 true
  panelMode?: 'left' | 'right' | 'both'  // v-model:panelMode，面板模式，默认 'both'
  defaultLeftSize?: number                // 左侧面板默认宽度百分比，默认 50（仅 both 模式生效）
  minPanelSize?: number                   // 面板最小宽度百分比，默认 30（仅 both 模式生效）

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
  (e: 'submit', data: AiPromptSubmitData): void
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
  'right-panel': () => VNode              // 右侧面板内容
  'header-actions': () => VNode           // 标题栏右侧扩展区域
  'empty': () => VNode                    // 消息列表为空时的占位内容
  'message-list': (props: {              // 完全替换消息列表区域
    messages: ParsedMessage[]
    loading: boolean
  }) => VNode
  'prompt-actions': () => VNode           // 输入框区域的扩展操作（如材料选择器按钮）
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
│ │ #message-list   │ │                            │
│ │ 或 AiMessageList│ │                            │
│ │ (flex-1 滚动)    │ │                            │
│ ├─────────────────┤ │                            │
│ │ AiTaskQueue     │ │                            │
│ │ (可折叠,可选)    │ │                            │
│ ├─────────────────┤ │                            │
│ │ AiPromptInput   │ │                            │
│ │ + #prompt-actions│ │                            │
│ │ (固定底部,可选)  │ │                            │
│ └─────────────────┘ │                            │
├─────────────────────┴────────────────────────────┤
```

### 面板切换逻辑

- 标题栏提供两个切换按钮：左侧面板切换 + 右侧面板切换
- 点击"左侧切换"：`both ↔ right`
- 点击"右侧切换"：`both ↔ left`
- 通过 `v-model:panelMode` 双向绑定，内外均可控制
- 没有 `#right-panel` slot 时自动退化为 `left` 模式，隐藏切换按钮
- 当 `panelMode` 为 `left` 或 `right` 时，可见面板占据 100% 宽度

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

### 面板显隐策略

使用 `<KeepAlive>` + `v-if` 方案：
- 面板切换时通过 `v-if` 控制挂载/卸载，避免 `v-show` 与 ResizablePanel flex 布局冲突
- 外层包裹 `<KeepAlive>` 缓存组件实例，保留滚动位置和输入内容等状态

```vue
<ResizablePanelGroup direction="horizontal">
  <ResizablePanel v-if="showLeftPanel" :default-size="leftSize">
    <KeepAlive>
      <div class="..." :key="'left'">
        <!-- 左侧内容 -->
      </div>
    </KeepAlive>
  </ResizablePanel>
  <ResizableHandle v-if="showLeftPanel && showRightPanel" with-handle />
  <ResizablePanel v-if="showRightPanel" :default-size="rightSize">
    <KeepAlive>
      <slot name="right-panel" />
    </KeepAlive>
  </ResizablePanel>
</ResizablePanelGroup>
```

### 返回按钮

只在父组件监听了 `@back` 时才渲染。

## 消息解析 — useMessageParser

```typescript
// 导出 coerceRawMessages 供外部使用（收敛现有三处重复实现）
export function coerceRawMessages(raw: any[]): BaseMessage[] { ... }

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
  state: 'input-available' | 'output-available' | 'output-error'
}

function useMessageParser(messages: MaybeRef<any[]>) {
  const parsedMessages = computed<ParsedMessage[]>(() => {
    // 1. 规范化：原始字典 → BaseMessage 实例（使用导出的 coerceRawMessages）
    // 2. 过滤：ToolMessage 合并到对应 AI 消息的 toolCalls
    // 3. 提取 thinking：从 additional_kwargs.reasoning 或 content blocks（reasoning_content type）中分离，统一为 string
    // 4. 匹配工具结果：AI.tool_calls + 后续 ToolMessage → ToolCallWithResult
    // 5. 推断工具状态
  })

  return { parsedMessages }
}
```

### 工具状态推断规则

与现有实现对齐，不使用 `pending` 状态：

| 条件 | 状态 |
|------|------|
| 无匹配 ToolMessage（等待用户确认或执行中） | `input-available` |
| 有匹配，执行成功 | `output-available` |
| 有匹配，执行出错 | `output-error` |

## 任务队列解析 — useTaskQueueParser

从消息流中自动提取 `write_todos` 工具结果，返回 `TodoItem[]`，配合 `AiTaskQueue` 使用：

```typescript
function useTaskQueueParser(messages: MaybeRef<any[]>) {
  const todos = computed<TodoItem[]>(() => {
    // 1. 从消息中查找所有 write_todos 工具调用的结果
    // 2. 合并为 TodoItem[]
    // 3. 原地 diff 更新，避免全量重渲染
    // 4. 排序：in_progress → pending → completed
  })

  return { todos }
}
```

使用方可以直接用此 composable，也可以自行构造 `todos` 传给 AiChat：

```typescript
// 方式 1：自动从消息提取
const { todos } = useTaskQueueParser(displayMessages)

// 方式 2：手动传入
const todos = ref<TodoItem[]>([...])
```

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

**自动滚动策略**：
- 新消息到达时自动滚动到底部
- 用户手动向上滚动超过 100px 后暂停自动滚动
- 用户滚回底部区域（距底部 < 100px）时恢复自动滚动
- 复用现有 `AiElementsConversationScrollButton` 组件提供"回到底部"按钮

### AiMessageItem.vue

```typescript
interface Props {
  message: ParsedMessage
  toolMap?: Record<string, Component>
  showToolInterrupt?: boolean
}
interface Emits {
  (e: 'tool-confirm', data: { toolCallId: string; data: any }): void
  (e: 'tool-reject', data: { toolCallId: string }): void
}
```

根据 `message.type` 渲染：human → 右对齐气泡，ai → 左对齐 + Markdown + thinking 折叠 + 工具调用，system → 居中灰色提示。

工具中断事件从 AiToolRenderer → AiMessageItem → AiMessageList → AiChat 逐层冒泡。

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

**适配层**：AiToolRenderer 内部将新接口映射为现有工具组件的 props 格式，保持现有工具组件不需要重写：

```typescript
// 适配：将 ToolCallWithResult 映射为现有工具组件的 props
const adaptedProps = computed(() => ({
  toolName: props.toolCall.name,
  input: props.toolCall.args,
  output: props.toolCall.result,
  state: props.toolCall.state,
}))
```

现有工具组件 props 接口保持不变：

```typescript
// 现有工具组件接口（不需要修改）
interface ExistingToolProps {
  toolName: string
  input?: any
  output?: any
  state: ExtendedToolState
}
```

新增的工具组件建议使用简化接口：

```typescript
// 新工具组件推荐接口
interface ToolProps {
  input: Record<string, any>
  output?: any
  state: ToolCallWithResult['state']
}
```

AiToolRenderer 同时兼容两种接口，通过适配层自动处理。

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
  enableFileUpload?: boolean              // 默认 true，同时控制按钮显示和拖拽上传
  showThinkingToggle?: boolean            // 默认 true
  thinking?: boolean                      // v-model:thinking
  minRows?: number                        // 默认 1
  maxRows?: number                        // 默认 4
}
interface Emits {
  (e: 'submit', data: AiPromptSubmitData): void
  (e: 'update:thinking', value: boolean): void
}
defineExpose({
  reset: () => void                       // 清空输入和附件
  focus: () => void                       // 聚焦输入框（如工具确认后自动聚焦）
})
```

**提交数据类型**（与现有 PromptSubmitData 解耦）：

```typescript
interface AiPromptSubmitData {
  text: string
  files?: UploadedFile[]                  // 上传的文件列表（如有）
}
```

与现有 promptInput 的差异：
- 移除材料选择器弹框（案件特有，通过 `#prompt-actions` slot 注入）
- 移除 caseAnalysis store 依赖
- 提交类型改为 `AiPromptSubmitData`（不含 `materials` 字段）
- 保留文件上传、拖拽、识别状态轮询、文件预览等核心能力
- `enableFileUpload=false` 时同时禁用上传按钮和拖拽响应

案件分析页面需要材料选择器时，通过 slot 注入：

```vue
<AiChat ...>
  <template #prompt-actions>
    <MaterialSelectorButton @select="handleMaterialSelect" />
  </template>
</AiChat>
```

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
<script setup>
const stream = reactive(useStream({ ... }))
const { todos } = useTaskQueueParser(displayMessages)
</script>

<template>
  <AiChat
    title="案件分析"
    v-model:panel-mode="panelMode"
    v-model:thinking="thinkingEnabled"
    :messages="displayMessages"
    :loading="stream.isLoading"
    :show-prompt="true"
    :show-task-queue="true"
    :todos="todos"
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
    <template #prompt-actions>
      <MaterialSelectorButton @select="handleMaterialSelect" />
    </template>
    <template #empty>
      <CaseAnalysisWelcome />
    </template>
  </AiChat>
</template>
```

页面文件从 ~400 行缩减到 ~150 行（仅保留 useStream 逻辑和事件处理）。

### 初始化分析（单面板、自定义消息列表）

```vue
<template>
  <AiChat
    title="初始化分析"
    panel-mode="left"
    :messages="allMessages"
    :loading="isLoading"
    :show-prompt="false"
    :show-task-queue="false"
    :show-tool-interrupt="false"
    @back="goBack"
  >
    <template #message-list="{ messages, loading }">
      <!-- 管道进度条 -->
      <InitAnalysisPipelineProgress
        v-if="phase === 'running'"
        :modules="activeModules"
        :module-states="moduleStates"
      />
      <!-- 按模块分组的消息渲染 -->
      <div v-for="mod in activeModules" :key="mod">
        <InitAnalysisModuleResult
          :module-name="mod"
          :state="getModuleState(mod)"
          :messages="getModuleMessages(mod)"
          @retry="retryModule(mod)"
        />
      </div>
      <!-- 积分不足卡片 -->
      <InitAnalysisInsufficientPointsCard
        v-if="interrupt"
        @resume="resumeWorkflow"
      />
      <!-- 完成按钮 -->
      <Button v-if="phase === 'complete'" @click="goToCaseDetail">
        进入案件详情
      </Button>
    </template>
    <template #empty>
      <InitAnalysisModuleSelector
        :modules="availableModules"
        @start="startAnalysis"
      />
    </template>
  </AiChat>
</template>
```

通过 `#message-list` slot 完全替换消息渲染，支持按模块分组、管道进度条等自定义布局。

### 案件详情嵌入（精简模式）

```vue
<template>
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
</template>
```

## 关键设计决策

### 活跃 run 重连

活跃 run 自动重连（刷新页面不丢失流）是使用方（页面）的职责，不内置到 AiChat 中。原因：重连逻辑与具体的 useStream 配置强相关（API URL、threadId、初始值等），不适合通用化。使用方在 `onMounted` 中检查并处理。

### coerceRawMessages 收敛

`coerceRawMessages` 函数从 `useMessageParser.ts` 导出，供外部直接使用。现有三处重复实现（`[sessionId].vue`、`useInitAnalysis.ts`、`ModuleResult.vue`）在迁移时统一替换为此导出。

## 迁移策略

1. 先创建 `ai/` 组件体系，实现完整功能
2. 将 `analysis/[sessionId].vue` 改为使用 `AiChat`，验证功能一致性
3. 将 `init-analysis/[sessionId].vue` 改为使用 `AiChat`（通过 `#message-list` slot）
4. 替换现有三处 `coerceRawMessages` 为统一导出
5. 清理旧组件中已被 `ai/` 替代的代码
