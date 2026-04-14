<script setup lang="ts">
import type { Component } from 'vue'
import type { ParsedMessage } from './composables/useMessageParser'

interface Props {
  msg: ParsedMessage
  isLast: boolean
  loading?: boolean
  toolMap?: Record<string, Component>
}

const props = defineProps<Props>()

const emit = defineEmits<{
  (e: 'tool-confirm', data: { toolCallId: string; data: any }): void
  (e: 'tool-reject', data: { toolCallId: string }): void
}>()
</script>

<template>
  <!-- 用户消息 -->
  <AiElementsMessage v-if="msg.type === 'human'" from="user" class="max-w-full">
    <AiElementsMessageContent>{{ msg.content }}</AiElementsMessageContent>
  </AiElementsMessage>

  <!-- AI 消息 -->
  <AiElementsMessage v-else-if="msg.type === 'ai'" from="assistant" class="max-w-full">
    <AiElementsMessageContent>
      <!-- 思考过程 -->
      <AiElementsReasoning v-if="msg.thinking" :is-streaming="loading && isLast">
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
      <AiElementsMessageResponse v-if="msg.content" :content="msg.content" mode="static" />
    </AiElementsMessageContent>
  </AiElementsMessage>

  <!-- 系统消息 -->
  <AiElementsMessage v-else-if="msg.type === 'system'" from="system" class="max-w-full">
    <AiElementsMessageContent>{{ msg.content }}</AiElementsMessageContent>
  </AiElementsMessage>
</template>
