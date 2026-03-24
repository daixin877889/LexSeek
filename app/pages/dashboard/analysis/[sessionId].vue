<template>

  <!-- 旧版分析界面 -->
  <div class="h-full flex flex-col" style="height: calc(100vh - 48px)">
    <!-- Header 区域 -->
    <div class="h-12 shrink-0 border-b bg-muted/30 text-base font-semibold flex items-center px-4 gap-2">
      <Button variant="ghost" size="icon" class="size-8" @click="goBack">
        <ArrowLeftIcon class="size-4" />
      </Button>
      <div class="flex-1 truncate">{{ "案件分析" }}</div>
    </div>

    <!-- 主内容区域 -->
    <ResizablePanelGroup direction="horizontal" class="flex-1 min-h-0">
      <!-- 左侧面板：对话区域 -->
      <ResizablePanel :default-size="50" :min-size="30" class="bg-muted/20">
        <div class="flex flex-col h-full overflow-hidden">
          <!-- 对话消息列表（占据剩余空间） -->
          <div class="flex-1 min-h-0">
            <ClientOnly>
              <AiElementsConversation class="h-full">
                <AiElementsConversationContent>
                  <AiElementsConversationEmptyState v-if="displayMessages.length === 0 && !stream.isLoading"
                    title="开始案件分析" description="输入补充信息或点击发送开始 AI 分析" />

                  <template v-for="(message, msgIndex) in displayMessages" :key="message.id ?? msgIndex">
                    <AiElementsMessage v-if="HumanMessage.isInstance(message)" from="user" class="max-w-full">
                      <AiElementsMessageContent>
                        {{ message.text }}
                      </AiElementsMessageContent>
                    </AiElementsMessage>

                    <AiElementsMessage v-else-if="AIMessage.isInstance(message)" from="assistant" class="max-w-full">
                      <AiElementsMessageContent>
                        <AiElementsReasoning v-if="getReasoningText(message)"
                          :is-streaming="stream.isLoading && msgIndex === displayMessages.length - 1">
                          <AiElementsReasoningTrigger />
                          <AiElementsReasoningContent :content="getReasoningText(message)" />
                        </AiElementsReasoning>

                        <AiElementsTool v-for="tc in getToolCallsForMessage(message)" :key="tc.call.id">
                          <AiElementsToolHeader :type="`tool-${tc.call.name}`" :state="tc.state" />
                          <AiElementsToolContent>
                            <AiElementsToolInput :input="tc.call.args" />
                            <AiElementsToolOutput v-if="tc.result" :output="tc.result.content"
                              :error-text="tc.state === 'output-error' ? String(tc.result.content) : undefined" />
                          </AiElementsToolContent>
                        </AiElementsTool>

                        <AiElementsMessageResponse v-if="message.text" :content="message.text" />
                      </AiElementsMessageContent>
                    </AiElementsMessage>
                  </template>

                </AiElementsConversationContent>
                <AiElementsConversationScrollButton />
              </AiElementsConversation>

              <template #fallback>
                <div class="flex size-full items-center justify-center">
                  <Loader2Icon class="size-6 animate-spin text-muted-foreground" />
                </div>
              </template>
            </ClientOnly>
          </div>
          <!-- 任务进度（可折叠，有 todo 时才显示） -->
          <Transition @enter="onProgressEnter" @after-enter="onProgressAfterEnter" @leave="onProgressLeave"
            @after-leave="onProgressAfterLeave">
            <Collapsible v-if="allTodos.length > 0" v-model:open="showTaskList" class="shrink-0 border-t">
              <CollapsibleTrigger
                class="flex items-center justify-between w-full px-4 py-2 hover:bg-muted/50 transition-colors">
                <span class="text-sm font-medium">任务进度</span>
                <div class="flex items-center gap-2">
                  <Badge variant="outline" class="text-xs">
                    {{allTodos.filter(todo => todo.status === 'completed').length}}/{{ allTodos.length }}
                  </Badge>
                  <ChevronUpIcon class="size-4 text-muted-foreground transition-transform duration-200"
                    :class="{ 'rotate-180': !showTaskList }" />
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div ref="todoListRef" class="px-4 pb-3 max-h-[120px] overflow-y-auto">

                  <AiElementsQueue>
                    <AiElementsQueueSection>
                      <AiElementsQueueItem v-for="todo in sortedTodos" :key="todo.id">
                        <AiElementsQueueItemContent :completed="todo.status === 'completed'">
                          <AiElementsQueueItemIndicator :status="todo.status" />
                          {{ todo.title }}
                        </AiElementsQueueItemContent>
                      </AiElementsQueueItem>
                    </AiElementsQueueSection>
                  </AiElementsQueue>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </Transition>

          <!-- 底部输入区域（固定） -->
          <div class="shrink-0 border-t bg-background">
            <CaseAnalysisPromptInput ref="promptInputRef" v-model:thinking="thinkingEnabled" placeholder="输入补充信息或问题..."
              submit-label="发送" :loading="stream.isLoading" :disabled="isComplete" :enable-watcher="false" :min-rows="1"
              :max-rows="4" @submit="handlePromptSubmit" />

            <!-- 状态提示 -->
            <div v-if="stream.isLoading" class="flex items-center justify-center pb-2">
              <Loader2Icon class="size-4 animate-spin text-primary mr-2" />
              <span class="text-xs text-muted-foreground">AI 正在分析中...</span>
            </div>
          </div>
        </div>
      </ResizablePanel>

      <ResizableHandle with-handle />

      <!-- 右侧面板：分析结果 -->
      <ResizablePanel :default-size="50" :min-size="30">
        <CaseAnalysisResults :results="analysisResults" v-model:active-index="activeResultIndex" :show-regenerate="true"
          :show-copy="true" :is-analyzing="stream.isLoading" class="h-full" @regenerate="handleRegenerate" />
      </ResizablePanel>
    </ResizablePanelGroup>
  </div>
