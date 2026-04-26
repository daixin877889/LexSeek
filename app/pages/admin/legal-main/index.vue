<template>
        <div class="space-y-6">
            <!-- 页面标题 -->
            <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                    <h1 class="text-2xl md:text-3xl font-bold mb-1">法律法规管理</h1>
                    <p class="text-muted-foreground text-sm">管理法律、法规、司法解释等法律文件</p>
                </div>
                <Button @click="navigateTo('/admin/legal-main/create')" class="w-full md:w-auto">
                    <Plus class="h-4 w-4 mr-2" />
                    添加法律法规
                </Button>
            </div>

            <!-- 搜索和筛选 -->
            <div class="flex flex-col md:flex-row gap-4 flex-wrap">
                <Input v-model="searchKeyword" placeholder="搜索法律名称、文号..." class="md:max-w-sm"
                    @keyup.enter="handleSearch" />
                <Select v-model="typeFilter">
                    <SelectTrigger class="w-full md:w-36">
                        <SelectValue placeholder="法律类型" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">全部类型</SelectItem>
                        <SelectItem value="law">法律</SelectItem>
                        <SelectItem value="regulation">行政法规</SelectItem>
                        <SelectItem value="judicial_interp">司法解释</SelectItem>
                        <SelectItem value="guideline">指导意见</SelectItem>
                    </SelectContent>
                </Select>
                <Select v-model="statusFilter">
                    <SelectTrigger class="w-full md:w-32">
                        <SelectValue placeholder="状态" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">全部状态</SelectItem>
                        <SelectItem value="valid">有效</SelectItem>
                        <SelectItem value="invalid">已失效</SelectItem>
                        <SelectItem value="pending">未生效</SelectItem>
                    </SelectContent>
                </Select>
                <Input v-model="issuingAuthorityFilter" placeholder="发文机关..." class="md:max-w-40"
                    @keyup.enter="handleSearch" />
                <div class="flex gap-2">
                    <Button variant="outline" @click="handleSearch">
                        <Search class="h-4 w-4 mr-2" />
                        搜索
                    </Button>
                    <Button variant="ghost" @click="handleReset" title="重置筛选">
                        <RotateCcw class="h-4 w-4" />
                    </Button>
                </div>
            </div>

            <!-- 加载状态 -->
            <div v-if="loading" class="flex justify-center py-12">
                <Loader2 class="h-10 w-10 animate-spin text-muted-foreground" />
            </div>

            <!-- 空状态 -->
            <div v-else-if="!legalList.length" class="flex flex-col items-center justify-center py-12 text-center">
                <Scale class="h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 class="text-lg font-medium mb-1">暂无法律法规数据</h3>
                <p class="text-muted-foreground text-sm mb-4">点击上方按钮添加第一条法律法规</p>
                <Button @click="navigateTo('/admin/legal-main/create')">
                    <Plus class="h-4 w-4 mr-2" />
                    添加法律法规
                </Button>
            </div>

            <!-- 法律法规列表 -->
            <template v-else>
                <!-- 桌面端折叠表格 -->
                <AdminLegalMainTable :legal-list="legalList" :expanded-rows="expandedRows"
                    :start-index="(pagination.page - 1) * pagination.pageSize" @toggle-expand="toggleRow"
                    @view-detail="(id: string) => navigateTo(`/admin/legal-main/detail/${id}`)"
                    @view-articles="(id: string) => navigateTo(`/admin/legal-main/articles/${id}`)"
                    @edit="(id: string) => navigateTo(`/admin/legal-main/edit/${id}`)" @delete="handleDelete" />

                <!-- 移动端卡片 -->
                <AdminLegalMainMobile :legal-list="legalList" :expanded-rows="expandedRows"
                    :start-index="(pagination.page - 1) * pagination.pageSize" @toggle-expand="toggleRow"
                    @view-detail="(id: string) => navigateTo(`/admin/legal-main/detail/${id}`)"
                    @view-articles="(id: string) => navigateTo(`/admin/legal-main/articles/${id}`)"
                    @edit="(id: string) => navigateTo(`/admin/legal-main/edit/${id}`)" @delete="handleDelete" />

                <!-- 分页 -->
                <GeneralPagination :current-page="pagination.page" :page-size="pagination.pageSize"
                    :total="pagination.total" @change="changePage" />
            </template>
        </div>

        <!-- 删除确认对话框 -->
        <AlertDialog v-model:open="deleteDialogOpen">
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>确认删除</AlertDialogTitle>
                    <AlertDialogDescription>
                        确定要删除「{{ legalToDelete?.name }}」吗？此操作将同时删除所有关联的条文和向量数据，不可撤销。
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction @click="confirmDelete" class="bg-destructive text-white hover:bg-destructive/90">
                        删除
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
</template>

<script setup lang="ts">
import { Plus, Search, Loader2, Scale, RotateCcw } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { LegalMainListItem, PaginatedResponse } from '#shared/types/legal'
import { VALIDITY_STATUS_FILTERS } from '#shared/types/legal-search'
import AdminLegalMainMobile from '~/components/admin/legal-main/LegalMainMobile.vue'
import AdminLegalMainTable from '~/components/admin/legal-main/LegalMainTable.vue'
import GeneralPagination from '~/components/general/pagination.vue'
import { useApiFetch } from '~/composables/useApiFetch'
import { useUrlState } from '~/composables/useUrlState'

definePageMeta({
    layout: 'admin-layout',
    title: "法律法规管理",
})

/** 分页信息 */
const pagination = ref({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 0,
})

