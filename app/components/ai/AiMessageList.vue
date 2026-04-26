<script setup lang="ts">
import { LoaderIcon } from 'lucide-vue-next'
import type { Component } from 'vue'
import type { ParsedMessage } from './composables/useMessageParser'
import AiMessageListVirtual from './AiMessageListVirtual.vue'

interface Props {
  messages: ParsedMessage[]
  loading?: boolean
  toolMap?: Record<string, Component>
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
})

const emit = defineEmits<{
  (e: 'tool-confirm', data: { toolCallId: string; data: any }): void
  (e: 'tool-reject', data: { toolCallId: string }): void
}>()

function isLastMessage(msg: ParsedMessage): boolean {
  return props.messages[props.messages.length - 1]?.id === msg.id
}
</script>

<template>
  <Conversation class="h-full pt-4">
    <!-- 空状态 -->
    <ConversationEmptyState v-if="messages.length === 0 && !loading" title="开始对话"
      description="输入消息开始 AI 对话" />

    <!-- 虚拟滚动消息列表 -->
    <AiMessageListVirtual v-else :messages="messages" :loading="loading" :tool-map="toolMap"
      @tool-confirm="(d) => emit('tool-confirm', d)" @tool-reject="(d) => emit('tool-reject', d)" />

    <ConversationScrollButton />

    <template #fallback>
      <div class="flex size-full items-center justify-center">
        <LoaderIcon class="size-6 animate-spin text-muted-foreground" />
      </div>
    </template>
  </Conversation>
</template>
