<script setup lang="ts">
/**
 * 法律助手 · 对话面板
 *
 * 父组件 chat.vue 用 `:key="sessionId"` 强制 remount 本组件，让 useStreamChat 基于
 * 新 threadId 重建实例避免跨会话污染。本组件只管"当前 session 下的一次完整生命周期"，
 * sessionId 一旦传入就固定。
 */
import { RefreshCw as RefreshCwIcon } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { AiPromptSubmitData } from '~/components/ai/AiPromptInput.vue'
import type { OssFileItem } from '~/store/file'
import AiChat from '~/components/ai/AiChat.vue'
import InterruptDispatcher from '~/components/InterruptDispatcher.vue'
import CaseAnalysisMaterialSelector from '~/components/caseAnalysis/materialSelector.vue'
import { PANEL_TOOL_MAP } from '~/components/agents/panelToolMap'
import { useLegalAssistantAgent } from '~/composables/agents'
import { usePanelMessageStreamContext } from '~/composables/agent-platform/usePanelMessageStreamContext'

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
  // 允许 files-only 提交：用户上传材料让 AI 直接看不留言是合理场景。
  // 旧版 !data.text.trim() 守卫会把"光附件"消息吞掉。
  if (!data.text.trim() && !data.files?.length) return
  sendMessage(data, { thinking: thinking.value })
  // 发送动作落定后立即清空输入框（含已选文件 chip + 文本），
  // 与小索保持一致，避免下一轮发送时附件残留导致重复发送。
  aiChatRef.value?.resetPrompt()
}

// 上传材料按钮接 MaterialSelector：用户从云盘已识别文件里选 → addFiles 灌进 prompt
// → 直接拿到 ossFileId。绕开 AiPromptInput 默认的 hidden file input click（display:none
// 触发不稳）。
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

const { resolveInterrupt, isCurrentInterruptToolCard } = usePanelMessageStreamContext({
  interruptData,
  resumeInterrupt,
  sessionRef: () => props.sessionId,
})

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
      :is-stopping="isStopping" prompt-placeholder="输入你的法律问题..." class="flex-1 min-h-0" :tool-map="PANEL_TOOL_MAP"
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

    <!-- isToolCard=false 的中断走 Dialog（按注册表分发到对应卡片）；
         isToolCard=true 的工具卡改走消息流内联（AiToolRenderer 渲染）。 -->
    <Dialog :open="!!interruptData && !isCurrentInterruptToolCard" @update:open="() => { }">
      <DialogContent class="sm:max-w-2xl max-h-[95vh] overflow-y-auto p-0" :show-close-button="false"
        @pointer-down-outside.prevent @escape-key-down.prevent @open-auto-focus.prevent>
        <DialogHeader class="sr-only">
          <DialogTitle>需要您的确认</DialogTitle>
          <DialogDescription>请查看并回应以下请求</DialogDescription>
        </DialogHeader>
        <div v-if="interruptData" class="p-6">
          <InterruptDispatcher
            :interrupt="interruptData as any"
            @submit="resolveInterrupt"
            @cancel="() => { }"
          />
        </div>
      </DialogContent>
    </Dialog>

    <CaseAnalysisMaterialSelector ref="materialSelectorRef" :disabled-file-ids="selectedFileIds"
      @files-selected="handleFilesFromSelector" />
  </div>
</template>
