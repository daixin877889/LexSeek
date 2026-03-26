# AiChat 通用 AI 流式对话组件实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 analysis 页面的流式对话 UI 抽象为通用 `AiChat` 组件，支持多场景复用。

**Architecture:** 组合式组件体系 — AiChat 顶层容器管理布局和面板切换，内部由 AiMessageList/AiMessageItem/AiToolRenderer/AiTaskQueue/AiPromptInput 组合。消息解析逻辑抽取到 useMessageParser composable。工具渲染通过映射表扩展，AiToolRenderer 包含适配层兼容现有工具组件接口。

**Tech Stack:** Vue 3 + TypeScript, shadcn-vue (ResizablePanel), @langchain/core (BaseMessage types), existing ai-elements components

**Spec:** `docs/superpowers/specs/2026-03-26-ai-chat-component-design.md`

---

## Task 1: useMessageParser composable

**Files:**
- Create: `app/components/ai/composables/useMessageParser.ts`
- Reference: `app/pages/dashboard/analysis/[sessionId].vue:189-196` (coerceRawMessages)
- Reference: `app/pages/dashboard/analysis/[sessionId].vue:198-260` (消息处理链)
- Reference: `app/pages/dashboard/analysis/[sessionId].vue:335-365` (getToolCallsForMessage)

- [ ] **Step 1: 创建 useMessageParser 文件，实现 coerceRawMessages**

从 `[sessionId].vue:189-196` 提取 `coerceRawMessages`，支持 human/ai/tool 三种消息类型的字典→BaseMessage 转换。导出供外部使用。

```typescript
// app/components/ai/composables/useMessageParser.ts
import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages'
import type { BaseMessage } from '@langchain/core/messages'

export function coerceRawMessages(raw: any[]): BaseMessage[] {
  if (!raw?.length) return []
  return raw
    .map((m: any) => {
      if (m instanceof HumanMessage || m instanceof AIMessage || m instanceof ToolMessage)
        return m
      const type = m?.type ?? m?._type
      if (type === 'human') return new HumanMessage(m)
      if (type === 'ai') return new AIMessage(m)
      if (type === 'tool') return new ToolMessage(m)
      return null
    })
    .filter(Boolean) as BaseMessage[]
}
```

- [ ] **Step 2: 实现 ParsedMessage 和 ToolCallWithResult 类型**

```typescript
export interface ToolCallWithResult {
  id: string
  name: string
  args: Record<string, any>
  result?: any
  state: 'input-available' | 'output-available' | 'output-error'
}

export interface ParsedMessage {
  id: string
  type: 'human' | 'ai' | 'tool' | 'system'
  content: string
  thinking?: string
  toolCalls?: ToolCallWithResult[]
  raw: any
}
```

- [ ] **Step 3: 实现 thinking 提取逻辑**

从 `[sessionId].vue:324-339` 提取 `getReasoningText`，支持两种传输格式：
- `contentBlocks` 中 `type === 'reasoning'`（LGP transport 路径）
- `content` 数组中 `type === 'thinking'`（FetchStreamTransport 路径）

```typescript
function extractThinking(message: AIMessage): string | undefined {
  // 格式 1: contentBlocks（LGP transport 路径）
  if ('contentBlocks' in message) {
    const text = (message as any).contentBlocks
      .filter((b: any) => b.type === 'reasoning')
      .map((b: any) => b.reasoning)
      .join('')
    if (text) return text
  }
  // 格式 2: content 数组中的 thinking 块（FetchStreamTransport 路径）
  if (Array.isArray(message.content)) {
    const text = message.content
      .filter((b: any) => b.type === 'thinking')
      .map((b: any) => b.thinking)
      .join('')
    if (text) return text
  }
  return undefined
}
```

- [ ] **Step 4: 实现工具调用匹配和状态推断**

从 `[sessionId].vue:350-374` 提取 toolResultsMap + getToolCallsForMessage，适配新接口。

注意：工具错误状态使用 `result.status === 'error'`（与现有实现一致），不是 `additional_kwargs.is_error`。

```typescript
function matchToolCalls(
  aiMessage: AIMessage,
  toolResultsMap: Map<string, any>
): ToolCallWithResult[] {
  const toolCalls = (aiMessage as any).tool_calls ?? []
  if (!toolCalls.length) return []

  return toolCalls.map((tc: any) => {
    const result = toolResultsMap.get(tc.id ?? '')
    const hasError = result && result.status === 'error'

    return {
      id: tc.id ?? '',
      name: tc.name,
      args: tc.args ?? {},
      result: result ?? undefined,
      state: hasError ? 'output-error' : result ? 'output-available' : 'input-available',
    } satisfies ToolCallWithResult
  })
}
```

- [ ] **Step 5: 组合完整的 useMessageParser**

