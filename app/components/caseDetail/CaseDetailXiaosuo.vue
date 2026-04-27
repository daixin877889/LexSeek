<script lang="ts" setup>
/**
 * 小索对话悬浮窗
 *
 * 使用 ChatWindowShell（三种窗口形态）+ SessionListPopover + InterruptConfirmation
 * 从 288 行精简到 ~100 行
 */
import type { useCaseMainAgent } from '~/composables/agents'
import type { SessionItem } from '~/components/case/SessionListPopover.vue'
import type { BaseMessage } from '@langchain/core/messages'
import type { OssFileItem } from '~/store/file'
import { toast } from 'vue-sonner'
import { RefreshCw as RefreshCwIcon } from 'lucide-vue-next'
import { QUEUE_MAX_SIZE } from '~/composables/chatQueueActions'
import AiChat from '~/components/ai/AiChat.vue'
import AiChatQueueChips from '~/components/ai/AiChatQueueChips.vue'
import InterruptDispatcher from '~/components/InterruptDispatcher.vue'
import CaseChatWindowShell from '~/components/case/ChatWindowShell.vue'
import CaseSessionListPopover from '~/components/case/SessionListPopover.vue'
import CaseAnalysisMaterialSelector from '~/components/caseAnalysis/materialSelector.vue'
import AgentsDocumentDraftDocumentCard from '~/components/agents/document/tools/DraftDocumentCard.vue'
import AgentsContractReviewContractCard from '~/components/agents/contract/tools/ReviewContractCard.vue'
import IconXiaosuoIcon from '~/components/icon/XiaosuoIcon.vue'
import { useInterruptToast } from '~/composables/useInterruptToast'

const props = defineProps<{
  xiaosuoChat: ReturnType<typeof useCaseMainAgent>
}>()

const isOpen = defineModel<boolean>({ default: false })
const isFullscreen = ref(false)
const thinking = ref(true)

// 适配 SessionListPopover 的类型
const sessions = computed<SessionItem[]>(() =>
  props.xiaosuoChat.sessions.value.map((s: any) => ({
    sessionId: s.sessionId,
    title: s.title,
    updatedAt: s.updatedAt,
  })),
)

const chatMessages = computed(() => props.xiaosuoChat.messages.value as any[])
const chatLoading = computed(() => !!props.xiaosuoChat.isLoading.value)
const interruptData = computed(() => props.xiaosuoChat.interruptData.value)

// Agent 运行状态 + 失败反馈
const runStatus = computed(() => props.xiaosuoChat.runStatus.value)
const runError = computed(() => props.xiaosuoChat.runError.value)
const showRetryButton = ref(false)

// 队列响应式字段 unwrap（Vue 3 template 不自动 unwrap 嵌套 props 的 Ref）
const currentQueue = computed(() => props.xiaosuoChat.currentQueue.value)
const queueLen = computed(() => props.xiaosuoChat.currentQueueLen.value)
const queueFull = computed(() => queueLen.value >= QUEUE_MAX_SIZE)
const isQueuePaused = computed(() => props.xiaosuoChat.isQueuePaused.value)
const queuePauseReason = computed(() => props.xiaosuoChat.queuePauseReason.value)

// 停止去抖：防止重复点击停止按钮发起多次 cancel 请求
const isStopping = ref(false)

// AiChat 组件 ref，用于在入队成功后 reset 输入框 / addFiles / 获取已选文件列表
const aiChatRef = ref<{
  resetPrompt: () => void
  addFiles: (files: unknown[]) => void
  selectedFileIds: number[]
} | null>(null)

// 阶段 6：MaterialSelector 上传支持（参照 AssistantChatPanel 模式）
const materialSelectorRef = ref<{ openDialog: () => void } | null>(null)
const selectedFileIds = computed(() => aiChatRef.value?.selectedFileIds ?? [])

function openMaterialSelector() {
  materialSelectorRef.value?.openDialog()
}

function handleFilesFromSelector(files: OssFileItem[]) {
  aiChatRef.value?.addFiles(files)
}

// 阶段 6：toolMap — 子代理工具结果卡片（与法律助手对齐）
const toolMap = {
  draft_document: AgentsDocumentDraftDocumentCard,
  review_contract: AgentsContractReviewContractCard,
}

