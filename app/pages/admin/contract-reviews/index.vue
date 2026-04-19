<template>
    <div class="space-y-6">
        <!-- 页面标题 -->
        <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
                <h1 class="text-2xl md:text-3xl font-bold mb-1">合同审查记录</h1>
                <p class="text-muted-foreground text-sm">查看并管理所有用户提交的合同审查记录</p>
            </div>
        </div>

        <!-- 筛选区域 -->
        <div class="flex flex-col md:flex-row gap-2 flex-wrap items-start md:items-center">
            <Select v-model="statusFilter">
                <SelectTrigger class="w-full md:w-40">
                    <SelectValue placeholder="状态" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">全部状态</SelectItem>
                    <SelectItem value="pending">待处理</SelectItem>
                    <SelectItem value="reviewing">审查中</SelectItem>
                    <SelectItem value="awaiting_stance">等待立场</SelectItem>
                    <SelectItem value="completed">已完成</SelectItem>
                    <SelectItem value="failed">失败</SelectItem>
                    <SelectItem value="rebuilding">重建中</SelectItem>
                </SelectContent>
            </Select>

            <Input v-model="keyword" placeholder="搜索合同文件名..." class="w-full md:w-64"
                @keyup.enter="handleSearch" />

            <Input v-model="userIdInputStr" placeholder="按用户 ID" type="number"
                class="w-full md:w-32" @keyup.enter="handleSearch" />

            <div class="flex items-center gap-2 px-1">
                <Checkbox id="include-deleted" :model-value="includeDeleted"
                    @update:model-value="(v) => (includeDeleted = v === true)" />
                <Label for="include-deleted" class="text-sm cursor-pointer">显示已删除</Label>
            </div>

            <Button @click="handleSearch">
                <Search class="h-4 w-4 mr-2" />
                搜索
            </Button>
            <Button variant="outline" @click="handleReset">重置</Button>
        </div>

        <!-- 加载状态 -->
        <div v-if="pending" class="flex justify-center py-12">
            <Loader2 class="h-10 w-10 animate-spin text-muted-foreground" />
        </div>

        <!-- 空状态 -->
        <div v-else-if="!rows.length" class="flex flex-col items-center justify-center py-12 text-center">
            <FileText class="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 class="text-lg font-medium mb-1">暂无记录</h3>
            <p class="text-muted-foreground text-sm">当前筛选条件下无数据</p>
        </div>

        <!-- 表格 -->
        <template v-else>
            <div class="rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead class="w-[60px]">ID</TableHead>
                            <TableHead>合同文件</TableHead>
                            <TableHead class="w-[180px]">用户</TableHead>
                            <TableHead class="w-[120px]">合同类型</TableHead>
                            <TableHead class="w-[80px]">立场</TableHead>
                            <TableHead class="w-[110px]">状态</TableHead>
                            <TableHead class="w-[90px] text-center">未保存</TableHead>
                            <TableHead class="w-[160px]">创建时间</TableHead>
                            <TableHead class="w-[140px] text-right">操作</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        <TableRow v-for="row in rows" :key="row.id"
                            :class="row.deletedAt ? 'opacity-50' : ''">
                            <TableCell class="font-medium">{{ row.id }}</TableCell>
                            <TableCell>
                                <div class="flex items-center gap-2">
                                    <span class="truncate max-w-[280px]" :title="row.originalFileName ?? ''">
                                        {{ row.originalFileName ?? '—' }}
                                    </span>
                                    <Badge v-if="row.deletedAt" variant="destructive" class="shrink-0">
                                        已删除
                                    </Badge>
                                </div>
                            </TableCell>
                            <TableCell>
                                <div class="text-sm">{{ row.userNickname ?? '—' }}</div>
                                <div class="text-xs text-muted-foreground">
                                    {{ row.userPhone ?? `ID: ${row.userId}` }}
                                </div>
                            </TableCell>
                            <TableCell class="text-sm">{{ row.contractType ?? '—' }}</TableCell>
                            <TableCell class="text-sm">{{ row.stance ?? '—' }}</TableCell>
                            <TableCell>
                                <Badge :variant="getStatusVariant(row.status)">
                                    {{ getStatusLabel(row.status) }}
                                </Badge>
                            </TableCell>
                            <TableCell class="text-center">
                                <span v-if="row.hasUnsavedDocxChanges" class="text-amber-600">✓</span>
                                <span v-else class="text-muted-foreground">✗</span>
                            </TableCell>
                            <TableCell class="text-sm text-muted-foreground">
                                {{ formatDate(String(row.createdAt)) }}
                            </TableCell>
                            <TableCell class="text-right">
                                <div class="flex justify-end gap-1">
                                    <NuxtLink :to="`/admin/contract-reviews/${row.id}`">
                                        <Button variant="ghost" size="sm">查看</Button>
                                    </NuxtLink>
                                    <Button v-if="!row.deletedAt" variant="ghost" size="sm"
                                        class="text-destructive hover:text-destructive"
                                        @click="askDelete(row)">
                                        删除
                                    </Button>
                                </div>
                            </TableCell>
                        </TableRow>
                    </TableBody>
                </Table>
            </div>

            <!-- 分页 -->
            <GeneralPagination :current-page="page" :page-size="pageSize" :total="total"
                @change="changePage" />
        </template>
    </div>

    <!-- 删除确认对话框 -->
    <AlertDialog v-model:open="deleteDialogOpen">
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle>确认软删除该审查记录？</AlertDialogTitle>
                <AlertDialogDescription>
                    删除后用户端将不可见。记录 ID：{{ selectedRow?.id }}，文件：{{ selectedRow?.originalFileName ?? '—' }}。
                </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
                <AlertDialogCancel :disabled="deleting">取消</AlertDialogCancel>
                <AlertDialogAction :disabled="deleting" @click="confirmDelete">
                    <Loader2 v-if="deleting" class="h-4 w-4 mr-2 animate-spin" />
                    确认删除
                </AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
    </AlertDialog>