```typescript
export function useMessageParser(messages: MaybeRef<any[]>) {
  const parsedMessages = computed<ParsedMessage[]>(() => {
    const raw = toValue(messages)
    if (!raw?.length) return []

    const baseMessages = coerceRawMessages(raw)

    // 预计算 ToolMessage 索引（与现有 toolResultsMap 对齐）
    const toolResultsMap = new Map<string, any>()
    for (const m of baseMessages) {
      if (m instanceof ToolMessage) {
        toolResultsMap.set((m as any).tool_call_id, m)
      }
    }

    return baseMessages
      .filter((m) => !(m instanceof ToolMessage)) // ToolMessage 合并到 AI 消息
      .map((m, _idx) => {
        if (m instanceof HumanMessage) {
          return {
            id: m.id ?? `human-${_idx}`,
            type: 'human' as const,
            content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
            raw: m,
          }
        }
        if (m instanceof AIMessage) {
          const content = Array.isArray(m.content)
            ? m.content
                .filter((b: any) => b.type === 'text')
                .map((b: any) => b.text)
                .join('')
            : (m.content as string)

          return {
            id: m.id ?? `ai-${_idx}`,
            type: 'ai' as const,
            content,
            thinking: extractThinking(m),
            toolCalls: matchToolCalls(m, toolResultsMap),
            raw: m,
          }
        }
        return {
          id: (m as any).id ?? `msg-${_idx}`,
          type: 'system' as const,
          content: typeof m.content === 'string' ? m.content : '',
          raw: m,
        }
      })
  })

  return { parsedMessages }
}
```

- [ ] **Step 6: Commit**

```bash
git add app/components/ai/composables/useMessageParser.ts
git commit -m "feat(ai): 添加 useMessageParser composable，统一消息解析逻辑"
```

---

## Task 2: useTaskQueueParser composable

**Files:**
- Create: `app/components/ai/composables/useTaskQueueParser.ts`
- Reference: `app/pages/dashboard/analysis/[sessionId].vue:249-321` (todo 提取逻辑)

- [ ] **Step 1: 实现 useTaskQueueParser**

从 `[sessionId].vue:249-321` 提取 todo 提取和 diff 更新逻辑：

```typescript
// app/components/ai/composables/useTaskQueueParser.ts

export interface TodoItem {
  id: string
  text: string
  status: 'pending' | 'in_progress' | 'completed'
}

const statusOrder: Record<string, number> = {
  in_progress: 0,
  pending: 1,
  completed: 2,
}

export function useTaskQueueParser(messages: MaybeRef<any[]>) {
  const todos = ref<TodoItem[]>([])

  function extractTodoItems(args: any, resultContent: any): TodoItem[] {
    // 优先从 resultContent（工具返回值）解析
    const source = resultContent ?? args
    if (!source) return []
    const items = Array.isArray(source) ? source : source?.todos ?? source?.items ?? []
    return items.map((item: any, idx: number) => ({
      id: item.id ?? `todo-${idx}`,
      text: item.title ?? item.text ?? item.name ?? '',
      status: item.status ?? 'pending',
    }))
  }

  watch(
    () => toValue(messages),
    (msgs) => {
      if (!msgs?.length) return

      // 收集所有 ToolMessage 结果
      const toolResultMap = new Map<string, any>()
      for (const m of msgs) {
        if (m?.type === 'tool' || m?.constructor?.name === 'ToolMessage') {
          const callId = m.tool_call_id ?? m.additional_kwargs?.tool_call_id
          if (callId) toolResultMap.set(callId, m.content)
        }
      }

      // 找到最新的已完成 write_todos 调用
      let latestTodos: TodoItem[] | null = null
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i]
        const toolCalls = m?.tool_calls ?? m?.additional_kwargs?.tool_calls ?? []
        for (const tc of toolCalls) {
          if (tc.name === 'write_todos' && toolResultMap.has(tc.id)) {
            latestTodos = extractTodoItems(tc.args, toolResultMap.get(tc.id))
            break
          }
        }
        if (latestTodos) break
      }

      if (!latestTodos) return

      // 排序
      latestTodos.sort((a, b) => (statusOrder[a.status] ?? 1) - (statusOrder[b.status] ?? 1))

      // 原地 diff 更新
      const current = todos.value
      if (current.length !== latestTodos.length) {
        todos.value = latestTodos
        return
      }
      let changed = false
      for (let i = 0; i < latestTodos.length; i++) {
        if (
          current[i].id !== latestTodos[i].id ||
          current[i].status !== latestTodos[i].status ||
          current[i].text !== latestTodos[i].text
        ) {
          changed = true
          break
        }
      }
      if (changed) todos.value = latestTodos
    },
    { deep: true }
  )

  return { todos: readonly(todos) }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/components/ai/composables/useTaskQueueParser.ts
git commit -m "feat(ai): 添加 useTaskQueueParser composable，从消息流提取任务列表"
```

---

## Task 3: AiToolRenderer 组件

