<template>
    <div class="space-y-4">
        <!-- 头部信息 -->
        <div class="flex items-center justify-between">
            <h3 class="text-lg font-semibold">法律法规</h3>
            <div class="text-sm text-muted-foreground">
                共 {{ total }} 条
            </div>
        </div>

        <!-- 加载状态 -->
        <template v-if="loading">
            <div v-for="i in pageSize" :key="`skeleton-${i}`" class="bg-card rounded-lg border p-4 space-y-3">
                <div class="flex items-start justify-between">
                    <Skeleton class="h-5 w-48" />
                    <Skeleton class="h-6 w-16" />
                </div>
                <Skeleton class="h-4 w-32" />
                <div class="flex items-center justify-between">
                    <Skeleton class="h-4 w-24" />
                    <Skeleton class="h-8 w-16" />
                </div>
            </div>
        </template>

        <!-- 列表项 -->
        <template v-else-if="items.length > 0">
            <div v-for="item in items" :key="item.id" class="bg-card rounded-lg border p-4 space-y-3 transition-colors"
                :class="{ 'ring-2 ring-primary': selectedId === item.id }" @click="handleItemClick(item)">
                <!-- 标题和类型 -->
                <div class="flex items-start justify-between gap-3">
                    <div class="flex-1 min-w-0">
                        <h4 class="font-medium leading-tight">{{ item.name }}</h4>
                        <div v-if="item.documentNumber" class="text-sm text-muted-foreground mt-1">
                            {{ item.documentNumber }}
                        </div>
                    </div>
                    <Badge :variant="getTypeVariant(item.type)" class="shrink-0">
                        {{ getTypeLabel(item.type) }}
                    </Badge>
                </div>

                <!-- 发文机关 -->
                <div v-if="item.issuingAuthority" class="flex flex-wrap gap-1">
                    <span v-for="(authority, index) in parseIssuingAuthorities(item.issuingAuthority)" :key="index"
                        class="inline-flex items-center px-2 py-0.5 rounded text-xs bg-muted text-muted-foreground">
                        {{ authority }}
                    </span>
                </div>

                <!-- 底部信息 -->
                <div class="flex items-center space-x-3 text-sm text-muted-foreground">
                    <span>{{ formatDate(item.effectiveDate) }}</span>
                    <Badge :variant="getValidityVariant(item)" class="text-xs">
                        {{ getValidityLabel(item) }}
                    </Badge>
                </div>
            </div>
        </template>

        <!-- 空状态 -->
        <template v-else>
            <div class="bg-card rounded-lg border p-8">
                <div class="flex flex-col items-center justify-center space-y-3 text-center">
                    <FileText class="h-12 w-12 text-muted-foreground" />
                    <div class="text-muted-foreground">
                        <div class="font-medium">暂无数据</div>
                        <div class="text-sm">请尝试调整搜索条件</div>
                    </div>
                </div>
            </div>
        </template>

        <!-- 分页 -->
        <div v-if="!loading && items.length > 0" class="bg-card rounded-lg border p-4">
            <!-- 分页信息 -->
            <div class="text-center text-sm text-muted-foreground mb-4">
                第 {{ currentPage }} / {{ totalPages }} 页，共 {{ total }} 条记录
            </div>

            <!-- 分页按钮 -->
            <div class="flex items-center justify-center space-x-2">
                <Button variant="outline" size="sm" :disabled="currentPage <= 1" @click="handlePageChange(1)">
                    首页
                </Button>
                <Button variant="outline" size="sm" :disabled="currentPage <= 1"
                    @click="handlePageChange(currentPage - 1)">
                    <ChevronLeft class="h-4 w-4" />
                </Button>

                <!-- 当前页码输入 -->
                <div class="flex items-center space-x-2">
                    <Input :model-value="currentPage.toString()" @update:model-value="handlePageInput"
                        @keyup.enter="handlePageInputConfirm" type="number" :min="1" :max="totalPages"
                        class="w-16 text-center" />
                    <span class="text-sm text-muted-foreground">/ {{ totalPages }}</span>
                </div>

                <Button variant="outline" size="sm" :disabled="currentPage >= totalPages"
                    @click="handlePageChange(currentPage + 1)">
                    <ChevronRight class="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" :disabled="currentPage >= totalPages"
                    @click="handlePageChange(totalPages)">
                    末页
                </Button>
            </div>
        </div>

        <!-- 加载更多按钮（可选） -->
        <div v-if="showLoadMore && !loading && items.length > 0 && currentPage < totalPages" class="text-center">
            <Button variant="outline" @click="handleLoadMore" :disabled="loadingMore">
                <template v-if="loadingMore">
                    <Loader2 class="h-4 w-4 mr-2 animate-spin" />
                    加载中...
                </template>
                <template v-else>
                    加载更多
                </template>
            </Button>
        </div>
    </div>
