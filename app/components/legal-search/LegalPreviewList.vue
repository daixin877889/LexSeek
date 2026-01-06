<template>
    <div class="legal-preview-list">
        <!-- 法律基本信息 -->
        <div class="mb-6 p-4 bg-muted/30 rounded-lg">
            <h1 class="text-xl font-bold mb-2">{{ legalData?.name }}</h1>
            <div class="flex flex-wrap gap-3 text-sm text-muted-foreground">
                <span v-if="legalData?.documentNumber">
                    <span class="font-medium">文号：</span>{{ legalData.documentNumber }}
                </span>
                <span v-if="legalData?.issuingAuthority">
                    <span class="font-medium">发文机关：</span>{{ legalData.issuingAuthority }}
                </span>
                <span v-if="legalData?.publishDate">
                    <span class="font-medium">发布日期：</span>{{ formatDate(legalData.publishDate) }}
                </span>
                <span v-if="legalData?.effectiveDate">
                    <span class="font-medium">生效日期：</span>{{ formatDate(legalData.effectiveDate) }}
                </span>
            </div>
        </div>

        <!-- 条文列表 -->
        <div class="space-y-2">
            <template v-for="article in articles" :key="article.id">
                <div :id="`article-${article.id}`" :ref="el => observeArticle(el, article.id)"
                    class="article-card border rounded-lg p-3 scroll-mt-4 transition-colors"
                    :class="getCardClass(article)" :style="{ marginLeft: `${getIndentLevel(article) * 16}px` }">
                    <!-- 卡片头部 -->
                    <div class="flex items-start gap-2 mb-1">
                        <!-- 序号 -->
                        <span class="text-xs text-muted-foreground shrink-0 w-6">
                            {{ getArticleIndex(article) }}
                        </span>

                        <!-- 标题和类型 -->
                        <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-2 flex-wrap">
                                <span :class="getTitleClass(article)">
                                    {{ getArticleTitle(article) }}
                                </span>
                                <Badge :variant="getTypeVariant(article)" class="shrink-0 text-xs h-5 px-1.5">
                                    {{ getTypeLabel(article) }}
                                </Badge>
                            </div>
                        </div>
                    </div>

                    <!-- 条文内容 -->
                    <div v-if="article.content" class="pl-8">
                        <div class="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
                            {{ article.content }}
                        </div>
                    </div>

                    <!-- 层级信息 - 与 LegalArticlePreview 保持一致 -->
                    <div v-if="hasHierarchy(article)" class="pl-8 mt-2 pt-2 border-t">
                        <div class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            <span v-if="article.l1">编: {{ article.l1 }}</span>
                            <span v-if="article.l2">分编: {{ article.l2 }}</span>
                            <span v-if="article.l3">章: {{ article.l3 }}</span>
                            <span v-if="article.l4">节: {{ article.l4 }}</span>
                            <span v-if="article.l5">条: {{ article.l5 }}</span>
                        </div>
                    </div>
                </div>
            </template>
        </div>

        <!-- 空状态 -->
        <div v-if="articles.length === 0" class="text-center py-12 text-muted-foreground">
            <FileText class="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>该法律法规暂无条文内容</p>
        </div>
    </div>
</template>

<script lang="ts" setup>
import { FileText } from 'lucide-vue-next'
import { Badge } from '~/components/ui/badge'
import type { LegalDetailResponse } from '#shared/types/legal-search'
import type { LegalArticleInfo } from '#shared/types/legal'
import { ArticleType, ArticleTypeLabels } from '#shared/types/legal'
import dayjs from 'dayjs'

// ==================== Props ====================

interface Props {
    /** 法律数据 */
    legalData: LegalDetailResponse | null
    /** 条文列表 */
    articles: LegalArticleInfo[]
    /** 当前激活的条文 ID */
    activeArticleId?: string | null
}

const props = withDefaults(defineProps<Props>(), {
    activeArticleId: null,
})

// ==================== Emits ====================

const emit = defineEmits<{
    articleVisible: [articleId: string]
}>()

// ==================== 响应式状态 ====================

/** IntersectionObserver 实例 */
let observer: IntersectionObserver | null = null

/** 已观察的元素 */
const observedElements = new Map<string, Element>()

// ==================== 方法 ====================

/** 格式化日期 */
const formatDate = (date: string | Date | null): string => {
    if (!date) return ''
    return dayjs(date).format('YYYY-MM-DD')
}

/** 获取条文序号 */
const getArticleIndex = (article: LegalArticleInfo): string => {
    const index = props.articles.indexOf(article)
    return `${index + 1}`
}

/** 获取条文标题 */
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
        const preview = article.content.slice(0, 50)
        return preview.length < article.content.length ? `${preview}...` : preview
    }

    return '-'
}

