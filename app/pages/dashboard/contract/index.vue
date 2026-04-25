<script setup lang="ts">
/**
 * 合同审查列表（/dashboard/contract）
 *
 * 顶级路由（从 /dashboard/assistant/contract 迁移过来）。
 *
 * 交互：
 * - 桌面：表格 · 操作列 DropdownMenu · 合同名称可点击跳详情
 * - 移动：卡片 · 右上角（上）删除 / （下）状态徽章 · 整卡 NuxtLink 跳详情
 * - 筛选：即时生效；搜索框 refDebounced 300ms 防抖、状态下拉改即触发
 *   （参考 app/pages/dashboard/disk-space.vue 的做法）
 * - 新建审查：弹窗 · 两 Tab（上传文件 / 粘贴文本），成功后跳详情
 *
 * 支持 query ?new=1&caseId=X：案件详情页"新建合同审查"入口会这样跳进来，
 * 页面挂载后自动打开弹窗并把 caseId 带入。
 */
import { ref, computed, onMounted, watch } from 'vue'
import { useMediaQuery, refDebounced } from '@vueuse/core'
import { toast } from 'vue-sonner'
import {
    FileText,
    Trash2Icon,
    MoreHorizontal,
    Loader2,
    Plus,
    Search,
} from 'lucide-vue-next'
import type { ReviewListItem } from '#shared/types/contract'
import { REVIEW_STATUS_LABEL } from '#shared/types/contract'

definePageMeta({
    layout: 'dashboard-layout',
    title: '合同审查',
    icon: 'FileSearch',
})

const route = useRoute()
const router = useRouter()
const isDesktop = useMediaQuery('(min-width: 768px)')

// 从 query 读取 caseId 与是否自动打开弹窗
const initCaseId = computed(() => {
    const v = route.query.caseId
    const n = Number(v)
    return Number.isInteger(n) && n > 0 ? n : null
})
const shouldAutoOpen = computed(() => route.query.new === '1')

// ===== 筛选状态（即时生效）=====
const formQ = ref('')
// 搜索文本防抖 300ms：避免逐字触发请求（参考 disk-space.vue）
const debouncedQ = refDebounced(formQ, 300)

const formStatus = ref<'all' | 'pending' | 'reviewing' | 'awaiting_stance' | 'completed' | 'failed' | 'rebuilding'>('all')

// 分页
const PAGE_SIZE = 20
const page = ref(1)

// 筛选变化时回到首页（避免"第三页但新结果只有一页"的空白）
watch([debouncedQ, formStatus], () => {
    page.value = 1
})

// 响应式 query：useApi 会跟随 computed 变化自动 refetch
const listQuery = computed(() => {
    const q: Record<string, string | number> = {
        skip: (page.value - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
    }
    const qText = debouncedQ.value.trim()
    if (qText) q.q = qText
    if (formStatus.value !== 'all') q.status = formStatus.value
    return q
})

interface ListResponse {
    items: ReviewListItem[]
    total: number
    skip: number
    take: number
}

const { data, status: listStatus, refresh } = await useApi<ListResponse>(
    '/api/v1/assistant/contract/reviews',
    { query: listQuery },
)
const items = computed<ReviewListItem[]>(() => data.value?.items ?? [])
const total = computed(() => data.value?.total ?? 0)
const loading = computed(() => listStatus.value === 'pending')

function resetFilter() {
    formQ.value = ''
    formStatus.value = 'all'
    page.value = 1
}

// ===== 新建弹窗 =====
const dialogOpen = ref(false)
const dialogCaseId = ref<number | null>(null)

function openNewDialog(caseId: number | null = null) {
    dialogCaseId.value = caseId
    dialogOpen.value = true
}

function handleCreated(reviewId: number) {
    toast.success('已发起合同审查')
    router.push(`/dashboard/contract/${reviewId}`)
}

// ===== 删除 =====
async function confirmDelete(item: ReviewListItem) {
    const alertDialogStore = useAlertDialogStore()
    alertDialogStore.showErrorDialog({
        title: '确认删除',
        message: `确定删除「${item.originalFileName ?? '未命名合同'}」？删除后无法恢复。`,
        confirmText: '确认删除',
        cancelText: '取消',
        onConfirm: async () => {
            const ok = await useApiFetch(
                `/api/v1/assistant/contract/reviews/${item.id}`,
                { method: 'DELETE' },
            )
            if (ok !== null) {
                toast.success('已删除')
                await refresh()
            }
        },
    })
}

// ===== 展示辅助 =====
// UI-R6：label 部分从 shared/types/contract.REVIEW_STATUS_LABEL 单一数据源 import；
// 仅 class 配色保留本地（属页面视觉表达，不进 shared 层）。
const STATUS_CLASS: Record<string, string> = {
    pending: 'bg-muted text-muted-foreground',
    reviewing: 'bg-primary/15 text-primary dark:bg-primary/20',
    awaiting_stance: 'bg-primary/15 text-primary dark:bg-primary/20',
    rebuilding: 'bg-primary/15 text-primary dark:bg-primary/20',
    completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200',
    failed: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200',
}
function statusMeta(s: string) {
    const label = (REVIEW_STATUS_LABEL as Record<string, string>)[s] ?? s
    return {
        label,
        class: STATUS_CLASS[s] ?? 'bg-muted text-muted-foreground',
    }
}

function formatDate(s: string | Date) {
    const d = typeof s === 'string' ? new Date(s) : s
    if (Number.isNaN(d.getTime())) return ''
    const now = new Date()
    const isToday = d.toDateString() === now.toDateString()
    const yesterday = new Date(now)
    yesterday.setDate(now.getDate() - 1)
    const isYesterday = d.toDateString() === yesterday.toDateString()
    const pad = (n: number) => String(n).padStart(2, '0')
    if (isToday) return `今天 ${pad(d.getHours())}:${pad(d.getMinutes())}`
    if (isYesterday) return `昨天 ${pad(d.getHours())}:${pad(d.getMinutes())}`
    if (d.getFullYear() === now.getFullYear()) return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))

