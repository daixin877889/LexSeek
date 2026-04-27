<script setup lang="ts">
/**
 * 法律助手 · 对话面板
 *
 * 用途：承载 `useAssistantChat(sessionId)` 的完整对话 UI。
 *
 * 设计要点：
 * - 父组件 chat.vue 用 `:key="sessionId"` 强制 remount 本组件，
 *   从而让 useAssistantChat/useStreamChat 基于新的 threadId 重建实例，
 *   避免跨会话的消息串流污染。
 * - 本组件只关心"当前 session 下的一次完整生命周期"，sessionId 一旦传入就固定。
 *
 * 阶段 5 Task 13 增量：
 * - 通过 toolMap 注入 2 张工具结果卡（DraftDocumentCard / ReviewContractCard）
 * - interrupt dialog 内按 interruptData.type 分发到对应交互卡：
 *   template_select → TemplateSelectCard
 *   stance_select   → StanceSelectCard
 *   其他            → CaseInterruptConfirmation（既有 fallback，覆盖案件域几个 type）
 * - resume value 走 LangGraph 标准的 stream.submit({ command: { resume: value } })，
 *   即既有的 resumeInterrupt(value)。
 *
 * 参见 spec §8.1 / §8.2、阶段 5 plan §五子组4 Task 13。
 */
import { RefreshCw as RefreshCwIcon } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { AiPromptSubmitData } from '~/components/ai/AiPromptInput.vue'
import type { OssFileItem } from '~/store/file'
import AiChat from '~/components/ai/AiChat.vue'
import CaseInterruptConfirmation from '~/components/case/InterruptConfirmation.vue'
import CaseAnalysisMaterialSelector from '~/components/caseAnalysis/materialSelector.vue'
import AgentsDocumentTemplateSelectCard from '~/components/agents/document/interrupts/TemplateSelectCard.vue'
import AgentsContractStanceSelectCard from '~/components/agents/contract/interrupts/StanceSelectCard.vue'
import AgentsDocumentDraftDocumentCard from '~/components/agents/document/tools/DraftDocumentCard.vue'
import AgentsContractReviewContractCard from '~/components/agents/contract/tools/ReviewContractCard.vue'
import { useLegalAssistantAgent } from '~/composables/agents'

const props = defineProps<{
  sessionId: string
}>()

/**
 * run 完成时触发：
 * - worker 会在首条对话完成后异步生成 ≤20 字标题（spec §5.6.1），
 * - 父页可据此刷新侧栏列表把"未命名对话"替换为生成后的标题。
 */
const emit = defineEmits<{
  'run-complete': []
}>()

// 基于固定 sessionId 构建 stream；作为 ref 只是为了满足 composable 签名。
const sessionIdRef = ref<string | null>(props.sessionId)

const {
  messages,
  isLoading,
  interruptData,
  runStatus,
  runError,
  sendMessage,
  resumeInterrupt,
  stopGeneration,
  init,
} = useLegalAssistantAgent(sessionIdRef)

// 旧版 useAssistantChat 提供的 isInterrupted 在工厂下需调用方自建
const isInterrupted = computed(() => interruptData.value != null)

const thinking = ref(true)

// 停止去抖：避免用户反复点击触发多次 cancel（参考 CaseDetailXiaosuo）
const isStopping = ref(false)

// 失败重试按钮
const showRetryButton = ref(false)
watch(runStatus, (status, prev) => {
  if (status === 'failed') {
    toast.error(`执行失败：${runError.value || '未知错误'}`)
    showRetryButton.value = true
  } else {
    showRetryButton.value = false
  }
  // 首轮对话完成后 worker 会异步生成标题；向父页抛事件触发侧栏刷新
  if (status === 'completed' && prev !== 'completed') {
    emit('run-complete')
  }
})

function onRetry() {
  const list = messages.value as any[]
  const lastUser = [...list].reverse().find((m) => {
    return typeof m?.getType === 'function' ? m.getType() === 'human' : m?.type === 'human'
  })
  if (!lastUser) return
  showRetryButton.value = false
  const content = typeof lastUser.content === 'string' ? lastUser.content : ''
  if (content) sendMessage({ text: content }, { thinking: thinking.value })
}

function handleSubmit(data: AiPromptSubmitData) {
  if (!data.text.trim()) return
  sendMessage(data, { thinking: thinking.value })
}

// 阶段 5：上传材料按钮接 MaterialSelector（参照 dashboard/cases/create.vue 既有模式）
// 不走 AiPromptInput 默认的 hidden file input click（display:none 触发不稳），
// 而是打开材料选择器：用户从云盘已识别文件里选 → addFiles 灌进 prompt → 直接拿到 ossFileId。
const aiChatRef = ref<{
  resetPrompt: () => void
  addFiles: (files: unknown[]) => void
  selectedFileIds: number[]
} | null>(null)
const materialSelectorRef = ref<{ openDialog: () => void } | null>(null)

const selectedFileIds = computed(() => aiChatRef.value?.selectedFileIds ?? [])

function openMaterialSelector() {
  materialSelectorRef.value?.openDialog()
}

function handleFilesFromSelector(files: OssFileItem[]) {
  aiChatRef.value?.addFiles(files)
}

