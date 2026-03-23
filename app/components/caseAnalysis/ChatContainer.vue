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

const {
    messages,
    isLoading: isStreaming,
    error: streamError,
    sendMessage,
    stopGeneration,
} = useCaseChat({
    sessionId: props.sessionId,
})

// 页面状态
const isLoading = ref(false)
const loadError = ref<string | null>(null)
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

/** 提取消息文本内容（兼容 string 和 content block 数组） */
function getMessageText(msg: any): string {
    const content = msg?.content
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
        return content
            .filter((block: any) => block.type === 'text')
            .map((block: any) => block.text)
            .join('')
    }
    return ''
}

/** 获取消息角色 */
function getMessageRole(msg: any): 'user' | 'assistant' {
    if (typeof msg?.getType === 'function') {
        return msg.getType() === 'human' ? 'user' : 'assistant'
    }
    if (typeof msg?._getType === 'function') {
        return msg._getType() === 'human' ? 'user' : 'assistant'
    }
    return 'assistant'
}

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

        <!-- 加载状态 -->
        <div v-if="isLoading" class="flex-1 flex items-center justify-center">
            <Loader2Icon class="size-8 animate-spin text-primary" />
        </div>

        <!-- 主内容区域：左右分栏 -->
        <ResizablePanelGroup v-else direction="horizontal" class="flex-1 min-h-0">
            <!-- 左侧：对话 -->
            <ResizablePanel :default-size="50" :min-size="30" class="bg-muted/20">
                <div class="flex flex-col h-full overflow-hidden">
                    <div class="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
                        <AiElementsConversation>
                            <AiElementsConversationContent>
                                <template v-for="msg in messages" :key="msg.id">
                                    <AiElementsMessage :from="getMessageRole(msg)">
                                        <AiElementsMessageContent>
                                            <AiElementsMessageResponse
                                                :content="getMessageText(msg)"
                                            />
                                        </AiElementsMessageContent>
                                    </AiElementsMessage>
                                </template>
                            </AiElementsConversationContent>
                            <AiElementsConversationScrollButton />
                        </AiElementsConversation>
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