onMounted(() => {
    if (shouldAutoOpen.value) openNewDialog(initCaseId.value)
})
</script>

<template>
    <div class="p-4 md:p-6 space-y-6">
        <!-- 页面标题 + 新建按钮 -->
        <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
                <h1 class="text-2xl md:text-3xl font-bold mb-1">合同审查</h1>
                <p class="text-muted-foreground text-sm">AI 逐条扫描合同条款，生成风险清单</p>
            </div>
            <Button @click="openNewDialog(null)">
                <Plus class="h-4 w-4 mr-1" />
                新建审查
            </Button>
        </div>

        <!-- 筛选条（即时生效：搜索 300ms 防抖，状态改即触发） -->
        <div class="flex flex-col md:flex-row gap-3 md:items-center">
            <div class="relative md:w-64">
                <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                    v-model="formQ"
                    placeholder="按文件名搜索"
                    class="pl-8"
                />
            </div>
            <Select v-model="formStatus">
                <SelectTrigger class="md:w-40">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">全部状态</SelectItem>
                    <SelectItem value="reviewing">审查中</SelectItem>
                    <SelectItem value="awaiting_stance">等待立场</SelectItem>
                    <SelectItem value="completed">已完成</SelectItem>
                    <SelectItem value="failed">失败</SelectItem>
                </SelectContent>
            </Select>
            <Button v-if="formQ || formStatus !== 'all'" variant="outline" @click="resetFilter">
                重置
            </Button>
        </div>

        <!-- 加载中 -->
        <div v-if="loading" class="py-16 text-center text-muted-foreground">
            <Loader2 class="size-6 mx-auto mb-2 animate-spin" />
            加载中...
        </div>

        <!-- 空态 -->
        <div v-else-if="items.length === 0"
            class="rounded-xl border border-dashed py-16 text-center text-muted-foreground">
            <FileText class="size-8 mx-auto mb-3 opacity-50" />
            <p class="text-sm">暂无合同审查记录</p>
            <p class="text-xs mt-1">点击右上角「新建审查」开始第一次合同扫描</p>
        </div>

        <!-- 列表主体 -->
        <template v-else>
            <!-- 桌面：表格 -->
            <div v-if="isDesktop" class="rounded-md border">
                <Table class="table-fixed">
                    <TableHeader>
                        <TableRow>
                            <TableHead>合同名称</TableHead>
                            <TableHead class="w-[120px]">类型</TableHead>
                            <TableHead class="w-[100px]">状态</TableHead>
                            <TableHead class="w-[120px]">风险</TableHead>
                            <TableHead class="w-[140px]">创建时间</TableHead>
                            <TableHead class="w-[80px] text-right">操作</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        <TableRow v-for="row in items" :key="row.id" class="group">
                            <TableCell>
                                <NuxtLink :to="`/dashboard/contract/${row.id}`"
                                    class="block min-w-0 hover:text-primary transition-colors">
                                    <div class="font-medium truncate" :title="row.originalFileName ?? ''">
                                        {{ row.originalFileName ?? '未命名合同' }}
                                    </div>
                                    <div v-if="row.caseId" class="text-xs text-muted-foreground truncate">
                                        归属案件 #{{ row.caseId }}
                                    </div>
                                </NuxtLink>
                            </TableCell>
                            <TableCell class="text-sm text-muted-foreground truncate">
                                {{ row.contractType ?? '—' }}
                            </TableCell>
                            <TableCell>
                                <span :class="['inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium',
                                    statusMeta(row.status).class]">
                                    {{ statusMeta(row.status).label }}
                                </span>
                            </TableCell>
                            <TableCell class="text-sm">
                                <span v-if="row.highRiskCount > 0" class="text-rose-500 font-semibold">
                                    {{ row.highRiskCount }} 高
                                </span>
                                <span v-if="row.mediumRiskCount > 0" class="text-amber-500 ml-1">
                                    {{ row.mediumRiskCount }} 中
                                </span>
                                <span v-if="row.totalRiskCount === 0" class="text-muted-foreground">—</span>
                            </TableCell>
                            <TableCell class="text-sm text-muted-foreground whitespace-nowrap">
                                {{ formatDate(row.createdAt) }}
                            </TableCell>
                            <TableCell class="text-right">
                                <DropdownMenu>
                                    <DropdownMenuTrigger as-child>
                                        <Button variant="ghost" size="icon">
                                            <MoreHorizontal class="h-4 w-4" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                        <DropdownMenuItem class="text-destructive" @click="confirmDelete(row)">
                                            <Trash2Icon class="h-4 w-4 mr-2" />
                                            删除
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </TableCell>
                        </TableRow>
                    </TableBody>
                </Table>
            </div>

            <!-- 移动：卡片 -->
            <div v-else class="space-y-3">
                <NuxtLink v-for="row in items" :key="row.id"
                    :to="`/dashboard/contract/${row.id}`"
                    class="group relative flex items-start gap-3 rounded-xl border bg-card p-3 transition-all hover:border-primary/60 hover:shadow-md">
                    <div
                        class="flex size-12 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <FileText class="size-6" />
                    </div>
                    <div class="flex-1 min-w-0 space-y-0.5 pr-10">
                        <div class="text-sm font-medium leading-tight line-clamp-2 group-hover:text-primary transition-colors">
                            {{ row.originalFileName ?? '未命名合同' }}
                        </div>
                        <div class="text-xs text-muted-foreground line-clamp-1">
                            {{ row.contractType ?? '—' }}
                            <template v-if="row.totalRiskCount > 0">
                                <span class="mx-1">·</span>
                                <span v-if="row.highRiskCount > 0" class="text-rose-500 font-semibold">
                                    {{ row.highRiskCount }} 高
                                </span>
                                <span v-if="row.mediumRiskCount > 0" class="text-amber-500 ml-1">
                                    {{ row.mediumRiskCount }} 中
                                </span>
                            </template>
                        </div>
                        <div class="text-[11px] text-muted-foreground/80 flex gap-2 flex-wrap">
                            <span>{{ formatDate(row.createdAt) }}</span>
                            <span v-if="row.caseId">· 归属案件 #{{ row.caseId }}</span>
                        </div>
                    </div>
                    <!-- 右上角：状态徽章（上）+ 删除按钮（下；移动端常显、桌面 hover 才显） -->
                    <div class="absolute top-2 right-2 flex flex-col items-end gap-1.5">
                        <span :class="['inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap',
                            statusMeta(row.status).class]">
                            {{ statusMeta(row.status).label }}
                        </span>
                        <button type="button"
                            class="p-1 rounded-md text-muted-foreground hover:bg-accent hover:text-destructive transition-colors md:opacity-0 md:group-hover:opacity-100"
                            aria-label="删除审查"
                            @click.stop.prevent="confirmDelete(row)">
                            <Trash2Icon class="size-3.5" />
                        </button>
                    </div>
                </NuxtLink>
            </div>

            <!-- 分页 -->
            <GeneralPagination v-if="pageCount > 1"
                :current-page="page"
                :page-size="PAGE_SIZE"
                :total="total"
                @change="(p: number) => (page = p)" />
        </template>

        <!-- 新建弹窗 -->
        <AssistantContractNewReviewDialog
            v-model:open="dialogOpen"
            :case-id="dialogCaseId"
            @created="handleCreated" />
    </div>
</template>
