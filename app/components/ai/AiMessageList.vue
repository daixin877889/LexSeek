<script setup lang="ts">
import type { Component } from 'vue'
import type { ParsedMessage } from './composables/useMessageParser'

interface Props {
  messages: ParsedMessage[]
  loading?: boolean
  toolMap?: Record<string, Component>
  showToolInterrupt?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
  showToolInterrupt: true,
})

const emit = defineEmits<{
  (e: 'tool-confirm', data: { toolCallId: string; data: any }): void
  (e: 'tool-reject', data: { toolCallId: string }): void
}>()

const scrollRef = ref<HTMLElement>()
const isUserScrolled = ref(false)

function handleScroll() {
  if (!scrollRef.value) return
  const { scrollTop, scrollHeight, clientHeight } = scrollRef.value
  const distFromBottom = scrollHeight - scrollTop - clientHeight
  isUserScrolled.value = distFromBottom > 100
}

function scrollToBottom() {
  if (scrollRef.value) {
    scrollRef.value.scrollTop = scrollRef.value.scrollHeight
    isUserScrolled.value = false
  }
}

// 新消息到达时自动滚动
watch(
  () => props.messages.length,
  () => {
    if (!isUserScrolled.value) {
      nextTick(scrollToBottom)
    }
  },
)

// loading 状态变化时滚动
watch(
  () => props.loading,
  (newLoading) => {
    if (newLoading && !isUserScrolled.value) {
      nextTick(scrollToBottom)
    }
  },
)
</script>

<template>
  <div class="relative min-h-0 flex-1">
    <div
      ref="scrollRef"
      class="h-full space-y-4 overflow-y-auto px-4 py-4"
      @scroll="handleScroll"
    >
      <!-- 空状态 -->
      <slot v-if="messages.length === 0 && !loading" name="empty" />

      <!-- 消息列表 -->
      <AiMessageItem
        v-for="msg in messages"
        :key="msg.id"
        :message="msg"
        :tool-map="toolMap"
        :show-tool-interrupt="showToolInterrupt"
        @tool-confirm="(data) => emit('tool-confirm', data)"
        @tool-reject="(data) => emit('tool-reject', data)"
      />

      <!-- 打字指示器 -->
      <div v-if="loading && messages.length > 0" class="flex justify-start">
        <div class="flex items-center gap-1 rounded-lg bg-muted px-3 py-2">
          <span class="size-2 animate-bounce rounded-full bg-muted-foreground/50" style="animation-delay: 0ms" />
          <span class="size-2 animate-bounce rounded-full bg-muted-foreground/50" style="animation-delay: 150ms" />
          <span class="size-2 animate-bounce rounded-full bg-muted-foreground/50" style="animation-delay: 300ms" />
        </div>
      </div>
    </div>

    <!-- 回到底部按钮 -->
    <Transition name="fade">
      <button
        v-if="isUserScrolled"
        class="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border bg-background px-3 py-1.5 text-sm shadow-md hover:bg-muted"
        @click="scrollToBottom"
      >
        <Icon name="lucide:arrow-down" class="size-4" />
        <span>回到底部</span>
      </button>
    </Transition>
  </div>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.2s;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
}
</style>
