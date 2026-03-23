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
                      <AiElementsTool v-for="tc in getToolCallsForMessage(message, stream.messages.value)"
                        :key="tc.call.id">
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
                    <template v-if="orderedTodoGroups.length === 1">
                      <AiElementsQueueSection>
                        <AiElementsQueueItem v-for="todo in orderedTodoGroups[0]!.todos" :key="todo.id">
                          <AiElementsQueueItemContent :completed="todo.status === 'completed'">
                            <AiElementsQueueItemIndicator :completed="todo.status === 'completed'" />
                            {{ todo.title }}
                          </AiElementsQueueItemContent>
                        </AiElementsQueueItem>
                      </AiElementsQueueSection>
                    </template>
                    <template v-else>
                      <AiElementsQueueSection v-for="group in orderedTodoGroups" :key="group.messageId">
                        <AiElementsQueueSectionTrigger>
                          <AiElementsQueueSectionLabel :label="group.label"
                            :count="group.todos.filter(t => t.status === 'completed').length" />
                        </AiElementsQueueSectionTrigger>
                        <AiElementsQueueSectionContent>
                          <AiElementsQueueItem v-for="todo in group.todos" :key="todo.id">
                            <AiElementsQueueItemContent :completed="todo.status === 'completed'">
                              <AiElementsQueueItemIndicator :completed="todo.status === 'completed'" />
                              {{ todo.title }}
                            </AiElementsQueueItemContent>
                          </AiElementsQueueItem>
                        </AiElementsQueueSectionContent>
                      </AiElementsQueueSection>
                    </template>
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
  description?: string
  status?: 'pending' | 'in_progress' | 'completed'
}

interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

interface TodoGroup {
  messageId: string
  label: string
  todos: QueueTodo[]
}

const todoGroups: Map<string, TodoGroup> = reactive(new Map())

const orderedTodoGroups = computed<TodoGroup[]>(() => Array.from(todoGroups.values()))

const allTodos = computed<QueueTodo[]>(() => orderedTodoGroups.value.flatMap(g => g.todos))

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

// 防抖标记
let updatePending = false

// 监听 messages 变化，从 write_todos 工具调用中提取 todo 数据
watch(() => stream.messages.value, (newMessages) => {
  if (updatePending) return
  updatePending = true

  nextTick(() => {
    // 收集所有 ToolMessage 结果，按 tool_call_id 索引
    const toolResults = new Map<string, InstanceType<typeof ToolMessage>>()
    for (const msg of newMessages) {
      if (ToolMessage.isInstance(msg)) {
        toolResults.set(msg.tool_call_id, msg)
      }
    }

    const seenIds = new Set<string>()
    let groupIndex = 0

    for (const message of newMessages) {
      if (!AIMessage.isInstance(message)) continue

      const toolCalls = message.tool_calls ?? []
      // 找到该消息中最后一个 write_todos 调用
      const writeTodosCall = [...toolCalls].reverse().find((tc: any) => tc.name === 'write_todos')
      if (!writeTodosCall) continue

      const msgId = message.id ?? `msg-${groupIndex}`
      seenIds.add(msgId)
      groupIndex++

      // 优先从 ToolMessage 结果获取 todos，其次从工具调用参数获取
      const result = toolResults.get(writeTodosCall.id ?? '')
      let items: TodoItem[] = []

      if (result) {
        try {
          const parsed = typeof result.content === 'string' ? JSON.parse(result.content) : result.content
          items = parsed?.update?.todos ?? parsed?.todos ?? []
        } catch {
          items = []
        }
      } else {
        items = (writeTodosCall.args as any)?.todos ?? []
      }

      if (!items.length) continue

      const existing = todoGroups.get(msgId)
      if (existing) {
        items.forEach((item, index) => {
          if (index < existing.todos.length) {
            const todo = existing.todos[index]
            if (todo) {
              todo.title = item.content
              todo.status = item.status
            }
          } else {
            existing.todos.push({
              id: `${msgId}-${index}`,
              title: item.content,
              status: item.status,
            })
          }
        })
        if (existing.todos.length > items.length) {
          existing.todos.splice(items.length)
        }
        existing.label = `第${groupIndex}轮分析`
      } else {
        todoGroups.set(msgId, {
          messageId: msgId,
          label: `第${groupIndex}轮分析`,
          todos: items.map((item, index) => ({
            id: `${msgId}-${index}`,
            title: item.content,
            status: item.status,
          })),
        })
      }
    }

    // 清理已不存在的分组
    for (const key of todoGroups.keys()) {
      if (!seenIds.has(key)) {
        todoGroups.delete(key)
      }
    }

    updatePending = false
  })
}, { deep: true })

/** 提取 AIMessage 中的推理文本 */
function getReasoningText(message: InstanceType<typeof AIMessage>): string {
  if (!('contentBlocks' in message)) return ''
  return (message as any).contentBlocks
    .filter((b: any) => b.type === 'reasoning')
    .map((b: any) => b.reasoning)
    .join('')
}

/** LangChain tool state → AI Elements ToolUIPart state */
type ToolState = 'input-available' | 'output-available' | 'output-error'

interface ToolCallWithResult {
  call: { id: string; name: string; args: Record<string, unknown> }
  result: InstanceType<typeof ToolMessage> | undefined
  state: ToolState
}

function getToolCallsForMessage(
  message: InstanceType<typeof AIMessage>,
  messages: readonly any[],
): ToolCallWithResult[] {
  const toolCalls = message.tool_calls ?? []
  if (toolCalls.length === 0) return []

  // 收集消息列表中所有 ToolMessage，按 tool_call_id 索引
  const toolResults = new Map<string, InstanceType<typeof ToolMessage>>()
  for (const msg of messages) {
    if (ToolMessage.isInstance(msg)) {
      toolResults.set(msg.tool_call_id, msg)
    }
  }

  return toolCalls.map((tc) => {
    const result = toolResults.get(tc.id ?? '')
    const hasError = result && (result as any).status === 'error'
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
watch(() => allTodos.value.length, (newLen, oldLen) => {
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
  todoGroups.clear()
});
</script>

<style></style>
