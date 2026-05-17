<template>
    <div class="theme-brand legal-article-preview h-full flex flex-col">
        <!-- 标题栏 - 超紧凑版 -->
        <div class="border-b px-3 py-1.5 bg-muted/30">
            <div class="flex items-center justify-between">
                <h3 class="text-sm font-medium">拆分预览</h3>
                <div class="flex items-center gap-2">
                    <span class="text-xs text-muted-foreground">
                        共 {{ articles.length }} 个条文块
                    </span>
                    <!-- 导航按钮 -->
                    <Popover v-model:open="navigationOpen">
                        <PopoverTrigger as-child>
                            <Button variant="ghost" size="icon" :class="['h-7 w-7', adminBrandFocusClass]">
                                <List class="h-3.5 w-3.5" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent class="theme-brand w-80 p-0" align="end">
                            <div class="flex flex-col h-[400px]">
                                <!-- 导航标题 -->
                                <div class="px-3 py-2 border-b shrink-0">
                                    <h4 class="text-sm font-medium">条文导航</h4>
                                </div>
                                <!-- 条文列表 -->
                                <div class="flex-1 overflow-y-auto">
                                    <div class="p-2 space-y-1">
                                        <button v-for="(article, index) in articles" :key="index"
                                            @click="scrollToArticle(index)"
                                            :class="['w-full text-left px-2 py-1.5 rounded-md hover:bg-muted transition-colors flex items-center gap-2', adminBrandFocusClass]"
                                            :style="{ paddingLeft: `${8 + getIndentLevel(article) * 8}px` }">
                                            <span class="text-xs text-muted-foreground shrink-0 min-w-[24px]">
                                                {{ index + 1 }}
                                            </span>
                                            <div class="flex-1 min-w-0 flex items-center gap-1.5">
                                                <span class="text-xs truncate">
                                                    {{ getArticleTitle(article) }}
                                                </span>
                                                <Badge :variant="getTypeVariant(article.type)"
                                                    class="shrink-0 text-xs h-4 px-1.5">
                                                    {{ getTypeLabel(article.type) }}
                                                </Badge>
                                            </div>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </PopoverContent>
                    </Popover>
                </div>
            </div>
        </div>

        <!-- 错误提示 - 超紧凑版 -->
        <div v-if="error" class="px-3 py-1.5 bg-destructive/10 border-b border-destructive/20">
            <div class="flex items-start gap-1.5">
                <AlertCircle class="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                <p class="text-xs text-destructive">{{ error }}</p>
            </div>
        </div>

        <!-- 条文列表 -->
        <ScrollArea class="flex-1 h-0">
            <div class="p-2 space-y-1.5">
                <!-- 条文卡片 - 超紧凑版 -->
                <div v-for="(article, index) in articles" :key="index" :ref="el => setArticleRef(el, index)"
                    :class="getCardClass(article.type)" :style="{ marginLeft: `${getIndentLevel(article) * 12}px` }">

                    <!-- 卡片头部 -->
                    <div class="flex items-start gap-2 mb-1">
                        <!-- 序号 -->
                        <span class="text-xs text-muted-foreground shrink-0 w-4">
                            {{ index + 1 }}
                        </span>

                        <!-- 标题和类型 -->
                        <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-1.5 flex-wrap">
                                <span :class="getTitleClass(article.type)">
                                    {{ getArticleTitle(article) }}
                                </span>
                                <Badge :variant="getTypeVariant(article.type)" class="shrink-0 text-xs h-4 px-1.5">
                                    {{ getTypeLabel(article.type) }}
                                </Badge>
                            </div>
                        </div>
                    </div>

                    <!-- 条文内容 -->
                    <div v-if="article.content" class="pl-6">
                        <div class="text-xs text-foreground/90 whitespace-pre-wrap leading-relaxed">
                            {{ article.content }}
                        </div>
                    </div>

                    <!-- 层级信息（如果有） -->
                    <div v-if="hasHierarchy(article)" class="pl-6 mt-1 pt-1 border-t">
                        <div class="flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                            <span v-if="article.l1">编: {{ article.l1 }}</span>
                            <span v-if="article.l2">分编: {{ article.l2 }}</span>
                            <span v-if="article.l3">章: {{ article.l3 }}</span>
                            <span v-if="article.l4">节: {{ article.l4 }}</span>
                            <span v-if="article.l5">条: {{ article.l5 }}</span>
                        </div>
                    </div>
                </div>

                <!-- 空状态 -->
                <div v-if="articles.length === 0 && !error" class="text-center py-8">
                    <FileText class="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                    <p class="text-xs text-muted-foreground">
                        开始编辑内容，预览将实时显示
                    </p>
                </div>
            </div>
        </ScrollArea>
    </div>
</template>

<script setup lang="ts">
import { AlertCircle, FileText, List } from 'lucide-vue-next'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { ParsedArticle } from '#shared/types/legal-parser'
import { error } from '#shared/utils/logger'
import { adminBrandFocusClass } from '~/utils/adminBrandStyles'

/**
 * Props 定义
 */
const props = defineProps<{
    /** 解析后的条文数组 */
    articles: ParsedArticle[]
    /** 解析错误信息 */
    error: string | null
}>()

