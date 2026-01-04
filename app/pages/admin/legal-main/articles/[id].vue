<template>
    <NuxtLayout name="admin-layout">
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
            <div class="bg-card rounded-lg border p-4">
                <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <!-- 关键词搜索 -->
                    <div class="md:col-span-2">
                        <Label class="text-sm text-muted-foreground mb-1.5 block">关键词搜索</Label>
                        <Input v-model="filters.keyword" placeholder="搜索内容、标题..." class="w-full" />
                    </div>
                    <!-- 条文类型 -->
                    <div>
                        <Label class="text-sm text-muted-foreground mb-1.5 block">条文类型</Label>
                        <Select v-model="filters.type">
                            <SelectTrigger class="w-full">
                                <SelectValue placeholder="全部类型" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">全部类型</SelectItem>
                                <SelectItem value="notice">通知</SelectItem>
                                <SelectItem value="header">正文头部</SelectItem>
                                <SelectItem value="footer">正文尾部</SelectItem>
                                <SelectItem value="annex">附件</SelectItem>
                                <SelectItem value="l1">编</SelectItem>
                                <SelectItem value="l2">分编</SelectItem>
                                <SelectItem value="l3">章</SelectItem>
                                <SelectItem value="l4">节</SelectItem>
                                <SelectItem value="l5">条</SelectItem>
                            </SelectContent>
                        </Select>
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
                <!-- 高级筛选（可折叠） -->
                <Collapsible v-model:open="showAdvancedFilters" class="mt-4">
                    <CollapsibleTrigger
                        class="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
                        <ChevronDown v-if="showAdvancedFilters" class="h-4 w-4" />
                        <ChevronRight v-else class="h-4 w-4" />
                        高级筛选
                    </CollapsibleTrigger>
                    <CollapsibleContent class="mt-4">
                        <div class="grid grid-cols-2 md:grid-cols-5 gap-4">
                            <div>
                                <Label class="text-sm text-muted-foreground mb-1.5 block">编 (L1)</Label>
                                <Input v-model="filters.l1" placeholder="如：第一编" />
                            </div>
                            <div>
                                <Label class="text-sm text-muted-foreground mb-1.5 block">分编 (L2)</Label>
                                <Input v-model="filters.l2" placeholder="如：第一分编" />
                            </div>
                            <div>
                                <Label class="text-sm text-muted-foreground mb-1.5 block">章 (L3)</Label>
                                <Input v-model="filters.l3" placeholder="如：第一章" />
                            </div>
                            <div>
                                <Label class="text-sm text-muted-foreground mb-1.5 block">节 (L4)</Label>
                                <Input v-model="filters.l4" placeholder="如：第一节" />
                            </div>
                            <div>
                                <Label class="text-sm text-muted-foreground mb-1.5 block">条 (L5)</Label>
                                <Input v-model="filters.l5" placeholder="如：第一条" />
                            </div>
                        </div>
                    </CollapsibleContent>
                </Collapsible>
            </div>

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

                <!-- 条文列表 - 桌面端缩进列表 -->
                <template v-else>
                    <div class="bg-card rounded-lg border overflow-hidden hidden md:block">
                        <table class="w-full">
                            <thead>
                                <tr class="border-b bg-muted/50">
                                    <th class="w-10 px-2 py-3"></th>
                                    <th class="px-4 py-3 text-left text-sm font-medium w-16">序号</th>
                                    <th class="px-4 py-3 text-left text-sm font-medium">条文标题</th>
                                    <th class="px-4 py-3 text-left text-sm font-medium w-20">类型</th>
                                    <th class="px-4 py-3 text-center text-sm font-medium w-20">状态</th>
                                    <th class="px-4 py-3 text-center text-sm font-medium w-28">向量化</th>
                                    <th class="px-4 py-3 text-center text-sm font-medium w-32">操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                <template v-for="(article, index) in articles" :key="article.id">
                                    <!-- 主行 - 可点击展开，根据类型添加背景色 -->
                                    <tr :class="getRowClass(article.type)" @click="toggleRow(article.id)">
                                        <!-- 展开图标 -->
                                        <td class="px-2 py-2.5 text-center">
                                            <div
                                                class="w-6 h-6 rounded flex items-center justify-center bg-muted/50 group-hover:bg-primary/10 transition-colors">
                                                <ChevronDown v-if="expandedRows.has(article.id)"
                                                    class="w-4 h-4 text-primary transition-transform" />
                                                <ChevronRight v-else
                                                    class="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                                            </div>
                                        </td>
                                        <!-- 序号 -->
                                        <td class="px-4 py-2.5 text-sm text-muted-foreground">
                                            {{ (pagination.page - 1) * pagination.pageSize + index + 1 }}
                                        </td>
                                        <!-- 条文标题（带缩进） -->
                                        <td class="py-2.5">
                                            <div class="flex items-center"
                                                :style="{ paddingLeft: `${getIndentLevel(article.type) * 20}px` }">
                                                <!-- 缩进指示线 -->
                                                <div v-if="getIndentLevel(article.type) > 0"
                                                    class="flex items-center mr-2">
                                                    <span v-for="i in getIndentLevel(article.type)" :key="i"
                                                        class="w-px h-4 bg-border mr-2" />
                                                </div>
                                                <!-- 标题文本 -->
                                                <span :class="getTitleClass(article.type)">
                                                    {{ getArticleTitle(article) }}
                                                </span>
                                            </div>
                                        </td>
                                        <!-- 类型 -->
                                        <td class="px-4 py-2.5">
                                            <span :class="getArticleTypeClass(article.type)">
                                                {{ getArticleTypeName(article.type) }}
                                            </span>
                                        </td>
                                        <!-- 状态 -->
                                        <td class="px-4 py-2.5 text-center">
                                            <span :class="getArticleStatusClass(article)">
                                                {{ getArticleStatusText(article) }}
                                            </span>
                                        </td>
                                        <!-- 向量化状态 -->
                                        <td class="px-4 py-2.5 text-center">
                                            <span v-if="article.isEmbedded"
                                                class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                                                <Check class="h-3 w-3 mr-1 shrink-0" />
                                                已嵌入
                                            </span>
                                            <span v-else
                                                class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400">
                                                未嵌入
                                            </span>
                                        </td>
                                        <!-- 操作 - 阻止点击事件冒泡 -->
                                        <td class="px-4 py-2.5 text-center" @click.stop>
                                            <div class="flex items-center justify-center gap-1">
                                                <Button variant="ghost" size="icon" class="h-7 w-7" title="重新向量化"
                                                    :disabled="embeddingId === article.id"
                                                    @click="handleEmbed(article)">
                                                    <Loader2 v-if="embeddingId === article.id"
                                                        class="h-3.5 w-3.5 animate-spin" />
                                                    <Sparkles v-else class="h-3.5 w-3.5" />
                                                </Button>
                                                <Button variant="ghost" size="icon" class="h-7 w-7" title="编辑"
                                                    @click="handleEdit(article)">
                                                    <Pencil class="h-3.5 w-3.5" />
                                                </Button>
                                                <Button variant="ghost" size="icon"
                                                    class="h-7 w-7 text-destructive hover:text-destructive" title="删除"
                                                    @click="handleDelete(article)">
                                                    <Trash2 class="h-3.5 w-3.5" />
                                                </Button>
                                            </div>
                                        </td>
                                    </tr>
                                    <!-- 展开详情行 -->
                                    <tr v-if="expandedRows.has(article.id)" class="bg-primary/5 border-b">
                                        <td colspan="7" class="px-4 py-4">
                                            <div :style="{ paddingLeft: `${getIndentLevel(article.type) * 20 + 32}px` }"
                                                class="space-y-4">
                                                <!-- 条文内容 -->
                                                <div>
                                                    <p class="text-muted-foreground text-sm mb-2">条文内容</p>
                                                    <div
                                                        class="bg-background rounded-lg p-4 border text-sm whitespace-pre-wrap max-h-64 overflow-y-auto">
                                                        {{ article.content || '暂无内容' }}
                                                    </div>
                                                </div>
                                                <!-- 层级路径 -->
                                                <div v-if="article.hierarchyPath">
                                                    <p class="text-muted-foreground text-sm mb-1">层级路径</p>
                                                    <p class="text-sm">{{ article.hierarchyPath }}</p>
                                                </div>
                                                <!-- 其他信息 -->
                                                <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                                                    <div>
                                                        <p class="text-muted-foreground mb-1">条文 ID</p>
                                                        <p class="font-mono text-xs">{{ article.id }}</p>
                                                    </div>
                                                    <div>
                                                        <p class="text-muted-foreground mb-1">排序</p>
                                                        <p class="font-medium">{{ article.order ?? '-' }}</p>
                                                    </div>
                                                    <div>
                                                        <p class="text-muted-foreground mb-1">创建时间</p>
                                                        <p class="font-medium">{{ formatDate(article.createdAt) }}</p>
                                                    </div>
                                                    <div>
                                                        <p class="text-muted-foreground mb-1">最后编辑</p>
                                                        <p class="font-medium">{{ formatDate(article.lastEditedAt) }}
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                </template>
                            </tbody>
                        </table>
                    </div>

                    <!-- 移动端卡片视图 -->
                    <div class="md:hidden space-y-2">
                        <div v-for="(article, index) in articles" :key="article.id"
                            :class="getMobileCardClass(article.type)">
                            <!-- 卡片头部 - 可点击展开 -->
                            <div class="p-3 cursor-pointer" @click="toggleRow(article.id)"
                                :style="{ paddingLeft: `${12 + getIndentLevel(article.type) * 12}px` }">
                                <div class="flex items-start justify-between gap-2">
                                    <div class="flex items-center gap-2 flex-1 min-w-0">
                                        <div
                                            class="w-5 h-5 rounded flex items-center justify-center bg-muted/50 shrink-0">
                                            <ChevronDown v-if="expandedRows.has(article.id)"
                                                class="w-3.5 h-3.5 text-primary" />
                                            <ChevronRight v-else class="w-3.5 h-3.5 text-muted-foreground" />
                                        </div>
                                        <span class="text-xs text-muted-foreground shrink-0">{{
                                            (pagination.page - 1) * pagination.pageSize + index + 1 }}</span>
                                        <span :class="getTitleClass(article.type)" class="truncate">
                                            {{ getArticleTitle(article) }}
                                        </span>
                                    </div>
                                    <span :class="getArticleTypeClass(article.type)">
                                        {{ getArticleTypeName(article.type) }}
                                    </span>
                                </div>
                                <div class="flex items-center justify-between mt-1.5 pl-7">
                                    <div class="flex items-center gap-2">
                                        <span :class="getArticleStatusClass(article)">
                                            {{ getArticleStatusText(article) }}
                                        </span>
                                        <span v-if="article.isEmbedded"
                                            class="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                                            <Check class="h-2.5 w-2.5 mr-0.5" />
                                            已嵌入
                                        </span>
                                        <span v-else
                                            class="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400">
                                            未嵌入
                                        </span>
                                    </div>
                                </div>
                            </div>
                            <!-- 展开内容 -->
                            <div v-if="expandedRows.has(article.id)" class="border-t bg-muted/30 p-3 space-y-3">
                                <!-- 条文内容 -->
                                <div>
                                    <p class="text-muted-foreground text-xs mb-1.5">条文内容</p>
                                    <div
                                        class="bg-background rounded-lg p-2.5 border text-sm whitespace-pre-wrap max-h-40 overflow-y-auto">
                                        {{ article.content || '暂无内容' }}
                                    </div>
                                </div>
                                <!-- 层级路径 -->
                                <div v-if="article.hierarchyPath">
                                    <p class="text-muted-foreground text-xs mb-1">层级路径</p>
                                    <p class="text-xs">{{ article.hierarchyPath }}</p>
                                </div>
                                <!-- 其他信息 -->
                                <div class="grid grid-cols-2 gap-2 text-xs">
                                    <div>
                                        <p class="text-muted-foreground mb-0.5">排序</p>
                                        <p class="font-medium">{{ article.order ?? '-' }}</p>
                                    </div>
                                    <div>
                                        <p class="text-muted-foreground mb-0.5">创建时间</p>
                                        <p class="font-medium">{{ formatDate(article.createdAt) }}</p>
                                    </div>
                                </div>
                                <!-- 操作按钮 -->
                                <div class="flex items-center gap-2 pt-2 border-t">
                                    <Button variant="outline" size="sm" class="flex-1 h-8 text-xs"
                                        :disabled="embeddingId === article.id" @click.stop="handleEmbed(article)">
                                        <Loader2 v-if="embeddingId === article.id" class="h-3 w-3 mr-1 animate-spin" />
                                        <Sparkles v-else class="h-3 w-3 mr-1" />
                                        向量化
                                    </Button>
                                    <Button variant="outline" size="sm" class="flex-1 h-8 text-xs"
                                        @click.stop="handleEdit(article)">
                                        <Pencil class="h-3 w-3 mr-1" />
                                        编辑
                                    </Button>
                                    <Button variant="outline" size="sm"
                                        class="h-8 text-xs text-destructive hover:text-destructive"
                                        @click.stop="handleDelete(article)">
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
    </NuxtLayout>