</template>

<script lang="ts" setup>
import { FileText, ChevronLeft, ChevronRight, Loader2 } from 'lucide-vue-next'
import type { LegalListItemWithValidity } from '~/composables/useLegalSearch'
import { LegalType } from '#shared/types/legal'
import dayjs from 'dayjs'

// ==================== Props ====================

interface Props {
    /** 列表数据 */
    items: LegalListItemWithValidity[]
    /** 加载状态 */
    loading?: boolean
    /** 加载更多状态 */
    loadingMore?: boolean
    /** 总数量 */
    total: number
    /** 当前页码 */
    currentPage: number
    /** 每页数量 */
    pageSize: number
    /** 总页数 */
    totalPages: number
    /** 选中的项目 ID */
    selectedId?: string | null
    /** 是否显示加载更多按钮 */
    showLoadMore?: boolean
}

const props = withDefaults(defineProps<Props>(), {
    loading: false,
    loadingMore: false,
    selectedId: null,
    showLoadMore: false,
})

// ==================== Emits ====================

const emit = defineEmits<{
    itemClick: [item: LegalListItemWithValidity]
    pageChange: [page: number]
    loadMore: []
}>()

// ==================== 响应式状态 ====================

/** 页码输入值 */
const pageInputValue = ref(props.currentPage.toString())

// ==================== 监听器 ====================

watch(() => props.currentPage, (newPage) => {
    pageInputValue.value = newPage.toString()
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
const getTypeVariant = (type: LegalType): "default" | "secondary" | "outline" | "destructive" => {
    const variants: Record<LegalType, "default" | "secondary" | "outline" | "destructive"> = {
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
    return dayjs(date).format('YYYY-MM-DD')
}

/** 获取生效状态标签 */
const getValidityLabel = (item: LegalListItemWithValidity): string => {
    const now = new Date()
    const effectiveDate = item.effectiveDate ? new Date(item.effectiveDate) : null
    const invalidDate = item.invalidDate ? new Date(item.invalidDate) : null

    // 已失效：失效日期已过
    if (invalidDate && invalidDate <= now) {
        return '已失效'
    }

    // 尚未生效：生效日期在未来
    if (effectiveDate && effectiveDate > now) {
        return '尚未生效'
    }

    // 现行有效
    return '现行有效'
}

/** 获取生效状态徽章样式 */
const getValidityVariant = (item: LegalListItemWithValidity): "default" | "secondary" | "outline" | "destructive" => {
    const now = new Date()
    const effectiveDate = item.effectiveDate ? new Date(item.effectiveDate) : null
    const invalidDate = item.invalidDate ? new Date(item.invalidDate) : null

    // 已失效
    if (invalidDate && invalidDate <= now) {
        return 'secondary'
    }

    // 尚未生效
    if (effectiveDate && effectiveDate > now) {
        return 'outline'
    }

    // 现行有效
    return 'default'
}

/** 解析发文机关（支持全角和半角逗号分隔） */
const parseIssuingAuthorities = (authority: string): string[] => {
    // 使用正则匹配全角逗号（，）和半角逗号（,）
    return authority.split(/[,，]/).map(s => s.trim()).filter(s => s.length > 0)
}

/** 处理项目点击 */
const handleItemClick = (item: LegalListItemWithValidity) => {
    emit('itemClick', item)
}

/** 处理页码变化 */
const handlePageChange = (page: number) => {
    if (page >= 1 && page <= props.totalPages && page !== props.currentPage) {
        emit('pageChange', page)
    }
}

/** 处理页码输入 */
const handlePageInput = (value: string | number) => {
    pageInputValue.value = String(value)
}

/** 处理页码输入确认 */
const handlePageInputConfirm = () => {
    const page = parseInt(pageInputValue.value)
    if (!isNaN(page)) {
        handlePageChange(page)
    } else {
        // 重置为当前页码
        pageInputValue.value = props.currentPage.toString()
    }
}

/** 处理加载更多 */
const handleLoadMore = () => {
    emit('loadMore')
}
</script>