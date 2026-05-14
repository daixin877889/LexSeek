<script setup lang="ts">
/**
 * 更新文书草稿工具结果卡片
 *
 * 由通用问答 / 小索 / 文书面板通过 AiToolRenderer.toolMap 注入。
 * update_document_draft 工具调用 patchDraftService 增量改字段并发 DRAFT_UPDATED SSE。
 *
 * 跟 RecommendTemplateCard / DraftDocumentCard 同理:历史会话回放兜底 + 让用户
 * 一眼看到"AI 改了哪些字段"而非干巴巴的 toolName。
 *
 * 状态:
 * - 执行中:spinner + "正在更新文书字段..."
 * - 已完成:CheckCircle2 + "已更新 N 个字段" + 字段名列表
 * - 失败:XCircle + 错误信息
 * - 兜底:"等待开始..."
 */
import {
    CheckCircle2,
    FileEdit,
    FilePenLine,
    Loader2,
    XCircle,
} from 'lucide-vue-next'
import { Button } from '~/components/ui/button'
import type { ExtendedToolState } from '~/components/ai-elements/types'
import { useToolResultState } from '~/composables/useToolResultState'

interface UpdateDocumentDraftInput {
    draftId?: number
    fieldUpdates?: Record<string, string | null>
}

interface UpdateDocumentDraftOutput {
    success?: boolean
    error?: string
    draftId?: number
    changedFields?: string[]
    summary?: string
    href?: string
}

const props = defineProps<{
    toolName: string
    input?: UpdateDocumentDraftInput | any
    output?: UpdateDocumentDraftOutput | string | null
    state: ExtendedToolState
}>()

const { result, isRunning, isFailed, isCompleted } = useToolResultState<UpdateDocumentDraftOutput>(props)

const changedFields = computed(() => result.value?.changedFields ?? [])

const completedTitle = computed(() => {
    const n = changedFields.value.length
    if (n === 0) return '未发现需要更新的字段'
    return `已更新 ${n} 个字段`
})

const fieldListText = computed(() => {
    if (!changedFields.value.length) return ''
    return changedFields.value.join('、')
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
                <p class="truncate text-sm font-medium text-foreground">更新文书</p>
                <p class="mt-0.5 truncate text-xs text-primary">正在更新文书字段...</p>
            </div>
        </div>

        <!-- 失败 -->
        <div v-else-if="isFailed" class="flex items-start gap-3">
            <div class="flex size-10 shrink-0 items-center justify-center rounded-md bg-destructive/10">
                <XCircle class="size-5 text-destructive" />
            </div>
            <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-foreground">更新失败</p>
                <p class="mt-0.5 text-xs text-destructive">
                    {{ result?.error || '更新过程中出现错误，请稍后重试' }}
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
                    <p class="truncate text-sm font-medium text-foreground">{{ completedTitle }}</p>
                    <p v-if="fieldListText" class="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        {{ fieldListText }}
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

        <!-- 兜底 -->
        <div v-else class="flex items-center gap-3">
            <div class="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
                <FilePenLine class="size-5 text-muted-foreground" />
            </div>
            <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-foreground">更新文书</p>
                <p class="mt-0.5 truncate text-xs text-muted-foreground">等待开始...</p>
            </div>
        </div>
    </div>
</template>
