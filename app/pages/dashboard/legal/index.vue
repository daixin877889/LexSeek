<template>
    <div class="p-4 md:p-6">
        <!-- 页面头部 -->
        <div class="mb-6">
            <h1 class="text-2xl md:text-3xl font-bold mb-1">法律法规</h1>
            <p class="text-muted-foreground text-sm">搜索和浏览法律法规全文，支持法条语义搜索</p>
        </div>

        <!-- 整合的搜索面板 -->
        <LegalSearchUnifiedSearchPanel v-model:active-tab="activeTab" v-model:keyword="searchKeyword"
            v-model:article-query="articleQuery" v-model:type="searchFilters.type"
            v-model:article-type="articleFilters.legalType" v-model:issuing-authority="searchFilters.issuingAuthority"
            v-model:validity-status="searchFilters.validityStatus"
            v-model:article-validity-status="articleFilters.validityStatus"
            :issuing-authorities-options="legalSearch.issuingAuthorities.value"
            :loading="activeTab === 'legal' ? legalSearch.loading.value : articleSearch.loading.value"
            @search="handleSearch" @reset="handleReset" class="mb-6" />

        <!-- 搜全文结果区域 -->
        <template v-if="activeTab === 'legal' && hasSearchResults">
            <!-- 加载状态 -->
            <div v-if="legalSearch.loading.value" class="flex justify-center py-12">
                <Loader2 class="h-10 w-10 animate-spin text-muted-foreground" />
            </div>

            <!-- 空状态 -->
            <div v-else-if="legalSearch.legalList.value.length === 0"
                class="bg-card rounded-lg border p-12 text-center">
                <FileText class="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <h3 class="text-lg font-medium mb-2">未找到相关法律法规</h3>
                <p class="text-muted-foreground text-sm mb-4">请尝试调整搜索条件</p>
                <Button variant="outline" @click="handleReset">
                    重置筛选
                </Button>
            </div>

            <!-- 法律法规列表 -->
            <template v-else>
                <!-- 桌面端表格 -->
                <LegalSearchLegalList :items="legalSearch.legalList.value" :loading="legalSearch.loading.value"
                    :total="legalSearch.pagination.value.total" :current-page="legalSearch.pagination.value.page"
                    :page-size="legalSearch.pagination.value.pageSize"
                    :total-pages="legalSearch.pagination.value.totalPages" :selected-id="selectedLegalId"
                    @row-click="handleLegalSelect" @page-change="handlePageChange" class="hidden md:block" />

                <!-- 移动端卡片 -->
                <LegalSearchLegalListMobile :items="legalSearch.legalList.value" :loading="legalSearch.loading.value"
                    :total="legalSearch.pagination.value.total" :current-page="legalSearch.pagination.value.page"
                    :page-size="legalSearch.pagination.value.pageSize"
                    :total-pages="legalSearch.pagination.value.totalPages" :selected-id="selectedLegalId"
                    @item-click="handleLegalSelect" @page-change="handlePageChange" class="md:hidden" />
            </template>
        </template>

        <!-- 搜法条结果区域 -->
        <template v-if="activeTab === 'article' && hasArticleSearched">
            <!-- 加载状态 -->
            <div v-if="articleSearch.loading.value" class="flex justify-center py-12">
                <Loader2 class="h-10 w-10 animate-spin text-muted-foreground" />
            </div>

            <!-- 错误状态 -->
            <div v-else-if="articleSearch.error.value" class="bg-card rounded-lg border p-12 text-center">
                <AlertCircle class="h-12 w-12 mx-auto mb-4 text-destructive" />
                <h3 class="text-lg font-medium mb-2">搜索失败</h3>
                <p class="text-muted-foreground text-sm mb-4">{{ articleSearch.error.value }}</p>
                <Button variant="outline" @click="handleArticleRetry">
                    <RefreshCw class="h-4 w-4 mr-2" />
                    重试
                </Button>
            </div>

            <!-- 空状态 -->
            <div v-else-if="articleSearch.results.value.length === 0"
                class="bg-card rounded-lg border p-12 text-center">
                <FileSearch class="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <h3 class="text-lg font-medium mb-2">未找到相关法条</h3>
                <p class="text-muted-foreground text-sm mb-4">请尝试使用不同的关键词搜索</p>
                <Button variant="outline" @click="handleReset">
                    重置搜索
                </Button>
            </div>

            <!-- 搜索结果列表 -->
            <div v-else class="bg-card rounded-lg border">
                <!-- 结果统计 -->
                <div class="px-6 py-4 border-b">
                    <div class="text-sm text-muted-foreground">
                        找到 <span class="font-medium text-foreground">{{ articleSearch.total.value }}</span> 条相关法条
                    </div>
                </div>

                <!-- 结果列表 -->
                <div class="divide-y">
                    <div v-for="result in articleSearch.results.value" :key="result.articles_id"
                        class="p-6 hover:bg-muted/50 transition-colors cursor-pointer"
                        @click="handleArticleResultClick(result)">
                        <!-- 法律信息 -->
                        <div class="flex items-start justify-between mb-3">
                            <div class="flex-1 min-w-0">
                                <h4 class="font-medium truncate">{{ result.legal_name }}</h4>
                                <div v-if="result.chapter_hierarchy?.length" class="text-sm text-muted-foreground mt-1">
                                    {{ result.chapter_hierarchy.join(' > ') }}
                                </div>
                            </div>
                            <Badge v-if="result.metadata?.legal_type"
                                :variant="getTypeVariant(result.metadata.legal_type as string)" class="ml-3 shrink-0">
                                {{ getTypeLabel(result.metadata.legal_type as string) }}
                            </Badge>
                        </div>

                        <!-- 法条内容 -->
                        <div class="text-sm leading-relaxed text-muted-foreground line-clamp-3"
                            v-html="highlightContent(extractArticleContent(result.content))" />

                        <!-- 相似度分数 -->
                        <div v-if="result.score" class="mt-3">
                            <div class="text-xs text-muted-foreground">
                                相似度: {{ (result.score * 100).toFixed(1) }}%
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 底部提示 -->
                <div class="px-6 py-4 border-t bg-muted/30">
                    <div class="text-xs text-muted-foreground text-center">
                        点击法条可查看详情
                    </div>
                </div>
            </div>
        </template>

        <!-- 法条详情弹框 -->
        <LegalSearchArticleDetailDialog v-model:open="articleDialogOpen" :article="selectedArticle" />
    </div>
