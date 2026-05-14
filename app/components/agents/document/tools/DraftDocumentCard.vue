<script setup lang="ts">
/**
 * 文书起草工具结果卡片（Mockup D）
 *
 * 由通用问答 chat panel 通过 AiToolRenderer.toolMap 注入。
 * - 执行中：spinner + "正在起草《XXX》..."
 * - 已完成：标题（书名号包裹的文书名）+ 字数 / 摘要 + 跳转按钮
 * - 失败：红色边框 + 错误信息
 */
import {
    CheckCircle2,
    FileEdit,
    FileText,
    Loader2,
    XCircle,
} from 'lucide-vue-next'
import { Button } from '~/components/ui/button'
import type { ExtendedToolState } from '~/components/ai-elements/types'

interface DraftDocumentInput {
    intent?: string
    keywords?: string[]
    category?: string
}

interface DraftDocumentOutput {
    success?: boolean
    error?: string
    draftId?: number
    title?: string
    summary?: string
    wordCount?: number
    href?: string
}

const props = defineProps<{
    toolName: string
    input?: DraftDocumentInput | any
    output?: DraftDocumentOutput | string | null
    state: ExtendedToolState
}>()

const result = computed<DraftDocumentOutput | null>(() => {
    const raw = props.output
    if (raw == null) return null
    if (typeof raw === 'string') {
        try { return JSON.parse(raw) as DraftDocumentOutput } catch { return null }
    }
    if (typeof raw === 'object') return raw as DraftDocumentOutput
    return null
})

const isRunning = computed(() =>
    props.state === 'input-streaming' || props.state === 'input-available',
)

const isFailed = computed(() => {
    if (props.state === 'output-error' || props.state === 'output-denied') return true
    if (result.value?.success === false) return true
    // 工具进入终态（output-available）但 result 为空 → 视为失败兜底
    // 例：stream 顶层错误让 toolPart 跳过工具体直接终结
    if (props.state === 'output-available' && !result.value) return true
    return false
})

const isCompleted = computed(() => !isRunning.value && !isFailed.value && !!result.value)

const draftTitle = computed(() => result.value?.title?.trim() || '文书')

const summary = computed(() => result.value?.summary?.trim() || '')

const wordCountText = computed(() => {
    const n = result.value?.wordCount
    if (typeof n === 'number' && n > 0) return `字数 ${n.toLocaleString()}`
    return ''
})

const runningText = computed(() => {
    const intent = props.input?.intent
    if (intent) return `正在起草《${intent}》...`
    return '正在起草文书...'
})

function handleOpen() {
    const href = result.value?.href
    if (!href) return
    navigateTo(href)
}
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
                <p class="truncate text-sm font-medium text-foreground">起草文书</p>
                <p class="mt-0.5 truncate text-xs text-primary">{{ runningText }}</p>
            </div>
        </div>

        <!-- 失败 -->
        <div v-else-if="isFailed" class="flex items-start gap-3">
            <div class="flex size-10 shrink-0 items-center justify-center rounded-md bg-destructive/10">
                <XCircle class="size-5 text-destructive" />
            </div>
            <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-foreground">起草失败</p>
                <p class="mt-0.5 text-xs text-destructive">
                    {{ result?.error || '起草过程中出现错误，请稍后重试' }}
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
                    <p class="truncate text-sm font-medium text-foreground">
                        已完成起草《{{ draftTitle }}》
                    </p>
                    <p v-if="wordCountText || summary" class="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        <span v-if="wordCountText">{{ wordCountText }}</span>
                        <span v-if="wordCountText && summary"> · </span>
                        <span v-if="summary">摘要：{{ summary }}</span>
                    </p>
                </div>
            </div>

            <Button
                v-if="result?.href"
                size="sm"
                variant="outline"
                class="w-full"
                @click="handleOpen"
            >
                <FileEdit class="mr-1.5 size-3.5" />
                在文书页继续编辑
            </Button>
        </div>

        <!-- 兜底：默认占位（无 output 也无运行中状态） -->
        <div v-else class="flex items-center gap-3">
            <div class="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
                <FileText class="size-5 text-muted-foreground" />
            </div>
            <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-foreground">起草文书</p>
                <p class="mt-0.5 truncate text-xs text-muted-foreground">等待开始...</p>
            </div>
        </div>
    </div>
</template>