**Files:**
- Create: `app/components/ai/AiToolRenderer.vue`
- Create: `app/components/ai/tools/DefaultTool.vue`
- Reference: `app/components/caseAnalysis/tools/ToolRenderer.vue` (现有工具分发器)

- [ ] **Step 1: 创建 DefaultTool fallback 组件**

```vue
<!-- app/components/ai/tools/DefaultTool.vue -->
<script setup lang="ts">
interface Props {
  toolName: string
  input?: any
  output?: any
  state: string
}
const props = defineProps<Props>()
</script>

<template>
  <AiElementsTool>
    <AiElementsToolHeader :title="props.toolName" :type="`tool-${props.toolName}`" :state="props.state" />
    <AiElementsToolContent>
      <AiElementsToolInput v-if="props.input" :input="props.input" />
      <AiElementsToolOutput v-if="props.output != null" :output="props.output" />
    </AiElementsToolContent>
  </AiElementsTool>
</template>
```

- [ ] **Step 2: 创建 AiToolRenderer 组件（含适配层和内置映射表）**

```vue
<!-- app/components/ai/AiToolRenderer.vue -->
<script setup lang="ts">
import type { Component } from 'vue'
import type { ToolCallWithResult } from './composables/useMessageParser'

interface Props {
  toolCall: ToolCallWithResult
  toolMap?: Record<string, Component>
  showInterrupt?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  showInterrupt: true,
})

const emit = defineEmits<{
  (e: 'confirm', data: any): void
  (e: 'reject'): void
}>()

// 内置工具映射表（使用 Nuxt 自动导入的组件名字符串，在 computed 中懒解析）
const builtInToolNames: Record<string, string> = {
  process_materials: 'AiToolsMaterialProcessTool',
  reserve_points: 'AiToolsPointsReserveTool',
  confirm_points: 'AiToolsConfirmPointsTool',
  rollback_points: 'AiToolsRollbackPointsTool',
  write_todos: 'AiToolsWriteTodosTool',
  search_case_materials: 'AiToolsMaterialSearchTool',
  search_law: 'AiToolsLawSearchTool',
  extract_case_info: 'AiToolsExtractInfoTool',
}

// 解析组件：用户 toolMap 优先 > 内置映射 > DefaultTool
const ToolComponent = computed(() => {
  // 1. 用户自定义映射（直接是组件引用）
  if (props.toolMap?.[props.toolCall.name]) {
    return props.toolMap[props.toolCall.name]
  }
  // 2. 内置映射（通过 resolveComponent 懒解析）
  const builtInName = builtInToolNames[props.toolCall.name]
  if (builtInName) {
    return resolveComponent(builtInName)
  }
  // 3. DefaultTool fallback
  return resolveComponent('AiToolsDefaultTool')
})

// 适配层：统一为现有工具组件的 props 格式
const adaptedProps = computed(() => ({
  toolName: props.toolCall.name,
  input: props.toolCall.args,
  output: props.toolCall.result,
  state: props.toolCall.state,
}))

function handleConfirm(data: any) {
  emit('confirm', data)
}

function handleReject() {
  emit('reject')
}
</script>

<template>
  <component
    :is="ToolComponent"
    v-bind="adaptedProps"
    @confirm="handleConfirm"
    @reject="handleReject"
  />
</template>
```

- [ ] **Step 3: Commit**

```bash
git add app/components/ai/AiToolRenderer.vue app/components/ai/tools/DefaultTool.vue
git commit -m "feat(ai): 添加 AiToolRenderer 工具渲染路由和 DefaultTool 组件"
```

---

## Task 4: AiTaskQueue 组件

**Files:**
- Create: `app/components/ai/AiTaskQueue.vue`
- Reference: `app/components/caseAnalysis/analysis/TaskQueue.vue` (现有实现)

- [ ] **Step 1: 创建 AiTaskQueue 组件**

从现有 `TaskQueue.vue` 迁移，去除 `write_todos` 硬编码依赖，改为接收 `todos` prop：

