<template>
        <div class="theme-brand space-y-6">
            <!-- 页面标题 -->
            <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                    <h1 class="text-2xl md:text-3xl font-bold mb-1">积分消耗项目</h1>
                    <p class="text-muted-foreground text-sm">管理各功能的积分消耗配置</p>
                </div>
                <Button :class="adminBrandPrimaryButtonClass" @click="formDialogRef?.openCreate()">
                    <Plus class="h-4 w-4 mr-2" />
                    新增项目
                </Button>
            </div>

            <!-- 筛选 -->
            <div class="flex flex-col md:flex-row gap-4">
                <Select v-model="groupFilter">
                    <SelectTrigger :class="['w-full md:w-48', adminBrandFocusClass]">
                        <SelectValue placeholder="选择分组" />
                    </SelectTrigger>
                    <SelectContent class="theme-brand">
                        <SelectItem value="all">全部分组</SelectItem>
                        <SelectItem v-for="g in groups" :key="g" :value="g">
                            {{ getGroupLabel(g) }}
                        </SelectItem>
                    </SelectContent>
                </Select>
                <Select v-model="statusFilter">
                    <SelectTrigger :class="['w-full md:w-32', adminBrandFocusClass]">
                        <SelectValue placeholder="状态" />
                    </SelectTrigger>
                    <SelectContent class="theme-brand">
                        <SelectItem value="all">全部状态</SelectItem>
                        <SelectItem value="1">启用</SelectItem>
                        <SelectItem value="0">禁用</SelectItem>
                    </SelectContent>
                </Select>
                <div class="flex-1">
                    <Input v-model="keyword" placeholder="搜索项目名称/描述..." :class="['w-full md:w-64', adminBrandFocusClass]"
                        @keyup.enter="handleSearch" />
                </div>
                <Button variant="outline" :class="adminBrandFocusClass" @click="handleSearch">
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
                <Coins class="h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 class="text-lg font-medium mb-1">暂无积分消耗项目</h3>
                <p class="text-muted-foreground text-sm">点击上方按钮新增项目</p>
            </div>

            <!-- 项目列表 -->
            <template v-else>
                <div class="bg-card rounded-lg border overflow-hidden">
                    <Table>
                        <TableHeader>
                            <TableRow class="bg-muted/50 hover:bg-muted/50">
                                <TableHead class="w-[60px]">ID</TableHead>
                                <TableHead>Key</TableHead>
                                <TableHead>分组</TableHead>
                                <TableHead>项目名称</TableHead>
                                <TableHead>描述</TableHead>
                                <TableHead class="w-[80px]">单位</TableHead>
                                <TableHead class="w-[100px]">积分数量</TableHead>
                                <TableHead class="w-[80px]">折扣</TableHead>
                                <TableHead class="w-[80px]">状态</TableHead>
                                <TableHead class="w-[100px] text-right">操作</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            <TableRow v-for="item in items" :key="item.id" class="hover:bg-muted/30">
                                <TableCell class="font-medium">{{ item.id }}</TableCell>
                                <TableCell class="font-mono text-sm text-muted-foreground">{{ item.key || '-' }}
                                </TableCell>
                                <TableCell>
                                    <Badge variant="outline" :class="getAdminPointItemGroupBadgeClass(item.group)">
                                        {{ getGroupLabel(item.group) }}
                                    </Badge>
                                </TableCell>
                                <TableCell class="font-mono text-sm">{{ item.name }}</TableCell>
                                <TableCell>{{ item.description || '-' }}</TableCell>
                                <TableCell>{{ item.unit }}</TableCell>
                                <TableCell>{{ item.pointAmount }}</TableCell>
                                <TableCell>{{ formatDiscount(item.discount) }}</TableCell>
                                <TableCell>
                                    <Badge variant="outline" :class="getAdminStatusBadgeClass(item.status === 1)">
                                        {{ item.status === 1 ? '启用' : '禁用' }}
                                    </Badge>
                                </TableCell>
                                <TableCell class="text-right">
                                    <DropdownMenu>
                                        <DropdownMenuTrigger as-child>
                                            <Button variant="ghost" size="icon" :class="adminBrandFocusClass">
                                                <MoreHorizontal class="h-4 w-4" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" class="theme-brand shadow-none">
                                            <DropdownMenuItem @click="formDialogRef?.openEdit(item)">
                                                <Pencil class="h-4 w-4 mr-2" />
                                                编辑
                                            </DropdownMenuItem>
                                            <DropdownMenuItem @click="handleToggleStatus(item)">
                                                <Power class="h-4 w-4 mr-2" />
                                                {{ item.status === 1 ? '禁用' : '启用' }}
                                            </DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem class="text-destructive focus:text-destructive" @click="handleDelete(item)">
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
        <AdminPointItemsFormDialog ref="formDialogRef" :groups="groups" @success="loadItems" />

        <!-- 删除确认对话框 -->
        <AlertDialog v-model:open="deleteDialogOpen">
            <AlertDialogContent class="theme-brand">
                <AlertDialogHeader>
                    <AlertDialogTitle>确认删除</AlertDialogTitle>
                    <AlertDialogDescription>
                        确定要删除积分消耗项目「{{ selectedItem?.description || selectedItem?.name }}」吗？此操作不可撤销。
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel :class="adminBrandFocusClass">取消</AlertDialogCancel>
                    <AlertDialogAction @click="confirmDelete" :disabled="deleting"
                        :class="adminBrandDestructiveActionClass">
                        <Loader2 v-if="deleting" class="h-4 w-4 mr-2 animate-spin" />
                        确认删除
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
</template>

