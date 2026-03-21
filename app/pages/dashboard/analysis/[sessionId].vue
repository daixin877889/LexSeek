<template>
  <div class="h-full flex flex-col" style="height: calc(100vh - 48px)">
    <!-- Header 区域 -->
    <div class="h-12 shrink-0 border-b bg-muted/30 text-base font-semibold flex items-center px-4 gap-2">
      <Button variant="ghost" size="icon" class="size-8" @click="goBack">
        <ArrowLeftIcon class="size-4" />
      </Button>
      <div class="flex-1 truncate">{{ "案件分析" }}</div>
      <Badge v-if="caseInfo?.status" variant="secondary" class="text-xs">
        {{ getStatusText(1) }}
      </Badge>
    </div>

    <!-- 加载状态 -->
    <div v-if="isLoading" class="flex-1 flex items-center justify-center">
      <div class="flex flex-col items-center gap-3">
        <Loader2Icon class="size-8 animate-spin text-primary" />
        <span class="text-sm text-muted-foreground">加载案件信息...</span>
      </div>
    </div>

    <!-- 错误状态 -->
    <div v-else-if="loadError" class="flex-1 flex items-center justify-center">
      <div class="flex flex-col items-center gap-3 text-center">
        <AlertCircleIcon class="size-12 text-destructive" />
        <p class="text-sm text-muted-foreground">{{ loadError }}</p>
        <Button variant="outline" size="sm" @click="loadCaseInfo">
          重新加载
        </Button>
      </div>
    </div>

    <!-- 主内容区域 -->
    <ResizablePanelGroup v-else direction="horizontal" class="flex-1 min-h-0">
      <!-- 左侧面板：对话区域 -->
      <ResizablePanel :default-size="50" :min-size="30" class="bg-muted/20">
        <div class="flex flex-col h-full overflow-hidden">
          <!-- 对话消息列表（占据剩余空间） -->
          <div class="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">

            <AiElementsConversation>
              <AiElementsConversationContent class="">

                <template v-for="(message, msgIndex) in chat.messages" :key="message.id">
                  <template v-for="(part, partIndex) in message.parts" :key="message.id + ':' + partIndex">
                    <AiElementsMessage :from="message.role">

                      <!-- 思考消息 -->
                      <AiElementsReasoning v-if="part.type === 'reasoning'" :is-streaming="part.state === 'streaming'">
                        <AiElementsReasoningTrigger />
                        <AiElementsReasoningContent :content="part.text" />
                      </AiElementsReasoning>

                      <!-- 文本消息 - 使用 MessageResponse 来渲染 markdown -->
                      <AiElementsMessageContent v-else-if="part.type === 'text'">
                        <AiElementsMessageResponse :content="part.text" />
                      </AiElementsMessageContent>

                      <!-- 工具消息 -->
                      <AiElementsTool v-else-if="part.type === 'dynamic-tool' && part.toolName === 'write_todos'">
                        <AiElementsToolHeader :state="part.state" :title="'待办事项'" :type="`tool-${part.toolName}`" />
                        <AiElementsToolContent>
                          <AiElementsToolOutput v-if="part.state === 'output-available'"
                            :output="getTodosFromPart(part as WriteTodos)" />
                        </AiElementsToolContent>
                      </AiElementsTool>

                    </AiElementsMessage>
                  </template>
                </template>

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
            <CaseAnalysisPromptInput
              ref="promptInputRef"
              v-model:thinking="thinkingEnabled"
              placeholder="输入补充信息或问题..."
              submit-label="发送"
              :loading="isAnalyzing"
              :disabled="isComplete"
              :enable-watcher="false"
              :min-rows="1"
              :max-rows="4"
              @submit="handlePromptSubmit"
            />

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
import { ArrowLeftIcon, Loader2Icon, AlertCircleIcon, ChevronUpIcon } from "lucide-vue-next";
import { toast } from "vue-sonner";
import { Chat } from '@ai-sdk/vue'
import type { UIMessage } from 'ai'
import { DefaultChatTransport, generateId } from 'ai'

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

interface WriteTodos {
  type: string
  toolName: string
  toolCallId: string
  state: string
  // 旧格式（input-streaming）
  input?: { todos: TodoItem[] }
  // 新格式（output-available）
  output?: {
    update: {
      todos: TodoItem[]
    }
  }
}

const getTodosFromPart = (part: WriteTodos): TodoItem[] => {
  return part.output?.update?.todos ?? part.input?.todos ?? []
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

// 正确的用法：直接使用 chat 实例
const chat = new Chat<UIMessage>({
  id: sessionId.value,
  generateId,
  transport: new DefaultChatTransport({
    api: '/api/v1/case/analysis/stream/' + sessionId.value,
    body: { get thinking() { return thinkingEnabled.value } },
  }),
  onFinish: () => {
    isAnalyzing.value = false
  },
  onError: (error) => {
    isAnalyzing.value = false
    toast.error('分析失败：' + error.message)
    console.error('[analysis] stream error', error)
  }
})

// 从 chat 实例访问属性
// const messages = chat.messages
const sendMessage = (msg: { text: string }) => chat.sendMessage(msg)

// 防抖标记
let updatePending = false

// 监听 messages 变化，按 messageId 分组收集所有 write_todos
watch(() => chat.messages, (newMessages) => {
  if (updatePending) return
  updatePending = true

  nextTick(() => {
    // 收集所有含 write_todos 的 message，按 messageId 分组
    const seenIds = new Set<string>()
    let groupIndex = 0

    for (const message of newMessages) {
      const msgId = (message as any).id as string
      // 找到该 message 中最后一个 write_todos part（同一消息中多次调用取最新）
      let lastWriteTodos: WriteTodos | null = null
      for (const part of (message as any).parts ?? []) {
        if (part.type === 'dynamic-tool' && part.toolName === 'write_todos') {
          lastWriteTodos = part as WriteTodos
        }
      }

      if (!lastWriteTodos) continue

      const items = getTodosFromPart(lastWriteTodos)
      if (!items.length) continue

      seenIds.add(msgId)
      groupIndex++

      const existing = todoGroups.get(msgId)
      if (existing) {
        // 原地更新已有分组
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
        // 截断多余项
        if (existing.todos.length > items.length) {
          existing.todos.splice(items.length)
        }
        existing.label = `第${groupIndex}轮分析`
      } else {
        // 新分组
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


// 页面状态
const isLoading = ref(false);
const loadError = ref<string | null>(null);
const showTaskList = ref(false);
const todoListRef = ref<HTMLElement | null>(null);

// 案件信息
const caseInfo = ref<{
  id: number;
  title: string;
  status: number;
  caseTypeId: number;
  caseTypeName?: string;
} | null>(null);

// 任务清单（未来扩展用）

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

  // 发送消息继续分析（materials 暂不传递，当前 stream API 不支持追加材料）
  sendMessage({ text: data.text || '开始分析' })

  // 重置输入组件
  promptInputRef.value?.reset()
}

function getStatusText(status: number): string {
  const statusMap: Record<number, string> = { 1: "进行中", 2: "已完成", 3: "已关闭" };
  return statusMap[status] || "未知";
}

const handleRegenerate = () => { }
const loadCaseInfo = () => { }
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

onMounted(() => {
});

onUnmounted(() => {
  todoGroups.clear()
});
</script>

<style></style>
