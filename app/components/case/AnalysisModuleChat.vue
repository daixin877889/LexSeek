<script lang="ts" setup>
/**
 * 模块对话悬浮窗组件
 *
 * 使用 ChatWindowShell（三种窗口形态）+ SessionListPopover（多 session 管理）
 * + InterruptConfirmation
 *
 * 每个模块对应一个 session manager，manager 内部管理该模块的多个 session。
 * 用户可以在同一模块下创建、切换、删除、重命名多个独立对话，
 * 避免老对话的上下文污染（与小索一致的多 session 模型）。
 */
import type { ModuleAgentInstance } from '~/composables/agents'
import type { SessionItem } from '~/components/case/SessionListPopover.vue'
import type { BaseMessage } from '@langchain/core/messages'
import { toast } from 'vue-sonner'
import { RefreshCw as RefreshCwIcon } from 'lucide-vue-next'
import { QUEUE_MAX_SIZE } from '~/composables/chatQueueActions'
import AiChat from '~/components/ai/AiChat.vue'
import AiChatQueueChips from '~/components/ai/AiChatQueueChips.vue'
import InterruptDispatcher from '~/components/InterruptDispatcher.vue'
import CaseChatWindowShell from '~/components/case/ChatWindowShell.vue'
import CaseSessionListPopover from '~/components/case/SessionListPopover.vue'
import { useInterruptToast } from '~/composables/useInterruptToast'

const props = defineProps<{
    caseId: number
    chatInstance: ModuleAgentInstance
}>()

const isOpen = defineModel<boolean>({ default: false })
const isFullscreen = ref(false)
const thinking = ref(true)

// 适配 SessionListPopover 的 session 列表类型
const sessions = computed<SessionItem[]>(() =>
    props.chatInstance.sessions.value.map((s: any) => ({
        sessionId: s.sessionId,
        title: s.title,
        updatedAt: s.updatedAt,
    })),
)

// 与 CaseDetailXiaosuo.vue 保持对称的 computed 包装
// !! 强制转 boolean 防御 isLoading 为 undefined 的边缘情况
const chatMessages = computed(() => props.chatInstance.messages.value as any[])
const chatLoading = computed(() => !!props.chatInstance.isLoading.value)
const interruptData = computed(() => props.chatInstance.interruptData.value)
// props 内部的 ComputedRef 在模板不会自动解包，setup 包一层 computed 后模板可直接绑定
const syntheticToolCalls = computed(() => (props.chatInstance as any).syntheticToolCalls?.value ?? {})

// 子 Agent 数据访问注入：模块对话同样会触发 sub_agent_token（caseMain 调
// ask_X_expert 时其 SSE 流可能在此 session 共消费；或后续给模块挂 task 工具）
provide('subAgentAccess', {
    get subThreadsMap() { return props.chatInstance.subThreadsMap },
})

// Agent 运行状态 + 失败反馈
const runStatus = computed(() => props.chatInstance.runStatus.value)
const runError = computed(() => props.chatInstance.runError.value)
const showRetryButton = ref(false)

// 队列响应式字段 unwrap（Vue 3 template 不自动 unwrap 嵌套 props 的 Ref）
const currentQueue = computed(() => props.chatInstance.currentQueue.value)
const queueLen = computed(() => props.chatInstance.currentQueueLen.value)
const queueFull = computed(() => queueLen.value >= QUEUE_MAX_SIZE)
const isQueuePaused = computed(() => props.chatInstance.isQueuePaused.value)
const queuePauseReason = computed(() => props.chatInstance.queuePauseReason.value)

// 停止去抖：防止重复点击停止按钮发起多次 cancel 请求
const isStopping = ref(false)

// AiChat 组件 ref，用于在入队成功后 reset 输入框
const aiChatRef = ref<{ resetPrompt: () => void } | null>(null)

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
    const messages = props.chatInstance.messages.value as BaseMessage[]
    const lastUser = [...messages].reverse().find((m) => m.getType() === 'human')
    if (!lastUser) return
    showRetryButton.value = false
    const content = typeof lastUser.content === 'string' ? lastUser.content : ''
    if (content) props.chatInstance.sendMessage(content, { thinking: thinking.value })
}

// 关闭时重置全屏
watch(isOpen, (open) => {
    if (!open) isFullscreen.value = false
})

function handleSubmit(data: { text: string; files?: any[] }) {
    if (!data.text.trim() && !data.files?.length) return

    // 暂停态强制入队 + loading 期间入队（spec §5.3）
    const shouldEnqueue =
        props.chatInstance.isLoading.value || props.chatInstance.isQueuePaused.value

    if (shouldEnqueue) {
        const ok = props.chatInstance.enqueueMessage(data.text, data.files, thinking.value)
        if (!ok) {
            toast.warning(`队列已满（最多 ${QUEUE_MAX_SIZE} 条），请等待当前对话结束或清空队列`)
        } else {
            aiChatRef.value?.resetPrompt()
        }
    } else {
        props.chatInstance.sendMessage(data.text, { thinking: thinking.value })
    }
}

