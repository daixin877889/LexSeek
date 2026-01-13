<script setup lang="ts">
/**
 * 对话消息列表组件
 *
 * 展示案件分析过程中的对话消息，包括用户消息和 AI 响应
 * 使用 ai-elements 组件库构建 AI 交互界面
 *
 * @see Requirements 10.1, 10.4
 * @see design.md - AI 界面组件集成
 */
import type { HTMLAttributes } from 'vue'
import type {
    ToolCallInfo,
    AnalysisResult,
    InterruptData,
} from '@/composables/useCaseAnalysis'
import { cn } from '@/lib/utils'
import { BotIcon, UserIcon, CopyIcon, CheckIcon, RefreshCwIcon } from 'lucide-vue-next'

/**
 * 消息项接口
 */
export interface MessageItem {
    /** 消息 ID */
    id: string
    /** 消息角色 */
    role: 'user' | 'assistant' | 'system'
    /** 消息内容 */
    content: string
    /** 时间戳 */
    timestamp?: number
    /** 是否正在流式输出 */
    isStreaming?: boolean
    /** 推理内容 */
    reasoning?: string
    /** 工具调用列表 */
    toolCalls?: ToolCallInfo[]
    /** 分析结果 */
    analysisResult?: AnalysisResult
    /** 中断数据 */
    interrupt?: InterruptData
    /** 原始 SSE 消息 */
    rawMessage?: SSEMessage
}

interface Props {
    /** 消息列表 */
    messages: MessageItem[]
    /** 当前流式文本 */
    streamingText?: string
    /** 当前推理内容 */
    reasoningText?: string
    /** 是否正在加载 */
    isLoading?: boolean
    /** 空状态标题 */
    emptyTitle?: string
    /** 空状态描述 */
    emptyDescription?: string
    /** 自定义类名 */
    class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
    messages: () => [],
    streamingText: '',
    reasoningText: '',
    isLoading: false,
    emptyTitle: '开始案件分析',
    emptyDescription: '上传案件材料后，AI 将帮助您分析案件',
})

const emit = defineEmits<{
    /** 复制消息内容 */
    (e: 'copy', message: MessageItem): void
    /** 重新生成消息 */
    (e: 'regenerate', message: MessageItem): void
}>()

// 复制状态
const copiedId = ref<string | null>(null)

/**
 * 复制消息内容
 */
async function handleCopy(message: MessageItem) {
    try {
        await navigator.clipboard.writeText(message.content)
        copiedId.value = message.id
        emit('copy', message)

        // 2 秒后重置复制状态
        setTimeout(() => {
            copiedId.value = null
        }, 2000)
    } catch (error) {
        console.error('复制失败:', error)
    }
}

/**
 * 重新生成消息
 */
function handleRegenerate(message: MessageItem) {
    emit('regenerate', message)
}

/**
 * 判断是否显示流式输出
 */
const showStreamingMessage = computed(() => {
    return props.isLoading && (props.streamingText || props.reasoningText)
})

/**
 * 判断消息是否为空
 */
const isEmpty = computed(() => {
    return props.messages.length === 0 && !showStreamingMessage.value
})

/**
 * 格式化时间戳
 */
function formatTimestamp(timestamp?: number): string {
    if (!timestamp) return ''
    const date = new Date(timestamp)
    return date.toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
    })
}

/**
 * 判断是否为用户消息
 */
function isUserMessage(message: MessageItem): boolean {
    return message.role === 'user'
}

/**
 * 判断是否为 AI 消息
 */
function isAssistantMessage(message: MessageItem): boolean {
    return message.role === 'assistant'
}
</script>

