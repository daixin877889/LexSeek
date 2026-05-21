<script setup lang="ts">
/**
 * 队列残留提示条
 *
 * AI 任务停止 / 放弃中断后，如果输入队列里还有未发送的消息，
 * 在 AiChat 上方显示：左侧剩余条数 + 右侧 [清空] [继续发送] 双按钮。
 * 样式对齐设计稿的消息排队条（琥珀色提醒底纹）。
 *
 * spec: docs/superpowers/specs/2026-05-14-ai-stop-and-queue-design.md §5.4 §7.5
 */
import { AlertCircle } from 'lucide-vue-next'

defineProps<{
  queueLength: number
}>()

const emit = defineEmits<{
  resume: []
  clear: []
}>()
</script>

<template>
  <div
    class="flex items-center gap-2 border-b border-amber-500/25 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
    <AlertCircle class="size-3.5 shrink-0" />
    <span>队列中还有 {{ queueLength }} 条消息未发送</span>
    <div class="ml-auto flex items-center gap-1">
      <button
        type="button"
        class="rounded-md px-2 py-1 text-xs font-medium transition-colors hover:bg-amber-500/15"
        @click="emit('clear')">
        清空
      </button>
      <button
        type="button"
        class="rounded-md bg-amber-500/15 px-2.5 py-1 text-xs font-semibold transition-colors hover:bg-amber-500/25"
        @click="emit('resume')">
        继续发送
      </button>
    </div>
  </div>
</template>