</template>

<script setup lang="ts">
import { ArrowLeft, Plus, Pencil, Trash2, Loader2, FileText, Check, Sparkles, ChevronRight, ChevronDown, Search, RotateCcw, ArrowUpDown, Save, Database, Zap } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import dayjs from 'dayjs'
import type { LegalArticleListItem, ArticleType, CreateLegalArticleRequest, UpdateLegalArticleRequest } from '#shared/types/legal'

definePageMeta({
    layout: false,
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
            // 有未保存的变更，提示用户
            if (!confirm('有未保存的排序变更，确定要退出吗？')) {
                return
            }
        }
        sortMode.value = false
        sortChanges.value = []
    } else {
        // 进入排序模式
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
    // 合并排序变更（去重，保留最新的）
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
            // 刷新排序树
            sortTreeRef.value?.refresh()
            // 刷新列表
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

/** 是否显示高级筛选 */
const showAdvancedFilters = ref(false)

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
    // 触发响应式更新
    expandedRows.value = new Set(expandedRows.value)
}

/** 格式化日期 */
const formatDate = (date: string | Date | null | undefined): string => {
    if (!date) return '-'
    return dayjs(date).format('YYYY-MM-DD HH:mm')
}

/** 获取条文类型名称 */
const getArticleTypeName = (type: ArticleType): string => {
    const typeMap: Record<string, string> = {
        notice: '通知',
        header: '正文头部',
        footer: '正文尾部',
        annex: '附件',
        l1: '编',
        l2: '分编',
        l3: '章',
        l4: '节',
        l5: '条',
    }
    return typeMap[type] || type
}

