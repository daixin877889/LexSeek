<template>
    <NuxtLayout name="admin-layout">
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
                <div class="bg-card rounded-lg border overflow-hidden hidden md:block">
                    <table class="w-full">
                        <thead>
                            <tr class="border-b bg-muted/50">
                                <th class="w-10 px-2 py-3"></th>
                                <th class="px-4 py-3 text-left text-sm font-medium w-16">序号</th>
                                <th class="px-4 py-3 text-left text-sm font-medium">法律名称</th>
                                <th class="px-4 py-3 text-left text-sm font-medium w-24">类型</th>
                                <th class="px-4 py-3 text-center text-sm font-medium w-24">状态</th>
                                <th class="px-4 py-3 text-center text-sm font-medium w-32">操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            <template v-for="(legal, index) in legalList" :key="legal.id">
                                <!-- 主行 - 可点击展开 -->
                                <tr class="border-b cursor-pointer transition-colors group hover:bg-muted/30"
                                    @click="toggleRow(legal.id)">
                                    <!-- 展开图标 -->
                                    <td class="px-2 py-2.5 text-center">
                                        <div
                                            class="w-6 h-6 rounded flex items-center justify-center bg-muted/50 group-hover:bg-primary/10 transition-colors">
                                            <ChevronDown v-if="expandedRows.has(legal.id)"
                                                class="w-4 h-4 text-primary transition-transform" />
                                            <ChevronRight v-else
                                                class="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                                        </div>
                                    </td>
                                    <!-- 序号 -->
                                    <td class="px-4 py-2.5 text-sm text-muted-foreground">
                                        {{ (pagination.page - 1) * pagination.pageSize + index + 1 }}
                                    </td>
                                    <!-- 法律名称（点击进入详情页） -->
                                    <td class="py-2.5" @click.stop="navigateTo(`/admin/legal-main/detail/${legal.id}`)">
                                        <span
                                            class="font-medium text-[#18181B] dark:text-zinc-100 hover:underline cursor-pointer">
                                            {{ legal.name }}
                                        </span>
                                    </td>
                                    <!-- 类型 -->
                                    <td class="px-4 py-2.5">
                                        <span :class="getTypeClass(legal.type)">
                                            {{ getTypeName(legal.type) }}
                                        </span>
                                    </td>
                                    <!-- 状态 -->
                                    <td class="px-4 py-2.5 text-center">
                                        <span :class="getStatusClass(legal)">
                                            {{ getStatusText(legal) }}
                                        </span>
                                    </td>
                                    <!-- 操作 - 阻止点击事件冒泡 -->
                                    <td class="px-4 py-2.5 text-center" @click.stop>
                                        <div class="flex items-center justify-center gap-1">
                                            <Button variant="ghost" size="icon" class="h-7 w-7" title="查看条文"
                                                @click="navigateTo(`/admin/legal-main/articles/${legal.id}`)">
                                                <FileText class="h-3.5 w-3.5" />
                                            </Button>
                                            <Button variant="ghost" size="icon" class="h-7 w-7" title="编辑"
                                                @click="navigateTo(`/admin/legal-main/edit/${legal.id}`)">
                                                <Pencil class="h-3.5 w-3.5" />
                                            </Button>
                                            <Button variant="ghost" size="icon"
                                                class="h-7 w-7 text-destructive hover:text-destructive" title="删除"
                                                @click="handleDelete(legal)">
                                                <Trash2 class="h-3.5 w-3.5" />
                                            </Button>
                                        </div>
                                    </td>
                                </tr>
                                <!-- 展开详情行 -->
                                <tr v-if="expandedRows.has(legal.id)" class="bg-primary/5 border-b">
                                    <td colspan="6" class="px-4 py-4">
                                        <div class="pl-8 space-y-4">
                                            <!-- 法律代码（单独一行） -->
                                            <div class="text-sm">
                                                <p class="text-muted-foreground mb-1">法律代码</p>
                                                <p class="font-mono text-xs break-all">{{ legal.code }}</p>
                                            </div>
                                            <!-- 基本信息 -->
                                            <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                                                <div>
                                                    <p class="text-muted-foreground mb-1">发文机关</p>
                                                    <p class="font-medium">{{ legal.issuingAuthority || '-' }}</p>
                                                </div>
                                                <div>
                                                    <p class="text-muted-foreground mb-1">文号</p>
                                                    <p class="font-medium">{{ legal.documentNumber || '-' }}</p>
                                                </div>
                                                <div>
                                                    <p class="text-muted-foreground mb-1">发布日期</p>
                                                    <p class="font-medium">{{ legal.publishDate || '-' }}</p>
                                                </div>
                                                <div>
                                                    <p class="text-muted-foreground mb-1">生效日期</p>
                                                    <p class="font-medium">{{ legal.effectiveDate || '-' }}</p>
                                                </div>
                                            </div>
                                            <!-- 其他信息 -->
                                            <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                                                <div>
                                                    <p class="text-muted-foreground mb-1">失效日期</p>
                                                    <p class="font-medium">{{ legal.invalidDate || '-' }}</p>
                                                </div>
                                                <div>
                                                    <p class="text-muted-foreground mb-1">创建时间</p>
                                                    <p class="font-medium">{{ formatDate(legal.createdAt) }}</p>
                                                </div>
                                                <div>
                                                    <p class="text-muted-foreground mb-1">最后编辑</p>
                                                    <p class="font-medium">{{ formatDate(legal.lastEditedAt) }}</p>
                                                </div>
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            </template>
                        </tbody>
                    </table>
                </div>

                <!-- 移动端卡片 -->
                <div class="md:hidden space-y-2">
                    <div v-for="(legal, index) in legalList" :key="legal.id"
                        class="bg-card rounded-lg border overflow-hidden">
                        <!-- 卡片头部 - 可点击展开 -->
                        <div class="p-3 cursor-pointer" @click="toggleRow(legal.id)">
                            <div class="flex items-start justify-between gap-2">
                                <div class="flex items-center gap-2 flex-1 min-w-0">
                                    <div class="w-5 h-5 rounded flex items-center justify-center bg-muted/50 shrink-0">
                                        <ChevronDown v-if="expandedRows.has(legal.id)"
                                            class="w-3.5 h-3.5 text-primary" />
                                        <ChevronRight v-else class="w-3.5 h-3.5 text-muted-foreground" />
                                    </div>
                                    <span class="text-xs text-muted-foreground shrink-0">{{
                                        (pagination.page - 1) * pagination.pageSize + index + 1 }}</span>
                                    <span class="font-medium truncate text-[#18181B] dark:text-zinc-100"
                                        @click.stop="navigateTo(`/admin/legal-main/detail/${legal.id}`)">
                                        {{ legal.name }}
                                    </span>
                                </div>
                                <span :class="getStatusClass(legal)">
                                    {{ getStatusText(legal) }}
                                </span>
                            </div>
                            <div class="flex items-center gap-2 mt-1.5 pl-7">
                                <span :class="getTypeClass(legal.type)">
                                    {{ getTypeName(legal.type) }}
                                </span>
                                <span v-if="legal.issuingAuthority" class="text-xs text-muted-foreground">
                                    {{ legal.issuingAuthority }}
                                </span>
                            </div>
                        </div>
                        <!-- 展开内容 -->
                        <div v-if="expandedRows.has(legal.id)" class="border-t bg-muted/30 p-3 space-y-3">
                            <!-- 详细信息 -->
                            <div class="grid grid-cols-2 gap-2 text-xs">
                                <div>
                                    <p class="text-muted-foreground mb-0.5">文号</p>
                                    <p class="font-medium">{{ legal.documentNumber || '-' }}</p>
                                </div>
                                <div>
                                    <p class="text-muted-foreground mb-0.5">发布日期</p>
                                    <p class="font-medium">{{ legal.publishDate || '-' }}</p>
                                </div>
                                <div>
                                    <p class="text-muted-foreground mb-0.5">生效日期</p>
                                    <p class="font-medium">{{ legal.effectiveDate || '-' }}</p>
                                </div>
                                <div>
                                    <p class="text-muted-foreground mb-0.5">失效日期</p>
                                    <p class="font-medium">{{ legal.invalidDate || '-' }}</p>
                                </div>
                            </div>
                            <!-- 操作按钮 -->
                            <div class="flex items-center gap-2 pt-2 border-t">
                                <Button variant="outline" size="sm" class="flex-1 h-8 text-xs"
                                    @click.stop="navigateTo(`/admin/legal-main/articles/${legal.id}`)">
                                    <FileText class="h-3 w-3 mr-1" />
                                    条文
                                </Button>
                                <Button variant="outline" size="sm" class="flex-1 h-8 text-xs"
                                    @click.stop="navigateTo(`/admin/legal-main/edit/${legal.id}`)">
                                    <Pencil class="h-3 w-3 mr-1" />
                                    编辑
                                </Button>
                                <Button variant="outline" size="sm"
                                    class="h-8 text-xs text-destructive hover:text-destructive"
                                    @click.stop="handleDelete(legal)">
                                    <Trash2 class="h-3 w-3" />
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>

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
    </NuxtLayout>
