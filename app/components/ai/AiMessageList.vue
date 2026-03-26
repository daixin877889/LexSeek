<script setup lang="ts">
import { LoaderIcon } from 'lucide-vue-next'
import type { Component } from 'vue'
import type { ParsedMessage } from './composables/useMessageParser'

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
  <AiElementsConversation class="h-full">
    <!-- 空状态 -->
    <AiElementsConversationEmptyState
      v-if="messages.length === 0 && !loading"
      title="开始对话"
      description="输入消息开始 AI 对话"
    />

    <!-- 消息列表 -->
    <AiElementsConversationContent v-else>
      <template v-for="msg in messages" :key="msg.id">
        <!-- 用户消息 -->
        <AiElementsMessage v-if="msg.type === 'human'" from="user" class="max-w-full">
          <AiElementsMessageContent>{{ msg.content }}</AiElementsMessageContent>
        </AiElementsMessage>

        <!-- AI 消息 -->
        <AiElementsMessage v-else-if="msg.type === 'ai'" from="assistant" class="max-w-full">
          <AiElementsMessageContent>
            <!-- 思考过程 -->
            <AiElementsReasoning v-if="msg.thinking"
              :is-streaming="loading && isLastMessage(msg)">
              <AiElementsReasoningTrigger />
              <AiElementsReasoningContent :content="msg.thinking" />
            </AiElementsReasoning>

            <!-- 工具调用 -->
            <AiToolRenderer
              v-for="tc in msg.toolCalls"
              :key="tc.id"
              :tool-call="tc"
              :tool-map="toolMap"
              @confirm="(data: any) => emit('tool-confirm', { toolCallId: tc.id, data })"
              @reject="emit('tool-reject', { toolCallId: tc.id })"
            />

            <!-- AI 响应内容 -->
            <AiElementsMessageResponse v-if="msg.content" :content="msg.content" />
          </AiElementsMessageContent>
        </AiElementsMessage>

        <!-- 系统消息 -->
        <AiElementsMessage v-else-if="msg.type === 'system'" from="system" class="max-w-full">
          <AiElementsMessageContent>{{ msg.content }}</AiElementsMessageContent>
        </AiElementsMessage>
      </template>
    </AiElementsConversationContent>

    <AiElementsConversationScrollButton />

    <template #fallback>
      <div class="flex size-full items-center justify-center">
        <LoaderIcon class="size-6 animate-spin text-muted-foreground" />
      </div>
    </template>
  </AiElementsConversation>
</template>
