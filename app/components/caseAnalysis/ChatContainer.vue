<script setup lang="ts">
import { useCaseChat } from '~/composables/useCaseChat'

const props = defineProps<{
    sessionId: string
    thinking?: boolean
}>()

const emit = defineEmits<{
    error: [message: string]
}>()

const {
    messages,
    isLoading,
    error,
    sendMessage,
    resumeInterrupt,
    stopGeneration,
    hasMessages,
} = useCaseChat({
    sessionId: props.sessionId,
    thinking: props.thinking,
})

watch(error, (err) => {
    if (err) emit('error', String(err))
})
</script>

<template>
    <AiElementsConversationConversation>
        <AiElementsConversationConversationContent>
            <!-- 消息列表 -->
            <template v-for="msg in messages" :key="msg.id">
                <AiElementsMessageMessage :role="msg._getType?.() === 'human' ? 'user' : 'assistant'">
                    <AiElementsMessageMessageContent>
                        {{ typeof msg.content === 'string' ? msg.content : '' }}
                    </AiElementsMessageMessageContent>
                </AiElementsMessageMessage>
            </template>

            <!-- 加载状态 -->
            <AiElementsLoaderLoader v-if="isLoading" />
        </AiElementsConversationConversationContent>

        <!-- 输入框 -->
        <AiElementsPromptInputPromptInput>
            <AiElementsPromptInputPromptInputTextarea
                placeholder="输入案情或问题..."
                @submit="sendMessage"
            />
            <AiElementsPromptInputPromptInputSubmit
                :disabled="isLoading"
                @click="isLoading ? stopGeneration() : undefined"
            />
        </AiElementsPromptInputPromptInput>
    </AiElementsConversationConversation>
</template>
