<template>
        <div class="space-y-6">
            <!-- 页面标题 -->
            <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div class="flex items-center gap-4">
                    <Button variant="ghost" size="icon" @click="navigateTo('/admin/legal-main')">
                        <ArrowLeft class="h-4 w-4" />
                    </Button>
                    <div>
                        <h1 class="text-2xl md:text-3xl font-bold mb-1">{{ legalName || '嵌入记录管理' }}</h1>
                        <p class="text-muted-foreground text-sm">查看和管理法律条文的向量嵌入记录</p>
                    </div>
                </div>
                <div class="flex items-center gap-2 text-sm text-muted-foreground">
                    <Database class="h-4 w-4" />
                    <span>共 {{ pagination.total }} 条嵌入记录</span>
                </div>
            </div>

            <!-- 筛选区域 -->
            <div class="bg-card rounded-lg border p-4">
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <!-- 条文 ID 筛选 -->
                    <div class="md:col-span-2">
                        <Label class="text-sm text-muted-foreground mb-1.5 block">条文 ID</Label>
                        <Input v-model="filters.articleId" placeholder="输入条文 ID 筛选..." class="w-full" />
                    </div>
                    <!-- 操作按钮 -->
                    <div class="flex items-end gap-2">
                        <Button @click="handleSearch" class="flex-1">
                            <Search class="h-4 w-4 mr-2" />
                            搜索
                        </Button>
                        <Button variant="outline" @click="handleReset">
                            <RotateCcw class="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            </div>

            <!-- 加载状态 -->
            <div v-if="loading" class="flex justify-center py-12">
                <Loader2 class="h-10 w-10 animate-spin text-muted-foreground" />
            </div>

            <!-- 空状态 -->
            <div v-else-if="!embeddings.length" class="flex flex-col items-center justify-center py-12 text-center">
                <Database class="h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 class="text-lg font-medium mb-1">{{ filters.articleId ? '未找到匹配的嵌入记录' : '暂无嵌入记录' }}</h3>
                <p class="text-muted-foreground text-sm mb-4">{{ filters.articleId ? '尝试调整筛选条件' : '请先对条文进行向量化处理' }}</p>
                <Button v-if="filters.articleId" variant="outline" @click="handleReset">
                    <RotateCcw class="h-4 w-4 mr-2" />
                    重置筛选
                </Button>
            </div>

            <!-- 嵌入记录列表 -->
            <template v-else>
                <div class="space-y-4">
                    <div v-for="embedding in embeddings" :key="embedding.id"
                        class="bg-card rounded-lg border overflow-hidden">
                        <!-- 记录头部 -->
                        <div class="p-4 border-b bg-muted/30 cursor-pointer" @click="toggleExpand(embedding.id)">
                            <div class="flex items-start justify-between gap-4">
                                <div class="flex items-center gap-3 flex-1 min-w-0">
                                    <div class="w-6 h-6 rounded flex items-center justify-center bg-muted">
                                        <ChevronDown v-if="expandedIds.has(embedding.id)"
                                            class="w-4 h-4 text-primary" />
                                        <ChevronRight v-else class="w-4 h-4 text-muted-foreground" />
                                    </div>
                                    <div class="flex-1 min-w-0">
                                        <div class="flex items-center gap-2 mb-1">
                                            <span class="font-mono text-xs text-muted-foreground truncate">{{
                                                embedding.id }}</span>
                                            <span v-if="!embedding.metadata?.invalid_date"
                                                class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                                                有效
                                            </span>
                                            <span v-else
                                                class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
                                                已失效
                                            </span>
                                        </div>
                                        <p class="text-sm text-muted-foreground truncate">
                                            {{ getHierarchyPath(embedding.metadata?.chapter_hierarchy) || '无层级路径' }}
                                        </p>
                                    </div>
                                </div>
                                <div class="flex items-center gap-2" @click.stop>
                                    <Button variant="ghost" size="icon" class="h-8 w-8" title="编辑元数据"
                                        @click="handleEdit(embedding)">
                                        <Pencil class="h-4 w-4" />
                                    </Button>
                                    <Button variant="ghost" size="icon"
                                        class="h-8 w-8 text-destructive hover:text-destructive" title="删除"
                                        @click="handleDelete(embedding)">
                                        <Trash2 class="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        </div>

                        <!-- 展开内容 -->
                        <div v-if="expandedIds.has(embedding.id)" class="p-4 space-y-4">
                            <!-- 嵌入文本 -->
                            <div>
                                <Label class="text-sm text-muted-foreground mb-2 block">嵌入文本</Label>
                                <div
                                    class="bg-muted/30 rounded-lg p-3 text-sm whitespace-pre-wrap max-h-48 overflow-y-auto font-mono">
                                    {{ embedding.text || '无文本内容' }}
                                </div>
                            </div>

                            <!-- 元数据 -->
                            <div>
                                <Label class="text-sm text-muted-foreground mb-2 block">元数据</Label>
                                <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                                    <div>
                                        <p class="text-muted-foreground mb-1">条文 ID</p>
                                        <p class="font-mono text-xs truncate">{{ embedding.metadata?.articles_id || '-'
                                            }}
                                        </p>
                                    </div>
                                    <div>
                                        <p class="text-muted-foreground mb-1">法律名称</p>
                                        <p class="font-medium truncate">{{ embedding.metadata?.legal_name || '-' }}</p>
                                    </div>
                                    <div>
                                        <p class="text-muted-foreground mb-1">法律代码</p>
                                        <p class="font-mono text-xs">{{ embedding.metadata?.document_number || '-' }}
                                        </p>
                                    </div>
                                    <div>
                                        <p class="text-muted-foreground mb-1">条文类型</p>
                                        <p class="font-medium">{{ getArticleTypeName(embedding.metadata?.article_type)
                                            }}
                                        </p>
                                    </div>
                                    <div>
                                        <p class="text-muted-foreground mb-1">发布日期</p>
                                        <p class="font-medium">{{ formatDate(embedding.metadata?.publish_date) }}</p>
                                    </div>
                                    <div>
                                        <p class="text-muted-foreground mb-1">生效日期</p>
                                        <p class="font-medium">{{ formatDate(embedding.metadata?.effective_date) }}</p>
                                    </div>
                                    <div>
                                        <p class="text-muted-foreground mb-1">失效日期</p>
                                        <p class="font-medium">{{ formatDate(embedding.metadata?.invalid_date) }}</p>
                                    </div>
                                    <div>
                                        <p class="text-muted-foreground mb-1">最后嵌入时间</p>
                                        <p class="font-medium">{{ formatDateTime(embedding.lastEmbeddingAt) }}</p>
                                    </div>
                                </div>
                            </div>

                            <!-- 原始 JSON -->
                            <Collapsible>
                                <CollapsibleTrigger
                                    class="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
                                    <Code class="h-4 w-4" />
                                    查看原始 JSON
                                </CollapsibleTrigger>
                                <CollapsibleContent class="mt-2">
                                    <pre
                                        class="bg-muted/30 rounded-lg p-3 text-xs overflow-x-auto">{{ JSON.stringify(embedding.metadata, null, 2) }}</pre>
                                </CollapsibleContent>
                            </Collapsible>
                        </div>
                    </div>
                </div>

                <!-- 分页 -->
                <GeneralPagination :current-page="pagination.page" :page-size="pagination.pageSize"
                    :total="pagination.total" @change="changePage" />
            </template>
        </div>

        <!-- 编辑元数据对话框 -->
        <Dialog v-model:open="showEditDialog">
            <DialogContent class="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>编辑元数据</DialogTitle>
                    <DialogDescription>
                        修改嵌入记录的元数据信息
                    </DialogDescription>
                </DialogHeader>
                <div class="space-y-4 py-4">
                    <!-- 是否有效 -->
                    <div class="flex items-center justify-between">
                        <Label>是否有效</Label>
                        <Switch v-model="editForm.isValid" />
                    </div>
                    <!-- 失效日期 -->
                    <div class="space-y-2">
                        <Label>失效日期</Label>
                        <GeneralDatePicker v-model="editForm.invalidDate" placeholder="选择失效日期" />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" @click="showEditDialog = false">取消</Button>
                    <Button @click="handleSaveEdit" :disabled="saving">
                        <Loader2 v-if="saving" class="h-4 w-4 mr-2 animate-spin" />
                        保存
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>

        <!-- 删除确认对话框 -->
        <AlertDialog v-model:open="deleteDialogOpen">
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>确认删除</AlertDialogTitle>
                    <AlertDialogDescription>
                        确定要删除此嵌入记录吗？删除后将无法恢复，需要重新对条文进行向量化。
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
import { ArrowLeft, Loader2, Database, Search, RotateCcw, ChevronRight, ChevronDown, Pencil, Trash2, Code } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import dayjs from 'dayjs'
import type { LawEmbeddingInfo, ArticleType, PaginatedResponse } from '#shared/types/legal'
import { ArticleTypeLabels } from '#shared/types/legal'