```vue
<!-- app/components/ai/AiTaskQueue.vue -->
<script setup lang="ts">
import type { TodoItem } from './composables/useTaskQueueParser'

interface Props {
  todos: TodoItem[]
  collapsible?: boolean
  defaultExpanded?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  collapsible: true,
  defaultExpanded: true,
})

const isExpanded = ref(props.defaultExpanded)

const sortedTodos = computed(() => {
  const order: Record<string, number> = { in_progress: 0, pending: 1, completed: 2 }
  return [...props.todos].sort((a, b) => (order[a.status] ?? 1) - (order[b.status] ?? 1))
})

function toggleExpand() {
  if (props.collapsible) isExpanded.value = !isExpanded.value
}

function getStatusIcon(status: string) {
  switch (status) {
    case 'in_progress': return 'loader'
    case 'completed': return 'check-circle'
    default: return 'circle'
  }
}

function getStatusClass(status: string) {
  switch (status) {
    case 'in_progress': return 'text-blue-500 animate-spin'
    case 'completed': return 'text-green-500'
    default: return 'text-muted-foreground'
  }
}
</script>

<template>
  <div v-if="todos.length > 0" class="border-t bg-muted/10">
    <button
      v-if="collapsible"
      class="flex w-full items-center gap-2 px-4 py-2 text-sm font-medium hover:bg-muted/20"
      @click="toggleExpand"
    >
      <Icon :name="isExpanded ? 'lucide:chevron-down' : 'lucide:chevron-right'" class="size-4" />
      <span>任务进度 ({{ todos.filter(t => t.status === 'completed').length }}/{{ todos.length }})</span>
    </button>
    <div v-show="isExpanded || !collapsible" class="max-h-40 overflow-y-auto px-4 pb-2">
      <div
        v-for="todo in sortedTodos"
        :key="todo.id"
        class="flex items-center gap-2 py-1 text-sm"
      >
        <Icon :name="`lucide:${getStatusIcon(todo.status)}`" class="size-4 shrink-0" :class="getStatusClass(todo.status)" />
        <span :class="{ 'line-through text-muted-foreground': todo.status === 'completed' }">
          {{ todo.text }}
        </span>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Commit**

```bash
git add app/components/ai/AiTaskQueue.vue
git commit -m "feat(ai): 添加 AiTaskQueue 任务队列组件"
```

---

## Task 5: AiMessageItem 组件

**Files:**
- Create: `app/components/ai/AiMessageItem.vue`
- Reference: `app/pages/dashboard/analysis/[sessionId].vue:375-470` (消息渲染模板)

- [ ] **Step 1: 创建 AiMessageItem 组件**

从 `[sessionId].vue` 的模板中提取单条消息的渲染逻辑：

```vue
<!-- app/components/ai/AiMessageItem.vue -->
<script setup lang="ts">
import type { Component } from 'vue'
import type { ParsedMessage, ToolCallWithResult } from './composables/useMessageParser'

interface Props {
  message: ParsedMessage
  toolMap?: Record<string, Component>
  showToolInterrupt?: boolean
}

withDefaults(defineProps<Props>(), {
  showToolInterrupt: true,
})

const emit = defineEmits<{
  (e: 'tool-confirm', data: { toolCallId: string; data: any }): void
  (e: 'tool-reject', data: { toolCallId: string }): void
}>()

const showThinking = ref(false)

function handleToolConfirm(toolCall: ToolCallWithResult, data: any) {
  emit('tool-confirm', { toolCallId: toolCall.id, data })
}

function handleToolReject(toolCall: ToolCallWithResult) {
  emit('tool-reject', { toolCallId: toolCall.id })
}
</script>

<template>
  <!-- Human Message -->
  <div v-if="message.type === 'human'" class="flex justify-end">
    <div class="max-w-[80%] rounded-2xl rounded-tr-sm bg-primary px-4 py-2 text-primary-foreground">
      <AiElementsMarkdownContent :content="message.content" />
    </div>
  </div>

  <!-- AI Message -->
  <div v-else-if="message.type === 'ai'" class="flex justify-start">
    <div class="max-w-[90%] space-y-2">
      <!-- Thinking 折叠块 -->
      <div v-if="message.thinking" class="text-sm">
        <button
          class="flex items-center gap-1 text-muted-foreground hover:text-foreground"
          @click="showThinking = !showThinking"
        >
          <Icon :name="showThinking ? 'lucide:chevron-down' : 'lucide:chevron-right'" class="size-3.5" />
          <span>深度思考</span>
        </button>
        <div v-show="showThinking" class="mt-1 rounded border-l-2 border-muted-foreground/30 pl-3 text-muted-foreground">
          <AiElementsMarkdownContent :content="message.thinking" />
        </div>
      </div>

      <!-- 工具调用 -->
      <AiToolRenderer
        v-for="tc in message.toolCalls"
        :key="tc.id"
        :tool-call="tc"
        :tool-map="toolMap"
        :show-interrupt="showToolInterrupt"
        @confirm="(data: any) => handleToolConfirm(tc, data)"
        @reject="() => handleToolReject(tc)"
      />

      <!-- AI 内容 -->
      <div v-if="message.content" class="prose prose-sm max-w-none dark:prose-invert">
        <AiElementsMarkdownContent :content="message.content" />
      </div>
    </div>
  </div>

  <!-- System Message -->
  <div v-else-if="message.type === 'system'" class="flex justify-center">
    <span class="text-xs text-muted-foreground">{{ message.content }}</span>
  </div>
</template>
```

- [ ] **Step 2: Commit**

```bash
git add app/components/ai/AiMessageItem.vue
git commit -m "feat(ai): 添加 AiMessageItem 单条消息渲染组件"
```

---

## Task 6: AiMessageList 组件

**Files:**
- Create: `app/components/ai/AiMessageList.vue`
- Reference: `app/pages/dashboard/analysis/[sessionId].vue:375-470` (消息列表区域)

- [ ] **Step 1: 创建 AiMessageList 组件**

```vue
<!-- app/components/ai/AiMessageList.vue -->
<script setup lang="ts">
import type { Component } from 'vue'
import type { ParsedMessage } from './composables/useMessageParser'