async function handleStop() {
  if (isStopping.value) return
  if (!isLoading.value) return

  isStopping.value = true
  let unwatch: (() => void) | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const cleanup = () => {
    isStopping.value = false
    unwatch?.()
    if (timer) clearTimeout(timer)
    unwatch = undefined
    timer = undefined
  }
  unwatch = watch(isLoading, (loading) => {
    if (!loading) cleanup()
  })
  timer = setTimeout(cleanup, 3000)
  try {
    await stopGeneration()
  } catch (err) {
    cleanup()
    throw err
  }
}

function handleResumeInterrupt(data: unknown) {
  resumeInterrupt(data)
}

// ========== 阶段 5 Task 13：toolMap + interrupt 分发 ==========
// 子代理工具结果卡：法律助手 chat 中遇到这两个工具时，AiToolRenderer 用对应卡片渲染
const toolMap = {
  draft_document: AgentsDocumentDraftDocumentCard,
  review_contract: AgentsContractReviewContractCard,
}

// interrupt dialog 内按 type 分发：template_select / stance_select 走新卡片，
// 其他（案件域已有的几个 type）继续走 CaseInterruptConfirmation
const interruptType = computed<string>(() => {
  const d = interruptData.value as { type?: unknown } | null
  return typeof d?.type === 'string' ? d.type : ''
})
const isTemplateSelect = computed(() => interruptType.value === 'template_select')
const isStanceSelect = computed(() => interruptType.value === 'stance_select')

// 卡片的 onResolve 走 LangGraph resume：
// LangGraph createAgent 路径下，tool 内 throw 的 interrupt 必须按 toolCallId 路由，
// 否则 interrupt() 返回 undefined 让工具误以为用户取消。所以把用户提交的裸 value
// 包装成 `{ [toolCallId]: value }` 再 submit 到 LangGraph command.resume。
// 注意：value=null 同样需要按 toolCallId 路由，让工具知道"是哪一个 tool 的取消"。
async function resolveInterrupt(value: unknown) {
  const tcId = (interruptData.value as { toolCallId?: unknown } | null)?.toolCallId
  if (typeof tcId === 'string' && tcId.length > 0) {
    resumeInterrupt({ [tcId]: value })
  } else {
    // 兼容老的非 sub-agent interrupt（如案件域的 case_info_confirm 等）：直接透传
    resumeInterrupt(value)
  }
}

// 初次挂载后调用工厂 init()：单 session 模式下会 switchSession 到固定 id，
// 内部自动调 reconnect()/loadHistory() 触发 SSE checkpointer 回放
onMounted(async () => {
  try {
    await init()
  } catch (err) {
    console.error('[assistant-chat] init failed', err)
  }
})
</script>

<template>
  <div class="flex flex-col h-full min-h-0">
    <AiChat ref="aiChatRef" :messages="messages" :loading="isLoading" :is-interrupted="isInterrupted"
      v-model:thinking="thinking" panel-mode="left" :show-header="false" :enable-file-upload="true"
      :is-stopping="isStopping" prompt-placeholder="输入你的法律问题..." class="flex-1 min-h-0" :tool-map="toolMap"
      :on-file-button-click="openMaterialSelector" @submit="handleSubmit" @stop="handleStop">
      <template #prompt-actions>
        <div v-if="showRetryButton" class="flex items-center gap-2 px-4 py-2">
          <Button size="sm" variant="outline" @click="onRetry">
            <RefreshCwIcon class="w-4 h-4 mr-1" />
            重试
          </Button>
        </div>
      </template>
    </AiChat>

    <!-- 中断确认弹窗：按 type 分发到不同卡片 -->
    <Dialog :open="!!interruptData" @update:open="() => { }">
      <DialogContent class="sm:max-w-2xl max-h-[95vh] overflow-y-auto p-0" :show-close-button="false"
        @pointer-down-outside.prevent @escape-key-down.prevent @open-auto-focus.prevent>
        <DialogHeader class="sr-only">
          <DialogTitle>需要您的确认</DialogTitle>
          <DialogDescription>请查看并回应以下请求</DialogDescription>
        </DialogHeader>
        <div v-if="interruptData" class="p-6">
          <!-- 文书模板选择（阶段 5 新增） -->
          <AgentsDocumentTemplateSelectCard v-if="isTemplateSelect"
            :interrupt="interruptData as any" :on-resolve="resolveInterrupt" />
          <!-- 合同立场选择（阶段 5 新增） -->
          <AgentsContractStanceSelectCard v-else-if="isStanceSelect"
            :interrupt="interruptData as any" :on-resolve="resolveInterrupt" />
          <!-- fallback：案件域既有 interrupt 类型（CASE_INFO_CHECK / BASIC_INFO_CONFIRM 等） -->
          <CaseInterruptConfirmation v-else :interrupt="interruptData" @submit="handleResumeInterrupt"
            @cancel="() => { }" />
        </div>
      </DialogContent>
    </Dialog>

    <!-- 阶段 5：上传材料弹框（参照 dashboard/cases/create.vue 复用） -->
    <CaseAnalysisMaterialSelector ref="materialSelectorRef" :disabled-file-ids="selectedFileIds"
      @files-selected="handleFilesFromSelector" />
  </div>
</template>