/** 搜索关键字 */
const searchKeyword = ref('')

/** 类型筛选 */
const typeFilter = ref('all')

/** 状态筛选 */
const statusFilter = ref('all')

/** 发文机关筛选 */
const issuingAuthorityFilter = ref('')

/** URL 状态管理 */
const { syncToUrl, restoreFromUrl } = useUrlState({
    defaultValues: {
        keyword: '',
        type: 'all',
        status: 'all',
        issuingAuthority: '',
        page: 1,
        pageSize: 20
    },
    validValues: {
        type: ['all', 'law', 'regulation', 'judicial_interp', 'guideline'],
        status: [...VALIDITY_STATUS_FILTERS]
    }
})

/** 加载状态 */
const loading = ref(false)

/** 法律法规列表 */
const legalList = ref<LegalMainListItem[]>([])

/** 已展开的行 ID 集合 */
const expandedRows = ref<Set<string>>(new Set())

/** 删除对话框 */
const deleteDialogOpen = ref(false)
const legalToDelete = ref<LegalMainListItem | null>(null)

/** 切换行的展开/收起状态 */
const toggleRow = (id: string) => {
    if (expandedRows.value.has(id)) {
        expandedRows.value.delete(id)
    } else {
        expandedRows.value.add(id)
    }
    // 触发响应式更新
    expandedRows.value = new Set(expandedRows.value)
}

/** 加载法律法规列表 */
const loadLegalList = async () => {
    loading.value = true
    try {
        const params: Record<string, any> = {
            page: pagination.value.page,
            pageSize: pagination.value.pageSize,
        }
        if (searchKeyword.value) {
            params.keyword = searchKeyword.value
        }
        if (typeFilter.value !== 'all') {
            params.type = typeFilter.value
        }
        if (statusFilter.value !== 'all') {
            params.status = statusFilter.value
        }
        if (issuingAuthorityFilter.value) {
            params.issuingAuthority = issuingAuthorityFilter.value
        }

        const data = await useApiFetch<PaginatedResponse<LegalMainListItem>>('/api/v1/admin/legal-main', { query: params })
        if (data) {
            legalList.value = data.items
            pagination.value.total = data.total
            pagination.value.totalPages = data.totalPages
        }
    } finally {
        loading.value = false
    }
}

/** 搜索 */
const handleSearch = () => {
    pagination.value.page = 1
    expandedRows.value = new Set()

    // 同步搜索条件到 URL
    syncToUrl({
        keyword: searchKeyword.value,
        type: typeFilter.value as any,
        status: statusFilter.value as any,
        issuingAuthority: issuingAuthorityFilter.value,
        page: 1,
        pageSize: pagination.value.pageSize
    })

    loadLegalList()
}

/** 重置筛选 */
const handleReset = () => {
    searchKeyword.value = ''
    typeFilter.value = 'all'
    statusFilter.value = 'all'
    issuingAuthorityFilter.value = ''
    pagination.value.page = 1
    expandedRows.value = new Set()

    // 清空 URL 参数
    syncToUrl({
        keyword: '',
        type: 'all',
        status: 'all',
        issuingAuthority: '',
        page: 1,
        pageSize: pagination.value.pageSize
    })

    loadLegalList()
}

/** 切换页码 */
const changePage = (page: number) => {
    pagination.value.page = page
    expandedRows.value = new Set()
    loadLegalList()
}

/** 删除法律法规 */
const handleDelete = (legal: LegalMainListItem) => {
    legalToDelete.value = legal
    deleteDialogOpen.value = true
}

/** 确认删除 */
const confirmDelete = async () => {
    if (!legalToDelete.value) return

    const result = await useApiFetch(`/api/v1/admin/legal-main/${legalToDelete.value.id}`, {
        method: 'DELETE',
    })

    if (result !== null) {
        toast.success('删除成功')
        loadLegalList()
    }

    deleteDialogOpen.value = false
    legalToDelete.value = null
}

/** 防止循环更新的标志 */
const isRestoring = ref(false)

/** 监听筛选条件变化，同步到 URL */
watch(
    () => [typeFilter.value, statusFilter.value, pagination.value.page, pagination.value.pageSize],
    () => {
        // 如果正在恢复状态，不触发 URL 同步
        if (isRestoring.value) return

        syncToUrl({
            keyword: searchKeyword.value,
            type: typeFilter.value as any,
            status: statusFilter.value as any,
            issuingAuthority: issuingAuthorityFilter.value,
            page: pagination.value.page,
            pageSize: pagination.value.pageSize
        })
    }
)

// 初始加载
onMounted(() => {
    try {
        // 从 URL 恢复筛选状态
        isRestoring.value = true
        const state = restoreFromUrl()
        searchKeyword.value = state.keyword
        typeFilter.value = state.type
        statusFilter.value = state.status
        issuingAuthorityFilter.value = state.issuingAuthority
        pagination.value.page = state.page
        pagination.value.pageSize = state.pageSize

        // 使用 nextTick 确保状态恢复完成后再启用 watch
        nextTick(() => {
            isRestoring.value = false
        })
    } catch (error) {
        // 记录错误日志
        console.error('[法律法规管理] URL 状态恢复失败:', error)

        // 使用默认值作为降级方案
        searchKeyword.value = ''
        typeFilter.value = 'all'
        statusFilter.value = 'all'
        issuingAuthorityFilter.value = ''
        pagination.value.page = 1
        pagination.value.pageSize = 20

        isRestoring.value = false
    }

    // 加载数据
    loadLegalList()
})
</script>