interface Props {
  messages: ParsedMessage[]
  loading?: boolean
  toolMap?: Record<string, Component>
  showToolInterrupt?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
  showToolInterrupt: true,
})

const emit = defineEmits<{
  (e: 'tool-confirm', data: { toolCallId: string; data: any }): void
  (e: 'tool-reject', data: { toolCallId: string }): void
}>()

const scrollRef = ref<HTMLElement>()
const isUserScrolled = ref(false)

// 自动滚动策略
function handleScroll() {
  if (!scrollRef.value) return
  const { scrollTop, scrollHeight, clientHeight } = scrollRef.value
  const distFromBottom = scrollHeight - scrollTop - clientHeight
  isUserScrolled.value = distFromBottom > 100
}

function scrollToBottom() {
  if (scrollRef.value) {
    scrollRef.value.scrollTop = scrollRef.value.scrollHeight
    isUserScrolled.value = false
  }
}

// 新消息到达时自动滚动
watch(
  () => props.messages.length,
  () => {
    if (!isUserScrolled.value) {
      nextTick(scrollToBottom)
    }
  }
)

// loading 状态变化时滚动
watch(
  () => props.loading,
  (newLoading) => {
    if (newLoading && !isUserScrolled.value) {
      nextTick(scrollToBottom)
    }
  }
)
</script>

<template>
  <div class="relative flex-1 min-h-0">
    <div
      ref="scrollRef"
      class="h-full overflow-y-auto px-4 py-4 space-y-4"
      @scroll="handleScroll"
    >
      <!-- 空状态 -->
      <slot v-if="messages.length === 0 && !loading" name="empty" />

      <!-- 消息列表 -->
      <AiMessageItem
        v-for="msg in messages"
        :key="msg.id"
        :message="msg"
        :tool-map="toolMap"
        :show-tool-interrupt="showToolInterrupt"
        @tool-confirm="(data) => emit('tool-confirm', data)"
        @tool-reject="(data) => emit('tool-reject', data)"
      />

      <!-- 打字指示器 -->
      <div v-if="loading && messages.length > 0" class="flex justify-start">
        <div class="flex items-center gap-1 rounded-lg bg-muted px-3 py-2">
          <span class="size-2 animate-bounce rounded-full bg-muted-foreground/50" style="animation-delay: 0ms" />
          <span class="size-2 animate-bounce rounded-full bg-muted-foreground/50" style="animation-delay: 150ms" />
          <span class="size-2 animate-bounce rounded-full bg-muted-foreground/50" style="animation-delay: 300ms" />
        </div>
      </div>
    </div>

    <!-- 回到底部按钮 -->
    <Transition name="fade">
      <button
        v-if="isUserScrolled"
        class="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-background border shadow-md px-3 py-1.5 text-sm flex items-center gap-1 hover:bg-muted"
        @click="scrollToBottom"
      >
        <Icon name="lucide:arrow-down" class="size-4" />
        <span>回到底部</span>
      </button>
    </Transition>
  </div>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.2s;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
}
</style>
```

- [ ] **Step 2: Commit**

```bash
git add app/components/ai/AiMessageList.vue
git commit -m "feat(ai): 添加 AiMessageList 消息列表组件，含自动滚动策略"
```

---

## Task 7: AiPromptInput 组件

**Files:**
- Create: `app/components/ai/AiPromptInput.vue`
- Reference: `app/components/caseAnalysis/promptInput.vue` (现有 611 行实现)

- [ ] **Step 1: 创建 AiPromptInput 组件**

从现有 `promptInput.vue` 复制并精简：
- 移除材料选择器弹框（`MaterialSelector` 相关代码）
- 移除 `caseAnalysis store` 同步逻辑（`enableWatcher` 和 store 依赖）
- 移除 `submitLabel` prop（改为固定图标按钮）
- 新增 `enableFileUpload` prop 控制文件上传和拖拽
- 提交类型改为 `AiPromptSubmitData`
- 保留：文件上传、拖拽、识别状态轮询、文件预览、深度思考开关

关键修改点（相对于现有 promptInput.vue）：

```typescript
// 新提交数据类型
export interface AiPromptSubmitData {
  text: string
  files?: UploadedFile[]
}

// Props 变更
interface Props {
  loading?: boolean
  disabled?: boolean
  placeholder?: string         // 默认 "输入消息..."
  enableFileUpload?: boolean   // 默认 true
  showThinkingToggle?: boolean // 默认 true
  thinking?: boolean           // v-model
  minRows?: number             // 默认 1
  maxRows?: number             // 默认 4
}

