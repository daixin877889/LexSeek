<script setup lang="ts">
/**
 * AI 响应组件
 *
 * 展示 AI 分析过程中的响应内容，包括：
 * - 推理过程（可折叠）
 * - 工具调用状态和结果
 * - AI 生成的内容（Markdown 渲染）
 * - 流式输出状态
 *
 * @see Requirements 10.2, 10.3, 10.5, 10.6
 * @see design.md - AI 界面组件集成
 */
import type { HTMLAttributes } from 'vue'
import type { ToolCallInfo } from '@/composables/useCaseAnalysis'
import type { ExtendedToolState } from '@/components/ai-elements/types'
import { cn } from '@/lib/utils'

/**
 * 组件属性接口
 */
interface Props {
    /** AI 响应内容（Markdown 格式） */
    content?: string
    /** 推理过程内容 */
    reasoning?: string
    /** 工具调用列表 */
    toolCalls?: ToolCallInfo[]
    /** 是否正在流式输出 */
    isStreaming?: boolean
    /** 推理过程是否正在流式输出 */
    isReasoningStreaming?: boolean
    /** 推理耗时（秒） */
    reasoningDuration?: number
    /** 是否默认展开推理过程 */
    defaultReasoningOpen?: boolean
    /** 是否显示工具调用详情 */
    showToolDetails?: boolean
    /** 自定义类名 */
    class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
    content: '',
    reasoning: '',
    toolCalls: () => [],
    isStreaming: false,
    isReasoningStreaming: false,
    reasoningDuration: undefined,
    defaultReasoningOpen: true,
    showToolDetails: true,
})

/**
 * 是否显示推理过程
 */
const showReasoning = computed(() => {
    return props.reasoning || props.isReasoningStreaming
})

/**
 * 是否显示工具调用
 */
const showToolCalls = computed(() => {
    return props.toolCalls && props.toolCalls.length > 0
})

/**
 * 是否显示内容
 */
const showContent = computed(() => {
    return props.content || props.isStreaming
})

/**
 * 将工具调用状态转换为 ExtendedToolState
 */
function getToolState(status: ToolCallInfo['status']): ExtendedToolState {
    const stateMap: Record<ToolCallInfo['status'], ExtendedToolState> = {
        calling: 'input-available',
        completed: 'output-available',
        error: 'output-error',
    }
    return stateMap[status]
}

/**
 * 获取工具调用的输入参数
 */
function getToolInput(toolCall: ToolCallInfo): Record<string, unknown> | undefined {
    return toolCall.args
}

/**
 * 获取工具调用的输出结果
 */
function getToolOutput(toolCall: ToolCallInfo): unknown {
    return toolCall.result
}

/**
 * 获取工具调用的错误信息
 */
function getToolError(toolCall: ToolCallInfo): string | undefined {
    if (toolCall.status === 'error' && toolCall.result) {
        if (typeof toolCall.result === 'string') {
            return toolCall.result
        }
        if (typeof toolCall.result === 'object' && 'error' in (toolCall.result as object)) {
            return String((toolCall.result as { error: unknown }).error)
        }
    }
    return undefined
}

/**
 * 格式化工具名称为可读标题
 */
function formatToolTitle(toolName: string): string {
    // 将下划线和连字符转换为空格，并首字母大写
    return toolName
        .replace(/[_-]/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase())
}
</script>

<template>
    <div :class="cn('flex flex-col gap-3', props.class)">
        <!-- 推理过程 -->
        <AiElementsReasoningReasoning v-if="showReasoning" :is-streaming="isReasoningStreaming"
            :duration="reasoningDuration" :default-open="defaultReasoningOpen">
            <AiElementsReasoningReasoningTrigger />
            <AiElementsReasoningReasoningContent :content="reasoning" />
        </AiElementsReasoningReasoning>

        <!-- 工具调用列表 -->
        <div v-if="showToolCalls" class="flex flex-col gap-2">
            <AiElementsToolTool v-for="toolCall in toolCalls" :key="toolCall.toolCallId"
                :default-open="showToolDetails && toolCall.status !== 'calling'">
                <AiElementsToolToolHeader :title="formatToolTitle(toolCall.toolName)" type="tool-invocation"
                    :state="getToolState(toolCall.status)" />
                <AiElementsToolToolContent v-if="showToolDetails">
                    <!-- 工具输入参数 -->
                    <AiElementsToolToolInput v-if="getToolInput(toolCall)" :input="getToolInput(toolCall)" />
                    <!-- 工具输出结果 -->
                    <AiElementsToolToolOutput v-if="toolCall.status !== 'calling'" :output="getToolOutput(toolCall)"
                        :error-text="getToolError(toolCall)" />
                </AiElementsToolToolContent>
            </AiElementsToolTool>
        </div>

        <!-- AI 响应内容 -->
        <div v-if="showContent" class="relative">
            <!-- Markdown 渲染内容 -->
            <AiElementsMessageMessageResponse v-if="content" :content="content"
                class="prose prose-sm dark:prose-invert max-w-none" />
            <!-- 流式输出加载状态 -->
            <div v-else-if="isStreaming" class="flex items-center gap-2 text-muted-foreground">
                <AiElementsLoaderLoader :size="14" />
                <span class="text-sm">正在生成...</span>
            </div>
        </div>

        <!-- 空状态：无内容且不在流式输出 -->
        <div v-if="!showReasoning && !showToolCalls && !showContent" class="text-sm text-muted-foreground">
            <slot name="empty">
                <!-- 默认空状态 -->
            </slot>
        </div>
    </div>
</template>
