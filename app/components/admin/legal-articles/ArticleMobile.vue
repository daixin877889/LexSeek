<template>
    <!-- 移动端条文卡片视图 -->
    <div class="md:hidden space-y-2">
        <div v-for="(article, index) in articles" :key="article.id" :class="getMobileCardClass(article.type)">
            <!-- 卡片头部 - 可点击展开 -->
            <div class="p-3 cursor-pointer" @click="$emit('toggle-expand', article.id)"
                :style="{ paddingLeft: `${12 + getIndentLevel(article.type) * 12}px` }">
                <div class="flex items-start justify-between gap-2">
                    <div class="flex items-center gap-2 flex-1 min-w-0">
                        <div class="w-5 h-5 rounded flex items-center justify-center bg-muted/50 shrink-0">
                            <ChevronDown v-if="expandedRows.has(article.id)" class="w-3.5 h-3.5 text-primary" />
                            <ChevronRight v-else class="w-3.5 h-3.5 text-muted-foreground" />
                        </div>
                        <span class="text-xs text-muted-foreground shrink-0">{{ startIndex + index + 1 }}</span>
                        <span :class="getTitleClass(article.type)" class="truncate">
                            {{ getArticleTitle(article) }}
                        </span>
                    </div>
                    <GeneralLegalArticleTypeBadge :type="article.type" />
                </div>
                <div class="flex items-center justify-between mt-1.5 pl-7">
                    <div class="flex items-center gap-2">
                        <GeneralLegalStatusBadge :effective-date="article.effectiveDate"
                            :invalid-date="article.invalidDate" />
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
                        :disabled="embeddingId === article.id" @click.stop="$emit('embed', article)">
                        <Loader2 v-if="embeddingId === article.id" class="h-3 w-3 mr-1 animate-spin" />
                        <Sparkles v-else class="h-3 w-3 mr-1" />
                        向量化
                    </Button>
                    <Button variant="outline" size="sm" class="flex-1 h-8 text-xs" @click.stop="$emit('edit', article)">
                        <Pencil class="h-3 w-3 mr-1" />
                        编辑
                    </Button>
                    <Button variant="outline" size="sm" class="h-8 text-xs text-destructive hover:text-destructive"
                        @click.stop="$emit('delete', article)">
                        <Trash2 class="h-3 w-3" />
                    </Button>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ChevronRight, ChevronDown, Check, Sparkles, Pencil, Trash2, Loader2 } from 'lucide-vue-next'
import dayjs from 'dayjs'
import type { LegalArticleListItem, ArticleType } from '#shared/types/legal'
import GeneralLegalArticleTypeBadge from '~/components/general/legal/ArticleTypeBadge.vue'
import GeneralLegalStatusBadge from '~/components/general/legal/LegalStatusBadge.vue'

// 定义 props
defineProps<{
    articles: LegalArticleListItem[]
    expandedRows: Set<string>
    startIndex: number
    embeddingId: string | null
}>()

// 定义事件
defineEmits<{
    'toggle-expand': [id: string]
    embed: [article: LegalArticleListItem]
    edit: [article: LegalArticleListItem]
    delete: [article: LegalArticleListItem]
}>()

/** 格式化日期 */
const formatDate = (date: string | Date | null | undefined): string => {
    if (!date) return '-'
    return dayjs(date).format('YYYY-MM-DD HH:mm')
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
</script>