<template>
    <AiElementsConversation :class="cn('h-full', props.class)">
        <!-- 空状态 -->
        <AiElementsConversationEmptyState v-if="isEmpty" :title="props.emptyTitle"
            :description="props.emptyDescription">
            <template #icon>
                <BotIcon class="size-12 text-muted-foreground/50" />
            </template>
        </AiElementsConversationEmptyState>

        <!-- 消息列表 -->
        <AiElementsConversationContent v-else>
            <!-- 历史消息 -->
            <template v-for="message in messages" :key="message.id">
                <!-- 用户消息 -->
                <AiElementsMessage v-if="isUserMessage(message)" from="user">
                    <AiElementsMessageContent>
                        <p class="whitespace-pre-wrap">{{ message.content }}</p>
                    </AiElementsMessageContent>
                    <AiElementsMessageAvatar name="用户">
                        <UserIcon class="size-4" />
                    </AiElementsMessageAvatar>
                </AiElementsMessage>

                <!-- AI 消息 -->
                <AiElementsMessage v-else-if="isAssistantMessage(message)" from="assistant">
                    <AiElementsMessageAvatar name="AI">
                        <BotIcon class="size-4" />
                    </AiElementsMessageAvatar>
                    <div class="flex flex-col gap-2 flex-1 min-w-0">
                        <!-- 推理过程（可折叠） -->
                        <Collapsible v-if="message.reasoning" class="w-full">
                            <CollapsibleTrigger
                                class="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
                                <span>查看推理过程</span>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                                <div class="mt-2 p-3 bg-muted/50 rounded-lg text-xs text-muted-foreground">
                                    <pre class="whitespace-pre-wrap font-mono">{{
                                        message.reasoning
                                    }}</pre>
                                </div>
                            </CollapsibleContent>
                        </Collapsible>

                        <!-- 工具调用 -->
                        <div v-if="message.toolCalls && message.toolCalls.length > 0" class="flex flex-col gap-2">
                            <div v-for="toolCall in message.toolCalls" :key="toolCall.toolCallId"
                                class="flex items-center gap-2 text-xs text-muted-foreground">
                                <span class="inline-flex items-center gap-1 px-2 py-1 bg-muted rounded">
                                    <span>🔧</span>
                                    <span>{{ toolCall.toolName }}</span>
                                    <span v-if="toolCall.status === 'calling'" class="animate-pulse">...</span>
                                    <span v-else-if="toolCall.status === 'completed'">✓</span>
                                    <span v-else-if="toolCall.status === 'error'">✗</span>
                                </span>
                            </div>
                        </div>

                        <!-- 消息内容 -->
                        <AiElementsMessageContent>
                            <AiElementsMessageResponse v-if="message.content" :content="message.content"
                                class="prose prose-sm dark:prose-invert max-w-none" />
                            <!-- 流式输出中的加载状态 -->
                            <div v-else-if="message.isStreaming" class="flex items-center gap-2 text-muted-foreground">
                                <span class="animate-pulse">正在思考...</span>
                            </div>
                        </AiElementsMessageContent>

                        <!-- 消息工具栏 -->
                        <AiElementsMessageToolbar v-if="message.content && !message.isStreaming"
                            class="opacity-0 group-hover:opacity-100 transition-opacity">
                            <AiElementsMessageActions>
                                <AiElementsMessageAction tooltip="复制" @click="handleCopy(message)">
                                    <CheckIcon v-if="copiedId === message.id" class="size-4 text-green-500" />
                                    <CopyIcon v-else class="size-4" />
                                </AiElementsMessageAction>
                                <AiElementsMessageAction tooltip="重新生成" @click="handleRegenerate(message)">
                                    <RefreshCwIcon class="size-4" />
                                </AiElementsMessageAction>
                            </AiElementsMessageActions>
                            <span v-if="message.timestamp" class="text-xs text-muted-foreground">
                                {{ formatTimestamp(message.timestamp) }}
                            </span>
                        </AiElementsMessageToolbar>
                    </div>
                </AiElementsMessage>
            </template>

            <!-- 当前流式输出 -->
            <AiElementsMessage v-if="showStreamingMessage" from="assistant">
                <AiElementsMessageAvatar name="AI">
                    <BotIcon class="size-4" />
                </AiElementsMessageAvatar>
                <div class="flex flex-col gap-2 flex-1 min-w-0">
                    <!-- 推理过程 -->
                    <Collapsible v-if="reasoningText" class="w-full" :default-open="true">
                        <CollapsibleTrigger
                            class="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
                            <span class="animate-pulse">正在推理...</span>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                            <div class="mt-2 p-3 bg-muted/50 rounded-lg text-xs text-muted-foreground">
                                <pre class="whitespace-pre-wrap font-mono">{{ reasoningText }}</pre>
                            </div>
                        </CollapsibleContent>
                    </Collapsible>

                    <!-- 流式内容 -->
                    <AiElementsMessageContent>
                        <AiElementsMessageResponse v-if="streamingText" :content="streamingText"
                            class="prose prose-sm dark:prose-invert max-w-none" />
                        <div v-else class="flex items-center gap-2 text-muted-foreground">
                            <span class="animate-pulse">正在生成...</span>
                        </div>
                    </AiElementsMessageContent>
                </div>
            </AiElementsMessage>

            <!-- 加载状态（无流式内容时） -->
            <AiElementsMessage v-else-if="isLoading && !streamingText && !reasoningText" from="assistant">
                <AiElementsMessageAvatar name="AI">
                    <BotIcon class="size-4" />
                </AiElementsMessageAvatar>
                <AiElementsMessageContent>
                    <div class="flex items-center gap-2 text-muted-foreground">
                        <div class="flex gap-1">
                            <span class="size-2 bg-current rounded-full animate-bounce" />
                            <span class="size-2 bg-current rounded-full animate-bounce" style="animation-delay: 0.1s" />
                            <span class="size-2 bg-current rounded-full animate-bounce" style="animation-delay: 0.2s" />
                        </div>
                        <span>AI 正在思考...</span>
                    </div>
                </AiElementsMessageContent>
            </AiElementsMessage>
        </AiElementsConversationContent>

        <!-- 滚动到底部按钮 -->
        <AiElementsConversationScrollButton />
    </AiElementsConversation>
</template>
