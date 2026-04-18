<script setup lang="ts">
/**
 * 文书生成首页 - 历史文书 Tab 内容
 *
 * 消费 GET /api/v1/assistant/document/drafts，展示当前用户的草稿。
 * - 桌面（≥768px）：表格
 * - 移动：卡片列表
 *
 * 两种视图共享加载/删除/跳转逻辑，仅 DOM 结构不同。
 */
import { FileTextIcon, Loader2Icon, Trash2Icon } from 'lucide-vue-next'
import { useMediaQuery } from '@vueuse/core'
import { toast } from 'vue-sonner'

interface DraftRow {
    id: number
    templateId: number
    templateName: string | null
    caseId: number | null
    status: string
    updatedAt: string
}

const { formatDate } = useFormatters()

const loading = ref(false)
const drafts = ref<DraftRow[]>([])
const pagination = ref({ page: 1, pageSize: 10, total: 0 })

const isDesktop = useMediaQuery('(min-width: 768px)')

const displayName = (row: DraftRow) => row.templateName || `模板 #${row.templateId}`

async function loadDrafts() {
    loading.value = true
    try {
        const skip = (pagination.value.page - 1) * pagination.value.pageSize
        const result = await useApiFetch<{ items: DraftRow[]; total: number }>(
            '/api/v1/assistant/document/drafts',
            { query: { skip, take: pagination.value.pageSize } },
        )
        if (result) {
            drafts.value = result.items
            pagination.value.total = result.total
        }
    } finally {
        loading.value = false
    }
}

onMounted(loadDrafts)

async function handleDelete(row: DraftRow) {
    if (!confirm(`确认删除「${displayName(row)}」？删除后无法恢复。`)) return
    const ok = await useApiFetch(
        `/api/v1/assistant/document/drafts/${row.id}`,
        { method: 'DELETE' },
    )
    if (ok !== null) {
        toast.success('已删除')
        loadDrafts()
    }
}

function openDraft(row: DraftRow) {
    navigateTo(`/dashboard/document/drafts/${row.id}`)
}

function changePage(page: number) {
    pagination.value.page = page
    loadDrafts()
}

const STATUS_LABEL: Record<string, string> = {
    pending: '生成中',
    filling: '生成中',
    ready: '可编辑',
    exported: '已导出',
    failed: '失败',
}
const statusLabel = (s: string) => STATUS_LABEL[s] ?? s

const STATUS_STYLE: Record<string, string> = {
    pending: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-200',
    filling: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-200',
    ready: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200',
    exported: 'bg-muted text-muted-foreground',
    failed: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200',
}
const statusStyle = (s: string) =>
    STATUS_STYLE[s] ?? 'bg-muted text-muted-foreground'
</script>

<template>
    <div class="space-y-3">
        <!-- 加载态 -->
        <div v-if="loading" class="flex justify-center py-8">
            <Loader2Icon class="size-6 animate-spin text-muted-foreground" />
        </div>

        <!-- 空态 -->
        <div
            v-else-if="!drafts.length"
            class="flex flex-col items-center justify-center py-10 text-muted-foreground"
        >
            <FileTextIcon class="size-10 mb-2 opacity-40" />
            <p class="text-sm">还没有历史文书，去「文书模板」开始吧</p>
        </div>

        <!-- 桌面：表格 -->
        <div v-else-if="isDesktop" class="rounded-md border">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>模板</TableHead>
                        <TableHead class="w-[120px]">关联案件</TableHead>
                        <TableHead class="w-[160px]">更新时间</TableHead>
                        <TableHead class="w-[140px] text-center">操作</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    <TableRow v-for="row in drafts" :key="row.id">
                        <TableCell class="font-medium">{{ displayName(row) }}</TableCell>
                        <TableCell>{{ row.caseId ? `#${row.caseId}` : '—' }}</TableCell>
                        <TableCell class="text-sm text-muted-foreground">
                            {{ formatDate(row.updatedAt) }}
                        </TableCell>
                        <TableCell class="text-center">
                            <Button variant="ghost" size="sm" @click="openDraft(row)">进入</Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                aria-label="删除草稿"
                                @click="handleDelete(row)"
                            >
                                <Trash2Icon class="size-4" />
                            </Button>
                        </TableCell>
                    </TableRow>
                </TableBody>
            </Table>
        </div>

        <!-- 移动：卡片列表（整卡可点击进入，删除浮于右上） -->
        <div v-else class="space-y-2">
            <button
                v-for="row in drafts"
                :key="row.id"
                type="button"
                class="group relative w-full flex items-start gap-3 rounded-xl border bg-card p-3 text-left transition-all hover:border-primary/60 hover:shadow-lg hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                @click="openDraft(row)"
            >
                <!-- 左侧文档图标 -->
                <div
                    class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary/20 transition-colors"
                >
                    <FileTextIcon class="size-4" />
                </div>

                <!-- 中间：名称 + 元信息（为右上角控件留出空间） -->
                <div class="flex-1 min-w-0 space-y-0.5 pr-20">
                    <div class="text-sm font-medium leading-snug line-clamp-1">
                        {{ displayName(row) }}
                    </div>
                    <div class="text-xs text-muted-foreground">
                        <span>{{ formatDate(row.updatedAt) }}</span>
                        <template v-if="row.caseId">
                            <span class="text-muted-foreground/60 mx-1">·</span>
                            <span>案件 #{{ row.caseId }}</span>
                        </template>
                    </div>
                </div>

                <!-- 右上：状态徽章（仅非默认态显示）+ 删除 -->
                <div class="absolute top-2 right-2 flex items-center gap-1">
                    <span
                        v-if="row.status !== 'ready'"
                        :class="statusStyle(row.status)"
                        class="rounded px-1.5 py-0.5 text-[10px] font-medium"
                    >
                        {{ statusLabel(row.status) }}
                    </span>
                    <button
                        type="button"
                        class="p-1 rounded-md text-muted-foreground hover:bg-accent hover:text-destructive transition-colors"
                        aria-label="删除草稿"
                        @click.stop="handleDelete(row)"
                    >
                        <Trash2Icon class="size-3.5" />
                    </button>
                </div>
            </button>
        </div>

        <GeneralPagination
            v-if="drafts.length"
            :current-page="pagination.page"
            :page-size="pagination.pageSize"
            :total="pagination.total"
            @change="changePage"
        />
    </div>
</template>