<script setup lang="ts">
import { Plus, Loader2, Coins, Search, MoreHorizontal, Pencil, Trash2, Power } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { PointConsumptionItem } from '#shared/types/point.types'
import AdminPointItemsFormDialog from '~/components/admin/point-items/FormDialog.vue'
import GeneralPagination from '~/components/general/pagination.vue'
import { useApiFetch } from '~/composables/useApiFetch'
import {
    adminBrandDestructiveActionClass,
    adminBrandFocusClass,
    adminBrandPrimaryButtonClass,
    getAdminPointItemGroupBadgeClass,
    getAdminStatusBadgeClass,
} from '~/utils/adminBrandStyles'

definePageMeta({ layout: 'admin-layout', title: '积分消耗项目' })

// 组件引用
const formDialogRef = ref<InstanceType<typeof import('~/components/admin/point-items/FormDialog.vue').default> | null>(null)

// 状态
const loading = ref(false)
const deleting = ref(false)
const items = ref<PointConsumptionItem[]>([])
const groups = ref<string[]>([])
const pagination = ref({ page: 1, pageSize: 20, total: 0 })
const groupFilter = ref('all')
const statusFilter = ref('all')
const keyword = ref('')

// 删除对话框状态
const deleteDialogOpen = ref(false)
const selectedItem = ref<PointConsumptionItem | null>(null)

// 分组标签映射
const groupLabels: Record<string, string> = {
    material: '材料处理',
    analysisModules: '分析模块',
    agentToken: 'Agent Token 消耗',
}

// 获取分组标签
const getGroupLabel = (group: string) => {
    return groupLabels[group] || group
}

// 格式化折扣
const formatDiscount = (discount: number | string | null | undefined) => {
    if (discount === null || discount === undefined) return '100%'
    const num = typeof discount === 'string' ? parseFloat(discount) : discount
    if (isNaN(num)) return '100%'
    return `${Math.round(num * 100)}%`
}

// 加载分组列表
const loadGroups = async () => {
    const data = await useApiFetch<string[]>('/api/v1/admin/point-consumption-items/groups')
    if (data) groups.value = data
}

// 加载项目列表
const loadItems = async () => {
    loading.value = true
    try {
        const params: Record<string, any> = {
            page: pagination.value.page,
            pageSize: pagination.value.pageSize,
        }
        if (groupFilter.value !== 'all') params.group = groupFilter.value
        if (statusFilter.value !== 'all') params.status = parseInt(statusFilter.value)
        if (keyword.value) params.keyword = keyword.value

        const data = await useApiFetch<{ items: PointConsumptionItem[]; total: number }>('/api/v1/admin/point-consumption-items', { query: params })
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
const handleToggleStatus = async (item: PointConsumptionItem) => {
    const newStatus = item.status === 1 ? 0 : 1
    const result = await useApiFetch(`/api/v1/admin/point-consumption-items/status/${item.id}`, {
        method: 'PUT',
        body: { status: newStatus }
    })
    if (result !== null) {
        toast.success(newStatus === 1 ? '已启用' : '已禁用')
        loadItems()
    }
}

// 删除项目
const handleDelete = (item: PointConsumptionItem) => {
    selectedItem.value = item
    deleteDialogOpen.value = true
}

const confirmDelete = async () => {
    if (!selectedItem.value) return
    deleting.value = true
    try {
        const result = await useApiFetch(`/api/v1/admin/point-consumption-items/${selectedItem.value.id}`, { method: 'DELETE' })
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
    loadGroups()
    loadItems()
})
</script>
