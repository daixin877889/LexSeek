<template>
    <div class="legal-preview h-screen flex flex-col bg-background">
        <!-- 顶部工具栏 -->
        <div class="border-b bg-card px-4 py-3">
            <div class="flex items-center justify-between">
                <!-- 左侧：返回按钮和标题 -->
                <div class="flex items-center gap-3 min-w-0 flex-1">
                    <Button variant="ghost" size="icon" class="h-8 w-8 shrink-0" @click="handleBack">
                        <ArrowLeft class="h-4 w-4" />
                    </Button>
                    <div class="min-w-0 flex-1">
                        <h1 class="text-base font-semibold truncate">{{ legalData?.name || '法律全文预览' }}</h1>
                        <div v-if="legalData?.documentNumber" class="text-xs text-muted-foreground truncate">
                            {{ legalData.documentNumber }}
                        </div>
                    </div>
                </div>

                <!-- 右侧：模式切换和字号控制 -->
                <div class="flex items-center gap-3 shrink-0">
                    <!-- 模式切换 -->
                    <div class="flex items-center gap-1 bg-muted rounded-md p-0.5">
                        <Button :variant="viewMode === 'document' ? 'default' : 'ghost'" size="sm" class="h-7 px-3"
                            @click="viewMode = 'document'">
                            文书版
                        </Button>
                        <Button :variant="viewMode === 'list' ? 'default' : 'ghost'" size="sm" class="h-7 px-3"
                            @click="viewMode = 'list'">
                            结构版
                        </Button>
                    </div>

                    <!-- 字号控制 - 简洁版禁用 -->
                    <div class="flex items-center gap-1 text-sm text-muted-foreground">
                        <span>字号:</span>
                        <Button variant="ghost" size="icon" class="h-7 w-7" @click="decreaseFontSize"
                            :disabled="viewMode === 'list' || fontSize <= 12">
                            <span class="text-base">A<sup>-</sup></span>
                        </Button>
                        <Button variant="ghost" size="icon" class="h-7 w-7" @click="increaseFontSize"
                            :disabled="viewMode === 'list' || fontSize >= 24">
                            <span class="text-base">A<sup>+</sup></span>
                        </Button>
                    </div>
                </div>
            </div>
        </div>

        <!-- 主内容区域 -->
        <div class="flex-1 flex overflow-hidden">
            <!-- 加载状态 -->
            <div v-if="loading" class="flex-1 flex items-center justify-center">
                <div class="text-center">
                    <Loader2 class="h-8 w-8 animate-spin text-muted-foreground mx-auto mb-3" />
                    <p class="text-sm text-muted-foreground">加载中...</p>
                </div>
            </div>

            <!-- 错误状态 -->
            <div v-else-if="error" class="flex-1 flex items-center justify-center">
                <div class="text-center">
                    <AlertCircle class="h-12 w-12 text-destructive mx-auto mb-3" />
                    <p class="text-destructive mb-4">{{ error }}</p>
                    <Button variant="outline" @click="loadLegalDetail">
                        <RefreshCw class="h-4 w-4 mr-2" />
                        重试
                    </Button>
                </div>
            </div>

            <!-- 内容区域 -->
            <template v-else-if="legalData">
                <!-- 左侧目录 - 支持层级展开收缩 -->
                <div class="w-72 border-r bg-muted/20 flex flex-col shrink-0 hidden md:flex overflow-hidden">
                    <div class="p-3 border-b shrink-0">
                        <div class="flex items-center justify-between">
                            <div class="flex items-center gap-2">
                                <h3 class="text-sm font-semibold">条文导航</h3>
                                <span class="text-xs text-muted-foreground">
                                    {{ articles.length }} 条
                                </span>
                            </div>
                            <!-- 展开/折叠切换按钮 -->
                            <Button v-if="isAllCollapsed" variant="ghost" size="icon" class="h-6 w-6" title="全部展开"
                                @click="expandAll">
                                <ChevronsDownUp class="h-3.5 w-3.5" />
                            </Button>
                            <Button v-else variant="ghost" size="icon" class="h-6 w-6" title="全部折叠"
                                @click="collapseAll">
                                <ChevronsUpDown class="h-3.5 w-3.5" />
                            </Button>
                        </div>
                    </div>
                    <div class="flex-1 overflow-y-auto p-2">
                        <template v-if="visibleTocItems.length > 0">
                            <div class="space-y-0.5">
                                <div v-for="item in visibleTocItems" :key="item.id"
                                    class="flex items-center rounded-md hover:bg-accent transition-colors" :class="{
                                        'bg-primary/10 text-primary': activeArticleId === item.id,
                                    }">
                                    <!-- 展开/收缩按钮 -->
                                    <button v-if="item.hasChildren"
                                        class="shrink-0 w-5 h-5 flex items-center justify-center hover:bg-accent rounded"
                                        :style="{ marginLeft: `${item.level * 8}px` }"
                                        @click="toggleCollapse(item.id, $event)">
                                        <ChevronRight v-if="isCollapsed(item.id)" class="h-3 w-3" />
                                        <ChevronDown v-else class="h-3 w-3" />
                                    </button>
                                    <!-- 占位符（无子节点时） -->
                                    <span v-else class="shrink-0 w-5"
                                        :style="{ marginLeft: `${item.level * 8}px` }"></span>

                                    <!-- 目录项内容 -->
                                    <button class="flex-1 text-left px-1 py-1.5 flex items-center gap-1.5 min-w-0"
                                        @click="scrollToArticle(item.id)">
                                        <span class="text-xs text-muted-foreground shrink-0 min-w-[20px]">
                                            {{ item.index }}
                                        </span>
                                        <span class="text-xs truncate flex-1">
                                            {{ item.title }}
                                        </span>
                                        <Badge :variant="getTypeVariant(item.type)" class="shrink-0 text-xs h-4 px-1">
                                            {{ item.typeLabel }}
                                        </Badge>
                                    </button>
                                </div>
                            </div>
                        </template>
                        <div v-else class="text-sm text-muted-foreground text-center py-4">
                            暂无目录
                        </div>
                    </div>
                </div>

                <!-- 右侧内容 -->
                <div class="flex-1 overflow-hidden flex flex-col">
                    <!-- 移动端目录按钮 -->
                    <div class="md:hidden p-2 border-b shrink-0">
                        <Sheet v-model:open="showMobileToc">
                            <SheetTrigger as-child>
                                <Button variant="outline" size="sm">
                                    <List class="h-4 w-4 mr-2" />
                                    条文导航
                                </Button>
                            </SheetTrigger>
                            <SheetContent side="left" class="w-80">
                                <SheetHeader>
                                    <SheetTitle>条文导航</SheetTitle>
                                </SheetHeader>
                                <div class="flex items-center justify-between mt-1 mb-3">
                                    <span class="text-xs text-muted-foreground">
                                        {{ articles.length }} 条
                                    </span>
                                    <!-- 展开/折叠切换按钮 -->
                                    <Button v-if="isAllCollapsed" variant="ghost" size="icon" class="h-6 w-6"
                                        title="全部展开" @click="expandAll">
                                        <ChevronsDownUp class="h-3.5 w-3.5" />
                                    </Button>
                                    <Button v-else variant="ghost" size="icon" class="h-6 w-6" title="全部折叠"
                                        @click="collapseAll">
                                        <ChevronsUpDown class="h-3.5 w-3.5" />
                                    </Button>
                                </div>
                                <div class="h-[calc(100vh-120px)] overflow-y-auto">
                                    <div class="space-y-0.5">
                                        <div v-for="item in visibleTocItems" :key="item.id"
                                            class="flex items-center rounded-md hover:bg-accent transition-colors"
                                            :class="{
                                                'bg-primary/10 text-primary': activeArticleId === item.id,
                                            }">
                                            <!-- 展开/收缩按钮 -->
                                            <button v-if="item.hasChildren"
                                                class="shrink-0 w-5 h-5 flex items-center justify-center hover:bg-accent rounded"
                                                :style="{ marginLeft: `${item.level * 8}px` }"
                                                @click="toggleCollapse(item.id, $event)">
                                                <ChevronRight v-if="isCollapsed(item.id)" class="h-3 w-3" />
                                                <ChevronDown v-else class="h-3 w-3" />
                                            </button>
                                            <!-- 占位符（无子节点时） -->
                                            <span v-else class="shrink-0 w-5"
                                                :style="{ marginLeft: `${item.level * 8}px` }"></span>

                                            <!-- 目录项内容 -->
                                            <button
                                                class="flex-1 text-left px-1 py-1.5 flex items-center gap-1.5 min-w-0"
                                                @click="scrollToArticle(item.id, true)">
                                                <span class="text-xs text-muted-foreground shrink-0 min-w-[20px]">
                                                    {{ item.index }}
                                                </span>
                                                <span class="text-xs truncate flex-1">
                                                    {{ item.title }}
                                                </span>
                                                <Badge :variant="getTypeVariant(item.type)"
                                                    class="shrink-0 text-xs h-4 px-1">
                                                    {{ item.typeLabel }}
                                                </Badge>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </SheetContent>
                        </Sheet>
                    </div>

                    <!-- 内容滚动区域 -->
                    <div ref="contentScrollRef" class="flex-1 overflow-y-auto relative">
                        <div class="max-w-4xl mx-auto p-6" :style="{ fontSize: `${fontSize}px` }">
                            <!-- 文书版模式 -->
                            <template v-if="viewMode === 'document'">
                                <LegalSearchLegalPreviewDocument :legal-data="legalData" :articles="articles"
                                    :active-article-id="activeArticleId" @article-visible="handleArticleVisible" />
                            </template>

                            <!-- 纯净版模式（列表样式） -->
                            <template v-else>
                                <LegalSearchLegalPreviewList :legal-data="legalData" :articles="articles"
                                    :active-article-id="activeArticleId" @article-visible="handleArticleVisible" />
                            </template>
                        </div>

                        <!-- 滚动到顶部/底部按钮 -->
                        <div class="fixed bottom-6 right-6 flex flex-col gap-2 z-10">
                            <Button variant="outline" size="icon" class="h-9 w-9 rounded-full shadow-md bg-background"
                                title="滚动到顶部" @click="scrollToTop">
                                <ArrowUp class="h-4 w-4" />
                            </Button>
                            <Button variant="outline" size="icon" class="h-9 w-9 rounded-full shadow-md bg-background"
                                title="滚动到底部" @click="scrollToBottom">
                                <ArrowDown class="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                </div>
            </template>
        </div>
    </div>