</template>

<script lang="ts" setup>
import type { AnalysisResult, PromptSubmitData } from "#shared/types/case";
import { ArrowLeftIcon, Loader2Icon, ChevronUpIcon } from "lucide-vue-next";
import { useStream, FetchStreamTransport } from "@langchain/vue";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";

definePageMeta({
  title: "案件分析",
  layout: "dashboard-layout",
});

const route = useRoute();
const router = useRouter();
const sessionId = computed(() => route.params.sessionId as string);

type TodoStatus = 'pending' | 'in_progress' | 'completed'

interface QueueTodo {
  id: string
  title: string
  status: TodoStatus
}

// 单一 todo 列表：write_todos 多次调用是对同一列表的状态更新
// 使用 reactive 数组，原地 diff 更新避免整个列表重渲染
const allTodos = reactive<QueueTodo[]>([])

// 三段式排序：in_progress > pending > completed
const statusOrder: Record<TodoStatus, number> = { in_progress: 0, pending: 1, completed: 2 }

const sortedTodos = computed(() =>
  [...allTodos].sort((a, b) =>
    (statusOrder[a.status] ?? 1) - (statusOrder[b.status] ?? 1)
  )
)

// 派生状态
const isComplete = ref(false)
const thinkingEnabled = ref(route.query.thinking !== 'false')

// 加载线程历史状态
const threadHistory = await useApiFetch<{
  values: Record<string, unknown>
  threadId: string
}>(`/api/v1/case/analysis/thread/${sessionId.value}`, {
  showError: false,
})

const stream = reactive(useStream({
  transport: new FetchStreamTransport({
    apiUrl: '/api/v1/case/analysis/chat',
  }),
  threadId: sessionId.value,
  // initialValues 存入 #historyValues，供 optimisticValues 合并使用
  // 注意：这不会让 stream.messages 在首次 submit 前返回历史
  initialValues: threadHistory?.values ?? undefined,
  onError: (error) => {
    console.error('[useStream] 流错误:', error)
  },
}))

// 历史消息 fallback：将 API 返回的字典格式消息转为 BaseMessage 实例
const historyMessages = computed(() => {
  const rawMessages = threadHistory?.values?.messages
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) return []
  return rawMessages.map((m: any) => {
    if (m.type === 'human') return new HumanMessage({ content: m.content, id: m.id })
    if (m.type === 'ai') return new AIMessage({ content: m.content, id: m.id, tool_calls: m.tool_calls })
    if (m.type === 'tool') return new ToolMessage({ content: m.content, tool_call_id: m.tool_call_id, id: m.id })
    return m
  })
})

