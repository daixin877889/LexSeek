<script setup lang="ts">
import { FileEditIcon, Trash2Icon } from 'lucide-vue-next'
import type { DraftRow } from '#shared/types/document'

defineProps<{
    items: DraftRow[]
    viewMode: 'grid' | 'list'
    showDelete?: boolean
}>()

const emit = defineEmits<{
    /** 删除成功后触发，父级据此刷新列表 */
    changed: []
}>()

const DRAFT_STATUS_LABEL: Record<string, string> = {
    drafting: '生成中',
    filling: '生成中',
    pending: '生成中',
    ready: '可编辑',
    exported: '已导出',
    failed: '失败',
}
const DRAFT_STATUS_STYLE: Record<string, string> = {
    drafting: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-200',
    filling: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-200',
    pending: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-200',
    ready: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200',
    exported: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200',
    failed: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200',
}
const draftStatusLabel = (s: string) => DRAFT_STATUS_LABEL[s] ?? s
const draftStatusStyle = (s: string) => DRAFT_STATUS_STYLE[s] ?? 'bg-muted text-muted-foreground'

function formatDraftDate(s: string) {
    if (!s) return ''
    const d = new Date(s)
    if (Number.isNaN(d.getTime())) return ''
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function handleDelete(row: DraftRow) {
    const alertDialogStore = useAlertDialogStore()
    alertDialogStore.showErrorDialog({
        title: '确认删除',
        message: `确定要删除文书「${row.title}」吗？删除后将无法恢复。`,
        confirmText: '确认删除',
        cancelText: '取消',
        onConfirm: async () => {
            const ok = await useApiFetch(
                `/api/v1/assistant/document/drafts/${row.id}`,
                { method: 'DELETE' },
            )
            if (ok !== null) {
                toast.success('已删除')
                emit('changed')
            }
        },
    })
}
</script>

<template>
    <Transition name="view-fade" mode="out-in">
        <!-- 网格视图 -->
        <div v-if="viewMode === 'grid'" key="grid" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            <NuxtLink v-for="d in items" :key="d.id" :to="`/dashboard/document/drafts/${d.id}`"
                class="group relative flex items-start gap-3 rounded-xl border bg-card p-3 transition-all hover:border-primary/60 hover:shadow-md hover:-translate-y-0.5">
                <div
                    class="flex size-12 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400 group-hover:bg-indigo-500/20 transition-colors">
                    <FileEditIcon class="size-6" />
                </div>
                <div class="flex-1 min-w-0 space-y-0.5 pr-14">
                    <div class="text-sm font-medium leading-snug line-clamp-1 group-hover:text-primary transition-colors">
                        {{ d.title }}
                    </div>
                    <div class="text-xs text-muted-foreground line-clamp-1" :title="d.templateName ?? ''">
                        模板：{{ d.templateName ?? '—' }}
                    </div>
                    <div class="text-xs text-muted-foreground">
                        {{ formatDraftDate(d.updatedAt) }}
                    </div>
                </div>
                <div class="absolute top-2 right-2 flex items-center gap-1">
                    <span :class="['rounded px-1.5 py-0.5 text-[10px] font-medium', draftStatusStyle(d.status)]">
                        {{ draftStatusLabel(d.status) }}
                    </span>
                    <button v-if="showDelete" type="button"
                        class="p-1 rounded-md text-muted-foreground hover:bg-accent hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
                        aria-label="删除草稿" @click.stop.prevent="handleDelete(d)">
                        <Trash2Icon class="size-3.5" />
                    </button>
                </div>
            </NuxtLink>
        </div>

        <!-- 列表视图 -->
        <div v-else key="list" class="space-y-1">
            <NuxtLink v-for="d in items" :key="d.id" :to="`/dashboard/document/drafts/${d.id}`"
                class="group w-full flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors border border-transparent hover:border-border/50">
                <div
                    class="flex items-center justify-center size-9 rounded-lg shrink-0 bg-indigo-500/10 dark:bg-indigo-500/20">
                    <FileEditIcon class="size-5 text-indigo-600 dark:text-indigo-400" />
                </div>
                <div class="flex-1 min-w-0 text-left">
                    <div class="text-sm font-medium truncate group-hover:text-primary transition-colors">
                        {{ d.title }}
                    </div>
                    <div class="text-[11px] text-muted-foreground/60 truncate">
                        {{ d.templateName ?? '—' }}
                    </div>
                </div>
                <div class="shrink-0 flex flex-col items-end gap-0.5">
                    <span
                        :class="['inline-flex items-center px-1.5 py-0 h-5 rounded text-[10px] font-medium', draftStatusStyle(d.status)]">
                        {{ draftStatusLabel(d.status) }}
                    </span>
                    <span class="text-[10px] text-muted-foreground/60">{{ formatDraftDate(d.updatedAt) }}</span>
                </div>
                <button v-if="showDelete" type="button"
                    class="shrink-0 p-1 rounded-md text-muted-foreground hover:bg-accent hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
                    aria-label="删除草稿" @click.stop.prevent="handleDelete(d)">
                    <Trash2Icon class="size-3.5" />
                </button>
            </NuxtLink>
        </div>
    </Transition>
</template>

<style scoped>
.view-fade-enter-active,
.view-fade-leave-active {
    transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.view-fade-enter-from {
    opacity: 0;
    transform: translateY(8px) scale(0.99);
}

.view-fade-leave-to {
    opacity: 0;
    transform: translateY(-8px) scale(0.99);
}
</style>