</template>

<script lang="ts" setup>
import { ArrowLeft, ArrowUp, ArrowDown, Loader2, AlertCircle, RefreshCw, List, ChevronRight, ChevronDown, ChevronsDownUp, ChevronsUpDown } from 'lucide-vue-next'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '~/components/ui/sheet'
import { Badge } from '~/components/ui/badge'
import type { LegalDetailResponse } from '#shared/types/legal-search'
import type { LegalArticleInfo } from '#shared/types/legal'
import { ArticleType, ArticleTypeLabels } from '#shared/types/legal'
import LegalSearchLegalPreviewDocument from '~/components/legal-search/LegalPreviewDocument.vue'
import LegalSearchLegalPreviewList from '~/components/legal-search/LegalPreviewList.vue'
import { useApiFetch } from '~/composables/useApiFetch'

// ==================== 页面元数据 ====================

definePageMeta({
    layout: false,
})

// ==================== 路由 ====================

const route = useRoute()
const router = useRouter()
const legalId = route.params.id as string

// ==================== 响应式状态 ====================

/** 加载状态 */
const loading = ref(true)

/** 错误信息 */
const error = ref<string | null>(null)

/** 法律数据 */
const legalData = ref<LegalDetailResponse | null>(null)

/** 条文列表 */
const articles = ref<LegalArticleInfo[]>([])

