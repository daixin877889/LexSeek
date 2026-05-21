<template>
        <div class="theme-brand space-y-6">
            <!-- 页面标题 -->
            <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                    <h1 class="text-2xl md:text-3xl font-bold mb-1">案件类型管理</h1>
                    <p class="text-muted-foreground text-sm">管理案件分析的类型配置</p>
                </div>
                <Button :class="adminBrandPrimaryButtonClass" @click="formDialogRef?.openCreate()">
                    <Plus class="h-4 w-4 mr-2" />
                    新增类型
                </Button>
            </div>

            <!-- 筛选 -->
            <div class="flex flex-col md:flex-row gap-4">
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
                    <Input v-model="keyword" placeholder="搜索类型名称/描述..." :class="['w-full md:w-64', adminBrandFocusClass]"
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
                <FolderKanban class="h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 class="text-lg font-medium mb-1">暂无案件类型</h3>
                <p class="text-muted-foreground text-sm">点击上方按钮新增类型</p>
            </div>

            <!-- 类型列表 -->
            <template v-else>
                <div class="bg-card rounded-lg border overflow-hidden">
                    <Table>
                        <TableHeader>
                            <TableRow class="bg-muted/50 hover:bg-muted/50">
                                <TableHead class="w-[60px]">ID</TableHead>
                                <TableHead>类型名称</TableHead>
                                <TableHead>描述</TableHead>
                                <TableHead class="w-[80px]">图标</TableHead>
                                <TableHead class="w-[80px]">优先级</TableHead>
                                <TableHead class="w-[80px]">状态</TableHead>
                                <TableHead class="w-[160px]">创建时间</TableHead>
                                <TableHead class="w-[100px] text-right">操作</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            <TableRow v-for="item in items" :key="item.id" class="hover:bg-muted/30">
                                <TableCell class="font-medium">{{ item.id }}</TableCell>
                                <TableCell class="font-medium">{{ item.name }}</TableCell>
                                <TableCell class="text-muted-foreground max-w-[200px] truncate">
                                    {{ item.description || '-' }}
                                </TableCell>
                                <TableCell>
                                    <span v-if="item.icon" class="text-muted-foreground text-sm">{{ item.icon }}</span>
                                    <span v-else class="text-muted-foreground">-</span>
                                </TableCell>
                                <TableCell>{{ item.priority }}</TableCell>
                                <TableCell>
                                    <Badge variant="outline" :class="getAdminStatusBadgeClass(item.status === 1)">
                                        {{ item.status === 1 ? '启用' : '禁用' }}
                                    </Badge>
                                </TableCell>
                                <TableCell class="text-muted-foreground">
                                    {{ formatDate(String(item.createdAt)) }}
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
        <AdminCaseTypesFormDialog ref="formDialogRef" @success="loadItems" />

        <!-- 删除确认对话框 -->
        <AlertDialog v-model:open="deleteDialogOpen">
            <AlertDialogContent class="theme-brand">
                <AlertDialogHeader>
                    <AlertDialogTitle>确认删除</AlertDialogTitle>
                    <AlertDialogDescription>
                        确定要删除案件类型「{{ selectedItem?.name }}」吗？此操作不可撤销。
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
import { Plus, Loader2, FolderKanban, Search, MoreHorizontal, Pencil, Trash2, Power } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import dayjs from 'dayjs'
import AdminCaseTypesFormDialog from '~/components/admin/case-types/FormDialog.vue'
import GeneralPagination from '~/components/general/pagination.vue'
import { useApiFetch } from '~/composables/useApiFetch'
import { useFormatters } from '~/composables/useFormatters'
import {
    adminBrandDestructiveActionClass,
    adminBrandFocusClass,
    adminBrandPrimaryButtonClass,
    getAdminStatusBadgeClass,
} from '~/utils/adminBrandStyles'

// 案件类型接口
interface CaseType {
    id: number
    name: string
    description?: string | null
    icon?: string | null
    priority: number
    status: number
    createdAt: Date | string
    updatedAt: Date | string
}

definePageMeta({ layout: 'admin-layout', title: '案件类型管理' })

// 组件引用
const formDialogRef = ref<InstanceType<typeof import('~/components/admin/case-types/FormDialog.vue').default> | null>(null)

// 状态
const loading = ref(false)
const deleting = ref(false)
const items = ref<CaseType[]>([])
const pagination = ref({ page: 1, pageSize: 20, total: 0 })
const statusFilter = ref('all')
const keyword = ref('')

// 删除对话框状态
const deleteDialogOpen = ref(false)
const selectedItem = ref<CaseType | null>(null)

const { formatDate } = useFormatters()

// 加载类型列表
const loadItems = async () => {
    loading.value = true
    try {
        const params: Record<string, any> = {
            page: pagination.value.page,
            pageSize: pagination.value.pageSize,
        }
        if (statusFilter.value !== 'all') params.status = parseInt(statusFilter.value)
        if (keyword.value) params.keyword = keyword.value

        const data = await useApiFetch<{ items: CaseType[]; total: number }>('/api/v1/admin/case-types', { query: params })
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
const handleToggleStatus = async (item: CaseType) => {
    const newStatus = item.status === 1 ? 0 : 1
    const result = await useApiFetch(`/api/v1/admin/case-types/status/${item.id}`, {
        method: 'PUT',
        body: { status: newStatus }
    })
    if (result !== null) {
        toast.success(newStatus === 1 ? '已启用' : '已禁用')
        loadItems()
    }
}

// 删除类型
const handleDelete = (item: CaseType) => {
    selectedItem.value = item
    deleteDialogOpen.value = true
}

const confirmDelete = async () => {
    if (!selectedItem.value) return
    deleting.value = true
    try {
        const result = await useApiFetch(`/api/v1/admin/case-types/${selectedItem.value.id}`, { method: 'DELETE' })
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
