<script setup lang="ts">
import type { ExtendedToolState } from '@/components/ai-elements/types'
import {
    BookOpenText,
    CheckCircle2,
    Loader2,
    Sparkles,
    XCircle,
} from 'lucide-vue-next'

/**
 * 生成结果摘要 工具卡片（合成卡片）
 *
 * 视觉与 SaveAnalysisResultTool 同款 FileCard 风格，紧跟在 save_analysis_result 卡片之后渲染。
 *
 * 触发方式：不是 LLM 主动调用的真实工具，而是 saveAnalysisResult 工具内部 await
 * completeAnalysisWithRAG 期间 emit 的 ANALYSIS_SUMMARY SSE 事件，前端 useStreamChat
 * 拦截后注入到 AIMessage.toolCalls 末尾形成的合成卡片。摘要本身是真实生成
 * （200-400 字 LLM 摘要 + embedding 切块）。
 */
interface SummaryOutput {
    success?: boolean
    summary?: string
    error?: string
}

const props = defineProps<{
    toolName: string
    input?: { analysisId?: number } | any
    output?: any
    state: ExtendedToolState
}>()

const result = computed<SummaryOutput | null>(() => {
    const raw = props.output
    if (raw == null) return null
    if (typeof raw === 'string') {
        try { return JSON.parse(raw) } catch { return null }
    }
    if (typeof raw === 'object') return raw as SummaryOutput
    return null
})

const isRunning = computed(() =>
    props.state === 'input-streaming' || props.state === 'input-available',
)

const isFailed = computed(() => {
    if (props.state === 'output-error') return true
    return result.value?.success === false
})

const title = computed<string>(() => {
    if (isRunning.value) return '生成结果摘要'
    if (isFailed.value) return '摘要生成失败'
    return '结果摘要已生成'
})

const subtitle = computed<string>(() => {
    if (isRunning.value) return '正在生成结果摘要…'
    if (isFailed.value) return result.value?.error || '生成摘要失败，分析结果已保存但 RAG 检索可能不可用'

    const summary = result.value?.summary
    if (summary && summary.trim()) {
        // 摘要前 60 字预览（保持一行展示，FileCard 副标题 truncate 兜底）
        const preview = summary.replace(/\s+/g, ' ').slice(0, 60)
        return preview.length < summary.length ? `${preview}…` : preview
    }
    return '已生成 200-400 字摘要并写入索引'
})
</script>

<template>
    <div
        class="not-prose group my-2 inline-flex w-full max-w-sm items-center gap-3 rounded-lg border bg-card px-3 py-2.5 transition-colors"
        :class="[
            isRunning && 'border-primary/40 bg-primary/5',
            isFailed && 'border-destructive/40 bg-destructive/5',
            !isRunning && !isFailed && 'hover:border-border hover:bg-muted/30',
        ]"
    >
        <!-- 左侧图标方块：运行中 spinner / 失败红 X / 默认 Sparkles（已生成） / 默认 BookOpenText（待开始） -->
        <div
            class="flex size-10 shrink-0 items-center justify-center rounded-md"
            :class="isFailed ? 'bg-destructive/10' : 'bg-primary/10'"
        >
            <Loader2 v-if="isRunning" class="size-5 animate-spin text-primary" />
            <XCircle v-else-if="isFailed" class="size-5 text-destructive" />
            <Sparkles v-else-if="state === 'output-available'" class="size-5 text-primary" />
            <BookOpenText v-else class="size-5 text-primary" />
        </div>

        <!-- 主信息：标题 + 副标题 -->
        <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-foreground" :title="title">
                {{ title }}
            </p>
            <p
                class="mt-0.5 truncate text-xs"
                :class="[
                    isRunning && 'text-primary',
                    isFailed && 'text-destructive',
                    !isRunning && !isFailed && 'text-muted-foreground',
                ]"
                :title="subtitle"
            >
                {{ subtitle }}
            </p>
        </div>

        <!-- 右侧状态小图标（运行中由左侧 spinner 表达） -->
        <CheckCircle2
            v-if="state === 'output-available' && !isFailed"
            class="size-4 shrink-0 text-green-500"
        />
        <XCircle
            v-else-if="state === 'output-error' || isFailed"
            class="size-4 shrink-0 text-destructive"
        />
    </div>
</template>
