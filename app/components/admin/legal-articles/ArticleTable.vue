<template>
    <!-- 桌面端条文表格 -->
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
                    <tr :class="getRowClass(article.type)" @click="$emit('toggle-expand', article.id)">
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
                            {{ startIndex + index + 1 }}
                        </td>
                        <!-- 条文标题（带缩进） -->
                        <td class="py-2.5">
                            <div class="flex items-center"
                                :style="{ paddingLeft: `${getIndentLevel(article.type) * 20}px` }">
                                <!-- 缩进指示线 -->
                                <div v-if="getIndentLevel(article.type) > 0" class="flex items-center mr-2">
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
                            <GeneralLegalArticleTypeBadge :type="article.type" />
                        </td>
                        <!-- 状态 -->
                        <td class="px-4 py-2.5 text-center">
                            <GeneralLegalStatusBadge :effective-date="article.effectiveDate"
                                :invalid-date="article.invalidDate" />
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
                                    :disabled="embeddingId === article.id" @click="$emit('embed', article)">
                                    <Loader2 v-if="embeddingId === article.id" class="h-3.5 w-3.5 animate-spin" />
                                    <Sparkles v-else class="h-3.5 w-3.5" />
                                </Button>
                                <Button variant="ghost" size="icon" class="h-7 w-7" title="编辑"
                                    @click="$emit('edit', article)">
                                    <Pencil class="h-3.5 w-3.5" />
                                </Button>
                                <Button variant="ghost" size="icon"
                                    class="h-7 w-7 text-destructive hover:text-destructive" title="删除"
                                    @click="$emit('delete', article)">
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
                                        <p class="font-medium">{{ formatDate(article.lastEditedAt) }}</p>
                                    </div>
                                </div>
                            </div>
                        </td>
                    </tr>
                </template>
            </tbody>
        </table>
    </div>
</template>

<script setup lang="ts">
import { ChevronRight, ChevronDown, Check, Sparkles, Pencil, Trash2, Loader2 } from 'lucide-vue-next'
import dayjs from 'dayjs'
import type { LegalArticleListItem, ArticleType } from '#shared/types/legal'

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
</script>