// 阶段 7：resolveInterrupt 包 toolCallId 路由
// LangGraph createAgent 路径下，sub-agent 工具的 interrupt 必须按 toolCallId 路由，
// 否则 interrupt() 返回 undefined，工具误以为用户取消。
async function resolveInterrupt(value: unknown) {
  const tcId = (interruptData.value as { toolCallId?: unknown } | null)?.toolCallId
  if (typeof tcId === 'string' && tcId.length > 0) {
    props.xiaosuoChat.resumeInterrupt({ [tcId]: value })
  } else {
    props.xiaosuoChat.resumeInterrupt(value)
  }
}

watch(runStatus, (status) => {
  if (status === 'failed') {
    toast.error(`执行失败：${runError.value}`)
    showRetryButton.value = true
  } else {
    // 非 failed 状态（含切换 session 后的 idle/completed/running/cancelled/interrupted/pending）一律隐藏
    showRetryButton.value = false
  }
})

function onRetry() {
  const messages = props.xiaosuoChat.messages.value as BaseMessage[]
  const lastUser = [...messages].reverse().find((m) => m.getType() === 'human')
  if (!lastUser) return
  showRetryButton.value = false
  const content = typeof lastUser.content === 'string' ? lastUser.content : ''
  if (content) props.xiaosuoChat.sendMessage(content, { thinking: thinking.value })
}

function handleSubmit(data: { text: string; files?: any[] }) {
  if (!data.text.trim() && !data.files?.length) return

  // 暂停态强制入队 + loading 期间入队（spec §5.3）
  const shouldEnqueue =
    props.xiaosuoChat.isLoading.value || props.xiaosuoChat.isQueuePaused.value

  if (shouldEnqueue) {
    const ok = props.xiaosuoChat.enqueueMessage(data.text, data.files, thinking.value)
    if (!ok) {
      toast.warning(`队列已满（最多 ${QUEUE_MAX_SIZE} 条），请等待当前对话结束或清空队列`)
    } else {
      aiChatRef.value?.resetPrompt()
    }
  } else {
    // 阶段 6：透传 files，sendMessage 内部做双轨承载（sentinel + additional_kwargs）
    props.xiaosuoChat.sendMessage(data.text, { thinking: thinking.value, files: data.files })
  }
}

async function handleStop() {
  if (isStopping.value) return
  // 短路：当前无流在跑，stop 无意义。用 isLoading（前端本地信号）而非
  // runStatus（后端 SSE 事件驱动，上轮 'cancelled' 会粘到新一轮 submit→status_change
  // 之间的窗口，旧实现在此窗口内会误把 stop 吞掉）
  if (!props.xiaosuoChat.isLoading.value) return

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
  // 监听 isLoading 变 false 作为 cleanup 信号。不能用 runStatus：
  // 若本轮 runStatus 赋值前就是 'cancelled'（上轮遗留），stop() 的同值赋值不触发 watch
  unwatch = watch(
    () => props.xiaosuoChat.isLoading.value,
    (loading) => { if (!loading) cleanup() },
  )
  timer = setTimeout(cleanup, 3000)
  try {
    await props.xiaosuoChat.stopGeneration()
  } catch (err) {
    console.error('[chat-stop] stopGeneration failed', err)
    cleanup()
  }
}

// 中断出现时 toast 提示，工具卡片从"运行中"切到"已暂停"（:is-interrupted 透传）
useInterruptToast(interruptData)

// 首次打开时初始化；关闭时重置全屏
// immediate: true 兼容 父组件 mount 时已经把 isOpen=true 的场景
// （Task 18：?focus=xiaosuo 在 onMounted 把 xiaosuoOpen=true，子组件 setup 时 isOpen 已经是 true，
// 普通 watch 会错过这次"变化"导致 init 不触发，sendMessage 静默失败）
watch(isOpen, (open) => {
  if (open) props.xiaosuoChat.init()
}, { immediate: true })
</script>