/** 视图模式：document（文书版）或 list（纯净版/列表版） */
const viewMode = ref<'document' | 'list'>('document')

/** 字号大小 */
const fontSize = ref(16)

/** 当前激活的条文 ID */
const activeArticleId = ref<string | null>(null)

/** 内容滚动区域 ref */
const contentScrollRef = ref<HTMLElement | null>(null)

/** 移动端目录是否显示 */
const showMobileToc = ref(false)

/** 收缩的层级节点 ID 集合 */
const collapsedIds = ref<Set<string>>(new Set())

// ==================== 类型定义 ====================

interface TocItem {
    id: string
    index: number
    title: string
    level: number
    type: ArticleType
    typeLabel: string
    hasChildren: boolean
    parentId: string | null
}

// ==================== 计算属性 ====================

/** 目录项 - 带层级关系 */
const tocItems = computed<TocItem[]>(() => {
    if (!articles.value.length) return []

    const items: TocItem[] = []
    // 记录每个层级的最后一个父节点 ID
    const parentStack: { level: number; id: string }[] = []

    articles.value.forEach((article, index) => {
        const level = getIndentLevel(article)
        const id = article.id

        // 找到当前项的父节点
        while (parentStack.length > 0 && parentStack[parentStack.length - 1]!.level >= level) {
            parentStack.pop()
        }
        const parentId = parentStack.length > 0 ? parentStack[parentStack.length - 1]!.id : null

        // 如果是可以有子节点的层级（L1-L4），加入父节点栈
        if (level < 4) {
            parentStack.push({ level, id })
        }

        items.push({
            id,
            index: index + 1,
            title: getArticleTitle(article),
            level,
            type: article.type,
            typeLabel: getTypeLabel(article.type),
            hasChildren: false, // 稍后计算
            parentId,
        })
    })

    // 计算哪些节点有子节点
    const parentIds = new Set(items.map(item => item.parentId).filter(Boolean))
    items.forEach(item => {
        item.hasChildren = parentIds.has(item.id)
    })

    return items
})

