<template>
        <div class="space-y-6">
            <!-- 页面标题 -->
            <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div class="flex items-center gap-4">
                    <Button variant="ghost" size="icon" @click="navigateTo('/admin/legal-main')">
                        <ArrowLeft class="h-4 w-4" />
                    </Button>
                    <div>
                        <h1 class="text-2xl md:text-3xl font-bold mb-1">{{ legalName || '法律条文管理' }}</h1>
                        <p class="text-muted-foreground text-sm">管理法律条文内容和向量化状态</p>
                    </div>
                </div>
                <div class="flex gap-2 w-full md:w-auto flex-wrap">
                    <Button variant="outline" @click="navigateTo(`/admin/legal-main/embeddings/${legalId}`)"
                        class="flex-1 md:flex-none" :disabled="sortMode">
                        <Database class="h-4 w-4 mr-2" />
                        嵌入记录
                    </Button>
                    <Button variant="outline" @click="handleBatchEmbed" class="flex-1 md:flex-none"
                        :disabled="sortMode || batchEmbedding">
                        <Loader2 v-if="batchEmbedding" class="h-4 w-4 mr-2 animate-spin" />
                        <Zap v-else class="h-4 w-4 mr-2" />
                        批量嵌入
                    </Button>
                    <Button variant="outline" @click="toggleSortMode" class="flex-1 md:flex-none">
                        <ArrowUpDown class="h-4 w-4 mr-2" />
                        {{ sortMode ? '退出排序' : '排序模式' }}
                    </Button>
                    <Button @click="showCreateDialog = true" class="flex-1 md:flex-none" :disabled="sortMode">
                        <Plus class="h-4 w-4 mr-2" />
                        添加条文
                    </Button>
                </div>
            </div>

            <!-- 筛选区域 -->
            <AdminLegalArticlesArticleFilters :filters="filters" @search="handleSearch" @reset="handleReset" />

            <!-- 排序模式视图 -->
            <template v-if="sortMode">
                <div class="bg-card rounded-lg border p-4">
                    <div class="flex items-center justify-between mb-4">
                        <div class="flex items-center gap-2">
                            <ArrowUpDown class="h-5 w-5 text-primary" />
                            <h3 class="font-medium">排序模式</h3>
                            <span class="text-sm text-muted-foreground">拖拽条目调整顺序，同级条文之间可排序</span>
                        </div>
                        <div class="flex items-center gap-2">
                            <Button variant="outline" size="sm" @click="cancelSort" :disabled="sortSaving">
                                取消
                            </Button>
                            <Button size="sm" @click="saveSort" :disabled="sortSaving || !hasSortChanges">
                                <Loader2 v-if="sortSaving" class="h-4 w-4 mr-2 animate-spin" />
                                <Save v-else class="h-4 w-4 mr-2" />
                                保存排序
                            </Button>
                        </div>
                    </div>
                    <LegalArticleSortTree ref="sortTreeRef" :legal-id="legalId" @change="handleSortChange" />
                </div>
            </template>

            <!-- 普通列表视图 -->
            <template v-else>
                <!-- 加载状态 -->
                <div v-if="loading" class="flex justify-center py-12">
                    <Loader2 class="h-10 w-10 animate-spin text-muted-foreground" />
                </div>

                <!-- 空状态 -->
                <div v-else-if="!articles.length" class="flex flex-col items-center justify-center py-12 text-center">
                    <FileText class="h-12 w-12 text-muted-foreground/50 mb-4" />
                    <h3 class="text-lg font-medium mb-1">{{ hasFilters ? '未找到匹配的条文' : '暂无条文数据' }}</h3>
                    <p class="text-muted-foreground text-sm mb-4">{{ hasFilters ? '尝试调整筛选条件' : '点击上方按钮添加第一条条文' }}</p>
                    <Button v-if="hasFilters" variant="outline" @click="handleReset">
                        <RotateCcw class="h-4 w-4 mr-2" />
                        重置筛选
                    </Button>
                    <Button v-else @click="showCreateDialog = true">
                        <Plus class="h-4 w-4 mr-2" />
                        添加条文
                    </Button>
                </div>

                <!-- 条文列表 -->
                <template v-else>
                    <!-- 桌面端表格 -->
                    <AdminLegalArticlesArticleTable :articles="articles" :expanded-rows="expandedRows"
                        :start-index="(pagination.page - 1) * pagination.pageSize" :embedding-id="embeddingId"
                        @toggle-expand="toggleRow" @embed="handleEmbed" @edit="handleEdit" @delete="handleDelete" />

                    <!-- 移动端卡片 -->
                    <AdminLegalArticlesArticleMobile :articles="articles" :expanded-rows="expandedRows"
                        :start-index="(pagination.page - 1) * pagination.pageSize" :embedding-id="embeddingId"
                        @toggle-expand="toggleRow" @embed="handleEmbed" @edit="handleEdit" @delete="handleDelete" />

                    <!-- 分页 -->
                    <GeneralPagination :current-page="pagination.page" :page-size="pagination.pageSize"
                        :total="pagination.total" @change="changePage" />
                </template>
            </template>
        </div>

        <!-- 创建/编辑条文对话框 -->
        <Dialog v-model:open="showCreateDialog">
            <DialogContent class="!w-[90vw] !max-w-5xl !sm:max-w-5xl h-[85vh] flex flex-col p-0">
                <!-- 固定头部 -->
                <DialogHeader class="px-6 py-4 border-b shrink-0">
                    <DialogTitle>{{ editingArticle ? '编辑条文' : '添加条文' }}</DialogTitle>
                    <DialogDescription>
                        {{ editingArticle ? '修改条文信息' : '添加新的法律条文' }}
                    </DialogDescription>
                </DialogHeader>
                <!-- 表单区域（内部滚动） -->
                <div class="flex-1 overflow-hidden px-6 py-4">
                    <LegalArticleForm :legal-id="legalId" :initial-data="editingArticle" @submit="handleArticleSubmit"
                        @cancel="closeDialog" class="h-full" />
                </div>
            </DialogContent>
        </Dialog>

        <!-- 删除确认对话框 -->
        <AlertDialog v-model:open="deleteDialogOpen">
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>确认删除</AlertDialogTitle>
                    <AlertDialogDescription>
                        确定要删除此条文吗？此操作将同时删除关联的向量数据，不可撤销。
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
import { ArrowLeft, Plus, Loader2, FileText, ArrowUpDown, Save, Database, Zap, RotateCcw } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { LegalArticleListItem, CreateLegalArticleRequest, UpdateLegalArticleRequest } from '#shared/types/legal'

