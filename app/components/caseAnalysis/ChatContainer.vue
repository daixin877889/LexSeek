<script setup lang="ts">
/**
 * 新版案件分析容器（v=2）
 *
 * LangChain BaseMessage → ai-elements parts 适配层
 * 将 useStream 的 BaseMessage[] 转换为旧版 parts 结构渲染
 */
import type { AnalysisResult, PromptSubmitData } from '#shared/types/case'
import { ArrowLeftIcon, Loader2Icon } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { useCaseChat } from '~/composables/useCaseChat'

const props = defineProps<{
    sessionId: string
    thinking?: boolean
}>()

const router = useRouter()

const {
    messages,
    isLoading: isStreaming,
    error: streamError,
    sendMessage,
    stopGeneration,
} = useCaseChat({
    sessionId: props.sessionId,
})

// ─── 适配层：BaseMessage → RenderMessage ───

interface RenderPart {
    type: 'reasoning' | 'text' | 'tool-call' | 'tool-result'
    content?: string
    isStreaming?: boolean
    text?: string
    toolName?: string
    toolArgs?: Record<string, any>
    toolCallId?: string
    toolOutput?: any
}

interface RenderMessage {
    id: string
    role: 'user' | 'assistant'
    parts: RenderPart[]
}

const TOOL_TITLES: Record<string, string> = {
    process_materials: '材料处理',
    extract_case_info: '信息提取',
    search_case_materials: '材料检索',
    search_law: '法律检索',
    reserve_points: '积分预扣',
    confirm_points: '积分确认',
    rollback_points: '积分回滚',
    write_todos: '待办事项',
}

function convertMessages(msgs: any[]): RenderMessage[] {
    if (!msgs?.length) return []
    const result: RenderMessage[] = []

    for (const msg of msgs) {
        const msgType = typeof msg.getType === 'function'
            ? msg.getType()
            : typeof msg._getType === 'function'
                ? msg._getType()
                : msg.type

        // ToolMessage → 合并到上一个 assistant 消息
        if (msgType === 'tool') {
            const toolCallId = msg.tool_call_id
            const lastAssistant = result.findLast(m => m.role === 'assistant')
            if (lastAssistant && toolCallId) {
                const callPart = lastAssistant.parts.find(
                    p => p.type === 'tool-call' && p.toolCallId === toolCallId
                )
                const insertIdx = callPart
                    ? lastAssistant.parts.indexOf(callPart) + 1
                    : lastAssistant.parts.length
                lastAssistant.parts.splice(insertIdx, 0, {
                    type: 'tool-result',
                    toolName: callPart?.toolName,
                    toolCallId,
                    toolOutput: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
                })
            }
            continue
        }

        const role = msgType === 'human' ? 'user' as const : 'assistant' as const
        const parts: RenderPart[] = []
        const content = msg.content

        if (typeof content === 'string') {
            if (content.length > 0) {
                parts.push({ type: 'text', text: content })
            }
        } else if (Array.isArray(content)) {
            for (const block of content) {
                if (block.type === 'text' && block.text) {
                    parts.push({ type: 'text', text: block.text })
                } else if (block.type === 'reasoning' || block.type === 'thinking') {
                    parts.push({
                        type: 'reasoning',
                        content: block.reasoning || block.thinking || '',
                        isStreaming: false,
                    })
                } else if (block.type === 'tool_use' || block.type === 'tool_call') {
                    parts.push({
                        type: 'tool-call',
                        toolName: block.name,
                        toolArgs: block.args || block.input,
                        toolCallId: block.id,
                    })
                }
            }
        }

        // 也处理 msg.tool_calls（AI 消息可能有独立的 tool_calls 数组）
        if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
            for (const tc of msg.tool_calls) {
                if (!parts.some(p => p.toolCallId === tc.id)) {
                    parts.push({
                        type: 'tool-call',
                        toolName: tc.name,
                        toolArgs: tc.args,
                        toolCallId: tc.id,
                    })
                }
            }
        }

        if (parts.length > 0) {
            result.push({
                id: msg.id || String(result.length),
                role,
                parts,
            })
        }
    }

    return result
}

const renderMessages = computed(() => convertMessages(messages.value || []))

function getToolTitle(name?: string): string {
    return name ? (TOOL_TITLES[name] || name) : '工具调用'
}

function tryParseToolOutput(output: any): string {
    if (typeof output !== 'string') return JSON.stringify(output, null, 2)
    try {
        return JSON.stringify(JSON.parse(output), null, 2)
    } catch {
        return output
    }
}

// ─── 页面状态 ───

const isAnalyzing = ref(false)
const isComplete = ref(false)
const thinkingEnabled = ref(props.thinking ?? true)
const analysisResults = ref<AnalysisResult[]>([])
const activeResultIndex = ref(0)
const promptInputRef = ref<{ reset: () => void } | null>(null)

watch(isStreaming, (val) => {
    isAnalyzing.value = val
})

watch(streamError, (err) => {
    if (err) {
        isAnalyzing.value = false
        toast.error('分析失败：' + String(err))
    }
})