<template>
  <!-- 聊天窗口外壳（桌面全屏/小窗/移动端 Sheet） -->
  <CaseChatWindowShell
    v-model:open="isOpen"
    v-model:fullscreen="isFullscreen"
    title="小索"
    :initial-width="380"
    :initial-height="500"
  >
    <!-- 标题栏图标 -->
    <template #titlebar-icon>
      <IconXiaosuoIcon class="size-4 shrink-0" />
    </template>
    <!-- 标题栏左侧：session 选择器 -->
    <template #titlebar-left>
      <CaseSessionListPopover
        :sessions="sessions"
        :current-id="xiaosuoChat.currentSessionId.value"
        title-prefix="小索"
        @select="xiaosuoChat.switchSession($event)"
        @create="xiaosuoChat.createSession()"
        @delete="xiaosuoChat.deleteSession($event)"
        @rename="(sid, title) => xiaosuoChat.renameSession(sid, title)"
      />
    </template>

    <!-- 对话内容 -->
    <AiChat
      ref="aiChatRef"
      :messages="chatMessages"
      :loading="chatLoading"
      :is-interrupted="!!interruptData"
      panel-mode="left"
      :show-header="false"
      v-model:thinking="thinking"
      :enable-file-upload="true"
      :queue-length="queueLen"
      :queue-full="queueFull"
      :is-stopping="isStopping"
      :tool-map="toolMap"
      :on-file-button-click="openMaterialSelector"
      prompt-placeholder="问我任何关于案件的问题..."
      @submit="handleSubmit"
      @stop="handleStop"
    >
      <template #prompt-actions>
        <!-- 重试按钮仅在队列为空时显示；
             当队列有内容且因失败暂停时，由 AiChatQueueChips 的"恢复队列"按钮覆盖此场景，
             避免两个相似操作同时出现造成用户困惑 -->
        <div v-if="showRetryButton && currentQueue.length === 0" class="flex items-center gap-2 px-4 py-2">
          <Button size="sm" variant="outline" @click="onRetry">
            <RefreshCwIcon class="w-4 h-4 mr-1" />
            重试
          </Button>
        </div>
        <AiChatQueueChips
          :queue="currentQueue"
          :max="QUEUE_MAX_SIZE"
          :paused="isQueuePaused"
          :pause-reason="queuePauseReason"
          @remove="(id) => props.xiaosuoChat.removeQueueItem(id)"
          @resume="() => props.xiaosuoChat.resumeQueue()"
          @clear="() => props.xiaosuoChat.clearQueue()"
        />
      </template>
    </AiChat>
  </CaseChatWindowShell>

  <!-- 悬浮按钮 -->
  <div class="absolute bottom-20 md:bottom-4 right-4 z-40">
    <IconXiaosuoIcon
      v-show="!isFullscreen"
      class="size-12 cursor-pointer transition-transform drop-shadow-lg animate-float"
      @click="isOpen = !isOpen"
    />
  </div>

  <!-- 中断处理弹窗
       阶段 7：改用 InterruptDispatcher 按注册表分发（template_select / stance_select / case_info_check 等）
       z-[200] 确保完整遮盖浮窗（ChatWindowShell z-[60]）。 -->
  <Dialog :open="!!interruptData" @update:open="() => {}">
    <DialogContent class="sm:max-w-2xl max-h-[95vh] overflow-y-auto p-0 z-[200]" overlay-class="z-[200]" :show-close-button="false"
      @pointer-down-outside.prevent @escape-key-down.prevent @open-auto-focus.prevent>
      <DialogHeader class="sr-only">
        <DialogTitle>需要您的确认</DialogTitle>
        <DialogDescription>请查看并回应以下请求</DialogDescription>
      </DialogHeader>
      <div v-if="interruptData" class="p-6">
        <InterruptDispatcher
          :interrupt="interruptData as any"
          @submit="resolveInterrupt"
          @cancel="() => {}"
        />
      </div>
    </DialogContent>
  </Dialog>

  <!-- 阶段 6：上传材料弹框（参照 AssistantChatPanel 复用） -->
  <CaseAnalysisMaterialSelector
    ref="materialSelectorRef"
    :disabled-file-ids="selectedFileIds"
    @files-selected="handleFilesFromSelector"
  />
</template>