</template>

<script lang="ts" setup>
import { Loader2, FileText, AlertCircle, RefreshCw, FileSearch } from 'lucide-vue-next'
import type { ValidityStatus, ArticleSearchFilters } from '#shared/types/legal-search'
import type { LawSearchResultItem, LegalType } from '#shared/types/legal'

// ==================== 页面元数据 ====================

definePageMeta({
    layout: "dashboard-layout",
    title: "法律法规",
})

// ==================== SEO ====================

useSeoMeta({
    title: '法律法规 - 法律检索系统',
    description: '搜索和浏览法律法规全文，支持多维度筛选和法条语义搜索',
})

// ==================== 组合式函数 ====================

const route = useRoute()
const router = useRouter()
const legalSearch = useLegalSearch()
const articleSearch = useArticleSearch()

// ==================== 响应式状态 ====================

/** 当前激活的 Tab */
const activeTab = ref<'legal' | 'article'>('legal')

/** 搜索关键词 */
const searchKeyword = ref('')

/** 搜索筛选条件 */
const searchFilters = ref<{ type: LegalType | null; issuingAuthority: string | null; validityStatus: ValidityStatus }>({
    type: null,
    issuingAuthority: null,
    validityStatus: 'valid',
})

/** 法条搜索查询 */
const articleQuery = ref('')

/** 法条搜索筛选条件 */
const articleFilters = ref<ArticleSearchFilters>({
    legalType: null,
    validityStatus: 'valid',
})