definePageMeta({
    layout: 'admin-layout',
    title: "法律条文管理",
})

const route = useRoute()
const legalId = route.params.id as string

/** 动态面包屑标题（与面包屑组件共享） */
const dynamicBreadcrumbTitle = useState<string | null>('breadcrumb-dynamic-title', () => null)

/** 排序模式 */
const sortMode = ref(false)
const sortSaving = ref(false)
const sortChanges = ref<{ id: string; order: number }[]>([])
const sortTreeRef = ref<{ refresh: () => void } | null>(null)

/** 是否有排序变更 */
const hasSortChanges = computed(() => sortChanges.value.length > 0)

/** 切换排序模式 */
const toggleSortMode = () => {
    if (sortMode.value) {
        // 退出排序模式
        if (hasSortChanges.value) {
            if (!confirm('有未保存的排序变更，确定要退出吗？')) {
                return
            }
        }
        sortMode.value = false
        sortChanges.value = []
    } else {
        sortMode.value = true
        sortChanges.value = []
    }
}

/** 取消排序 */
const cancelSort = () => {
    sortMode.value = false
    sortChanges.value = []
}

/** 处理排序变化 */
const handleSortChange = (items: { id: string; order: number }[]) => {
    const changeMap = new Map(sortChanges.value.map(item => [item.id, item]))
    for (const item of items) {
        changeMap.set(item.id, item)
    }
    sortChanges.value = Array.from(changeMap.values())
}

