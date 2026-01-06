<template>
    <div class="bg-card rounded-lg border h-full flex flex-col">
        <!-- 头部 -->
        <div class="p-4 border-b flex items-center justify-between">
            <div class="flex-1 min-w-0">
                <h3 class="font-semibold truncate">{{ legalData?.name || '法律全文预览' }}</h3>
                <div v-if="legalData?.documentNumber" class="text-sm text-muted-foreground">
                    {{ legalData.documentNumber }}
                </div>
            </div>
            <div class="flex items-center space-x-2">
                <!-- 移动端关闭按钮 -->
                <Button v-if="showCloseButton" variant="ghost" size="sm" @click="handleClose">
                    <X class="h-4 w-4" />
                </Button>
                <!-- 全屏切换按钮 -->
                <Button variant="ghost" size="sm" @click="toggleFullscreen">
                    <Maximize2 v-if="!isFullscreen" class="h-4 w-4" />
                    <Minimize2 v-else class="h-4 w-4" />
                </Button>
            </div>
        </div>

        <!-- 法律信息 -->
        <div v-if="legalData" class="p-4 border-b bg-muted/30">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                    <span class="font-medium">法律类型：</span>
                    <Badge :variant="getTypeVariant(legalData.type)">
                        {{ getTypeLabel(legalData.type) }}
                    </Badge>
                </div>
                <div v-if="legalData.issuingAuthority">
                    <span class="font-medium">发文机关：</span>
                    {{ legalData.issuingAuthority }}
                </div>
                <div v-if="legalData.publishDate">
                    <span class="font-medium">发布日期：</span>
                    {{ formatDate(legalData.publishDate) }}
                </div>
                <div v-if="legalData.effectiveDate">
                    <span class="font-medium">生效日期：</span>
                    {{ formatDate(legalData.effectiveDate) }}
                </div>
                <div>
                    <span class="font-medium">生效状态：</span>
                    <Badge :variant="isLegalValid ? 'default' : 'secondary'">
                        {{ isLegalValid ? '有效' : '已失效' }}
                    </Badge>
                </div>
            </div>
        </div>

        <!-- 内容区域 -->
        <div class="flex-1 flex overflow-hidden">
            <!-- 条文导航（桌面端） -->
            <div v-if="!isMobile && articles.length > 0" class="w-64 border-r bg-muted/20 overflow-y-auto">
                <div class="p-3 border-b">
                    <h4 class="font-medium text-sm">条文导航</h4>
                </div>
                <div class="p-2">
                    <div v-for="article in articles" :key="article.id" class="mb-1">
                        <button class="w-full text-left px-2 py-1 text-sm rounded hover:bg-muted transition-colors"
                            :class="{
                                'bg-primary text-primary-foreground': activeArticleId === article.id,
                                'font-medium': getArticleLevel(article) === 1,
                                'pl-4': getArticleLevel(article) === 2,
                                'pl-6': getArticleLevel(article) === 3,
                                'pl-8': getArticleLevel(article) >= 4,
                            }" @click="scrollToArticle(article.id)">
                            {{ getArticleTitle(article) }}
                        </button>
                    </div>
                </div>
            </div>

            <!-- 条文内容 -->
            <div class="flex-1 overflow-y-auto">
                <!-- 加载状态 -->
                <div v-if="loading" class="p-6 space-y-4">
                    <Skeleton class="h-6 w-3/4" />
                    <Skeleton class="h-4 w-full" />
                    <Skeleton class="h-4 w-5/6" />
                    <Skeleton class="h-4 w-4/5" />
                </div>

                <!-- 错误状态 -->
                <div v-else-if="error" class="p-6 text-center">
                    <div class="text-destructive mb-2">{{ error }}</div>
                    <Button variant="outline" @click="handleRetry">
                        <RefreshCw class="h-4 w-4 mr-2" />
                        重试
                    </Button>
                </div>

                <!-- 空状态 -->
                <div v-else-if="!legalData" class="p-6 text-center text-muted-foreground">
                    <FileText class="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <div>请选择法律法规查看全文</div>
                </div>

                <!-- 条文内容 -->
                <div v-else-if="articles.length > 0" class="p-6">
                    <!-- 移动端条文导航按钮 -->
                    <div v-if="isMobile" class="mb-4">
                        <Button variant="outline" size="sm" @click="showMobileNavigation = true">
                            <List class="h-4 w-4 mr-2" />
                            条文导航
                        </Button>
                    </div>

                    <!-- 条文列表 -->
                    <div class="space-y-6">
                        <div v-for="article in articles" :key="article.id" :id="`article-${article.id}`"
                            class="scroll-mt-4">
                            <!-- 条文标题 -->
                            <div class="font-medium mb-2" :class="{
                                'text-lg': getArticleLevel(article) === 1,
                                'text-base': getArticleLevel(article) === 2,
                                'text-sm': getArticleLevel(article) >= 3,
                            }">
                                {{ getArticleTitle(article) }}
                            </div>

                            <!-- 条文内容 -->
                            <div class="text-sm leading-relaxed whitespace-pre-wrap" :class="{
                                'pl-0': getArticleLevel(article) === 1,
                                'pl-4': getArticleLevel(article) === 2,
                                'pl-6': getArticleLevel(article) === 3,
                                'pl-8': getArticleLevel(article) >= 4,
                            }" v-html="highlightContent(article.content || '')" />
                        </div>
                    </div>
                </div>

                <!-- 无条文内容 -->
                <div v-else class="p-6 text-center text-muted-foreground">
                    <FileX class="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <div>该法律法规暂无条文内容</div>
                </div>
            </div>
        </div>

        <!-- 移动端条文导航抽屉 -->
        <Sheet v-if="isMobile" v-model:open="showMobileNavigation">
            <SheetContent side="left" class="w-80">
                <SheetHeader>
                    <SheetTitle>条文导航</SheetTitle>
                </SheetHeader>
                <div class="mt-4 space-y-1">
                    <button v-for="article in articles" :key="article.id"
                        class="w-full text-left px-2 py-1 text-sm rounded hover:bg-muted transition-colors" :class="{
                            'bg-primary text-primary-foreground': activeArticleId === article.id,
                            'font-medium': getArticleLevel(article) === 1,
                            'pl-4': getArticleLevel(article) === 2,
                            'pl-6': getArticleLevel(article) === 3,
                            'pl-8': getArticleLevel(article) >= 4,
                        }" @click="scrollToArticle(article.id, true)">
                        {{ getArticleTitle(article) }}
                    </button>
                </div>
            </SheetContent>
        </Sheet>
    </div>