/**
 * 导航状态
 */
const navigationOpen = ref(false)
const articleRefs = ref<Map<number, HTMLElement>>(new Map())

/**
 * 设置条文元素引用
 */
function setArticleRef(el: any, index: number) {
    if (el) {
        articleRefs.value.set(index, el as HTMLElement)
    }
}

/**
 * 滚动到指定条文
 */
function scrollToArticle(index: number) {
    const element = articleRefs.value.get(index)
    if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' })
        // 关闭导航弹窗
        navigationOpen.value = false

        // 添加高亮效果
        element.classList.add('ring-2', 'ring-primary', 'ring-offset-2')
        setTimeout(() => {
            element.classList.remove('ring-2', 'ring-primary', 'ring-offset-2')
        }, 2000)
    }
}

/**
 * 获取条文类型的显示标签
 */
function getTypeLabel(type: ParsedArticle['type']): string {
    const labels: Record<ParsedArticle['type'], string> = {
        notice: '公告',
        header: '头部',
        footer: '尾部',
        annex: '附件',
        l1: '编',
        l2: '分编',
        l3: '章',
        l4: '节',
        l5: '条',
    }
    return labels[type] || type
}

/**
 * 获取条文类型的 Badge 样式
 */
function getTypeVariant(type: ParsedArticle['type']): 'default' | 'secondary' | 'outline' {
    if (type === 'notice') return 'default'
    if (type === 'header' || type === 'footer') return 'secondary'
    if (type === 'annex') return 'outline'
    return 'default'
}

/**
 * 获取条文的缩进层级
 */
function getIndentLevel(article: ParsedArticle): number {
    // 根据条文类型和层级计算缩进
    if (article.type === 'notice' || article.type === 'header' || article.type === 'footer') {
        return 0
    }
    if (article.type === 'annex') {
        return 0
    }
    if (article.type === 'l1') return 0
    if (article.type === 'l2') return 1
    if (article.type === 'l3') return 2
    if (article.type === 'l4') return 3
    if (article.type === 'l5') return 4
    return 0
}

/**
 * 获取条文标题
 */
function getArticleTitle(article: ParsedArticle): string {
    // 按层级优先级返回标题
    if (article.type === 'l5' && article.l5) return article.l5
    if (article.type === 'l4' && article.l4) return article.l4
    if (article.type === 'l3' && article.l3) return article.l3
    if (article.type === 'l2' && article.l2) return article.l2
    if (article.type === 'l1' && article.l1) return article.l1
    // 其他类型显示内容摘要
    if (article.content) {
        const preview = article.content.slice(0, 50)
        return preview.length < article.content.length ? `${preview}...` : preview
    }
    return '-'
}

/**
 * 获取标题样式类（不同层级不同样式）- 紧凑版
 */
function getTitleClass(type: ParsedArticle['type']): string {
    const classes: Record<string, string> = {
        l1: 'text-xs font-bold text-foreground',
        l2: 'text-xs font-semibold text-foreground',
        l3: 'text-xs font-medium text-foreground',
        l4: 'text-xs font-medium text-muted-foreground',
        l5: 'text-xs text-foreground',
    }
    return classes[type] || 'text-xs text-muted-foreground'
}

/**
 * 获取卡片样式类（不同层级不同背景）- 紧凑版
 */
function getCardClass(type: ParsedArticle['type']): string {
    const baseClass = 'border rounded-md p-2 transition-colors'
    const typeClasses: Record<string, string> = {
        l1: 'bg-indigo-500/5 border-indigo-500/20',
        l2: 'bg-cyan-500/5 border-cyan-500/20',
        l3: 'bg-emerald-500/5 border-emerald-500/20',
        l4: 'bg-amber-500/5 border-amber-500/20',
        l5: 'bg-primary/5 border-primary/20',
    }
    return `${baseClass} ${typeClasses[type] || 'bg-card'}`
}

/**
 * 判断条文是否有层级信息
 */
function hasHierarchy(article: ParsedArticle): boolean {
    return !!(article.l1 || article.l2 || article.l3 || article.l4 || article.l5)
}
</script>

<style scoped>
/* 确保 markstream-vue 渲染的内容样式正确 */
.prose {
    color: var(--foreground);
}

.prose :deep(p) {
    margin-top: 0.5rem;
    margin-bottom: 0.5rem;
}

.prose :deep(ul),
.prose :deep(ol) {
    margin-top: 0.5rem;
    margin-bottom: 0.5rem;
    padding-left: 1.5rem;
}

.prose :deep(li) {
    margin-top: 0.25rem;
    margin-bottom: 0.25rem;
}

.prose :deep(code) {
    background-color: var(--muted);
    padding: 0.125rem 0.25rem;
    border-radius: 0.25rem;
    font-size: 0.875em;
}

.prose :deep(pre) {
    background-color: var(--muted);
    padding: 0.75rem;
    border-radius: 0.375rem;
    overflow-x: auto;
}

.prose :deep(blockquote) {
    border-left: 4px solid var(--border);
    padding-left: 1rem;
    color: var(--muted-foreground);
    font-style: italic;
}
</style>
