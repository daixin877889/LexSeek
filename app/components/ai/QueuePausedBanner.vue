<script setup lang="ts">
/**
 * 队列残留提示条
 *
 * 在 AI 任务停止 / 放弃中断后,如果输入队列里还有未发送的消息,
 * 在 AiChat 上方显示本条:左侧提示文案 + 右侧 [清空] [继续] 双按钮。
 *
 * 显示条件由调用方控制（v-if="queueLength > 0 && isQueuePaused"）。
 *
 * spec: docs/superpowers/specs/2026-05-14-ai-stop-and-queue-design.md §5.4 §7.5
 */
import { AlertCircle } from 'lucide-vue-next'
import { Alert, AlertDescription } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'

defineProps<{
  queueLength: number
}>()

const emit = defineEmits<{
  resume: []
  clear: []
}>()
</script>

<template>
  <Alert class="rounded-none border-x-0 border-t-0">
    <AlertCircle class="size-4" />
    <AlertDescription class="flex items-center justify-between gap-3">
      <span>队列中还有 {{ queueLength }} 条消息未发送</span>
      <div class="flex gap-2">
        <Button variant="outline" size="sm" @click="emit('clear')">
          清空队列
        </Button>
        <Button variant="default" size="sm" @click="emit('resume')">
          继续发送
        </Button>
      </div>
    </AlertDescription>
  </Alert>
</template>