</template>

<script lang="ts" setup>
import {
    X,
    Maximize2,
    Minimize2,
    RefreshCw,
    FileText,
    FileX,
    List
} from 'lucide-vue-next'
import type { LegalDetailResponse } from '#shared/types/legal-search'
import type { LegalArticleInfo } from '#shared/types/legal'
import { LegalType } from '#shared/types/legal'
import dayjs from 'dayjs'

// ==================== Props ====================

interface Props {
    /** 法律数据 */
    legalData?: LegalDetailResponse | null
    /** 条文列表 */
    articles?: LegalArticleInfo[]
    /** 加载状态 */
    loading?: boolean
    /** 错误信息 */
    error?: string | null
    /** 高亮关键词 */
    highlightKeywords?: string[]
    /** 是否显示关闭按钮（移动端） */
    showCloseButton?: boolean
    /** 是否全屏模式 */
    isFullscreen?: boolean
}

const props = withDefaults(defineProps<Props>(), {
    legalData: null,
    articles: () => [],
    loading: false,
    error: null,
    highlightKeywords: () => [],
    showCloseButton: false,
    isFullscreen: false,
})

// ==================== Emits ====================

const emit = defineEmits<{
    close: []
    retry: []
    toggleFullscreen: []
}>()

// ==================== 响应式状态 ====================