/** 选中的法律 ID */
const selectedLegalId = ref<string | null>(null)

/** 法条详情弹框状态 */
const articleDialogOpen = ref(false)

/** 选中的法条（用于弹框显示） */
const selectedArticle = ref<LawSearchResultItem | null>(null)

/** 是否已执行过搜索（有搜索结果） */
const hasSearchResults = ref(false)

/** 法条搜索是否已执行过 */
const hasArticleSearched = ref(false)

/** 防止循环更新的标志 */
const isRestoring = ref(false)

// ==================== URL 状态同步 ====================

/** 同步状态到 URL */
const syncToUrl = () => {
    if (isRestoring.value) return

    const query: Record<string, string> = {}

    // Tab 状态
    if (activeTab.value !== 'legal') {
        query.tab = activeTab.value
    }

    // 搜全文筛选条件（始终保留）
    if (searchKeyword.value) {
        query.keyword = searchKeyword.value
    }
    if (searchFilters.value.type) {
        query.type = searchFilters.value.type
    }
    if (searchFilters.value.issuingAuthority) {
        query.issuingAuthority = searchFilters.value.issuingAuthority
    }
    if (searchFilters.value.validityStatus !== 'valid') {
        query.validityStatus = searchFilters.value.validityStatus
    }
    if (legalSearch.pagination.value.page > 1) {
        query.page = String(legalSearch.pagination.value.page)
    }

    // 搜法条筛选条件（始终保留）
    if (articleQuery.value) {
        query.articleQuery = articleQuery.value
    }
    if (articleFilters.value.legalType) {
        query.articleType = articleFilters.value.legalType
    }
    if (articleFilters.value.validityStatus !== 'valid') {
        query.articleStatus = articleFilters.value.validityStatus
    }

    router.replace({ query })
}

/** 从 URL 恢复状态 */
const restoreFromUrl = () => {
    const query = route.query

    // 恢复 Tab 状态
    if (query.tab === 'article') {
        activeTab.value = 'article'
    } else {
        activeTab.value = 'legal'
    }

    // 恢复搜全文筛选条件
    if (typeof query.keyword === 'string') {
        searchKeyword.value = query.keyword
    }
    if (typeof query.type === 'string' && ['law', 'regulation', 'judicial_interp', 'guideline'].includes(query.type)) {
        searchFilters.value.type = query.type as LegalType
    }
    if (typeof query.issuingAuthority === 'string') {
        searchFilters.value.issuingAuthority = query.issuingAuthority
    }
    if (typeof query.validityStatus === 'string' && ['all', 'valid', 'pending', 'invalid'].includes(query.validityStatus)) {
        searchFilters.value.validityStatus = query.validityStatus as ValidityStatus
    }
    if (typeof query.page === 'string') {
        const page = parseInt(query.page, 10)
        if (!isNaN(page) && page > 0) {
            legalSearch.setPage(page)
        }
    }

    // 恢复搜法条筛选条件
    if (typeof query.articleQuery === 'string') {
        articleQuery.value = query.articleQuery
    }
    if (typeof query.articleType === 'string' && ['law', 'regulation', 'judicial_interp', 'guideline'].includes(query.articleType)) {
        articleFilters.value.legalType = query.articleType as LegalType
    }
    if (typeof query.articleStatus === 'string' && ['all', 'valid', 'pending', 'invalid'].includes(query.articleStatus)) {
        articleFilters.value.validityStatus = query.articleStatus as ValidityStatus
    }

    // 如果有搜全文的关键词，自动执行搜索
    if (searchKeyword.value || searchFilters.value.type || searchFilters.value.issuingAuthority) {
        hasSearchResults.value = true
        legalSearch.setFilters({
            keyword: searchKeyword.value,
            ...searchFilters.value,
        })
    }

    // 如果有搜法条的查询，自动执行搜索
    if (articleQuery.value) {
        hasArticleSearched.value = true
        articleSearch.searchArticles(articleQuery.value, articleFilters.value)
    }
}

