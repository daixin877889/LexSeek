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
 * 参见 spec §8.1 / §8.2。
 */
import { RefreshCw as RefreshCwIcon } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { AiPromptSubmitData } from '~/components/ai/AiPromptInput.vue'

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
  loading,
  isInterrupted,
  interruptData,
  runStatus,
  runError,
  sendMessage,
  resumeInterrupt,
  stopGeneration,
  reconnect,
} = useAssistantChat(sessionIdRef)

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

async function handleStop() {
  if (isStopping.value) return
  if (!loading.value) return

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
  unwatch = watch(loading, (isLoading) => {
    if (!isLoading) cleanup()
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

// 初次挂载后拉取历史（通过 submit(undefined) 触发 SSE checkpointer 回放）
onMounted(async () => {
  try {
    await reconnect()
  } catch (err) {
    console.error('[assistant-chat] reconnect failed', err)
  }
})
</script>

<template>
  <div class="flex flex-col h-full min-h-0">
    <AiChat :messages="messages" :loading="loading" :is-interrupted="isInterrupted" v-model:thinking="thinking"
      panel-mode="left" :show-header="false" :enable-file-upload="false" :is-stopping="isStopping"
      prompt-placeholder="输入你的法律问题..." class="flex-1 min-h-0" @submit="handleSubmit" @stop="handleStop">
      <template #prompt-actions>
        <div v-if="showRetryButton" class="flex items-center gap-2 px-4 py-2">
          <Button size="sm" variant="outline" @click="onRetry">
            <RefreshCwIcon class="w-4 h-4 mr-1" />
            重试
          </Button>
        </div>
      </template>
    </AiChat>

    <!-- 中断确认弹窗 -->
    <Dialog :open="!!interruptData" @update:open="() => { }">
      <DialogContent class="sm:max-w-2xl max-h-[95vh] overflow-y-auto p-0" :show-close-button="false"
        @pointer-down-outside.prevent @escape-key-down.prevent @open-auto-focus.prevent>
        <DialogHeader class="sr-only">
          <DialogTitle>需要您的确认</DialogTitle>
          <DialogDescription>请查看并回应以下请求</DialogDescription>
        </DialogHeader>
        <div v-if="interruptData" class="p-6">
          <CaseInterruptConfirmation :interrupt="interruptData" @submit="handleResumeInterrupt" @cancel="() => { }" />
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>