/** 当前激活的条文 ID */
const activeArticleId = ref<string | null>(null)

/** 是否显示移动端导航 */
const showMobileNavigation = ref(false)

/** 是否为移动端 */
const isMobile = ref(false)

// ==================== 生命周期 ====================

onMounted(() => {
    // 检测屏幕尺寸
    const checkMobile = () => {
        isMobile.value = window.innerWidth < 768
    }

    checkMobile()
    window.addEventListener('resize', checkMobile)

    onUnmounted(() => {
        window.removeEventListener('resize', checkMobile)
    })
})

// ==================== 计算属性 ====================

/** 判断法律是否有效 */
const isLegalValid = computed(() => {
    if (!props.legalData) return false

    const now = new Date()
    const effectiveDate = props.legalData.effectiveDate ? new Date(props.legalData.effectiveDate) : null
    const invalidDate = props.legalData.invalidDate ? new Date(props.legalData.invalidDate) : null

    // 如果有生效日期且还未生效，则无效
    if (effectiveDate && effectiveDate > now) return false

    // 如果有失效日期且已失效，则无效
    if (invalidDate && invalidDate <= now) return false

    return true
})

// ==================== 方法 ====================

/** 获取法律类型标签 */
const getTypeLabel = (type: LegalType): string => {
    const labels: Record<LegalType, string> = {
        law: '法律',
        regulation: '行政法规',
        judicial_interp: '司法解释',
        guideline: '指导意见',
    }
    return labels[type] || type
}

/** 获取法律类型徽章样式 */
const getTypeVariant = (type: LegalType): "default" | "destructive" | "outline" | "secondary" => {
    const variants: Record<LegalType, "default" | "destructive" | "outline" | "secondary"> = {
        law: 'default',
        regulation: 'secondary',
        judicial_interp: 'outline',
        guideline: 'destructive',
    }
    return variants[type] || 'default'
}

/** 格式化日期 */
const formatDate = (date: string | Date | null): string => {
    if (!date) return '-'
    return dayjs(date).format('YYYY年MM月DD日')
}

/** 获取条文标题 */
const getArticleTitle = (article: LegalArticleInfo): string => {
    const parts: string[] = []

    if (article.l1) parts.push(`第${article.l1}编`)
    if (article.l2) parts.push(`第${article.l2}章`)
    if (article.l3) parts.push(`第${article.l3}节`)
    if (article.l4) parts.push(`第${article.l4}条`)
    if (article.l5) parts.push(`第${article.l5}款`)

    return parts.join(' ') || `条文 ${article.order || article.id}`
}

/** 获取条文层级 */
const getArticleLevel = (article: LegalArticleInfo): number => {
    if (article.l1 && !article.l2) return 1
    if (article.l2 && !article.l3) return 2
    if (article.l3 && !article.l4) return 3
    return 4
}

/** 高亮内容 */
const highlightContent = (content: string): string => {
    if (!props.highlightKeywords.length) return content

    let highlightedContent = content
    props.highlightKeywords.forEach(keyword => {
        if (keyword.trim()) {
            const regex = new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
            highlightedContent = highlightedContent.replace(
                regex,
                '<mark class="bg-yellow-200 dark:bg-yellow-800">$1</mark>'
            )
        }
    })

    return highlightedContent
}

/** 滚动到指定条文 */
const scrollToArticle = (articleId: string, closeMobileNav = false) => {
    const element = document.getElementById(`article-${articleId}`)
    if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' })
        activeArticleId.value = articleId

        if (closeMobileNav) {
            showMobileNavigation.value = false
        }
    }
}

/** 处理关闭 */
const handleClose = () => {
    emit('close')
}

/** 处理重试 */
const handleRetry = () => {
    emit('retry')
}

/** 切换全屏 */
const toggleFullscreen = () => {
    emit('toggleFullscreen')
}

// ==================== 监听器 ====================

// 监听条文变化，重置激活状态
watch(() => props.articles, () => {
    activeArticleId.value = null
})
</script>