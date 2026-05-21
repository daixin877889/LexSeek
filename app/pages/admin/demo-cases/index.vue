<template>
        <div class="theme-brand space-y-6">
            <!-- 页面标题 -->
            <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                    <h1 class="text-2xl md:text-3xl font-bold mb-1">示范案例</h1>
                    <p class="text-muted-foreground text-sm">管理预设的示范案例，供用户快速体验分析流程</p>
                </div>
                <Button :class="adminBrandPrimaryButtonClass" @click="formDialogRef?.openCreate()">
                    <Plus class="h-4 w-4 mr-2" />
                    新增案例
                </Button>
            </div>

            <!-- 筛选 -->
            <div class="flex flex-col md:flex-row gap-4">
                <Select v-model="caseTypeFilter">
                    <SelectTrigger :class="['w-full md:w-48', adminBrandFocusClass]">
                        <SelectValue placeholder="案件类型" />
                    </SelectTrigger>
                    <SelectContent class="theme-brand">
                        <SelectItem value="all">全部类型</SelectItem>
                        <SelectItem v-for="t in caseTypes" :key="t.id" :value="String(t.id)">
                            {{ t.name }}
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
                    <Input v-model="keyword" placeholder="搜索案例标题/简介..." :class="['w-full md:w-64', adminBrandFocusClass]"
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
                <FileText class="h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 class="text-lg font-medium mb-1">暂无示范案例</h3>
                <p class="text-muted-foreground text-sm">点击上方按钮新增案例</p>
            </div>

            <!-- 案例列表 -->
            <template v-else>
                <div class="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead class="w-[60px]">ID</TableHead>
                                <TableHead>案例标题</TableHead>
                                <TableHead>案件类型</TableHead>
                                <TableHead class="w-[100px]">材料数量</TableHead>
                                <TableHead class="w-[80px]">优先级</TableHead>
                                <TableHead class="w-[80px]">状态</TableHead>
                                <TableHead class="w-[100px] text-right">操作</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            <TableRow v-for="item in items" :key="item.id">
                                <TableCell class="font-medium">{{ item.id }}</TableCell>
                                <TableCell>
                                    <div>
                                        <div class="font-medium">{{ item.title }}</div>
                                        <div v-if="item.description"
                                            class="text-sm text-muted-foreground truncate max-w-xs">
                                            {{ item.description }}
                                        </div>
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <Badge variant="outline" :class="adminBrandChipClass">
                                        {{ getCaseTypeName(item.caseTypeId) }}
                                    </Badge>
                                </TableCell>
                                <TableCell>{{ getMaterialCount(item.materials) }}</TableCell>
                                <TableCell>{{ item.priority }}</TableCell>
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
                                        <DropdownMenuContent align="end" class="theme-brand">
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
        <AdminDemoCasesFormDialog ref="formDialogRef" :case-types="caseTypes" @success="loadItems" />

        <!-- 删除确认对话框 -->
        <AlertDialog v-model:open="deleteDialogOpen">
            <AlertDialogContent class="theme-brand">
                <AlertDialogHeader>
                    <AlertDialogTitle>确认删除</AlertDialogTitle>
                    <AlertDialogDescription>
                        确定要删除示范案例「{{ selectedItem?.title }}」吗？此操作不可撤销。
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction :class="adminBrandDestructiveActionClass" @click="confirmDelete" :disabled="deleting">
                        <Loader2 v-if="deleting" class="h-4 w-4 mr-2 animate-spin" />
                        确认删除
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
</template>

<script setup lang="ts">
import { Plus, Loader2, FileText, Search, MoreHorizontal, Pencil, Trash2, Power } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import AdminDemoCasesFormDialog from '~/components/admin/demo-cases/FormDialog.vue'
import GeneralPagination from '~/components/general/pagination.vue'
import { useApiFetch } from '~/composables/useApiFetch'
import {
    adminBrandChipClass,
    adminBrandDestructiveActionClass,
    adminBrandFocusClass,
    adminBrandPrimaryButtonClass,
    getAdminStatusBadgeClass,
} from '~/utils/adminBrandStyles'

/** 示范案例类型 */
interface DemoCase {
    id: number
    title: string
    description?: string | null
    caseTypeId: number
    materials: any[]
    coverImage?: string | null
    priority: number
    status: number
}

/** 案件类型 */
interface CaseType {
    id: number
    name: string
}

definePageMeta({ layout: 'admin-layout', title: '示范案例' })

// 组件引用
const formDialogRef = ref<InstanceType<typeof import('~/components/admin/demo-cases/FormDialog.vue').default> | null>(null)

// 状态
const loading = ref(false)
const deleting = ref(false)
const items = ref<DemoCase[]>([])
const caseTypes = ref<CaseType[]>([])
const pagination = ref({ page: 1, pageSize: 20, total: 0 })
const caseTypeFilter = ref('all')
const statusFilter = ref('all')
const keyword = ref('')

// 删除对话框状态
const deleteDialogOpen = ref(false)
const selectedItem = ref<DemoCase | null>(null)

// 获取案件类型名称
const getCaseTypeName = (caseTypeId: number) => {
    const caseType = caseTypes.value.find(t => t.id === caseTypeId)
    return caseType?.name || `类型 ${caseTypeId}`
}

// 获取材料数量
const getMaterialCount = (materials: any) => {
    if (Array.isArray(materials)) return materials.length
    return 0
}

// 加载案件类型列表
const loadCaseTypes = async () => {
    const data = await useApiFetch<{ items: CaseType[] }>('/api/v1/case-types')
    if (data) {
        caseTypes.value = data.items
    }
}

// 加载案例列表
const loadItems = async () => {
    loading.value = true
    try {
        const params: Record<string, any> = {
            page: pagination.value.page,
            pageSize: pagination.value.pageSize,
        }
        if (caseTypeFilter.value !== 'all') params.caseTypeId = parseInt(caseTypeFilter.value)
        if (statusFilter.value !== 'all') params.status = parseInt(statusFilter.value)
        if (keyword.value) params.keyword = keyword.value

        const data = await useApiFetch<{ items: DemoCase[]; total: number }>('/api/v1/admin/demo-cases', { query: params })
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
const handleToggleStatus = async (item: DemoCase) => {
    const newStatus = item.status === 1 ? 0 : 1
    const result = await useApiFetch(`/api/v1/admin/demo-cases/status/${item.id}`, {
        method: 'PUT',
        body: { status: newStatus }
    })
    if (result !== null) {
        toast.success(newStatus === 1 ? '已启用' : '已禁用')
        loadItems()
    }
}

// 删除案例
const handleDelete = (item: DemoCase) => {
    selectedItem.value = item
    deleteDialogOpen.value = true
}

const confirmDelete = async () => {
    if (!selectedItem.value) return
    deleting.value = true
    try {
        const result = await useApiFetch(`/api/v1/admin/demo-cases/${selectedItem.value.id}`, { method: 'DELETE' })
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
    loadCaseTypes()
    loadItems()
})
</script>
