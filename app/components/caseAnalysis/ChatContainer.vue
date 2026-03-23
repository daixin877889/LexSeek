<script setup lang="ts">
/**
 * 新版案件分析容器（v=2）
 *
 * 复用旧版布局（Header + 左右分栏 + PromptInput），
 * 数据源从 ai-sdk Chat 切换为 useCaseChat（@langchain/vue useStream）
 */
import type { AnalysisResult, PromptSubmitData } from '#shared/types/case'
import { ArrowLeftIcon, Loader2Icon, AlertCircleIcon } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { useCaseChat } from '~/composables/useCaseChat'

const props = defineProps<{
    sessionId: string
    thinking?: boolean
}>()

const router = useRouter()

// 新版数据源
const thinkingEnabled = ref(props.thinking ?? true)
const {
    messages,
    isLoading: isStreaming,
    error: streamError,
    sendMessage,
    stopGeneration,
} = useCaseChat({
    sessionId: props.sessionId,
    thinking: thinkingEnabled.value,
})

// 页面状态（复用旧版逻辑）
const isLoading = ref(false)
const loadError = ref<string | null>(null)
const isAnalyzing = ref(false)
const isComplete = ref(false)
const analysisResults = ref<AnalysisResult[]>([])
const activeResultIndex = ref(0)
const promptInputRef = ref<{ reset: () => void } | null>(null)

// 同步 streaming 状态到 isAnalyzing
watch(isStreaming, (val) => {
    isAnalyzing.value = val
})

// 调试：监控 messages 变化
watch(messages, (msgs) => {
    console.log('[ChatContainer] messages 更新:', {
        count: msgs?.length ?? 0,
        isRef: isRef(messages),
        isComputed: isReadonly(messages),
        raw: msgs?.slice(0, 2).map((m: any) => ({
            type: typeof m,
            hasGetType: typeof m?.getType === 'function',
            has_getType: typeof m?._getType === 'function',
            id: m?.id,
            content: typeof m?.content === 'string' ? m.content.substring(0, 50) : typeof m?.content,
        })),
    })
}, { deep: true, immediate: true })

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

function getStatusText(status: number): string {
    const statusMap: Record<number, string> = { 1: '进行中', 2: '已完成', 3: '已关闭' }
    return statusMap[status] || '未知'
}

const goBack = () => router.push({ name: 'dashboard-analysis' })
const handleRegenerate = () => {}
const loadCaseInfo = () => {}
</script>

<template>
    <div class="h-full flex flex-col" style="height: calc(100vh - 48px)">
        <!-- Header 区域 -->
        <div class="h-12 shrink-0 border-b bg-muted/30 text-base font-semibold flex items-center px-4 gap-2">
            <Button variant="ghost" size="icon" class="size-8" @click="goBack">
                <ArrowLeftIcon class="size-4" />
            </Button>
            <div class="flex-1 truncate">案件分析</div>
            <Badge variant="outline" class="text-xs">新版</Badge>
        </div>

        <!-- 加载状态 -->
        <div v-if="isLoading" class="flex-1 flex items-center justify-center">
            <div class="flex flex-col items-center gap-3">
                <Loader2Icon class="size-8 animate-spin text-primary" />
                <span class="text-sm text-muted-foreground">加载案件信息...</span>
            </div>
        </div>

        <!-- 错误状态 -->
        <div v-else-if="loadError" class="flex-1 flex items-center justify-center">
            <div class="flex flex-col items-center gap-3 text-center">
                <AlertCircleIcon class="size-12 text-destructive" />
                <p class="text-sm text-muted-foreground">{{ loadError }}</p>
                <Button variant="outline" size="sm" @click="loadCaseInfo">
                    重新加载
                </Button>
            </div>
        </div>

        <!-- 主内容区域：左右分栏 -->
        <ResizablePanelGroup v-else direction="horizontal" class="flex-1 min-h-0">
            <!-- 左侧面板：对话区域 -->
            <ResizablePanel :default-size="50" :min-size="30" class="bg-muted/20">
                <div class="flex flex-col h-full overflow-hidden">
                    <!-- 对话消息列表 -->
                    <div class="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
                        <AiElementsConversation>
                            <AiElementsConversationContent>
                                <template v-for="msg in messages" :key="msg.id">
                                    <AiElementsMessage
                                        :from="msg._getType?.() === 'human' ? 'user' : 'assistant'"
                                    >
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
                    </div>

                    <!-- 底部输入区域 -->
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

            <!-- 右侧面板：分析结果 -->
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
