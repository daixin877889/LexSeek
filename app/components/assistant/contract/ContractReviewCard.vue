<script setup lang="ts">
/**
 * 合同审查 · 单条审查记录卡片
 *
 * 整卡可点击跳转审查详情；右侧删除按钮 emit delete(review)。
 */
import { computed } from 'vue'
import { FileText, Trash2Icon } from 'lucide-vue-next'
import type { ReviewListItem } from '#shared/types/contract'
import { REVIEW_STATUS_LABEL } from '#shared/types/contract'

const props = defineProps<{ review: ReviewListItem }>()
const emit = defineEmits<{ delete: [review: ReviewListItem] }>()

// 状态徽章配色（与列表页历史实现保持一致）
const STATUS_CLASS: Record<string, string> = {
    pending: 'bg-muted text-muted-foreground',
    reviewing: 'bg-primary/15 text-primary dark:bg-primary/20',
    awaiting_stance: 'bg-primary/15 text-primary dark:bg-primary/20',
    rebuilding: 'bg-primary/15 text-primary dark:bg-primary/20',
    completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200',
    failed: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200',
}

const statusLabel = computed(
    () => (REVIEW_STATUS_LABEL as Record<string, string>)[props.review.status] ?? props.review.status,
)
const statusClass = computed(
    () => STATUS_CLASS[props.review.status] ?? 'bg-muted text-muted-foreground',
)

function formatDate(value: string | Date): string {
    const d = typeof value === 'string' ? new Date(value) : value
    if (Number.isNaN(d.getTime())) return ''
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const isToday = d.toDateString() === now.toDateString()
    const yesterday = new Date(now)
    yesterday.setDate(now.getDate() - 1)
    const isYesterday = d.toDateString() === yesterday.toDateString()
    if (isToday) return `今天 ${pad(d.getHours())}:${pad(d.getMinutes())}`
    if (isYesterday) return `昨天 ${pad(d.getHours())}:${pad(d.getMinutes())}`
    if (d.getFullYear() === now.getFullYear()) return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
</script>

<template>
    <NuxtLink :to="`/dashboard/contract/${review.id}`"
        class="group flex items-center gap-3.5 rounded-xl border bg-card p-3.5 transition-all hover:border-primary/50 hover:shadow-md md:p-4">
        <!-- 文件图标 -->
        <div class="flex size-11 shrink-0 items-center justify-center rounded-[11px] [background-image:var(--tint-navy-bg)] text-[var(--tint-navy-fg)]">
            <FileText class="size-5" />
        </div>

        <!-- 主体 -->
        <div class="min-w-0 flex-1 space-y-1">
            <div class="flex items-center gap-2.5">
                <span class="truncate text-sm font-semibold transition-colors group-hover:text-primary"
                    :title="review.originalFileName ?? ''">
                    {{ review.originalFileName ?? '未命名合同' }}
                </span>
                <span :class="['inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[11px] font-medium', statusClass]">
                    {{ statusLabel }}
                </span>
            </div>
            <div class="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground">
                <span>{{ review.contractType ?? '未识别类型' }}</span>
                <span aria-hidden="true">·</span>
                <span v-if="review.totalRiskCount > 0" class="inline-flex items-center gap-1.5">
                    <span v-if="review.highRiskCount > 0" class="font-semibold text-rose-500">
                        {{ review.highRiskCount }} 高
                    </span>
                    <span v-if="review.mediumRiskCount > 0" class="font-medium text-amber-500">
                        {{ review.mediumRiskCount }} 中
                    </span>
                </span>
                <span v-else>暂无风险</span>
                <span aria-hidden="true">·</span>
                <span>{{ formatDate(review.createdAt) }}</span>
                <template v-if="review.caseId">
                    <span aria-hidden="true">·</span>
                    <span>归属案件 #{{ review.caseId }}</span>
                </template>
            </div>
        </div>

        <!-- 删除：桌面 hover 显现 / 移动端常显 -->
        <button type="button"
            class="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-destructive md:opacity-0 md:group-hover:opacity-100"
            aria-label="删除审查"
            @click.stop.prevent="emit('delete', review)">
            <Trash2Icon class="size-4" />
        </button>
    </NuxtLink>
</template>
