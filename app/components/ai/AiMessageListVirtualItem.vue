<script setup lang="ts">
import type { Component } from 'vue'
import type { ParsedMessage } from './composables/useMessageParser'
import AiToolRenderer from '~/components/ai/AiToolRenderer.vue'
import UserMessageWithAttachments from '~/components/ai/UserMessageWithAttachments.vue'
import AttachmentMessageBubble, {
  type AttachmentLite,
} from '~/components/ai/AttachmentMessageBubble.vue'

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

/**
 * 阶段 5（方案 C 混合）· 附件消息识别：
 *   1. 优先用 LangChain 标准 metadata（msg.attachments，已由 useMessageParser
 *      从 additional_kwargs.attachments 升级到 ParsedMessage 一等公民字段）
 *   2. 旧消息 fallback：content 以 `__ATTACHMENTS__\n` 开头时解析 JSON
 *
 * 优先 metadata 让前端不依赖字符串前缀检测，content 完全可由后端控制。
 */
const ATTACH_SENTINEL = '__ATTACHMENTS__\n'

const isAttachmentMessage = computed<boolean>(() => {
  if (props.msg.type !== 'human') return false
  if (props.msg.attachments && props.msg.attachments.length > 0) return true
  // fallback：旧消息只有 sentinel content（兼容历史会话回放）
  return typeof props.msg.content === 'string' && props.msg.content.startsWith(ATTACH_SENTINEL)
})

const parsedAttachments = computed<AttachmentLite[]>(() => {
  // 优先：metadata 路径
  if (props.msg.attachments && props.msg.attachments.length > 0) {
    return props.msg.attachments as AttachmentLite[]
  }
  // fallback：sentinel content 解析（仅旧消息）
  if (typeof props.msg.content === 'string' && props.msg.content.startsWith(ATTACH_SENTINEL)) {
    try {
      const raw = props.msg.content.slice(ATTACH_SENTINEL.length)
      const arr = JSON.parse(raw)
      if (!Array.isArray(arr)) return []
      return arr.filter(
        (a): a is AttachmentLite =>
          a && typeof a === 'object' && typeof a.id === 'number' && typeof a.fileName === 'string',
      )
    } catch {
      return []
    }
  }
  return []
})
</script>

<template>
  <!-- 附件消息：去掉 user 默认灰色气泡（bg-secondary），让卡片直接停在聊天背景上 -->
  <Message v-if="isAttachmentMessage" from="user" class="max-w-full">
    <MessageContent
      class="group-[.is-user]:!bg-transparent group-[.is-user]:!p-0"
    >
      <AttachmentMessageBubble :attachments="parsedAttachments" />
    </MessageContent>
  </Message>

  <!-- 普通用户消息：保留 inline 附件 fallback 兼容老消息（旧 `[附件: name · id=N]` 格式） -->
  <Message v-else-if="msg.type === 'human'" from="user" class="max-w-full">
    <MessageContent>
      <UserMessageWithAttachments :content="msg.content" />
    </MessageContent>
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
