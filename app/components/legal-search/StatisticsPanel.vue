<template>
    <div class="bg-card rounded-lg border p-6">
        <!-- 加载状态 -->
        <div v-if="loading" class="grid grid-cols-2 lg:grid-cols-4 gap-6">
            <div v-for="i in 4" :key="i" class="space-y-3">
                <Skeleton class="h-4 w-24" />
                <Skeleton class="h-10 w-20" />
                <Skeleton class="h-3 w-28" />
            </div>
        </div>

        <!-- 统计数据 -->
        <div v-else-if="statistics" class="grid grid-cols-2 lg:grid-cols-4 gap-6">
            <!-- 法律总数 -->
            <div class="text-center lg:text-left">
                <div class="text-sm font-medium text-muted-foreground mb-2">法律法规总数</div>
                <div class="text-3xl font-bold text-foreground mb-1">{{ statistics.total.toLocaleString() }}</div>
                <div class="text-xs text-muted-foreground">包含所有类型法规</div>
            </div>

            <!-- 法律 -->
            <div class="text-center lg:text-left">
                <div class="text-sm font-medium text-muted-foreground mb-2">法律</div>
                <div class="text-3xl font-bold text-blue-600 mb-1">{{ statistics.byType.law.toLocaleString() }}</div>
                <div class="text-xs text-muted-foreground">全国人大制定</div>
            </div>

            <!-- 行政法规 -->
            <div class="text-center lg:text-left">
                <div class="text-sm font-medium text-muted-foreground mb-2">行政法规</div>
                <div class="text-3xl font-bold text-green-600 mb-1">{{ statistics.byType.regulation.toLocaleString() }}
                </div>
                <div class="text-xs text-muted-foreground">国务院制定</div>
            </div>

            <!-- 司法解释 -->
            <div class="text-center lg:text-left">
                <div class="text-sm font-medium text-muted-foreground mb-2">司法解释</div>
                <div class="text-3xl font-bold text-purple-600 mb-1">{{
                    statistics.byType.judicial_interp.toLocaleString() }}</div>
                <div class="text-xs text-muted-foreground">最高法院制定</div>
            </div>
        </div>

        <!-- 错误状态 -->
        <div v-else-if="error" class="text-center py-8">
            <div class="text-sm text-destructive mb-3">{{ error }}</div>
            <Button variant="outline" size="sm" @click="$emit('retry')">
                重试
            </Button>
        </div>

        <!-- 空状态 -->
        <div v-else class="text-center py-8">
            <div class="text-sm text-muted-foreground">暂无统计数据</div>
        </div>
    </div>
</template>

<script lang="ts" setup>
import type { LegalSearchStatistics } from '#shared/types/legal-search'

// ==================== Props ====================

interface Props {
    /** 统计数据 */
    statistics: LegalSearchStatistics | null
    /** 加载状态 */
    loading?: boolean
    /** 错误信息 */
    error?: string | null
}

const props = withDefaults(defineProps<Props>(), {
    loading: false,
    error: null,
})

// ==================== Emits ====================

const emit = defineEmits<{
    retry: []
}>()
</script>