/** 获取条文类型样式类 */
const getArticleTypeClass = (type: ArticleType): string => {
    const baseClass = 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium'
    const typeClasses: Record<string, string> = {
        l5: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
        l4: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
        l3: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
        l2: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
        l1: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    }
    return `${baseClass} ${typeClasses[type] || 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400'}`
}

/** 获取条文状态文本 */
const getArticleStatusText = (article: LegalArticleListItem): string => {
    if (article.invalidDate) {
        const invalidDate = dayjs(article.invalidDate)
        if (invalidDate.isBefore(dayjs())) {
            return '已失效'
        }
    }
    if (article.effectiveDate) {
        const effectiveDate = dayjs(article.effectiveDate)
        if (effectiveDate.isAfter(dayjs())) {
            return '未生效'
        }
    }
    return '有效'
}

/** 获取条文状态样式类 */
const getArticleStatusClass = (article: LegalArticleListItem): string => {
    const baseClass = 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium'
    const status = getArticleStatusText(article)
    if (status === '有效') {
        return `${baseClass} bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400`
    }
    if (status === '已失效') {
        return `${baseClass} bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400`
    }
    return `${baseClass} bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400`
}

/** 根据类型计算缩进级别 */
const getIndentLevel = (type: ArticleType): number => {
    const levels: Record<string, number> = {
        notice: 0, header: 0, footer: 0, annex: 0,
        l1: 0, l2: 1, l3: 2, l4: 3, l5: 4
    }
    return levels[type] ?? 0
}

