<script setup lang="ts">
/**
 * 模板推荐工具结果卡片
 *
 * 由通用问答 / 小索 / 文书面板通过 AiToolRenderer.toolMap 注入。
 * recommend_template 工具走 LangGraph interrupt 弹 TemplateSelectCard 让用户挑模板,
 * 选完之后工具返回 templateId/templateName/placeholders 给 LLM。
 *
 * 历史会话刷新后 resolvedInterrupts 清空 → TemplateSelectCard 不再以 snapshot
 * 渲染,所以本卡片承担"已选模板"的可视化兜底,逻辑与 DraftDocumentCard 一致。
 *
 * 状态:
 * - 执行中:spinner + "正在为你推荐模板..."
 * - 已完成:CheckCircle2 + "已选择模板《XXX》" + 类别 / 字段数副文案
 * - 取消:XCircle muted + "已取消模板选择"
 * - 失败:XCircle 红 + 错误信息
 */
import {
    CheckCircle2,
    FileSearch,
    Loader2,
    XCircle,
} from 'lucide-vue-next'
import type { ExtendedToolState } from '~/components/ai-elements/types'
import { useToolResultState } from '~/composables/useToolResultState'

interface RecommendTemplateInput {
    intent?: string
    keywords?: string[]
    category?: string
}

interface RecommendTemplateOutput {
    success?: boolean
    cancelled?: boolean
    error?: string
    message?: string
    templateId?: number
    templateName?: string
    templateCategory?: string | null
    placeholders?: Array<{ name: string; firstContext?: string | null }>
}

const props = defineProps<{
    toolName: string
    input?: RecommendTemplateInput | any
    output?: RecommendTemplateOutput | string | null
    state: ExtendedToolState
}>()

const { result, isRunning, isFailed: rawFailed, isCompleted: rawCompleted } = useToolResultState<RecommendTemplateOutput>(props)

// recommend_template 通过 result.cancelled === true 区分"用户取消"与"工具失败",
// 取消优先于失败/完成,使用单独的 isCancelled 派生
const isCancelled = computed(() => result.value?.cancelled === true)
const isFailed = computed(() => !isCancelled.value && rawFailed.value)
const isCompleted = computed(() => !isCancelled.value && rawCompleted.value)

const templateName = computed(() => result.value?.templateName?.trim() || '模板')

const placeholderCount = computed(() => result.value?.placeholders?.length ?? 0)

const subText = computed(() => {
    const parts: string[] = []
    if (result.value?.templateCategory) parts.push(`类别：${result.value.templateCategory}`)
    if (placeholderCount.value > 0) parts.push(`${placeholderCount.value} 个字段待填`)
    return parts.join(' · ')
})

const runningText = computed(() => {
    const intent = props.input?.intent
    if (intent) return `正在为《${intent}》匹配模板...`
    return '正在为你推荐模板...'
})
</script>

<template>
    <div
        class="not-prose group my-2 w-full max-w-md rounded-lg border bg-card p-4 shadow-sm transition-colors"
        :class="[
            isRunning && 'border-primary/40 bg-primary/5',
            isFailed && 'border-destructive/40 bg-destructive/5',
        ]"
    >
        <!-- 执行中 -->
        <div v-if="isRunning" class="flex items-center gap-3">
            <div class="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10">
                <Loader2 class="size-5 animate-spin text-primary" />
            </div>
            <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-foreground">推荐模板</p>
                <p class="mt-0.5 truncate text-xs text-primary">{{ runningText }}</p>
            </div>
        </div>

        <!-- 失败 -->
        <div v-else-if="isFailed" class="flex items-start gap-3">
            <div class="flex size-10 shrink-0 items-center justify-center rounded-md bg-destructive/10">
                <XCircle class="size-5 text-destructive" />
            </div>
            <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-foreground">推荐失败</p>
                <p class="mt-0.5 text-xs text-destructive">
                    {{ result?.error || '推荐过程中出现错误，请稍后重试' }}
                </p>
            </div>
        </div>

        <!-- 已取消 -->
        <div v-else-if="isCancelled" class="flex items-start gap-3">
            <div class="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
                <XCircle class="size-5 text-muted-foreground" />
            </div>
            <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-foreground">已取消模板选择</p>
                <p class="mt-0.5 truncate text-xs text-muted-foreground">
                    {{ result?.message || '可重新提出起草需求' }}
                </p>
            </div>
        </div>

        <!-- 已完成 -->
        <div v-else-if="isCompleted" class="flex items-start gap-3">
            <div class="flex size-10 shrink-0 items-center justify-center rounded-md bg-emerald-100 dark:bg-emerald-900/30">
                <CheckCircle2 class="size-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-foreground">
                    已选择模板《{{ templateName }}》
                </p>
                <p v-if="subText" class="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                    {{ subText }}
                </p>
            </div>
        </div>

        <!-- 兜底：默认占位（无 output 也无运行中状态） -->
        <div v-else class="flex items-center gap-3">
            <div class="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
                <FileSearch class="size-5 text-muted-foreground" />
            </div>
            <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-foreground">推荐模板</p>
                <p class="mt-0.5 truncate text-xs text-muted-foreground">等待开始...</p>
            </div>
        </div>
    </div>
</template>
