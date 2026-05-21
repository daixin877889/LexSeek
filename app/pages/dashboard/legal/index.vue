<template>
    <div class="p-4 md:p-6">
        <!-- 页面头部 -->
        <div class="mb-6">
            <!-- <p class="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-primary">
                LEGAL SEARCH · 法律法规检索
            </p> -->
            <h1 class="mb-1 text-2xl font-bold md:text-3xl">法律法规检索</h1>
            <p class="text-sm text-muted-foreground">
                覆盖法律 · 行政法规 · 司法解释 · 指导意见，支持法规全文检索与法条语义检索。
            </p>
        </div>

        <!-- 整合的搜索面板 -->
        <LegalSearchUnifiedSearchPanel v-model:active-tab="activeTab" v-model:keyword="searchKeyword"
            v-model:article-query="articleQuery" v-model:type="searchFilters.type"
            v-model:article-type="articleFilters.legalType" v-model:issuing-authority="searchFilters.issuingAuthority"
            v-model:validity-status="searchFilters.validityStatus"
            v-model:article-validity-status="articleFilters.validityStatus"
            :issuing-authorities-options="legalSearch.issuingAuthorities.value"
            :loading="activeTab === 'legal' ? legalSearch.loading.value : articleSearch.loading.value"
            @search="handleSearch" @reset="handleReset" class="mb-4" />

        <!-- 热门检索 -->
        <div class="mb-6 flex flex-wrap items-center gap-2.5">
            <span class="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <Flame class="h-4 w-4 fill-orange-400 text-orange-500 animate-pulse" />
                热门检索
            </span>
            <button v-for="(kw, idx) in trending.keywords.value" :key="kw" type="button"
                class="group inline-flex items-center gap-1 rounded-full bg-card border border-border/70 px-3.5 py-1.5 text-[12.5px] text-foreground/85 transition-all hover:border-primary/40 hover:text-primary"
                @click="handleTrendingClick(kw)">
                <span v-if="idx < 3"
                    :class="[
                        'inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold leading-none',
                        idx === 0 ? 'bg-[color:var(--brand-sky)]/15 text-[color:var(--brand-sky)]'
                        : idx === 1 ? 'bg-orange-100 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300'
                        : 'bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300'
                    ]">
                    {{ idx + 1 }}
                </span>
                {{ kw }}
            </button>
        </div>

        <!-- 搜全文结果区域 -->
        <template v-if="activeTab === 'legal'">
            <!-- 加载状态 -->
            <div v-if="legalSearch.loading.value" class="flex justify-center py-12">
                <Loader2 class="h-10 w-10 animate-spin text-muted-foreground" />
            </div>

            <!-- 空状态 -->
            <div v-else-if="legalSearch.legalList.value.length === 0"
                class="bg-card rounded-xl border p-12 text-center">
                <FileText class="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
                <h3 class="mb-2 text-lg font-medium">
                    {{ searchKeyword.trim() ? '未找到相关法律法规' : '当前筛选条件下没有法律法规' }}
                </h3>
                <p class="mb-4 text-sm text-muted-foreground">请尝试调整搜索条件</p>
                <Button variant="outline" @click="handleReset">重置筛选</Button>
            </div>

            <!-- 结果列表 -->
            <template v-else>
                <!-- 结果标题行（仅在有 keyword 时显示） -->
                <div v-if="searchKeyword.trim()" class="mb-3 flex flex-wrap items-baseline justify-between gap-3">
                    <h2 class="text-base font-semibold">
                        找到 {{ legalSearch.pagination.value.total.toLocaleString() }} 部法律法规（耗时
                        {{ legalSearch.searchElapsed.value.toFixed(2) }} 秒）
                    </h2>
                    <div class="flex items-center gap-2">
                        <span class="whitespace-nowrap text-xs font-semibold text-muted-foreground">排序</span>
                        <Select :model-value="sortValue" @update:model-value="handleSortChange($event as string)">
                            <SelectTrigger class="w-[140px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem v-for="o in SORT_OPTIONS" :key="o.value" :value="o.value">
                                    {{ o.label }}
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>

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
            <div v-else-if="articleSearch.error.value" class="bg-card rounded-xl border p-12 text-center">
                <AlertCircle class="mx-auto mb-4 h-12 w-12 text-destructive" />
                <h3 class="mb-2 text-lg font-medium">搜索失败</h3>
                <p class="mb-4 text-sm text-muted-foreground">{{ articleSearch.error.value }}</p>
                <Button variant="outline" @click="handleArticleRetry">
                    <RefreshCw class="mr-2 h-4 w-4" />
                    重试
                </Button>
            </div>

            <!-- 空状态 -->
            <div v-else-if="articleSearch.results.value.length === 0"
                class="bg-card rounded-xl border p-12 text-center">
                <FileSearch class="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
                <h3 class="mb-2 text-lg font-medium">未找到相关法条</h3>
                <p class="mb-4 text-sm text-muted-foreground">请尝试使用不同的关键词搜索</p>
                <Button variant="outline" @click="handleReset">重置搜索</Button>
            </div>

            <!-- 结果列表 -->
            <template v-else>
                <h2 class="mb-3 text-base font-semibold">
                    找到 {{ articleSearch.total.value }} 条相关法条 · 按语义相似度排序
                    <span class="ml-1 font-normal text-muted-foreground">
                        （耗时 {{ articleSearch.searchElapsed.value.toFixed(2) }} 秒）
                    </span>
                </h2>
                <div class="flex flex-col gap-3">
                    <div v-for="card in articleCards" :key="card.id"
                        class="bg-card cursor-pointer rounded-xl border p-5 transition-colors hover:bg-muted/40"
                        @click="handleArticleResultClick(card.raw)">
                        <!-- 顶行：类型 + 法条号 + 相似度 -->
                        <div class="mb-2 flex flex-wrap items-center gap-2.5">
                            <LegalSearchStatusBadge :tone="card.typeTone">
                                {{ card.typeLabel }}
                            </LegalSearchStatusBadge>
                            <span v-if="card.articleNo" class="text-[13px] font-semibold text-primary">
                                {{ card.articleNo }}
                            </span>
                            <span v-if="card.similarity"
                                class="ml-auto inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                                <span class="h-1.5 w-1.5 rounded-full bg-primary" />
                                相似度 {{ card.similarity }}%
                            </span>
                        </div>
                        <!-- 法律名称 -->
                        <h3 class="mb-1 font-semibold">{{ card.raw.legal_name }}</h3>
                        <!-- 章节面包屑 -->
                        <div v-if="card.breadcrumb.length" class="mb-2 text-xs text-muted-foreground">
                            {{ card.breadcrumb.join(' › ') }}
                        </div>
                        <!-- 高亮摘录 -->
                        <p class="text-[13.5px] leading-relaxed text-foreground line-clamp-3" v-html="card.excerpt" />
                    </div>
                    <p class="mt-1 text-center text-xs text-muted-foreground">
                        点击法条卡片可查看完整条文与关联案例
                    </p>
                </div>
            </template>
        </template>

        <!-- 法条详情弹框 -->
        <LegalSearchArticleDetailDialog v-model:open="articleDialogOpen" :article="selectedArticle" />
    </div>