// 条件性禁用拖拽
const { isOverDropZone } = useDropZone(dropZoneRef, {
  onDrop: (files) => {
    if (!props.enableFileUpload) return  // 新增：禁用时忽略拖拽
    handleFileDrop(files)
  },
})

// 提交时构建 AiPromptSubmitData（而非 PromptSubmitData）
function handleSubmit() {
  const data: AiPromptSubmitData = {
    text: inputText.value.trim(),
    files: selectedFiles.value.length > 0 ? [...selectedFiles.value] : undefined,
  }
  emit('submit', data)
}
```

由于此文件较大（~500 行），实施时从现有 `promptInput.vue` 复制后逐步删减。具体删减清单：

1. 删除 `import { useCaseAnalysisStore }` 及相关 store 同步逻辑
2. 删除 `MaterialSelector` 组件引用和相关状态
3. 删除 `enableWatcher` prop 和对应 watch 逻辑
4. 删除 `submitLabel` prop
5. 修改 `handleSubmit` 构建 `AiPromptSubmitData`
6. 在 `useDropZone` 的 `onDrop` 中加入 `enableFileUpload` 检查
7. 在模板中对上传按钮加 `v-if="enableFileUpload"` 条件

- [ ] **Step 2: Commit**

```bash
git add app/components/ai/AiPromptInput.vue
git commit -m "feat(ai): 添加 AiPromptInput 通用输入框组件"
```

---

## Task 8: AiChat 顶层容器组件

**Files:**
- Create: `app/components/ai/AiChat.vue`
- Reference: `app/pages/dashboard/analysis/[sessionId].vue` (布局结构)

- [ ] **Step 1: 创建 AiChat 组件**

```vue
<!-- app/components/ai/AiChat.vue -->
<script setup lang="ts">
import type { Component } from 'vue'
import type { TodoItem } from './composables/useTaskQueueParser'
import type { AiPromptSubmitData } from './AiPromptInput.vue'
import { useMessageParser } from './composables/useMessageParser'

type PanelMode = 'left' | 'right' | 'both'

interface Props {
  // 布局
  title?: string
  showHeader?: boolean
  panelMode?: PanelMode
  defaultLeftSize?: number
  minPanelSize?: number
  // 消息
  messages: any[]
  loading?: boolean
  // 输入框
  showPrompt?: boolean
  promptPlaceholder?: string
  promptDisabled?: boolean
  showThinkingToggle?: boolean
  enableFileUpload?: boolean
  thinking?: boolean
  // 工具
  toolMap?: Record<string, Component>
  showToolInterrupt?: boolean
  // 任务队列
  showTaskQueue?: boolean
  todos?: TodoItem[]
}

const props = withDefaults(defineProps<Props>(), {
  title: 'AI 对话',
  showHeader: true,
  panelMode: 'both',
  defaultLeftSize: 50,
  minPanelSize: 30,
  loading: false,
  showPrompt: true,
  promptPlaceholder: '输入消息...',
  promptDisabled: false,
  showThinkingToggle: true,
  enableFileUpload: true,
  thinking: true,
  showToolInterrupt: true,
  showTaskQueue: false,
})

const emit = defineEmits<{
  (e: 'submit', data: AiPromptSubmitData): void
  (e: 'tool-confirm', data: { toolCallId: string; data: any }): void
  (e: 'tool-reject', data: { toolCallId: string }): void
  (e: 'back'): void
  (e: 'update:thinking', value: boolean): void
  (e: 'update:panelMode', value: PanelMode): void
}>()

const slots = useSlots()
const attrs = useAttrs()

// 消息解析
const { parsedMessages } = useMessageParser(() => props.messages)

// 面板逻辑
const hasRightSlot = computed(() => !!slots['right-panel'])
const hasBackListener = computed(() => !!attrs.onBack)

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

const leftSize = computed(() =>
  effectivePanelMode.value === 'both' ? props.defaultLeftSize : 100
)
const rightSize = computed(() =>
  effectivePanelMode.value === 'both' ? 100 - props.defaultLeftSize : 100
)

function toggleLeftPanel() {
  const next = effectivePanelMode.value === 'both' ? 'right' : 'both'
  emit('update:panelMode', next)
}

function toggleRightPanel() {
  const next = effectivePanelMode.value === 'both' ? 'left' : 'both'
  emit('update:panelMode', next)
}

// Prompt ref
const promptRef = ref<InstanceType<typeof AiPromptInput>>()

