<template>
    <!-- 法律统计信息卡片 -->
    <div class="bg-card rounded-lg border p-6">
        <div class="flex items-center gap-2 mb-4">
            <BarChart3 class="h-5 w-5 text-primary" />
            <h2 class="text-lg font-semibold">统计信息</h2>
        </div>
        <div v-if="statistics" class="space-y-6">
            <!-- 条文统计 -->
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div class="bg-primary/5 rounded-lg p-4">
                    <p class="text-sm text-muted-foreground mb-1">条文总数</p>
                    <p class="text-3xl font-bold text-primary">{{ statistics.totalArticles }}</p>
                </div>
                <div class="bg-green-50 dark:bg-green-950/20 rounded-lg p-4">
                    <p class="text-sm text-muted-foreground mb-1">已向量化</p>
                    <p class="text-3xl font-bold text-green-600 dark:text-green-400">
                        {{ statistics.embeddedArticles }}
                    </p>
                    <p class="text-xs text-muted-foreground mt-1">
                        {{ getPercentage(statistics.embeddedArticles, statistics.totalArticles) }}
                    </p>
                </div>
                <div class="bg-orange-50 dark:bg-orange-950/20 rounded-lg p-4">
                    <p class="text-sm text-muted-foreground mb-1">未向量化</p>
                    <p class="text-3xl font-bold text-orange-600 dark:text-orange-400">
                        {{ statistics.notEmbeddedArticles }}
                    </p>
                    <p class="text-xs text-muted-foreground mt-1">
                        {{ getPercentage(statistics.notEmbeddedArticles, statistics.totalArticles) }}
                    </p>
                </div>
            </div>

            <!-- 向量化进度条 -->
            <div v-if="statistics.totalArticles > 0">
                <div class="flex items-center justify-between mb-2">
                    <p class="text-sm text-muted-foreground">向量化进度</p>
                    <p class="text-sm font-medium">
                        {{ getPercentage(statistics.embeddedArticles, statistics.totalArticles) }}
                    </p>
                </div>
                <div class="w-full bg-muted rounded-full h-2">
                    <div class="bg-green-600 dark:bg-green-400 h-2 rounded-full transition-all"
                        :style="{ width: getPercentage(statistics.embeddedArticles, statistics.totalArticles) }">
                    </div>
                </div>
            </div>

            <!-- 类型分布 -->
            <div v-if="showTypeDistribution" class="pt-4 border-t">
                <p class="text-sm font-medium mb-3">条文类型分布</p>
                <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
                    <div v-for="(count, type) in statistics.articlesByType" :key="type"
                        class="bg-muted/50 rounded-lg p-3">
                        <p class="text-xs text-muted-foreground mb-1">{{ getArticleTypeName(type) }}</p>
                        <p class="text-xl font-semibold">{{ count }}</p>
                    </div>
                </div>
            </div>
        </div>
        <div v-else class="text-center py-8 text-muted-foreground">
            <Loader2 class="h-8 w-8 animate-spin mx-auto mb-2" />
            <p class="text-sm">加载统计信息...</p>
        </div>
    </div>
</template>

<script setup lang="ts">
import { BarChart3, Loader2 } from 'lucide-vue-next'
import type { LegalStatistics } from '#shared/types/legal'

// 定义 props
defineProps<{
    statistics: LegalStatistics | null
    showTypeDistribution?: boolean
}>()

/** 计算百分比 */
const getPercentage = (value: number, total: number): string => {
    if (total === 0) return '0%'
    return `${Math.round((value / total) * 100)}%`
}

/** 获取条文类型名称 */
const getArticleTypeName = (type: string): string => {
    const typeMap: Record<string, string> = {
        l1: '编',
        l2: '分编',
        l3: '章',
        l4: '节',
        l5: '条',
        notice: '通知',
        header: '正文头部',
        footer: '正文尾部',
        annex: '附件',
    }
    return typeMap[type] || type
}
</script>