definePageMeta({
    layout: 'admin-layout',
    title: "嵌入记录管理",
})

const route = useRoute()
const legalId = route.params.id as string

/** 动态面包屑标题 */
const dynamicBreadcrumbTitle = useState<string | null>('breadcrumb-dynamic-title', () => null)

/** 法律名称 */
const legalName = ref('')

/** 加载状态 */
const loading = ref(false)

/** 嵌入记录列表 */
const embeddings = ref<LawEmbeddingInfo[]>([])

/** 展开的记录 ID */
const expandedIds = ref<Set<string>>(new Set())

/** 筛选条件 */
const filters = ref({
    articleId: '',
})

/** 分页信息 */
const pagination = ref({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 0,
})

/** 编辑对话框 */
const showEditDialog = ref(false)
const editingEmbedding = ref<LawEmbeddingInfo | null>(null)
const editForm = ref({
    isValid: true,
    invalidDate: '' as string | null,
})
const saving = ref(false)

/** 删除对话框 */
const deleteDialogOpen = ref(false)
const deletingEmbedding = ref<LawEmbeddingInfo | null>(null)

/** 加载法律信息 */
const loadLegalInfo = async () => {
    const data = await useApiFetch<{ name: string }>(`/api/v1/admin/legal-main/${legalId}`)
    if (data) {
        legalName.value = data.name
        dynamicBreadcrumbTitle.value = data.name
    }
}