/** 获取条文标题（显示当前层级的标题） */
const getArticleTitle = (article: LegalArticleListItem): string => {
    // 按层级优先级返回标题
    if (article.type === 'l5' && article.l5) return article.l5
    if (article.type === 'l4' && article.l4) return article.l4
    if (article.type === 'l3' && article.l3) return article.l3
    if (article.type === 'l2' && article.l2) return article.l2
    if (article.type === 'l1' && article.l1) return article.l1
    // 其他类型显示内容摘要或层级路径
    if (article.content) {
        const preview = article.content.slice(0, 50)
        return preview.length < article.content.length ? `${preview}...` : preview
    }
    return article.hierarchyPath || '-'
}

/** 获取标题样式类（不同层级不同样式） */
const getTitleClass = (type: ArticleType): string => {
    const classes: Record<string, string> = {
        l1: 'text-sm font-bold text-foreground',
        l2: 'text-sm font-semibold text-foreground',
        l3: 'text-sm font-medium text-foreground',
        l4: 'text-sm font-medium text-muted-foreground',
        l5: 'text-sm text-foreground',
    }
    return classes[type] || 'text-sm text-muted-foreground'
}

/** 获取行样式类（不同层级不同背景） */
const getRowClass = (type: ArticleType): string => {
    const baseClass = 'border-b cursor-pointer transition-colors group'
    const typeClasses: Record<string, string> = {
        l1: 'bg-red-50/50 hover:bg-red-100/50 dark:bg-red-950/20 dark:hover:bg-red-950/30',
        l2: 'bg-green-50/30 hover:bg-green-100/30 dark:bg-green-950/10 dark:hover:bg-green-950/20',
        l3: 'bg-orange-50/30 hover:bg-orange-100/30 dark:bg-orange-950/10 dark:hover:bg-orange-950/20',
        l4: 'bg-purple-50/20 hover:bg-purple-100/20 dark:bg-purple-950/10 dark:hover:bg-purple-950/15',
        l5: 'hover:bg-primary/5',
    }
    return `${baseClass} ${typeClasses[type] || 'hover:bg-muted/50'}`
}

/** 获取移动端卡片样式类 */
const getMobileCardClass = (type: ArticleType): string => {
    const baseClass = 'bg-card rounded-lg border overflow-hidden'
    const typeClasses: Record<string, string> = {
        l1: 'border-l-4 border-l-red-500',
        l2: 'border-l-4 border-l-green-500',
        l3: 'border-l-4 border-l-orange-500',
        l4: 'border-l-4 border-l-purple-500',
        l5: 'border-l-4 border-l-blue-500',
    }
    return `${baseClass} ${typeClasses[type] || ''}`
}

/** 加载法律详情 */
const loadLegalInfo = async () => {
    const data = await useApiFetch<{ name: string }>(`/api/v1/admin/legal-main/${legalId}`)
    if (data) {
        legalName.value = data.name
        // 设置动态面包屑标题
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
const handleSearch = () => {
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
    // 切换页码时清空展开状态
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
        // 使用 $fetch 直接调用，因为 useApiFetch 无法区分 data: null 的成功和失败
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
                forceAll: false, // 智能判断，只嵌入需要更新的条文
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
