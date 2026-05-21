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
import { EyeIcon, FileTextIcon, Loader2Icon, Trash2Icon } from 'lucide-vue-next'
import { useMediaQuery } from '@vueuse/core'
import { toast } from 'vue-sonner'
import type { DraftRow } from '#shared/types/document'
import GeneralPagination from '~/components/general/pagination.vue'
import { useApiFetch } from '~/composables/useApiFetch'
import { useFormatters } from '~/composables/useFormatters'
import { useAlertDialogStore } from '~/store/alertDialog'

const props = defineProps<{
    /** 外部传入列表数据；未传则组件内部自拉 */
    items?: DraftRow[]
    /** 外部控制 loading 态（仅受控模式有效） */
    loading?: boolean
    /** 按 caseId 过滤（仅内部自拉模式有效） */
    caseId?: number
    /** 隐藏"关联案件"列（桌面表格） */
    hideCaseColumn?: boolean
}>()

const emit = defineEmits<{
    /** 删除完成（父组件据此触发刷新） */
    changed: []
}>()

const { formatDate } = useFormatters()

const innerLoading = ref(false)
const innerDrafts = ref<DraftRow[]>([])
const pagination = ref({ page: 1, pageSize: 10, total: 0 })

/** 是否受控：有 items prop 即受控 */
const controlled = computed(() => props.items !== undefined)

/** 对外暴露的列表 / loading 来源 */
const drafts = computed(() => (controlled.value ? (props.items ?? []) : innerDrafts.value))
const loading = computed(() => (controlled.value ? !!props.loading : innerLoading.value))

const isDesktop = useMediaQuery('(min-width: 768px)')

const templateLabel = (row: DraftRow) => row.templateName || `模板 #${row.templateId}`
const titleLabel = (row: DraftRow) => row.title?.trim() || templateLabel(row)

async function loadDrafts() {
    if (controlled.value) return // 受控模式由父组件刷新
    innerLoading.value = true
    try {
        const skip = (pagination.value.page - 1) * pagination.value.pageSize
        const query: Record<string, number | boolean> = {
            skip,
            take: pagination.value.pageSize,
        }
        if (props.caseId != null) {
            query.caseId = props.caseId
        } else {
            // 工作台「历史文书」全局列表语义：排除旧库迁移而来的 legacy 自由文书
            query.excludeLegacy = true
        }
        const result = await useApiFetch<{ items: DraftRow[]; total: number }>(
            '/api/v1/assistant/document/drafts',
            { query },
        )
        if (result) {
            innerDrafts.value = result.items
            pagination.value.total = result.total
        }
    } finally {
        innerLoading.value = false
    }
}

onMounted(() => {
    if (!controlled.value) loadDrafts()
})

async function handleDelete(row: DraftRow) {
    const alertDialogStore = useAlertDialogStore()
    alertDialogStore.showErrorDialog({
        title: '确认删除',
        message: `确认删除「${titleLabel(row)}」？删除后无法恢复。`,
        confirmText: '确认删除',
        cancelText: '取消',
        onConfirm: async () => {
            const ok = await useApiFetch(
                `/api/v1/assistant/document/drafts/${row.id}`,
                { method: 'DELETE' },
            )
            if (ok !== null) {
                toast.success('已删除')
                if (controlled.value) emit('changed')
                else loadDrafts()
            }
        },
    })
}

function openDraft(row: DraftRow) {
    navigateTo(`/dashboard/document/drafts/${row.id}?from=document-history`)
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
            <p class="text-sm">
                {{ caseId != null ? '本案件还没有文书，点「+ 新建文书」开始' : '还没有历史文书，去「文书模板」开始吧' }}
            </p>
        </div>

        <!-- 桌面：表格 -->
        <div v-else-if="isDesktop" class="rounded-md border">
            <Table class="table-fixed">
                <TableHeader>
                    <TableRow>
                        <!-- 文书名称：未声明宽度，占剩余空间，优先级最高 -->
                        <TableHead>文书名称</TableHead>
                        <TableHead class="w-[200px]">模板</TableHead>
                        <TableHead v-if="!hideCaseColumn" class="w-[180px]">关联案件</TableHead>
                        <TableHead class="w-[140px]">更新时间</TableHead>
                        <TableHead class="w-[84px] text-center">操作</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    <TableRow v-for="row in drafts" :key="row.id">
                        <TableCell class="font-medium">
                            <NuxtLink
                                :to="`/dashboard/document/drafts/${row.id}?from=document-history`"
                                class="text-foreground hover:text-primary transition-colors truncate block max-w-full align-middle"
                                :title="titleLabel(row)"
                            >
                                {{ titleLabel(row) }}
                            </NuxtLink>
                        </TableCell>
                        <TableCell class="text-sm text-muted-foreground">
                            <span class="truncate block max-w-full" :title="templateLabel(row)">
                                {{ templateLabel(row) }}
                            </span>
                        </TableCell>
                        <TableCell v-if="!hideCaseColumn">
                            <NuxtLink
                                v-if="row.caseId"
                                :to="`/dashboard/cases/${row.caseId}?tab=documents`"
                                class="text-foreground hover:text-primary transition-colors truncate block max-w-full align-middle"
                                :title="row.caseTitle ?? `案件 #${row.caseId}`"
                            >
                                {{ row.caseTitle ?? `案件 #${row.caseId}` }}
                            </NuxtLink>
                            <span v-else class="text-muted-foreground">—</span>
                        </TableCell>
                        <TableCell class="text-sm text-muted-foreground whitespace-nowrap">
                            {{ formatDate(row.updatedAt) }}
                        </TableCell>
                        <TableCell>
                            <div class="flex items-center justify-center gap-1">
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    class="h-8 w-8 rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive"
                                    title="删除草稿"
                                    aria-label="删除草稿"
                                    @click="handleDelete(row)"
                                >
                                    <Trash2Icon class="size-4" />
                                </Button>
                                <NuxtLink :to="`/dashboard/document/drafts/${row.id}?from=document-history`">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        class="h-8 w-8 rounded-full hover:bg-primary/10 hover:text-primary"
                                        title="查看详情"
                                        aria-label="查看详情"
                                    >
                                        <EyeIcon class="size-4" />
                                    </Button>
                                </NuxtLink>
                            </div>
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
                    class="flex size-12 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary/20 transition-colors"
                >
                    <FileTextIcon class="size-6" />
                </div>

                <!-- 中间：文书标题 + 模板 + 元信息（为右上角控件留出空间） -->
                <div class="flex-1 min-w-0 space-y-0.5 pr-20">
                    <div class="text-sm font-medium leading-snug line-clamp-1">
                        {{ titleLabel(row) }}
                    </div>
                    <div class="text-xs text-muted-foreground line-clamp-1">
                        模板：{{ templateLabel(row) }}
                    </div>
                    <div class="text-xs text-muted-foreground">
                        <span>{{ formatDate(row.updatedAt) }}</span>
                        <template v-if="row.caseId">
                            <span class="text-muted-foreground/60 mx-1">·</span>
                            <NuxtLink
                                :to="`/dashboard/cases/${row.caseId}?tab=documents`"
                                class="hover:text-primary transition-colors"
                                @click.stop
                            >
                                {{ row.caseTitle ?? `案件 #${row.caseId}` }}
                            </NuxtLink>
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
            v-if="!controlled && drafts.length"
            :current-page="pagination.page"
            :page-size="pagination.pageSize"
            :total="pagination.total"
            @change="changePage"
        />
    </div>
</template>