/** 保存排序 */
const saveSort = async () => {
    if (!hasSortChanges.value) return

    sortSaving.value = true
    try {
        const result = await useApiFetch('/api/v1/admin/legal-articles/batch-sort', {
            method: 'POST',
            body: {
                legalId,
                items: sortChanges.value,
            },
        })

        if (result) {
            toast.success('排序保存成功')
            sortChanges.value = []
            sortTreeRef.value?.refresh()
            loadArticles()
        }
    } finally {
        sortSaving.value = false
    }
}

/** 筛选条件 */
const filters = ref({
    keyword: '',
    type: 'all',
    l1: '',
    l2: '',
    l3: '',
    l4: '',
    l5: '',
})

/** 是否有筛选条件 */
const hasFilters = computed(() => {
    return filters.value.keyword ||
        (filters.value.type && filters.value.type !== 'all') ||
        filters.value.l1 ||
        filters.value.l2 ||
        filters.value.l3 ||
        filters.value.l4 ||
        filters.value.l5
})

/** 分页信息 */
const pagination = ref({
    page: 1,
    pageSize: 100,
    total: 0,
    totalPages: 0,
})

/** 加载状态 */
const loading = ref(false)

/** 法律名称 */
const legalName = ref('')

/** 条文列表 */
const articles = ref<LegalArticleListItem[]>([])

/** 已展开的行 ID 集合 */
const expandedRows = ref<Set<string>>(new Set())

/** 创建/编辑对话框 */
const showCreateDialog = ref(false)
const editingArticle = ref<LegalArticleListItem | null>(null)

/** 删除对话框 */
const deleteDialogOpen = ref(false)
const articleToDelete = ref<LegalArticleListItem | null>(null)

/** 向量化中的条文 ID */
const embeddingId = ref<string | null>(null)

/** 批量嵌入中 */
const batchEmbedding = ref(false)

/** 切换行的展开/收起状态 */
const toggleRow = (id: string) => {
    if (expandedRows.value.has(id)) {
        expandedRows.value.delete(id)
    } else {
        expandedRows.value.add(id)
    }
    expandedRows.value = new Set(expandedRows.value)
}

/** 加载法律详情 */
const loadLegalInfo = async () => {
    const data = await useApiFetch<{ name: string }>(`/api/v1/admin/legal-main/${legalId}`)
    if (data) {
        legalName.value = data.name
        dynamicBreadcrumbTitle.value = data.name
    }
}

/** 加载条文列表 */
const loadArticles = async () => {
    loading.value = true
    try {
        const params: Record<string, any> = {
            legalId,
            page: pagination.value.page,
            pageSize: pagination.value.pageSize,
        }

        // 添加筛选参数
        if (filters.value.keyword) params.keyword = filters.value.keyword
        if (filters.value.type && filters.value.type !== 'all') params.type = filters.value.type
        if (filters.value.l1) params.l1 = filters.value.l1
        if (filters.value.l2) params.l2 = filters.value.l2
        if (filters.value.l3) params.l3 = filters.value.l3
        if (filters.value.l4) params.l4 = filters.value.l4
        if (filters.value.l5) params.l5 = filters.value.l5

        const data = await useApiFetch<{ items: LegalArticleListItem[], total: number, totalPages: number }>('/api/v1/admin/legal-articles', { query: params })
        if (data) {
            articles.value = data.items
            pagination.value.total = data.total
            pagination.value.totalPages = data.totalPages
        }
    } finally {
        loading.value = false
    }
}

