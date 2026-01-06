<template>
    <div class="legal-preview-document">
        <!-- 法律基本信息 -->
        <div class="mb-8 pb-6 border-b">
            <h1 class="text-2xl font-bold text-center mb-4">{{ legalData?.name }}</h1>
            <div class="flex flex-wrap justify-center gap-4 text-sm text-muted-foreground">
                <span v-if="legalData?.documentNumber">{{ legalData.documentNumber }}</span>
                <span v-if="legalData?.issuingAuthority">{{ legalData.issuingAuthority }}</span>
                <span v-if="legalData?.publishDate">{{ formatDate(legalData.publishDate) }}</span>
            </div>
        </div>

        <!-- 条文内容 -->
        <div class="space-y-6">
            <template v-for="article in articles" :key="article.id">
                <!-- 编级标题 -->
                <div v-if="isL1Title(article)" :id="`article-${article.id}`"
                    class="text-xl font-bold text-center py-4 scroll-mt-4" :ref="el => observeArticle(el, article.id)">
                    {{ article.l1 }}
                </div>

                <!-- 章级标题 -->
                <div v-else-if="isL2Title(article)" :id="`article-${article.id}`"
                    class="text-lg font-semibold text-center py-3 scroll-mt-4"
                    :ref="el => observeArticle(el, article.id)">
                    {{ article.l2 }}
                </div>

                <!-- 节级标题 -->
                <div v-else-if="isL3Title(article)" :id="`article-${article.id}`"
                    class="text-base font-medium py-2 scroll-mt-4" :ref="el => observeArticle(el, article.id)">
                    {{ article.l3 }}
                </div>

                <!-- 条文内容 -->
                <div v-else :id="`article-${article.id}`" class="article-item scroll-mt-4"
                    :ref="el => observeArticle(el, article.id)">
                    <!-- 条文标题（如第一条、第二条等） -->
                    <div class="flex items-start gap-2">
                        <div v-if="article.l4 || article.l5"
                            class="font-medium text-primary shrink-0 border-l-4 border-primary pl-2">
                            {{ article.l4 || article.l5 }}
                        </div>
                    </div>

                    <!-- 条文正文 -->
                    <div v-if="article.content" class="mt-2 leading-relaxed whitespace-pre-wrap text-foreground/90"
                        :class="{ 'pl-4': article.l4 || article.l5 }">
                        {{ article.content }}
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
import type { LegalDetailResponse } from '#shared/types/legal-search'
import type { LegalArticleInfo } from '#shared/types/legal'
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
    return dayjs(date).format('YYYY年MM月DD日')
}

/** 判断是否为编级标题 */
const isL1Title = (article: LegalArticleInfo): boolean => {
    return !!(article.l1 && !article.l2 && !article.l3 && !article.l4 && !article.l5 && !article.content)
}

/** 判断是否为章级标题 */
const isL2Title = (article: LegalArticleInfo): boolean => {
    return !!(article.l2 && !article.l3 && !article.l4 && !article.l5 && !article.content)
}

/** 判断是否为节级标题 */
const isL3Title = (article: LegalArticleInfo): boolean => {
    return !!(article.l3 && !article.l4 && !article.l5 && !article.content)
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
.article-item {
    transition: background-color 0.2s;
}

.article-item:target {
    background-color: hsl(var(--primary) / 0.1);
    border-radius: 0.375rem;
    padding: 0.5rem;
    margin: -0.5rem;
}
</style>