</template>

<script lang="ts" setup>
import { Loader2, FileText, AlertCircle, RefreshCw, FileSearch, Flame } from 'lucide-vue-next'
import type { ValidityStatusFilter, ArticleSearchFilters } from '#shared/types/legal-search'
import { VALIDITY_STATUS_FILTERS } from '#shared/types/legal-search'
import type { LawSearchResultItem, LegalType } from '#shared/types/legal'
import LegalSearchArticleDetailDialog from '~/components/legal-search/ArticleDetailDialog.vue'
import LegalSearchLegalList from '~/components/legal-search/LegalList.vue'
import LegalSearchLegalListMobile from '~/components/legal-search/LegalListMobile.vue'
import LegalSearchUnifiedSearchPanel from '~/components/legal-search/UnifiedSearchPanel.vue'
import LegalSearchStatusBadge from '~/components/legal-search/StatusBadge.vue'
import type { BadgeTone } from '~/components/legal-search/legalDisplay'
import { useArticleSearch } from '~/composables/useArticleSearch'
import { useLegalSearch } from '~/composables/useLegalSearch'
import { useSiteSeo } from '~/composables/useSiteSeo'
import { useTrendingKeywords } from '~/composables/useTrendingKeywords'

// ==================== 页面元数据 ====================

definePageMeta({
    layout: "dashboard-layout",
    title: "法律法规",
})

// ==================== SEO ====================

useSiteSeo({
    title: '法律法规 - 法律检索系统',
    description: '搜索和浏览法律法规全文，支持多维度筛选和法条语义搜索',
    path: '/dashboard/legal',
    noindex: true,
})

// ==================== 常量 ====================

/** 搜全文结果排序选项（仅保留后端支持的字段） */
const SORT_OPTIONS = [
    { value: 'publishDate', label: '按发布日期', sortBy: 'publishDate', sortOrder: 'desc' },
    { value: 'effectiveDate', label: '按生效日期', sortBy: 'effectiveDate', sortOrder: 'desc' },
    { value: 'name', label: '按名称', sortBy: 'name', sortOrder: 'asc' },
] as const

