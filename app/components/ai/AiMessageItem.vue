<script setup lang="ts">
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-vue-next'
import type { Component } from 'vue'
import type { ParsedMessage, ToolCallWithResult } from './composables/useMessageParser'

interface Props {
  message: ParsedMessage
  toolMap?: Record<string, Component>
  showToolInterrupt?: boolean
}

withDefaults(defineProps<Props>(), {
  showToolInterrupt: true,
})

const emit = defineEmits<{
  (e: 'tool-confirm', data: { toolCallId: string; data: any }): void
  (e: 'tool-reject', data: { toolCallId: string }): void
}>()

const showThinking = ref(false)

function handleToolConfirm(toolCall: ToolCallWithResult, data: any) {
  emit('tool-confirm', { toolCallId: toolCall.id, data })
}

function handleToolReject(toolCall: ToolCallWithResult) {
  emit('tool-reject', { toolCallId: toolCall.id })
}
</script>

<template>
  <!-- Human Message -->
  <div v-if="message.type === 'human'" class="flex justify-end">
    <div class="max-w-[80%] rounded-2xl rounded-tr-sm bg-primary px-4 py-2 text-primary-foreground">
      <AiElementsMarkdownContent :content="message.content" />
    </div>
  </div>

  <!-- AI Message -->
  <div v-else-if="message.type === 'ai'" class="flex justify-start">
    <div class="max-w-[90%] space-y-2">
      <!-- Thinking 折叠块 -->
      <div v-if="message.thinking" class="text-sm">
        <button
          class="flex items-center gap-1 text-muted-foreground hover:text-foreground"
          @click="showThinking = !showThinking"
        >
          <ChevronDownIcon v-if="showThinking" class="size-3.5" />
          <ChevronRightIcon v-else class="size-3.5" />
          <span>深度思考</span>
        </button>
        <div v-show="showThinking" class="mt-1 rounded border-l-2 border-muted-foreground/30 pl-3 text-muted-foreground">
          <AiElementsMarkdownContent :content="message.thinking" />
        </div>
      </div>

      <!-- 工具调用 -->
      <AiToolRenderer
        v-for="tc in message.toolCalls"
        :key="tc.id"
        :tool-call="tc"
        :tool-map="toolMap"
        :show-interrupt="showToolInterrupt"
        @confirm="(data: any) => handleToolConfirm(tc, data)"
        @reject="() => handleToolReject(tc)"
      />

      <!-- AI 内容 -->
      <div v-if="message.content" class="prose prose-sm max-w-none dark:prose-invert">
        <AiElementsMarkdownContent :content="message.content" />
      </div>
    </div>
  </div>

  <!-- System Message -->
  <div v-else-if="message.type === 'system'" class="flex justify-center">
    <span class="text-xs text-muted-foreground">{{ message.content }}</span>
  </div>
</template>