/** 可见的目录项（根据展开/收缩状态过滤） */
const visibleTocItems = computed(() => {
    const items = tocItems.value
    const visible: TocItem[] = []

    // 收集所有被收缩节点的后代
    const hiddenByParent = new Set<string>()

    items.forEach(item => {
        // 检查是否有任何祖先被收缩
        let currentParentId = item.parentId
        let isHidden = false

        while (currentParentId) {
            if (collapsedIds.value.has(currentParentId)) {
                isHidden = true
                break
            }
            // 找到父节点的父节点
            const parent = items.find(i => i.id === currentParentId)
            currentParentId = parent?.parentId || null
        }

        if (!isHidden) {
            visible.push(item)
        }
    })

    return visible
})

/** 是否全部折叠 */
const isAllCollapsed = computed(() => {
    const parentIds = tocItems.value
        .filter(item => item.hasChildren)
        .map(item => item.id)
    // 如果没有可折叠的节点，返回 false
    if (parentIds.length === 0) return false
    // 检查是否所有父节点都被折叠
    return parentIds.every(id => collapsedIds.value.has(id))
})

// ==================== 方法 ====================

/** 加载法律详情 */
const loadLegalDetail = async () => {
    loading.value = true
    error.value = null

    try {
        const response = await useApiFetch<LegalDetailResponse>(`/api/v1/legal/${legalId}`)
        if (response) {
            legalData.value = response
            articles.value = response.articles || []
        }
    } catch (err: any) {
        error.value = err.message || '加载失败'
        console.error('加载法律详情失败:', err)
    } finally {
        loading.value = false
    }
}

/** 获取条文标题 - 参照 LegalArticlePreview 的实现 */
const getArticleTitle = (article: LegalArticleInfo): string => {
    const type = article.type

    // 根据类型返回对应层级的标题
    if (type === ArticleType.L5 && article.l5) return article.l5
    if (type === ArticleType.L4 && article.l4) return article.l4
    if (type === ArticleType.L3 && article.l3) return article.l3
    if (type === ArticleType.L2 && article.l2) return article.l2
    if (type === ArticleType.L1 && article.l1) return article.l1

    // 如果没有层级信息，显示内容摘要
    if (article.content) {
        const preview = article.content.slice(0, 30)
        return preview.length < article.content.length ? `${preview}...` : preview
    }

    return `条文 ${article.order || article.id}`
}