async function handleStop() {
    if (isStopping.value) return
    // 短路：当前无流在跑，stop 无意义。用 isLoading（前端本地信号）而非
    // runStatus（后端 SSE 事件驱动，上轮 'cancelled' 会粘到新一轮 submit→status_change
    // 之间的窗口，旧实现在此窗口内会误把 stop 吞掉）
    if (!props.chatInstance.isLoading.value) return

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
        () => props.chatInstance.isLoading.value,
        (loading) => { if (!loading) cleanup() },
    )
    timer = setTimeout(cleanup, 3000)
    try {
        await props.chatInstance.stopGeneration()
    } catch (err) {
        console.error('[chat-stop] stopGeneration failed', err)
        cleanup()
    }
}

function handleResumeInterrupt(data: unknown) {
    props.chatInstance.resumeInterrupt(data)
}

// 中断出现时 toast 提示，工具卡片从"运行中"切到"已暂停"（:is-interrupted 透传）
useInterruptToast(interruptData)
</script>

<template>
  <!-- 聊天窗口外壳（桌面全屏/小窗/移动端 Sheet），偏移避免与小索重叠 -->
  <CaseChatWindowShell
    v-model:open="isOpen"
    v-model:fullscreen="isFullscreen"
    :title="chatInstance.moduleTitle"
    :initial-width="380"
    :initial-height="640"
    :position-offset="{ x: -40, y: -40 }"
  >
    <!-- 标题栏左侧：session 选择器（前缀由 UI 动态拼接为"模块名 - 时间"） -->
    <template #titlebar-left>
      <CaseSessionListPopover
        :sessions="sessions"
        :current-id="chatInstance.currentSessionId.value"
        :title-prefix="chatInstance.moduleTitle"
        @select="chatInstance.switchSession($event)"
        @create="chatInstance.createSession()"
        @delete="chatInstance.deleteSession($event)"
        @rename="(sid, title) => chatInstance.renameSession(sid, title)"
      />
    </template>

    <!-- 对话内容 -->
    <!-- :extra-tool-calls 把 saveAnalysisResult 工具发出的"生成结果摘要"合成卡片
         注入到对应 AIMessage 的 toolCalls 末尾（紧跟 save_analysis_result 卡片渲染） -->
    <AiChat
      ref="aiChatRef"
      :messages="chatMessages"
      :loading="chatLoading"
      :is-interrupted="!!interruptData"
      :extra-tool-calls="syntheticToolCalls"
      panel-mode="left"
      :show-header="false"
      v-model:thinking="thinking"
      :enable-file-upload="false"
      :queue-length="queueLen"
      :queue-full="queueFull"
      :is-stopping="isStopping"
      prompt-placeholder="输入消息优化分析结果..."
      @submit="handleSubmit"
      @stop="handleStop"
    >
      <template #prompt-actions>
        <!-- 重试按钮仅在队列为空时显示（与 CaseDetailXiaosuo 对称）：
             队列有内容且因失败暂停时，由 AiChatQueueChips 的"恢复队列"按钮覆盖此场景，
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
          @remove="(id) => props.chatInstance.removeQueueItem(id)"
          @resume="() => props.chatInstance.resumeQueue()"
          @clear="() => props.chatInstance.clearQueue()"
        />
      </template>
    </AiChat>
  </CaseChatWindowShell>

  <!-- 中断处理弹窗
       阶段 7：改用 InterruptDispatcher 按注册表分发；
       content + overlay 都提到 z-[70]，完整遮住浮窗（ChatWindowShell z-[60]）。 -->
  <Dialog :open="!!interruptData" @update:open="() => {}">
    <DialogContent class="sm:max-w-2xl max-h-[95vh] overflow-y-auto p-0 z-[70]" overlay-class="z-[70]" :show-close-button="false"
      @pointer-down-outside.prevent @escape-key-down.prevent @open-auto-focus.prevent>
      <DialogHeader class="sr-only">
        <DialogTitle>需要您的确认</DialogTitle>
        <DialogDescription>请查看并回应以下请求</DialogDescription>
      </DialogHeader>
      <div v-if="interruptData" class="p-6">
        <InterruptDispatcher
          :interrupt="interruptData as any"
          @submit="handleResumeInterrupt"
          @cancel="() => {}"
        />
      </div>
    </DialogContent>
  </Dialog>
</template>
