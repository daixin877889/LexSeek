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
            <AiElementsConversation class="h-full">
              <AiElementsConversationContent>
                <!-- 空状态 -->
                <AiElementsConversationEmptyState v-if="stream.messages.value.length === 0 && !stream.isLoading.value"
                  title="开始案件分析" description="输入补充信息或点击发送开始 AI 分析" />

                <template v-for="(message, msgIndex) in stream.messages.value" :key="message.id ?? msgIndex">
                  <!-- 用户消息 -->
                  <AiElementsMessage v-if="HumanMessage.isInstance(message)" from="user">
                    <AiElementsMessageContent>
                      {{ message.text }}
                    </AiElementsMessageContent>
                  </AiElementsMessage>

                  <!-- AI 消息 -->
                  <AiElementsMessage v-else-if="AIMessage.isInstance(message)" from="assistant">
                    <AiElementsMessageContent>
                      <!-- 推理块 -->
                      <AiElementsReasoning v-if="getReasoningText(message)"
                        :is-streaming="stream.isLoading.value && msgIndex === stream.messages.value.length - 1">
                        <AiElementsReasoningTrigger />
                        <AiElementsReasoningContent :content="getReasoningText(message)" />
                      </AiElementsReasoning>

                      <!-- 工具调用 -->
                      <AiElementsTool v-for="tc in getToolCallsForMessage(message)" :key="tc.call.id">
                        <AiElementsToolHeader :type="`tool-${tc.call.name}`" :state="tc.state" />
                        <AiElementsToolContent>
                          <AiElementsToolInput :input="tc.call.args" />
                          <AiElementsToolOutput v-if="tc.result" :output="tc.result.content"
                            :error-text="tc.state === 'output-error' ? String(tc.result.content) : undefined" />
                        </AiElementsToolContent>
                      </AiElementsTool>

                      <!-- 文本回复 -->
                      <AiElementsMessageResponse v-if="message.text" :content="message.text" />
                    </AiElementsMessageContent>
                  </AiElementsMessage>
                </template>

                <!-- 加载中指示器 -->
                <!-- <AiElementsMessage v-if="stream.isLoading.value" from="assistant">
                  <AiElementsMessageContent>
                    <AiElementsLoader />
                  </AiElementsMessageContent>
                </AiElementsMessage> -->
              </AiElementsConversationContent>
              <AiElementsConversationScrollButton />
            </AiElementsConversation>

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
                <div ref="todoListRef" class="px-4 pb-3 max-h-[200px] overflow-y-auto">

                  <AiElementsQueue>
                    <AiElementsQueueSection>
                      <AiElementsQueueItem v-for="todo in allTodos" :key="todo.id">
                        <AiElementsQueueItemContent :completed="todo.status === 'completed'">
                          <AiElementsQueueItemIndicator :completed="todo.status === 'completed'" />
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
              submit-label="发送" :loading="isAnalyzing" :disabled="isComplete" :enable-watcher="false" :min-rows="1"
              :max-rows="4" @submit="handlePromptSubmit" />

            <!-- 状态提示 -->
            <div v-if="isAnalyzing" class="flex items-center justify-center pb-2">
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
          :show-copy="true" :is-analyzing="isAnalyzing" class="h-full" @regenerate="handleRegenerate" />
      </ResizablePanel>
    </ResizablePanelGroup>
  </div>
</template>

<script lang="ts" setup>
import type { AnalysisResult, PromptSubmitData } from "#shared/types/case";
import { ArrowLeftIcon, Loader2Icon, ChevronUpIcon } from "lucide-vue-next";
import { useStream } from "@langchain/vue";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";

definePageMeta({
  title: "案件分析",
  layout: "dashboard-layout",
});

const route = useRoute();
const router = useRouter();
const sessionId = computed(() => route.params.sessionId as string);

interface QueueTodo {
  id: string
  title: string
  status: 'pending' | 'in_progress' | 'completed'
}

// 单一 todo 列表：write_todos 多次调用是对同一列表的状态更新
// 使用 reactive 数组，原地 diff 更新避免整个列表重渲染
const allTodos = reactive<QueueTodo[]>([])

// 派生状态
const isAnalyzing = ref(false)
const isComplete = ref(false)
const thinkingEnabled = ref(route.query.thinking !== 'false')

const stream = useStream({
  apiUrl: "http://localhost:2024/",
  assistantId: "mainAgent",
  // transport,
  // threadId: sessionId.value,
  // messagesKey: 'messages',
  onError: (error) => {
    console.error('[useStream] 流错误:', error);
  },
  onFinish: (state, error) => {
    console.log('[useStream] 流完成:', state, error);
  },
});

// stream.messages / stream.isLoading 是 getter，不能解构，需通过 stream.xxx 访问
const { submit } = stream

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
watch(() => stream.messages.value, (messages) => {
  // Pass 1: 收集所有 ToolMessage 结果（ToolMessage 在消息数组中位于 AIMessage 之后，必须先收集）
  const toolResultMap = new Map<string, any>()
  for (const msg of messages) {
    if (ToolMessage.isInstance(msg)) {
      toolResultMap.set((msg as any).tool_call_id, msg)
    }
  }

  // Pass 2: 找到最新的已完成 write_todos 调用
  let latestTodos: Array<{ title: string; status: string }> | null = null

  for (const msg of messages) {
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
  if (!('contentBlocks' in message)) return ''
  return message.contentBlocks
    .filter((b: any) => b.type === 'reasoning')
    .map((b: any) => b.reasoning)
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
  for (const msg of stream.messages.value) {
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
  if (isAnalyzing.value || isComplete.value) return

  isAnalyzing.value = true

  // // 发送消息继续分析（materials 暂不传递，当前 stream API 不支持追加材料）
  // sendMessage({ text: data.text || '开始分析' })
  submit({ messages: [{ type: 'human', content: data.text || '开始分析' }] })

  // 重置输入组件
  promptInputRef.value?.reset()
}

const handleRegenerate = () => { }
const goBack = () => {
  router.push({ name: "dashboard-analysis" });
}

// 自动展开：仅首次出现 todos 时展开一次
let hasAutoExpanded = false
watch(() => allTodos.length, (newLen, oldLen) => {
  if (!hasAutoExpanded && oldLen === 0 && newLen > 0) {
    hasAutoExpanded = true
    showTaskList.value = true
  }
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