// 最终用于模板渲染的消息列表
// stream 启动后使用 stream.messages；否则 fallback 到历史
const displayMessages = computed(() =>
  stream.messages.length > 0 || stream.isLoading
    ? stream.messages
    : historyMessages.value
)

/** 从 write_todos 工具的参数或返回值中提取原始 todo 数据 */
function extractTodoItems(args: any, resultContent: any): Array<{ title: string; status: string }> {
  // 优先从工具返回值解析
  if (resultContent != null) {
    try {
      const parsed = typeof resultContent === 'string' ? JSON.parse(resultContent) : resultContent
      const items = parsed?.update?.todos ?? parsed?.todos
      if (Array.isArray(items) && items.length > 0) {
        return items.map((item: any) => ({
          title: item.content ?? item.title ?? '',
          status: item.status ?? 'pending',
        }))
      }
    } catch { /* 解析失败，降级到 args */ }
  }

  // 降级从工具调用参数解析
  const argTodos = args?.todos
  if (Array.isArray(argTodos) && argTodos.length > 0) {
    return argTodos.map((item: any) => ({
      title: item.content ?? item.title ?? '',
      status: item.status ?? 'pending',
    }))
  }

  return []
}

// 监听 messages 变化，提取最新的 write_todos 数据
// 关键设计：只处理已完成的工具调用（有 ToolMessage 结果），跳过正在流式传输的不完整调用
// 这样可以避免流式 args 逐 token 到达导致列表逐项重渲染
watch(displayMessages, (msgs) => {
  if (!msgs) return
  // Pass 1: 收集所有 ToolMessage 结果（ToolMessage 在消息数组中位于 AIMessage 之后，必须先收集）
  const toolResultMap = new Map<string, any>()
  for (const msg of msgs) {
    if (ToolMessage.isInstance(msg)) {
      toolResultMap.set((msg as any).tool_call_id, msg)
    }
  }

  // Pass 2: 找到最新的已完成 write_todos 调用
  let latestTodos: Array<{ title: string; status: string }> | null = null

  for (const msg of msgs) {
    if (!AIMessage.isInstance(msg)) continue
    const toolCalls: any[] = (msg as any).tool_calls ?? []
    for (const tc of toolCalls) {
      if (tc.name !== 'write_todos') continue
      const result = toolResultMap.get(tc.id ?? '')
      // 跳过尚未完成的工具调用（无 ToolMessage 结果）
      // 这是防止流式重渲染的关键：不完整的 args 不会被处理
      if (!result) continue
      const parsed = extractTodoItems(tc.args, result.content)
      if (parsed.length > 0) latestTodos = parsed
    }
  }

  if (!latestTodos) return

  // 原地 diff：只修改变化的字段，避免替换数组引用触发全量重渲染
  for (let i = 0; i < latestTodos.length; i++) {
    const incoming = latestTodos[i]
    if (i < allTodos.length) {
      if (allTodos[i]?.title !== incoming?.title) allTodos[i]!.title = incoming!.title
      if (allTodos[i]?.status !== incoming?.status) allTodos[i]!.status = incoming!.status as QueueTodo['status']
    } else {
      allTodos.push({ id: `todo-${i}`, title: incoming!.title, status: incoming!.status as QueueTodo['status'] })
    }
  }
  if (allTodos.length > latestTodos.length) {
    allTodos.splice(latestTodos.length)
  }
}, { deep: true })

/** 提取 AIMessage 中的推理文本 */
function getReasoningText(message: any): string {
  // 优先使用 contentBlocks（LGP transport 路径）
  if ('contentBlocks' in message) {
    return message.contentBlocks
      .filter((b: any) => b.type === 'reasoning')
      .map((b: any) => b.reasoning)
      .join('')
  }
  // FetchStreamTransport 路径：直接从 content 数组提取 thinking 块
  const content = message.content
  if (!Array.isArray(content)) return ''
  return content
    .filter((b: any) => b.type === 'thinking')
    .map((b: any) => b.thinking)
    .join('')
}

/** LangChain tool state → AI Elements ToolUIPart state */
type ToolState = 'input-available' | 'output-available' | 'output-error'

interface ToolCallWithResult {
  call: { id: string; name: string; args: Record<string, unknown> }
  result: any
  state: ToolState
}