/** 获取条文类型标签 */
const getTypeLabel = (article: LegalArticleInfo): string => {
    return ArticleTypeLabels[article.type] || '其他'
}

/** 获取条文类型徽章样式 */
const getTypeVariant = (article: LegalArticleInfo): 'default' | 'secondary' | 'outline' => {
    const type = article.type
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

/** 获取缩进层级 */
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

/** 获取卡片样式类 */
const getCardClass = (article: LegalArticleInfo): string => {
    const type = article.type
    const baseClass = ''

    const typeClasses: Record<string, string> = {
        [ArticleType.NOTICE]: 'bg-yellow-50/50 border-yellow-200 dark:bg-yellow-950/20 dark:border-yellow-900',
        [ArticleType.HEADER]: 'bg-gray-50/50 border-gray-200 dark:bg-gray-950/20 dark:border-gray-800',
        [ArticleType.FOOTER]: 'bg-gray-50/50 border-gray-200 dark:bg-gray-950/20 dark:border-gray-800',
        [ArticleType.ANNEX]: 'bg-cyan-50/50 border-cyan-200 dark:bg-cyan-950/20 dark:border-cyan-900',
        [ArticleType.L1]: 'bg-red-50/50 border-red-200 dark:bg-red-950/20 dark:border-red-900',
        [ArticleType.L2]: 'bg-green-50/50 border-green-200 dark:bg-green-950/20 dark:border-green-900',
        [ArticleType.L3]: 'bg-orange-50/50 border-orange-200 dark:bg-orange-950/20 dark:border-orange-900',
        [ArticleType.L4]: 'bg-purple-50/50 border-purple-200 dark:bg-purple-950/20 dark:border-purple-900',
        [ArticleType.L5]: 'bg-blue-50/50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-900',
    }

    return `${baseClass} ${typeClasses[type] || 'bg-card'}`
}

/** 获取标题样式类 */
const getTitleClass = (article: LegalArticleInfo): string => {
    const type = article.type
    const classes: Record<string, string> = {
        [ArticleType.NOTICE]: 'text-sm font-medium text-yellow-700 dark:text-yellow-400',
        [ArticleType.HEADER]: 'text-sm font-medium text-muted-foreground',
        [ArticleType.FOOTER]: 'text-sm font-medium text-muted-foreground',
        [ArticleType.ANNEX]: 'text-sm font-medium text-cyan-700 dark:text-cyan-400',
        [ArticleType.L1]: 'text-sm font-bold text-foreground',
        [ArticleType.L2]: 'text-sm font-semibold text-foreground',
        [ArticleType.L3]: 'text-sm font-medium text-foreground',
        [ArticleType.L4]: 'text-sm font-medium text-muted-foreground',
        [ArticleType.L5]: 'text-sm text-foreground',
    }
    return classes[type] || 'text-sm text-muted-foreground'
}

/** 判断是否有层级信息 */
const hasHierarchy = (article: LegalArticleInfo): boolean => {
    // 只有当条文有内容时才显示层级信息
    if (!article.content) return false

    // 检查是否有多个层级
    const levels = [article.l1, article.l2, article.l3, article.l4, article.l5].filter(Boolean)
    return levels.length > 1
}

/** 观察条文元素 */
const observeArticle = (el: any, articleId: string) => {
    if (!el || !observer) return

    // 如果已经观察过，先取消观察
    const existingEl = observedElements.get(articleId)
    if (existingEl) {
        observer.unobserve(existingEl)
    }

    // 观察新元素
    observer.observe(el)
    observedElements.set(articleId, el)
}

// ==================== 生命周期 ====================

onMounted(() => {
    // 创建 IntersectionObserver
    observer = new IntersectionObserver(
        (entries) => {
            // 找到最靠近顶部的可见元素
            const visibleEntries = entries.filter(entry => entry.isIntersecting)
            if (visibleEntries.length > 0) {
                // 按照元素在页面中的位置排序
                visibleEntries.sort((a, b) => {
                    return a.boundingClientRect.top - b.boundingClientRect.top
                })

                const topEntry = visibleEntries[0]
                if (topEntry) {
                    const articleId = topEntry.target.id.replace('article-', '')
                    emit('articleVisible', articleId)
                }
            }
        },
        {
            rootMargin: '-100px 0px -50% 0px',
            threshold: 0,
        }
    )
})

onUnmounted(() => {
    if (observer) {
        observer.disconnect()
        observer = null
    }
    observedElements.clear()
})
</script>

<style scoped>
.article-card {
    transition: all 0.2s;
}

.article-card:target {
    outline: 2px solid hsl(var(--primary));
    outline-offset: 2px;
}
</style>