/** 法条号识别正则：以「第…条」开头 */
const ARTICLE_NO_RE = /^第[一二三四五六七八九十百千零〇\d]+条/

/** 法条类型中文名 → 徽章色调 */
const ARTICLE_TYPE_TONE: Record<string, BadgeTone> = {
    '法律': 'info',
    '法规': 'success',
    '司法解释': 'warn',
    '指导意见': 'muted',
}

// ==================== 组合式函数 ====================

const route = useRoute()
const router = useRouter()
const legalSearch = useLegalSearch()
const articleSearch = useArticleSearch()
const trending = useTrendingKeywords()

// ==================== 响应式状态 ====================

/** 当前激活的 Tab */
const activeTab = ref<'legal' | 'article'>('legal')

/** 搜索关键词 */
const searchKeyword = ref('')

/** 搜索筛选条件 */
const searchFilters = ref<{ type: LegalType | null; issuingAuthority: string | null; validityStatus: ValidityStatusFilter }>({
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

/** 法条搜索是否已执行过 */
const hasArticleSearched = ref(false)

/** 防止循环更新的标志 */
const isRestoring = ref(false)

// ==================== 计算属性 ====================

/** 搜全文当前排序值（派生自检索筛选条件，与 useLegalSearch 单一数据源保持一致） */
const sortValue = computed(() => legalSearch.filters.value.sortBy)

/** 法条卡片派生数据 */
const articleCards = computed(() =>
    articleSearch.results.value.map(result => {
        const { articleNo, breadcrumb } = splitChapter(result.chapter_hierarchy || [])
        const legalType = result.metadata?.legal_type
        return {
            id: result.articles_id,
            raw: result,
            articleNo,
            breadcrumb,
            typeLabel: legalType || '法条',
            typeTone: (legalType && ARTICLE_TYPE_TONE[legalType]) || 'info',
            similarity: result.score ? (result.score * 100).toFixed(1) : null,
            excerpt: highlightContent(extractArticleContent(result.content)),
        }
    })
)

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
    if (typeof query.validityStatus === 'string' && (VALIDITY_STATUS_FILTERS as readonly string[]).includes(query.validityStatus)) {
        searchFilters.value.validityStatus = query.validityStatus as ValidityStatusFilter
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
    if (typeof query.articleStatus === 'string' && (VALIDITY_STATUS_FILTERS as readonly string[]).includes(query.articleStatus)) {
        articleFilters.value.validityStatus = query.articleStatus as ValidityStatusFilter
    }

    // 如果有搜全文的关键词，自动执行搜索
    if (searchKeyword.value || searchFilters.value.type || searchFilters.value.issuingAuthority) {
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

    // 搜全文 tab 默认列表：URL 未带任何过滤条件时，主动拉一次默认列表
    if (
        activeTab.value === 'legal'
        && !searchKeyword.value
        && !searchFilters.value.type
        && !searchFilters.value.issuingAuthority
    ) {
        await legalSearch.search()
    }

    // 拉当前 tab 的热搜词
    await trending.load(activeTab.value)
})

// ==================== 监听器 ====================

/** 监听 Tab 切换，同步到 URL、刷新热搜、兜底加载默认列表 */
watch(activeTab, async (val) => {
    syncToUrl()
    await trending.load(val)
    if (val === 'legal' && legalSearch.legalList.value.length === 0 && !searchKeyword.value) {
        await legalSearch.search()
    }
})

/** 监听搜全文分页变化，同步到 URL */
watch(() => legalSearch.pagination.value.page, () => {
    if (activeTab.value === 'legal') {
        syncToUrl()
    }
})

// ==================== 辅助方法 ====================

/** 拆分章节层级：末段若为「第…条」则作为法条号，其余作为面包屑 */
const splitChapter = (hierarchy: string[]): { articleNo: string | null; breadcrumb: string[] } => {
    if (hierarchy.length > 0) {
        const last = hierarchy[hierarchy.length - 1]!
        if (ARTICLE_NO_RE.test(last)) {
            return { articleNo: last, breadcrumb: hierarchy.slice(0, -1) }
        }
    }
    return { articleNo: null, breadcrumb: hierarchy }
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

/** 处理热门检索词点击 */
const handleTrendingClick = (keyword: string) => {
    if (activeTab.value === 'legal') {
        searchKeyword.value = keyword
    } else {
        articleQuery.value = keyword
    }
    handleSearch()
}

/** 处理排序变化 */
const handleSortChange = (val: string) => {
    const opt = SORT_OPTIONS.find(o => o.value === val)
    if (!opt) return
    legalSearch.setSort(opt.sortBy, opt.sortOrder)
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