function handleSubmit(data: AiPromptSubmitData) {
  emit('submit', data)
}
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- Header -->
    <div
      v-if="showHeader"
      class="h-12 shrink-0 border-b bg-muted/30 flex items-center px-4 gap-2"
    >
      <Button
        v-if="hasBackListener"
        variant="ghost"
        size="icon"
        class="size-8"
        @click="emit('back')"
      >
        <Icon name="lucide:arrow-left" class="size-4" />
      </Button>
      <div class="flex-1 truncate text-base font-semibold">{{ title }}</div>

      <!-- 面板切换按钮 -->
      <template v-if="hasRightSlot">
        <Button
          variant="ghost"
          size="icon"
          class="size-8"
          :class="{ 'bg-muted': !showLeftPanel }"
          @click="toggleLeftPanel"
        >
          <Icon name="lucide:panel-left" class="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          class="size-8"
          :class="{ 'bg-muted': !showRightPanel }"
          @click="toggleRightPanel"
        >
          <Icon name="lucide:panel-right" class="size-4" />
        </Button>
      </template>

      <!-- Header actions slot -->
      <slot name="header-actions" />
    </div>

    <!-- Main content: 双面板模式 -->
    <ResizablePanelGroup
      v-if="showLeftPanel && showRightPanel"
      direction="horizontal"
      class="flex-1 min-h-0"
    >
      <ResizablePanel :default-size="leftSize" :min-size="minPanelSize">
        <KeepAlive>
          <div key="left-panel" class="flex h-full flex-col">
            <!-- Message list (slot 或默认) -->
            <slot
              v-if="$slots['message-list']"
              name="message-list"
              :messages="parsedMessages"
              :loading="loading"
            />
            <AiMessageList
              v-else
              :messages="parsedMessages"
              :loading="loading"
              :tool-map="toolMap"
              :show-tool-interrupt="showToolInterrupt"
              @tool-confirm="(d) => emit('tool-confirm', d)"
              @tool-reject="(d) => emit('tool-reject', d)"
            >
              <template #empty>
                <slot name="empty" />
              </template>
            </AiMessageList>

            <!-- Task queue -->
            <AiTaskQueue
              v-if="showTaskQueue && todos?.length"
              :todos="todos"
            />

            <!-- Prompt input -->
            <div v-if="showPrompt" class="shrink-0 border-t">
              <slot name="prompt-actions" />
              <AiPromptInput
                ref="promptRef"
                :loading="loading"
                :disabled="promptDisabled"
                :placeholder="promptPlaceholder"
                :enable-file-upload="enableFileUpload"
                :show-thinking-toggle="showThinkingToggle"
                :thinking="thinking"
                @submit="handleSubmit"
                @update:thinking="(v) => emit('update:thinking', v)"
              />
            </div>
          </div>
        </KeepAlive>
      </ResizablePanel>

      <ResizableHandle with-handle />

      <ResizablePanel :default-size="rightSize" :min-size="minPanelSize">
        <KeepAlive>
          <slot name="right-panel" />
        </KeepAlive>
      </ResizablePanel>
    </ResizablePanelGroup>

    <!-- 单面板模式 -->
    <div v-else class="flex-1 min-h-0 flex flex-col">
      <KeepAlive>
        <template v-if="showLeftPanel">
          <slot
            v-if="$slots['message-list']"
            name="message-list"
            :messages="parsedMessages"
            :loading="loading"
          />
          <AiMessageList
            v-else
            :messages="parsedMessages"
            :loading="loading"
            :tool-map="toolMap"
            :show-tool-interrupt="showToolInterrupt"
            @tool-confirm="(d) => emit('tool-confirm', d)"
            @tool-reject="(d) => emit('tool-reject', d)"
          >
            <template #empty>
              <slot name="empty" />
            </template>
          </AiMessageList>

          <AiTaskQueue
            v-if="showTaskQueue && todos?.length"
            :todos="todos"
          />

          <div v-if="showPrompt" class="shrink-0 border-t">
            <slot name="prompt-actions" />
            <AiPromptInput
              ref="promptRef"
              :loading="loading"
              :disabled="promptDisabled"
              :placeholder="promptPlaceholder"
              :enable-file-upload="enableFileUpload"
              :show-thinking-toggle="showThinkingToggle"
              :thinking="thinking"
              @submit="handleSubmit"
              @update:thinking="(v) => emit('update:thinking', v)"
            />
          </div>
        </template>

        <template v-if="showRightPanel && !showLeftPanel">
          <slot name="right-panel" />
        </template>
      </KeepAlive>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Commit**

```bash
git add app/components/ai/AiChat.vue
git commit -m "feat(ai): 添加 AiChat 顶层容器组件，支持分栏布局和面板切换"
```

---

## Task 9: 迁移工具组件到 ai/tools/

**Files:**
- Move: `app/components/caseAnalysis/tools/*.vue` → `app/components/ai/tools/`
- Keep: 现有工具组件的 props 接口不变

