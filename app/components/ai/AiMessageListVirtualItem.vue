<script setup lang="ts">
import type { Component } from 'vue'
import type { ParsedMessage } from './composables/useMessageParser'
import AiToolRenderer from '~/components/ai/AiToolRenderer.vue'

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
  <Message v-if="msg.type === 'human'" from="user" class="max-w-full">
    <MessageContent>{{ msg.content }}</MessageContent>
  </Message>

  <!-- AI 消息 -->
  <!-- MessageContent 默认 w-fit 会让工具卡片按内容宽度自适应，导致同一工具在不同消息里宽度不一。
       这里覆盖为 w-full，让所有工具调用与消息容器同宽（max-w-[80%]） -->
  <Message v-else-if="msg.type === 'ai'" from="assistant" class="max-w-full">
    <MessageContent class="w-full">
      <!-- 思考过程 -->
      <Reasoning v-if="msg.thinking" :is-streaming="loading && isLast">
        <ReasoningTrigger />
        <ReasoningContent :content="msg.thinking" />
      </Reasoning>

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
      <MessageResponse v-if="msg.content" :content="msg.content" mode="static" />
    </MessageContent>
  </Message>

  <!-- 系统消息 -->
  <Message v-else-if="msg.type === 'system'" from="system" class="max-w-full">
    <MessageContent>{{ msg.content }}</MessageContent>
  </Message>
</template>