// ==================== 生命周期 ====================

onMounted(async () => {
    // 初始化数据：加载发文机关列表
    await legalSearch.loadIssuingAuthorities()

    // 从 URL 恢复状态
    isRestoring.value = true
    restoreFromUrl()
    nextTick(() => {
        isRestoring.value = false
    })
})

// ==================== 监听器 ====================

/** 监听 Tab 切换，同步到 URL */
watch(activeTab, () => {
    syncToUrl()
})

/** 监听搜全文分页变化，同步到 URL */
watch(() => legalSearch.pagination.value.page, () => {
    if (activeTab.value === 'legal') {
        syncToUrl()
    }
})

// ==================== 辅助方法 ====================

/** 获取法律类型标签 */
const getTypeLabel = (type: string): string => {
    const labels: Record<string, string> = {
        law: '法律',
        regulation: '行政法规',
        judicial_interp: '司法解释',
        guideline: '指导意见',
    }
    return labels[type] || type
}

/** 获取法律类型徽章样式 */
const getTypeVariant = (type: string): "default" | "secondary" | "outline" | "destructive" => {
    const variants: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
        law: 'default',
        regulation: 'secondary',
        judicial_interp: 'outline',
        guideline: 'destructive',
    }
    return variants[type] || 'default'
}

/** 提取法条实际内容（截取 "内容：" 后的部分） */
const extractArticleContent = (content: string): string => {
    const marker = '内容：'
    const index = content.indexOf(marker)
    if (index !== -1) {
        return content.substring(index + marker.length).trim()
    }
    return content
}

/** 高亮搜索内容 */
const highlightContent = (content: string): string => {
    if (!articleQuery.value.trim()) return content

    const keywords = articleQuery.value.trim().split(/\s+/)
    let highlightedContent = content

    keywords.forEach(keyword => {
        if (keyword.length > 0) {
            const regex = new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
            highlightedContent = highlightedContent.replace(
                regex,
                '<mark class="bg-yellow-200 dark:bg-yellow-800 px-1 rounded">$1</mark>'
            )
        }
    })

    return highlightedContent
}

// ==================== 方法 ====================

/** 处理搜索 */
const handleSearch = () => {
    if (activeTab.value === 'legal') {
        hasSearchResults.value = true
        legalSearch.setFilters({
            keyword: searchKeyword.value,
            ...searchFilters.value,
        })
    } else {
        hasArticleSearched.value = true
        articleSearch.searchArticles(articleQuery.value, articleFilters.value)
    }
    syncToUrl()
}

/** 处理重置 */
const handleReset = () => {
    if (activeTab.value === 'legal') {
        searchKeyword.value = ''
        searchFilters.value = {
            type: null,
            issuingAuthority: null,
            validityStatus: 'valid',
        }
        selectedLegalId.value = null
        hasSearchResults.value = false
        legalSearch.resetFilters()
    } else {
        articleQuery.value = ''
        articleFilters.value = {
            legalType: null,
            validityStatus: 'valid',
        }
        hasArticleSearched.value = false
        articleSearch.clearResults()
    }
    syncToUrl()
}

/** 处理法律选择 - 跳转到预览页面 */
const handleLegalSelect = (item: { id: string }) => {
    selectedLegalId.value = item.id
    navigateTo(`/dashboard/legal/preview/${item.id}`)
}

/** 处理页码变化 */
const handlePageChange = (page: number) => {
    legalSearch.setPage(page)
}

/** 处理法条搜索结果点击 - 打开详情弹框 */
const handleArticleResultClick = (result: LawSearchResultItem) => {
    selectedArticle.value = result
    articleDialogOpen.value = true
}

/** 处理法条搜索重试 */
const handleArticleRetry = () => {
    if (articleQuery.value) {
        articleSearch.searchArticles(articleQuery.value, articleFilters.value)
    }
}
</script>