- [ ] **Step 1: 复制现有工具组件到 ai/tools/**

将以下文件从 `app/components/caseAnalysis/tools/` 复制到 `app/components/ai/tools/`：
- `LawSearchTool.vue`
- `MaterialSearchTool.vue`
- `MaterialProcessTool.vue`
- `PointsReserveTool.vue`
- `ConfirmPointsTool.vue`
- `RollbackPointsTool.vue`
- `WriteTodosTool.vue`
- `ExtractInfoTool.vue`

注意：现阶段只是复制，不修改原文件，也不修改工具组件的内部实现。迁移后需要确认 Nuxt 自动导入路径是否正确（`AiTools` 前缀）。

`MembershipPurchaseTool.vue` 和 `PointsPurchaseTool.vue` 暂不创建（设计文档中列出但尚无现有实现），待后续需要时再添加。

- [ ] **Step 2: 更新 AiToolRenderer 中的 builtInToolMap 使用新路径的组件**

由于 Nuxt 自动导入，组件名从 `CaseAnalysisTools*` 变为 `AiTools*`，更新 AiToolRenderer 中的 resolveComponent 调用。

- [ ] **Step 3: Commit**

```bash
git add app/components/ai/tools/
git commit -m "feat(ai): 迁移工具组件到 ai/tools/ 目录"
```

---

## Task 10: 迁移 analysis/[sessionId] 页面

**Files:**
- Modify: `app/pages/dashboard/analysis/[sessionId].vue`

- [ ] **Step 1: 重写 analysis/[sessionId].vue 使用 AiChat**

保留页面中的：
- `useStream` 逻辑和初始化
- `threadHistory` 加载和消息处理
- `displayMessages` 计算属性
- 事件处理函数（handlePromptSubmit, handleToolConfirm, handleToolReject, handleRegenerate）
- `analysisResults` 计算

删除页面中的：
- `coerceRawMessages`（使用 useMessageParser 导出）
- `getToolCallsForMessage`（已内聚到 useMessageParser）
- Todo 提取逻辑（使用 useTaskQueueParser）
- 完整的模板（替换为 AiChat）

页面从 ~514 行精简到 ~150 行。参考设计文档中的"案件分析（完整功能）"使用示例。

- [ ] **Step 2: 验证功能一致性**

手动验证：
1. 消息列表正确渲染（human/ai/thinking/工具调用）
2. 工具中断（confirm/reject）正常工作
3. 任务队列正确显示
4. 右侧分析结果面板正常
5. 面板切换功能正常
6. 输入框提交和文件上传正常
7. 深度思考开关正常

- [ ] **Step 3: Commit**

```bash
git add app/pages/dashboard/analysis/[sessionId].vue
git commit -m "refactor(analysis): 迁移案件分析页面使用 AiChat 组件"
```

---

## Task 11: 迁移 init-analysis/[sessionId] 页面

**Files:**
- Modify: `app/pages/dashboard/cases/init-analysis/[sessionId].vue`

- [ ] **Step 1: 重写 init-analysis/[sessionId].vue 使用 AiChat**

使用 `#message-list` slot 保留自定义消息渲染（按模块分组、管道进度条等）。参考设计文档中的"初始化分析"使用示例。

关键配置：
- `panel-mode="left"`（单面板）
- `:show-prompt="false"`
- `:show-task-queue="false"`
- `:show-tool-interrupt="false"`
- `#message-list` slot 完全自定义
- `#empty` slot 放模块选择器

- [ ] **Step 2: 验证功能一致性**

手动验证：
1. 模块选择阶段正常
2. 管道进度条显示正常
3. 按模块分组的消息渲染正确
4. 积分不足中断卡片正常
5. 完成后跳转正常

- [ ] **Step 3: Commit**

```bash
git add app/pages/dashboard/cases/init-analysis/[sessionId].vue
git commit -m "refactor(analysis): 迁移初始化分析页面使用 AiChat 组件"
```

---

## Task 12: 收敛 coerceRawMessages 和清理旧代码

**Files:**
- Modify: `app/composables/useInitAnalysis.ts` (替换 coerceRawMessages)
- Delete or clean: `app/components/caseAnalysis/tools/ToolRenderer.vue` (如不再被引用)

- [ ] **Step 1: 替换 useInitAnalysis 中的 coerceRawMessages**

```typescript
// app/composables/useInitAnalysis.ts
// 替换本地 coerceRawMessages 为统一导出
import { coerceRawMessages } from '~/components/ai/composables/useMessageParser'
```

删除 useInitAnalysis.ts 中本地定义的 coerceRawMessages 函数（约 125-132 行）。

- [ ] **Step 2: 清理不再使用的旧组件**

检查以下组件是否还有其他引用，如无则可安全删除：
- `app/components/caseAnalysis/tools/ToolRenderer.vue`（被 AiToolRenderer 替代）

同时检查 `app/components/initAnalysis/ModuleResult.vue` 中是否引用了 `CaseAnalysisToolsToolRenderer`，如有则更新为 `AiToolRenderer`。

注意：现有工具组件（`caseAnalysis/tools/` 下的具体工具）如果已复制到 `ai/tools/`，确认无其他页面引用后标记为待清理（可暂不删除，待全面迁移完成后再清理）。

- [ ] **Step 3: 运行类型检查**

```bash
npx nuxi typecheck
```

确保无类型错误。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(ai): 收敛 coerceRawMessages 到统一导出，清理旧工具分发器"
```