</template>

<script setup lang="ts">
import { Loader2, FileText, Search } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { AdminReviewListItem } from '#shared/types/contract'
import { REVIEW_STATUS_LABEL } from '#shared/types/contract'

definePageMeta({ layout: 'admin-layout', title: '合同审查记录' })

// ─── 类型 ────────────────────────────────────────────────────────────────────
interface ListResponse {
    items: AdminReviewListItem[]
    total: number
    skip: number
    take: number
}

// ─── 状态 ────────────────────────────────────────────────────────────────────
const { formatDate } = useFormatters()

const page = ref(1)
const pageSize = ref(20)
const statusFilter = ref<string>('all')
const keyword = ref('')
const userIdInputStr = ref('')
const includeDeleted = ref(false)

const deleteDialogOpen = ref(false)
const deleting = ref(false)
const selectedRow = ref<AdminReviewListItem | null>(null)

// ─── 查询参数 ─────────────────────────────────────────────────────────────────
const queryUrl = computed(() => {
    const params = new URLSearchParams()
    params.set('skip', String((page.value - 1) * pageSize.value))
    params.set('take', String(pageSize.value))
    if (statusFilter.value && statusFilter.value !== 'all') {
        params.set('status', statusFilter.value)
    }
    const q = keyword.value.trim()
    if (q) params.set('q', q)
    const uid = Number(userIdInputStr.value)
    if (Number.isInteger(uid) && uid > 0) params.set('userId', String(uid))
    if (includeDeleted.value) params.set('includeDeleted', 'true')
    return `/api/v1/admin/contract-reviews?${params.toString()}`
})

// ─── 数据请求 ──────────────────────────────────────────────────────────────
// useApi 传入 computed URL 会自动追踪变化并 refetch；无需显式 watch / refresh。
const { data, pending, refresh } = await useApi<ListResponse>(queryUrl)

const rows = computed<AdminReviewListItem[]>(() => data.value?.items ?? [])
const total = computed(() => data.value?.total ?? 0)

// ─── 状态 Badge 映射 ─────────────────────────────────────────────────────────
type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline'

function getStatusLabel(status: string) {
    return REVIEW_STATUS_LABEL[status as keyof typeof REVIEW_STATUS_LABEL] ?? status
}

function getStatusVariant(status: string): BadgeVariant {
    if (status === 'completed') return 'default'
    if (status === 'failed') return 'destructive'
    if (status === 'reviewing' || status === 'awaiting_stance') return 'secondary'
    return 'outline'
}

// ─── 事件 ────────────────────────────────────────────────────────────────────
function handleSearch() {
    // 重置到第一页；queryUrl 变化由 useApi 自动 refetch
    page.value = 1
}

function handleReset() {
    page.value = 1
    statusFilter.value = 'all'
    keyword.value = ''
    userIdInputStr.value = ''
    includeDeleted.value = false
}

function changePage(p: number) {
    page.value = p
}

function askDelete(row: AdminReviewListItem) {
    selectedRow.value = row
    deleteDialogOpen.value = true
}

async function confirmDelete() {
    if (!selectedRow.value) return
    deleting.value = true
    try {
        const result = await useApiFetch(
            `/api/v1/admin/contract-reviews/${selectedRow.value.id}`,
            { method: 'DELETE' },
        )
        if (result !== null) {
            toast.success('已删除')
            deleteDialogOpen.value = false
            selectedRow.value = null
            await refresh()
        }
    } finally {
        deleting.value = false
    }
}
</script>
