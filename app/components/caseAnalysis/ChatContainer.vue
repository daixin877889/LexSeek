<script setup lang="ts">
import { useCaseChat } from '~/composables/useCaseChat'
import { Loader2Icon } from 'lucide-vue-next'

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

const inputText = ref('')

function handleSend() {
    if (!inputText.value.trim()) return
    sendMessage(inputText.value.trim())
    inputText.value = ''
}
</script>

<template>
    <div class="flex flex-col h-full">
        <!-- 对话内容区 -->
        <div class="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
            <AiElementsConversation>
                <AiElementsConversationContent>
                    <template v-for="msg in messages" :key="msg.id">
                        <AiElementsMessage :from="msg._getType?.() === 'human' ? 'user' : 'assistant'">
                            <AiElementsMessageContent>
                                <AiElementsMessageResponse
                                    v-if="typeof msg.content === 'string'"
                                    :content="msg.content"
                                />
                            </AiElementsMessageContent>
                        </AiElementsMessage>
                    </template>
                </AiElementsConversationContent>
                <AiElementsConversationScrollButton />
            </AiElementsConversation>

            <!-- 加载状态 -->
            <div v-if="isLoading" class="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2Icon class="size-4 animate-spin" />
                <span>正在分析...</span>
            </div>
        </div>

        <!-- 输入框 -->
        <div class="shrink-0 border-t bg-background p-4">
            <div class="flex gap-2">
                <Textarea
                    v-model="inputText"
                    placeholder="输入案情或问题..."
                    :rows="2"
                    class="flex-1"
                    @keydown.enter.exact.prevent="handleSend"
                />
                <Button
                    :disabled="isLoading || !inputText.trim()"
                    @click="handleSend"
                >
                    {{ isLoading ? '停止' : '发送' }}
                </Button>
            </div>
        </div>
    </div>
</template>