// 预计算 ToolMessage 索引，避免模板中每个 AI 消息都重复遍历
const toolResultsMap = computed(() => {
  const map = new Map<string, any>()
  for (const msg of displayMessages.value) {
    if (ToolMessage.isInstance(msg)) {
      map.set((msg as any).tool_call_id, msg)
    }
  }
  return map
})

function getToolCallsForMessage(message: any): ToolCallWithResult[] {
  const toolCalls = message.tool_calls ?? []
  if (toolCalls.length === 0) return []

  return toolCalls.map((tc: any) => {
    const result = toolResultsMap.value.get(tc.id ?? '')
    const hasError = result && result.status === 'error'
    return {
      call: { id: tc.id ?? '', name: tc.name, args: tc.args as Record<string, unknown> },
      result,
      state: (hasError ? 'output-error' : result ? 'output-available' : 'input-available') as ToolState,
    }
  })
}


// 页面状态
const showTaskList = ref(false)
const todoListRef = ref<HTMLElement | null>(null)

// 分析结果
const analysisResults = ref<AnalysisResult[]>([]);
const activeResultIndex = ref(0);

// promptInput 组件引用
const promptInputRef = ref<{ reset: () => void } | null>(null)

/**
 * 处理 promptInput 提交：发送补充消息和追加材料
 */
async function handlePromptSubmit(data: PromptSubmitData) {
  if (stream.isLoading || isComplete.value) return

  const text = data.text || '开始分析'

  // 捕获当前消息列表，构造 optimisticValues 防止消息闪烁
  const currentMsgDicts = stream.messages.length > 0
    ? stream.messages.map((m: any) => typeof m.toDict === 'function' ? m.toDict() : m)
    : (threadHistory?.values?.messages as any[] ?? [])

  stream.submit(
    { messages: [{ type: 'human', content: text }] },
    {
      optimisticValues: () => ({
        messages: [...currentMsgDicts, { type: 'human', content: text }],
      }),
    },
  )

  promptInputRef.value?.reset()
}

const handleRegenerate = () => { }
const goBack = () => {
  router.push({ name: "dashboard-analysis" });
}

// 自动展开 + 自动滚动
let hasAutoExpanded = false
watch(() => allTodos.length, (newLen, oldLen) => {
  if (!hasAutoExpanded && oldLen === 0 && newLen > 0) {
    hasAutoExpanded = true
    showTaskList.value = true
  }
})

// 状态变化时滚动到顶部（in_progress 排最前，方便用户跟踪当前任务）
watch(() => allTodos.map(t => t.status).join(), () => {
  nextTick(() => {
    const el = todoListRef.value
    if (el) {
      el.scrollTo({ top: 0, behavior: 'smooth' })
    }
  })
})

// Transition JS hooks：平滑的滑入/滑出动画
function onProgressEnter(el: Element) {
  const htmlEl = el as HTMLElement
  htmlEl.style.overflow = 'hidden'
  htmlEl.style.height = '0'
  htmlEl.style.opacity = '0'
  void htmlEl.offsetHeight
  htmlEl.style.transition = 'height 0.3s ease, opacity 0.3s ease'
  htmlEl.style.height = htmlEl.scrollHeight + 'px'
  htmlEl.style.opacity = '1'
}

function onProgressAfterEnter(el: Element) {
  const htmlEl = el as HTMLElement
  htmlEl.style.transition = ''
  htmlEl.style.height = ''
  htmlEl.style.overflow = ''
}

function onProgressLeave(el: Element) {
  const htmlEl = el as HTMLElement
  htmlEl.style.overflow = 'hidden'
  htmlEl.style.height = htmlEl.scrollHeight + 'px'
  htmlEl.style.opacity = '1'
  void htmlEl.offsetHeight
  htmlEl.style.transition = 'height 0.3s ease, opacity 0.3s ease'
  htmlEl.style.height = '0'
  htmlEl.style.opacity = '0'
}

function onProgressAfterLeave(el: Element) {
  const htmlEl = el as HTMLElement
  htmlEl.style.transition = ''
  htmlEl.style.height = ''
  htmlEl.style.overflow = ''
}

onUnmounted(() => {
  allTodos.splice(0)
});
</script>

<style></style>
