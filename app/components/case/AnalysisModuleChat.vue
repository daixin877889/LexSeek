<script lang="ts" setup>
/**
 * 模块对话悬浮窗组件
 *
 * 使用 ChatWindowShell（三种窗口形态）+ InterruptConfirmation
 * 132 行精简到 ~70 行，补齐 InterruptHandler 功能缺失
 */
import type { ModuleChatInstance } from '~/composables/useModuleChatManager'

const props = defineProps<{
    caseId: number
    chatInstance: ModuleChatInstance
}>()

const isOpen = defineModel<boolean>({ default: false })
const isFullscreen = ref(false)
const thinking = ref(true)

const interruptData = computed(() => props.chatInstance.interruptData.value)

// 关闭时重置全屏
watch(isOpen, (open) => {
    if (!open) isFullscreen.value = false
})

function handleSubmit(data: { text: string }) {
    if (data.text.trim()) {
        props.chatInstance.sendMessage(data.text, { thinking: thinking.value })
    }
}

function handleResumeInterrupt(data: unknown) {
    props.chatInstance.resumeInterrupt(data)
}
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
    <!-- 对话内容 -->
    <AiChat
      :messages="chatInstance.messages.value"
      :loading="chatInstance.isLoading.value"
      panel-mode="left"
      :show-header="false"
      v-model:thinking="thinking"
      :enable-file-upload="false"
      prompt-placeholder="输入消息优化分析结果..."
      @submit="handleSubmit"
      @stop="chatInstance.stopGeneration()"
    />
  </CaseChatWindowShell>

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