async function handlePromptSubmit(data: PromptSubmitData) {
    if (isAnalyzing.value || isComplete.value) return
    isAnalyzing.value = true
    sendMessage(data.text || '开始分析')
    promptInputRef.value?.reset()
}

const goBack = () => router.push({ name: 'dashboard-analysis' })
const handleRegenerate = () => {}
</script>

<template>
    <div class="h-full flex flex-col" style="height: calc(100vh - 48px)">
        <!-- Header -->
        <div class="h-12 shrink-0 border-b bg-muted/30 text-base font-semibold flex items-center px-4 gap-2">
            <Button variant="ghost" size="icon" class="size-8" @click="goBack">
                <ArrowLeftIcon class="size-4" />
            </Button>
            <div class="flex-1 truncate">案件分析</div>
            <Badge variant="outline" class="text-xs">新版</Badge>
        </div>

        <!-- 主内容区域：左右分栏 -->
        <ResizablePanelGroup direction="horizontal" class="flex-1 min-h-0">
            <!-- 左侧：对话 -->
            <ResizablePanel :default-size="50" :min-size="30" class="bg-muted/20">
                <div class="flex flex-col h-full overflow-hidden">
                    <div class="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
                        <AiElementsConversation>
                            <AiElementsConversationContent>
                                <template v-for="msg in renderMessages" :key="msg.id">
                                    <template v-for="(part, i) in msg.parts" :key="msg.id + ':' + i">
                                        <AiElementsMessage :from="msg.role">

                                            <!-- 思考过程 -->
                                            <AiElementsReasoning
                                                v-if="part.type === 'reasoning'"
                                                :is-streaming="part.isStreaming ?? false"
                                            >
                                                <AiElementsReasoningTrigger />
                                                <AiElementsReasoningContent :content="part.content || ''" />
                                            </AiElementsReasoning>

                                            <!-- 文本消息 -->
                                            <AiElementsMessageContent v-else-if="part.type === 'text'">
                                                <AiElementsMessageResponse :content="part.text || ''" />
                                            </AiElementsMessageContent>

                                            <!-- 工具调用 -->
                                            <AiElementsTool v-else-if="part.type === 'tool-call'">
                                                <AiElementsToolHeader
                                                    state="call"
                                                    :title="getToolTitle(part.toolName)"
                                                    :type="`tool-${part.toolName}`"
                                                />
                                                <AiElementsToolContent v-if="part.toolArgs">
                                                    <AiElementsToolInput>
                                                        <pre class="text-xs whitespace-pre-wrap">{{ JSON.stringify(part.toolArgs, null, 2) }}</pre>
                                                    </AiElementsToolInput>
                                                </AiElementsToolContent>
                                            </AiElementsTool>

                                            <!-- 工具结果 -->
                                            <AiElementsTool v-else-if="part.type === 'tool-result'">
                                                <AiElementsToolHeader
                                                    state="result"
                                                    :title="getToolTitle(part.toolName)"
                                                    :type="`tool-${part.toolName}`"
                                                />
                                                <AiElementsToolContent>
                                                    <AiElementsToolOutput>
                                                        <pre class="text-xs whitespace-pre-wrap max-h-60 overflow-y-auto">{{ tryParseToolOutput(part.toolOutput) }}</pre>
                                                    </AiElementsToolOutput>
                                                </AiElementsToolContent>
                                            </AiElementsTool>

                                        </AiElementsMessage>
                                    </template>
                                </template>
                            </AiElementsConversationContent>
                            <AiElementsConversationScrollButton />
                        </AiElementsConversation>

                        <!-- 空状态 -->
                        <div v-if="!renderMessages.length && !isAnalyzing" class="flex items-center justify-center h-full text-muted-foreground text-sm">
                            输入案情开始分析
                        </div>
                    </div>

                    <!-- 输入区域 -->
                    <div class="shrink-0 border-t bg-background">
                        <CaseAnalysisPromptInput
                            ref="promptInputRef"
                            v-model:thinking="thinkingEnabled"
                            placeholder="输入补充信息或问题..."
                            submit-label="发送"
                            :loading="isAnalyzing"
                            :disabled="isComplete"
                            :enable-watcher="false"
                            :min-rows="1"
                            :max-rows="4"
                            @submit="handlePromptSubmit"
                        />
                        <div v-if="isAnalyzing" class="flex items-center justify-center pb-2">
                            <Loader2Icon class="size-4 animate-spin text-primary mr-2" />
                            <span class="text-xs text-muted-foreground">AI 正在分析中...</span>
                        </div>
                    </div>
                </div>
            </ResizablePanel>

            <ResizableHandle with-handle />

            <!-- 右侧：分析结果 -->
            <ResizablePanel :default-size="50" :min-size="30">
                <CaseAnalysisResults
                    :results="analysisResults"
                    v-model:active-index="activeResultIndex"
                    :show-regenerate="true"
                    :show-copy="true"
                    :is-analyzing="isAnalyzing"
                    class="h-full"
                    @regenerate="handleRegenerate"
                />
            </ResizablePanel>
        </ResizablePanelGroup>
    </div>
</template>
