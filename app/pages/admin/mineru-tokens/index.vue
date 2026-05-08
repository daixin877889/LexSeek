<template>
        <div class="space-y-6">
            <!-- 页面标题 -->
            <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                    <h1 class="text-2xl md:text-3xl font-bold mb-1">MinerU Token 管理</h1>
                    <p class="text-muted-foreground text-sm">管理 MinerU PDF 转换服务的 API Token</p>
                </div>
                <Button @click="formDialogRef?.openCreate()">
                    <Plus class="h-4 w-4 mr-2" />
                    新增 Token
                </Button>
            </div>

            <!-- 筛选 -->
            <div class="flex flex-col md:flex-row gap-4">
                <Select v-model="statusFilter">
                    <SelectTrigger class="w-full md:w-32">
                        <SelectValue placeholder="状态" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">全部状态</SelectItem>
                        <SelectItem value="1">启用</SelectItem>
                        <SelectItem value="0">禁用</SelectItem>
                    </SelectContent>
                </Select>
                <div class="flex-1">
                    <Input v-model="keyword" placeholder="搜索 Token 名称/备注..." class="w-full md:w-64"
                        @keyup.enter="handleSearch" />
                </div>
                <Button variant="outline" @click="handleSearch">
                    <Search class="h-4 w-4 mr-2" />
                    筛选
                </Button>
            </div>

            <!-- 加载状态 -->
            <div v-if="loading" class="flex justify-center py-12">
                <Loader2 class="h-10 w-10 animate-spin text-muted-foreground" />
            </div>

            <!-- 空状态 -->
            <div v-else-if="!items.length" class="flex flex-col items-center justify-center py-12 text-center">
                <Key class="h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 class="text-lg font-medium mb-1">暂无 MinerU Token</h3>
                <p class="text-muted-foreground text-sm">点击上方按钮新增 Token</p>
            </div>

            <!-- Token 列表 -->
            <template v-else>
                <div class="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead class="w-[60px]">ID</TableHead>
                                <TableHead>Token 名称</TableHead>
                                <TableHead>Token 值</TableHead>
                                <TableHead>备注</TableHead>
                                <TableHead class="w-[80px]">状态</TableHead>
                                <TableHead class="w-[140px]">到期时间</TableHead>
                                <TableHead class="w-[160px]">最近使用</TableHead>
                                <TableHead class="w-[160px]">创建时间</TableHead>
                                <TableHead class="w-[100px] text-right">操作</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            <TableRow v-for="item in items" :key="item.id">
                                <TableCell class="font-medium">{{ item.id }}</TableCell>
                                <TableCell class="font-medium">{{ item.name }}</TableCell>
                                <TableCell>
                                    <code class="px-2 py-1 bg-muted rounded text-sm font-mono">
                                        {{ item.tokenMasked }}
                                    </code>
                                </TableCell>
                                <TableCell class="text-muted-foreground max-w-[200px] truncate">
                                    {{ item.remark || '-' }}
                                </TableCell>
                                <TableCell>
                                    <div class="flex flex-col gap-1">
                                        <Badge :variant="item.status === 1 ? 'default' : 'secondary'">
                                            {{ item.status === 1 ? '启用' : '禁用' }}
                                        </Badge>
                                        <Badge v-if="item.expired" variant="destructive" class="w-fit">已过期</Badge>
                                    </div>
                                </TableCell>
                                <TableCell class="text-muted-foreground">
                                    {{ item.expiresAt ? formatDate(item.expiresAt) : '永不过期' }}
                                </TableCell>
                                <TableCell class="text-muted-foreground">
                                    {{ item.lastUsedAt ? formatDate(item.lastUsedAt) : '-' }}
                                </TableCell>
                                <TableCell class="text-muted-foreground">
                                    {{ formatDate(item.createdAt) }}
                                </TableCell>
                                <TableCell class="text-right">
                                    <DropdownMenu>
                                        <DropdownMenuTrigger as-child>
                                            <Button variant="ghost" size="icon">
                                                <MoreHorizontal class="h-4 w-4" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            <DropdownMenuItem @click="formDialogRef?.openEdit(item)">
                                                <Pencil class="h-4 w-4 mr-2" />
                                                编辑
                                            </DropdownMenuItem>
                                            <DropdownMenuItem @click="handleToggleStatus(item)">
                                                <Power class="h-4 w-4 mr-2" />
                                                {{ item.status === 1 ? '禁用' : '启用' }}
                                            </DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem class="text-destructive" @click="handleDelete(item)">
                                                <Trash2 class="h-4 w-4 mr-2" />
                                                删除
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </TableCell>
                            </TableRow>
                        </TableBody>
                    </Table>
                </div>

                <!-- 分页 -->
                <GeneralPagination :current-page="pagination.page" :page-size="pagination.pageSize"
                    :total="pagination.total" @change="changePage" />
            </template>
        </div>

        <!-- 创建/编辑对话框 -->
        <AdminMineruTokensFormDialog ref="formDialogRef" @success="loadItems" />

        <!-- 删除确认对话框 -->
        <AlertDialog v-model:open="deleteDialogOpen">
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>确认删除</AlertDialogTitle>
                    <AlertDialogDescription>
                        确定要删除 MinerU Token「{{ selectedItem?.name }}」吗？此操作不可撤销。
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction @click="confirmDelete" :disabled="deleting">
                        <Loader2 v-if="deleting" class="h-4 w-4 mr-2 animate-spin" />
                        确认删除
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
</template>