/** 获取条文缩进层级 - 参照 LegalArticlePreview 的实现 */
const getIndentLevel = (article: LegalArticleInfo): number => {
    const type = article.type
    const levels: Record<string, number> = {
        [ArticleType.NOTICE]: 0,
        [ArticleType.HEADER]: 0,
        [ArticleType.FOOTER]: 0,
        [ArticleType.ANNEX]: 0,
        [ArticleType.L1]: 0,
        [ArticleType.L2]: 1,
        [ArticleType.L3]: 2,
        [ArticleType.L4]: 3,
        [ArticleType.L5]: 4,
    }
    return levels[type] || 0
}

/** 获取条文类型标签 */
const getTypeLabel = (type: ArticleType): string => {
    return ArticleTypeLabels[type] || '其他'
}

/** 获取类型徽章样式 */
const getTypeVariant = (type: ArticleType): 'default' | 'secondary' | 'outline' => {
    // 通知、头部、尾部、附件使用 secondary
    if (type === ArticleType.NOTICE || type === ArticleType.HEADER || type === ArticleType.FOOTER || type === ArticleType.ANNEX) {
        return 'secondary'
    }
    // 编、分编使用 default
    if (type === ArticleType.L1 || type === ArticleType.L2) return 'default'
    // 章使用 secondary
    if (type === ArticleType.L3) return 'secondary'
    // 节、条使用 outline
    return 'outline'
}

/** 切换节点展开/收缩状态 */
const toggleCollapse = (id: string, event: Event) => {
    event.stopPropagation()
    if (collapsedIds.value.has(id)) {
        collapsedIds.value.delete(id)
    } else {
        collapsedIds.value.add(id)
    }
    // 触发响应式更新
    collapsedIds.value = new Set(collapsedIds.value)
}

/** 检查节点是否收缩 */
const isCollapsed = (id: string): boolean => {
    return collapsedIds.value.has(id)
}

/** 全部展开 */
const expandAll = () => {
    collapsedIds.value = new Set()
}

/** 全部折叠 */
const collapseAll = () => {
    // 收集所有有子节点的节点 ID
    const parentIds = tocItems.value
        .filter(item => item.hasChildren)
        .map(item => item.id)
    collapsedIds.value = new Set(parentIds)
}

/** 滚动到指定条文 */
const scrollToArticle = (articleId: string, closeMobileToc = false) => {
    const element = document.getElementById(`article-${articleId}`)
    if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' })
        activeArticleId.value = articleId

        if (closeMobileToc) {
            showMobileToc.value = false
        }
    }
}

/** 处理条文可见性变化 */
const handleArticleVisible = (articleId: string) => {
    activeArticleId.value = articleId
}

/** 增大字号 */
const increaseFontSize = () => {
    if (fontSize.value < 24) {
        fontSize.value += 2
    }
}

/** 减小字号 */
const decreaseFontSize = () => {
    if (fontSize.value > 12) {
        fontSize.value -= 2
    }
}

/** 返回上一页 */
const handleBack = () => {
    router.back()
}

/** 滚动到顶部 */
const scrollToTop = () => {
    if (contentScrollRef.value) {
        contentScrollRef.value.scrollTo({ top: 0, behavior: 'smooth' })
    }
}

/** 滚动到底部 */
const scrollToBottom = () => {
    if (contentScrollRef.value) {
        contentScrollRef.value.scrollTo({ top: contentScrollRef.value.scrollHeight, behavior: 'smooth' })
    }
}

// ==================== 生命周期 ====================

onMounted(() => {
    loadLegalDetail()
})
</script>

<style scoped>
.legal-preview {
    height: 100vh;
    overflow: hidden;
}
</style>