/** 搜索 */
const handleSearch = (newFilters: typeof filters.value) => {
    filters.value = newFilters
    pagination.value.page = 1
    expandedRows.value = new Set()
    loadArticles()
}

/** 重置筛选 */
const handleReset = () => {
    filters.value = {
        keyword: '',
        type: 'all',
        l1: '',
        l2: '',
        l3: '',
        l4: '',
        l5: '',
    }
    pagination.value.page = 1
    expandedRows.value = new Set()
    loadArticles()
}

/** 切换页码 */
const changePage = (page: number) => {
    pagination.value.page = page
    expandedRows.value = new Set()
    loadArticles()
}

/** 编辑条文 */
const handleEdit = (article: LegalArticleListItem) => {
    editingArticle.value = article
    showCreateDialog.value = true
}

/** 关闭对话框 */
const closeDialog = () => {
    showCreateDialog.value = false
    editingArticle.value = null
}

/** 提交条文表单 */
const handleArticleSubmit = async (data: CreateLegalArticleRequest | UpdateLegalArticleRequest) => {
    let result
    if (editingArticle.value) {
        result = await useApiFetch(`/api/v1/admin/legal-articles/${editingArticle.value.id}`, {
            method: 'PUT',
            body: data,
        })
    } else {
        result = await useApiFetch('/api/v1/admin/legal-articles', {
            method: 'POST',
            body: { ...data, legalId },
        })
    }

    if (result) {
        toast.success(editingArticle.value ? '更新成功' : '创建成功')
        closeDialog()
        loadArticles()
    }
}

/** 删除条文 */
const handleDelete = (article: LegalArticleListItem) => {
    articleToDelete.value = article
    deleteDialogOpen.value = true
}

/** 确认删除 */
const confirmDelete = async () => {
    if (!articleToDelete.value) return

    const result = await useApiFetch(`/api/v1/admin/legal-articles/${articleToDelete.value.id}`, {
        method: 'DELETE',
    })

    if (result !== null) {
        toast.success('删除成功')
        loadArticles()
    }

    deleteDialogOpen.value = false
    articleToDelete.value = null
}

/** 手动触发向量化 */
const handleEmbed = async (article: LegalArticleListItem) => {
    if (!article.content) {
        toast.error('条文没有内容，无法向量化')
        return
    }

    embeddingId.value = article.id
    try {
        const response = await $fetch<{ success: boolean; message: string }>(`/api/v1/admin/legal-articles/${article.id}/embed`, {
            method: 'POST',
        })

        if (response.success) {
            toast.success(response.message || '向量化成功')
            loadArticles()
        } else {
            toast.error(response.message || '向量化失败')
        }
    } catch (error: any) {
        const message = error?.data?.message || error?.message || '向量化失败'
        toast.error(message)
    } finally {
        embeddingId.value = null
    }
}

/** 批量嵌入 */
const handleBatchEmbed = async () => {
    batchEmbedding.value = true
    try {
        const response = await $fetch<{
            success: boolean
            message: string
            data: { total: number; processed: number; skipped: number; upToDate: number; failed: number }
        }>('/api/v1/admin/legal-articles/batch-embed', {
            method: 'POST',
            body: {
                legalId,
                forceAll: false,
            },
        })

        if (response.success) {
            const { processed, failed } = response.data || {}
            if (failed > 0) {
                toast.warning(response.message)
            } else if (processed === 0) {
                toast.info(response.message)
            } else {
                toast.success(response.message)
            }
            loadArticles()
        } else {
            toast.error(response.message || '批量嵌入失败')
        }
    } catch (error: any) {
        const message = error?.data?.message || error?.message || '批量嵌入失败'
        toast.error(message)
    } finally {
        batchEmbedding.value = false
    }
}

// 初始加载
onMounted(() => {
    loadLegalInfo()
    loadArticles()
})

// 页面离开时清除动态标题
onUnmounted(() => {
    dynamicBreadcrumbTitle.value = null
})
</script>