<script setup lang="ts">
import { Plus, Loader2, Key, Search, MoreHorizontal, Pencil, Trash2, Power } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import dayjs from 'dayjs'
import AdminMineruTokensFormDialog from '~/components/admin/mineru-tokens/FormDialog.vue'
import GeneralPagination from '~/components/general/pagination.vue'
import { useApiFetch } from '~/composables/useApiFetch'

// MinerU Token 接口（脱敏版本）
interface MineruTokenMasked {
    id: number
    name: string
    tokenMasked: string
    remark?: string | null
    status: number
    expiresAt?: Date | string | null
    lastUsedAt?: Date | string | null
    expired?: boolean
    createdAt: Date | string
    updatedAt: Date | string
}

definePageMeta({ layout: 'admin-layout', title: 'MinerU Token 管理' })

// 组件引用
const formDialogRef = ref<InstanceType<typeof import('~/components/admin/mineru-tokens/FormDialog.vue').default> | null>(null)

// 状态
const loading = ref(false)
const deleting = ref(false)
const items = ref<MineruTokenMasked[]>([])
const pagination = ref({ page: 1, pageSize: 20, total: 0 })
const statusFilter = ref('all')
const keyword = ref('')

// 删除对话框状态
const deleteDialogOpen = ref(false)
const selectedItem = ref<MineruTokenMasked | null>(null)

// 格式化日期
const formatDate = (date: Date | string) => {
    return dayjs(date).format('YYYY-MM-DD HH:mm')
}

// 加载 Token 列表
const loadItems = async () => {
    loading.value = true
    try {
        const params: Record<string, any> = {
            page: pagination.value.page,
            pageSize: pagination.value.pageSize,
        }
        if (statusFilter.value !== 'all') params.status = parseInt(statusFilter.value)
        if (keyword.value) params.keyword = keyword.value

        const data = await useApiFetch<{ items: MineruTokenMasked[]; total: number }>('/api/v1/admin/mineru-tokens', { query: params })
        if (data) {
            items.value = data.items
            pagination.value.total = data.total
        }
    } finally {
        loading.value = false
    }
}

// 筛选
const handleSearch = () => {
    pagination.value.page = 1
    loadItems()
}

// 翻页
const changePage = (page: number) => {
    pagination.value.page = page
    loadItems()
}

// 切换状态
const handleToggleStatus = async (item: MineruTokenMasked) => {
    const result = await useApiFetch(`/api/v1/admin/mineru-tokens/status/${item.id}`, {
        method: 'PUT',
    })
    if (result !== null) {
        toast.success(item.status === 1 ? '已禁用' : '已启用')
        loadItems()
    }
}

// 删除 Token
const handleDelete = (item: MineruTokenMasked) => {
    selectedItem.value = item
    deleteDialogOpen.value = true
}

const confirmDelete = async () => {
    if (!selectedItem.value) return
    deleting.value = true
    try {
        const result = await useApiFetch(`/api/v1/admin/mineru-tokens/${selectedItem.value.id}`, { method: 'DELETE' })
        if (result !== null) {
            toast.success('删除成功')
            deleteDialogOpen.value = false
            loadItems()
        }
    } finally {
        deleting.value = false
    }
}

onMounted(() => {
    loadItems()
})
</script>