/** 加载嵌入记录 */
const loadEmbeddings = async () => {
    loading.value = true
    try {
        const query: Record<string, any> = {
            legalId,
            page: pagination.value.page,
            pageSize: pagination.value.pageSize,
        }
        if (filters.value.articleId) {
            query.articleId = filters.value.articleId
        }

        const data = await useApiFetch<PaginatedResponse<LawEmbeddingInfo>>('/api/v1/admin/law-embeddings', { query })
        if (data) {
            embeddings.value = data.items
            pagination.value.total = data.total
            pagination.value.totalPages = data.totalPages
        }
    } finally {
        loading.value = false
    }
}

/** 切换展开状态 */
const toggleExpand = (id: string) => {
    if (expandedIds.value.has(id)) {
        expandedIds.value.delete(id)
    } else {
        expandedIds.value.add(id)
    }
}

/** 搜索 */
const handleSearch = () => {
    pagination.value.page = 1
    loadEmbeddings()
}

/** 重置筛选 */
const handleReset = () => {
    filters.value.articleId = ''
    pagination.value.page = 1
    loadEmbeddings()
}

/** 切换页码 */
const changePage = (page: number) => {
    pagination.value.page = page
    loadEmbeddings()
}

/** 编辑元数据 */
const handleEdit = (embedding: LawEmbeddingInfo) => {
    editingEmbedding.value = embedding
    editForm.value = {
        isValid: embedding.metadata?.invalid_date === null,
        invalidDate: embedding.metadata?.invalid_date || null,
    }
    showEditDialog.value = true
}

/** 保存编辑 */
const handleSaveEdit = async () => {
    if (!editingEmbedding.value) return

    saving.value = true
    try {
        const result = await useApiFetch(`/api/v1/admin/law-embeddings/${editingEmbedding.value.id}`, {
            method: 'PUT',
            body: editForm.value,
        })

        if (result) {
            toast.success('更新成功')
            showEditDialog.value = false
            loadEmbeddings()
        }
    } finally {
        saving.value = false
    }
}

/** 删除嵌入记录 */
const handleDelete = (embedding: LawEmbeddingInfo) => {
    deletingEmbedding.value = embedding
    deleteDialogOpen.value = true
}

/** 确认删除 */
const confirmDelete = async () => {
    if (!deletingEmbedding.value) return

    const result = await useApiFetch(`/api/v1/admin/law-embeddings/${deletingEmbedding.value.id}`, {
        method: 'DELETE',
    })

    if (result !== null) {
        toast.success('删除成功')
        deleteDialogOpen.value = false
        loadEmbeddings()
    }
}

/** 获取条文类型名称 */
const getArticleTypeName = (type?: string) => {
    if (!type) return '-'
    return ArticleTypeLabels[type as ArticleType] || type
}

/** 获取层级路径字符串 */
const getHierarchyPath = (hierarchy?: string[]) => {
    if (!hierarchy || !Array.isArray(hierarchy) || hierarchy.length === 0) return ''
    return hierarchy.join(' > ')
}

/** 格式化日期 */
const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return '-'
    return dayjs(dateStr).format('YYYY-MM-DD')
}

/** 格式化日期时间 */
const formatDateTime = (dateStr: string | null) => {
    if (!dateStr) return '-'
    return dayjs(dateStr).format('YYYY-MM-DD HH:mm')
}

// 初始加载
onMounted(() => {
    loadLegalInfo()
    loadEmbeddings()
})

// 页面离开时清除动态标题
onUnmounted(() => {
    dynamicBreadcrumbTitle.value = null
})
</script>
