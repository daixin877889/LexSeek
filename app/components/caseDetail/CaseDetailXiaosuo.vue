<script lang="ts" setup>
/**
 * 小索对话悬浮窗
 *
 * 使用 ChatWindowShell（三种窗口形态）+ SessionListPopover + InterruptConfirmation
 * 从 288 行精简到 ~100 行
 */
import xiaosuoIcon from '~/assets/icon/xiaosuo.svg'
import type { useXiaosuoChat } from '~/composables/useXiaosuoChat'
import type { SessionItem } from '~/components/case/SessionListPopover.vue'

const props = defineProps<{
  xiaosuoChat: ReturnType<typeof useXiaosuoChat>
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

function handleSubmit(data: { text: string }) {
  if (data.text.trim()) {
    props.xiaosuoChat.sendMessage(data.text, { thinking: thinking.value })
  }
}

function handleResumeInterrupt(data: unknown) {
  props.xiaosuoChat.resumeInterrupt(data)
}

// 首次打开时初始化；关闭时重置全屏
watch(isOpen, (open) => {
  if (open) props.xiaosuoChat.init()
})
</script>

<template>
  <!-- 聊天窗口外壳（桌面全屏/小窗/移动端 Sheet） -->
  <CaseChatWindowShell
    v-model:open="isOpen"
    v-model:fullscreen="isFullscreen"
    title="小索"
    :icon="xiaosuoIcon"
    :initial-width="380"
    :initial-height="500"
  >
    <!-- 标题栏左侧：session 选择器（前缀由 UI 动态拼接为"小索 - 时间"） -->
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
      :messages="chatMessages"
      :loading="chatLoading"
      panel-mode="left"
      :show-header="false"
      v-model:thinking="thinking"
      :enable-file-upload="false"
      prompt-placeholder="问我任何关于案件的问题..."
      @submit="handleSubmit"
      @stop="xiaosuoChat.stopGeneration()"
    />
  </CaseChatWindowShell>

  <!-- 悬浮按钮 -->
  <div class="absolute bottom-4 right-4 z-40">
    <img
      v-show="!isFullscreen"
      :src="xiaosuoIcon"
      class="size-12 cursor-pointer hover:scale-110 transition-transform drop-shadow-lg"
      alt="小索"
      @click="isOpen = !isOpen"
    />
  </div>

  <!-- 中断处理弹窗 -->
  <Dialog :open="!!interruptData" @update:open="() => {}">
    <DialogContent class="sm:max-w-2xl max-h-[95vh] overflow-y-auto p-0" :show-close-button="false"
      @pointer-down-outside.prevent @escape-key-down.prevent @open-auto-focus.prevent>
      <DialogHeader class="sr-only">
        <DialogTitle>需要您的确认</DialogTitle>
        <DialogDescription>请查看并回应以下请求</DialogDescription>
      </DialogHeader>
      <div v-if="interruptData" class="p-6">
        <CaseInterruptConfirmation
          :interrupt="interruptData"
          @submit="handleResumeInterrupt"
          @cancel="() => {}"
        />
      </div>
    </DialogContent>
  </Dialog>
</template>
