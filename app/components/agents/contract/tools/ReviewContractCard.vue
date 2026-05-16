<script setup lang="ts">
/**
 * 合同审查工具结果卡片（Mockup C）
 *
 * 由通用问答 chat panel 通过 AiToolRenderer.toolMap 注入。
 * - 执行中：spinner + "正在分析合同..."
 * - 已完成：合同名 + 甲乙方 + 风险统计（高/中/低）+ Top 3 风险 + 跳转按钮
 * - 失败：红色边框 + 错误信息
 */
import {
    AlertTriangle,
    CheckCircle2,
    ExternalLink,
    FileSearch,
    FileText,
    Loader2,
    XCircle,
} from 'lucide-vue-next'
import { Button } from '~/components/ui/button'
import type { ExtendedToolState } from '~/components/ai-elements/types'

interface ReviewContractInput {
    ossFileId?: number
    fileName?: string
    partyAHint?: string
    partyBHint?: string
}

interface ReviewContractOutput {
    success?: boolean
    error?: string
    reviewId?: number
    fileName?: string
    partyA?: string
    partyB?: string
    /** 风险统计：{ high: 2, medium: 3, low: 1 } */
    riskStats?: {
        high?: number
        medium?: number
        low?: number
    }
    /** Top 风险条款（最多 3 个） */
    topRisks?: Array<{ title?: string; level?: 'high' | 'medium' | 'low' }>
    href?: string
}

const props = defineProps<{
    toolName: string
    input?: ReviewContractInput | any
    output?: ReviewContractOutput | string | null
    state: ExtendedToolState
}>()

const result = computed<ReviewContractOutput | null>(() => {
    const raw = props.output
    if (raw == null) return null
    if (typeof raw === 'string') {
        try { return JSON.parse(raw) as ReviewContractOutput } catch { return null }
    }
    if (typeof raw === 'object') return raw as ReviewContractOutput
    return null
})

const isRunning = computed(() =>
    props.state === 'input-streaming' || props.state === 'input-available',
)

const isFailed = computed(() => {
    if (props.state === 'output-error' || props.state === 'output-denied') return true
    if (result.value?.success === false) return true
    // 工具进入终态（output-available）但 result 为空 → 视为失败兜底
    // 例：stream 顶层错误（如 LLM input 不符 zod schema）让 toolPart 跳过工具体直接终结
    if (props.state === 'output-available' && !result.value) return true
    return false
})

const isCompleted = computed(() => !isRunning.value && !isFailed.value && !!result.value)

const fileName = computed(() => result.value?.fileName || props.input?.fileName || '合同文件')

const partyText = computed(() => {
    const a = result.value?.partyA?.trim()
    const b = result.value?.partyB?.trim()
    if (!a && !b) return ''
    return `甲方：${a || '未指定'} / 乙方：${b || '未指定'}`
})

const stats = computed(() => result.value?.riskStats ?? {})
const hasStats = computed(() => {
    const s = stats.value
    return (s.high || 0) + (s.medium || 0) + (s.low || 0) > 0
})

const topRisks = computed(() => (result.value?.topRisks ?? []).slice(0, 3))

function handleOpen() {
    const href = result.value?.href
    if (!href) return
    navigateTo(href)
}
</script>

<template>
    <div
        class="not-prose group my-2 w-full max-w-md rounded-lg border bg-card p-4 transition-colors"
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
                <p class="truncate text-sm font-medium text-foreground">合同审查</p>
                <p class="mt-0.5 truncate text-xs text-primary">正在分析合同...</p>
            </div>
        </div>

        <!-- 失败 -->
        <div v-else-if="isFailed" class="flex items-start gap-3">
            <div class="flex size-10 shrink-0 items-center justify-center rounded-md bg-destructive/10">
                <XCircle class="size-5 text-destructive" />
            </div>
            <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-foreground">审查失败</p>
                <p class="mt-0.5 text-xs text-destructive">
                    {{ result?.error || '审查过程中出现错误，请稍后重试' }}
                </p>
            </div>
        </div>

        <!-- 已完成 -->
        <div v-else-if="isCompleted" class="space-y-3">
            <div class="flex items-start gap-3">
                <div class="flex size-10 shrink-0 items-center justify-center rounded-md bg-emerald-100 dark:bg-emerald-900/30">
                    <CheckCircle2 class="size-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div class="min-w-0 flex-1">
                    <p class="truncate text-sm font-medium text-foreground" :title="fileName">
                        已完成审查 {{ fileName }}
                    </p>
                    <p v-if="partyText" class="mt-0.5 truncate text-xs text-muted-foreground">
                        {{ partyText }}
                    </p>
                </div>
            </div>

            <!-- 风险统计 -->
            <div v-if="hasStats" class="flex items-center gap-2 rounded-md bg-muted/40 px-3 py-2 text-xs">
                <AlertTriangle class="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                <span class="text-muted-foreground">风险：</span>
                <span class="font-medium text-red-600 dark:text-red-400">高 {{ stats.high || 0 }}</span>
                <span class="text-muted-foreground">/</span>
                <span class="font-medium text-amber-600 dark:text-amber-400">中 {{ stats.medium || 0 }}</span>
                <span class="text-muted-foreground">/</span>
                <span class="font-medium text-sky-600 dark:text-sky-400">低 {{ stats.low || 0 }}</span>
            </div>

            <!-- Top 风险条款 -->
            <div v-if="topRisks.length" class="space-y-1">
                <p class="text-xs text-muted-foreground">Top 风险</p>
                <ol class="list-decimal pl-5 text-xs text-foreground space-y-0.5">
                    <li v-for="(r, idx) in topRisks" :key="idx" class="line-clamp-1">
                        {{ r.title || `风险 ${idx + 1}` }}
                    </li>
                </ol>
            </div>

            <Button
                v-if="result?.href"
                size="sm"
                variant="outline"
                class="w-full"
                @click="handleOpen"
            >
                <ExternalLink class="mr-1.5 size-3.5" />
                打开合同审查工作台
            </Button>
        </div>

        <!-- 兜底 -->
        <div v-else class="flex items-center gap-3">
            <div class="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
                <FileSearch class="size-5 text-muted-foreground" />
            </div>
            <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-foreground">合同审查</p>
                <p class="mt-0.5 truncate text-xs text-muted-foreground">等待开始...</p>
            </div>
        </div>
    </div>
</template>
