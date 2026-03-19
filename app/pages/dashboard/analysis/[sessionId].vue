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
          <!-- 任务进度（可折叠） -->
          <Collapsible v-model:open="showTaskList" class="shrink-0 border-t">
            <CollapsibleTrigger
              class="flex items-center justify-between w-full px-4 py-2 hover:bg-muted/50 transition-colors">
              <span class="text-sm font-medium">分析进度</span>
              <Badge variant="outline" class="text-xs">
                {{Todos.filter(todo => todo.status === 'completed').length}}/{{ Todos.length }}
              </Badge>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div class="px-4 pb-3">

                <AiElementsQueue>
                  <AiElementsQueueSection>
                    <AiElementsQueueItem v-for="todo in Todos" :key="todo.id">
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

          <!-- 底部输入区域（固定） -->
          <div class="shrink-0 border-t p-3 bg-background">
            <!-- 中断确认组件 -->
            <CaseInterruptConfirmation v-if="showInterruptConfirmation" :interrupt="currentInterrupt"
              :is-submitting="isSubmittingInterrupt" @submit="handleInterruptSubmit" @cancel="handleInterruptCancel" />

            <!-- 输入框 -->
            <div v-else class="flex items-center gap-2">
              <Textarea v-model="userInput" placeholder="输入补充信息或问题..." class="min-h-[40px] max-h-[120px] resize-none"
                :disabled="isAnalyzing || isComplete" @keydown.enter.exact.prevent="handleSendMessage" />
              <Button size="icon" :disabled="!userInput.trim() || isAnalyzing || isComplete" @click="handleSendMessage">
                <SendIcon class="size-4" />
              </Button>
            </div>

            <!-- 状态提示 -->
            <div v-if="isAnalyzing" class="flex items-center justify-center mt-2">
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
import type { AnalysisResult, InterruptData } from "#shared/types/case";
import { ArrowLeftIcon, Loader2Icon, AlertCircleIcon, SendIcon } from "lucide-vue-next";
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

const Todos: QueueTodo[] = reactive([])

// 跟踪当前处理的 todos 所在消息 ID，用于多轮对话时清空旧列表
let lastTodosMessageId: string | null = null

// 防抖：避免 deep watch 每个 token 都触发列表更新
let updatePending = false
let pendingWriteTodos: WriteTodos | null = null
let pendingMessageId: string | null = null

const updateTodos = (inputTodos: WriteTodos) => {
  getTodosFromPart(inputTodos).forEach((item, index) => {
    if (index < Todos.length) {
      // 原地更新属性，避免替换整个对象触发列表重新渲染
      const todo = Todos[index]
      if (todo) {
        todo.title = item.content
        todo.status = item.status
      }
    } else {
      Todos.push({
        id: String(index),
        title: item.content,
        status: item.status
      })
    }
  })
}

// 派生状态
const isAnalyzing = ref(false)
const isComplete = ref(false)

// 正确的用法：直接使用 chat 实例
const chat = new Chat<UIMessage>({
  id: sessionId.value,
  generateId,
  transport: new DefaultChatTransport({
    api: '/api/v1/case/analysis/stream/' + sessionId.value,
  }),
  onFinish: () => {},
  onError: (error) => {
    toast.error('分析失败：' + error.message)
    console.error('[analysis] stream error', error)
  }
})

// 从 chat 实例访问属性
// const messages = chat.messages
const sendMessage = (msg: { text: string }) => chat.sendMessage(msg)

// 监听 messages 变化，只处理最后一个 write_todos（防抖减少更新频率）
watch(() => chat.messages, (newMessages) => {
  // 找到最后一个 write_todos part 及其所在 message
  let lastWriteTodos: WriteTodos | null = null
  let messageId: string | null = null

  for (const message of newMessages) {
    for (const part of (message as any).parts ?? []) {
      if (part.type === 'dynamic-tool' && part.toolName === 'write_todos') {
        lastWriteTodos = part as WriteTodos
        messageId = (message as any).id
      }
    }
  }

  if (!lastWriteTodos || !getTodosFromPart(lastWriteTodos).length) return

  pendingWriteTodos = lastWriteTodos
  pendingMessageId = messageId

  if (!updatePending) {
    updatePending = true
    nextTick(() => {
      if (!pendingWriteTodos) return
      // 新消息的 todos → 清空旧列表（多轮对话场景）
      if (pendingMessageId !== lastTodosMessageId) {
        lastTodosMessageId = pendingMessageId
        Todos.splice(0, Todos.length)
      }
      updateTodos(pendingWriteTodos)
      updatePending = false
    })
  }
}, { deep: true })


// 页面状态
const isLoading = ref(false);
const loadError = ref<string | null>(null);
const isSubmittingInterrupt = ref(false);
const showTaskList = ref(false);
const userInput = ref('');

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

// 中断状态
const currentInterrupt = ref<InterruptData | null>(null);
const showInterruptConfirmation = computed(() => currentInterrupt.value !== null);

function getStatusText(status: number): string {
  const statusMap: Record<number, string> = { 1: "进行中", 2: "已完成", 3: "已关闭" };
  return statusMap[status] || "未知";
}

const handleRegenerate = () => { }
const handleSendMessage = () => { sendMessage({ text: "开始分析" }) }
const handleInterruptSubmit = () => { }
const handleInterruptCancel = () => { }
const loadCaseInfo = () => { }
const goBack = () => {
  router.push({ name: "dashboard-analysis" });
}

onMounted(() => {
});

onUnmounted(() => {
  lastTodosMessageId = null
});
</script>

<style></style>