</template>

<script setup lang="ts">
import { Plus, Search, Pencil, Trash2, Loader2, Scale, FileText, ChevronRight, ChevronDown, RotateCcw } from 'lucide-vue-next'
import dayjs from 'dayjs'
import { toast } from 'vue-sonner'
import type { LegalMainListItem, LegalType, PaginatedResponse } from '#shared/types/legal'

definePageMeta({
    layout: false,
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
        status: ['all', 'valid', 'invalid', 'pending']
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

/** 格式化日期 */
const formatDate = (date: string | Date | null | undefined): string => {
    if (!date) return '-'
    return dayjs(date).format('YYYY-MM-DD HH:mm')
}

/** 获取类型名称 */
const getTypeName = (type: LegalType): string => {
    const typeMap: Record<string, string> = {
        law: '法律',
        regulation: '行政法规',
        judicial_interp: '司法解释',
        guideline: '指导意见',
    }
    return typeMap[type] || type
}

/** 获取类型样式类 */
const getTypeClass = (type: LegalType): string => {
    const baseClass = 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium'
    const typeClasses: Record<string, string> = {
        law: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
        regulation: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
        judicial_interp: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
        guideline: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
    }
    return `${baseClass} ${typeClasses[type] || typeClasses.guideline}`
}

/** 获取状态文本 */
const getStatusText = (legal: LegalMainListItem): string => {
    if (legal.invalidDate) {
        const invalidDate = dayjs(legal.invalidDate)
        if (invalidDate.isBefore(dayjs())) {
            return '已失效'
        }
    }
    if (legal.effectiveDate) {
        const effectiveDate = dayjs(legal.effectiveDate)
        if (effectiveDate.isAfter(dayjs())) {
            return '未生效'
        }
    }
    return '有效'
}

/** 获取状态样式类 */
const getStatusClass = (legal: LegalMainListItem): string => {
    const baseClass = 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap'
    const status = getStatusText(legal)
    if (status === '有效') {
        return `${baseClass} bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400`
    }
    if (status === '已失效') {
        return `${baseClass} bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400`
    }
    return `${baseClass} bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400`
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
