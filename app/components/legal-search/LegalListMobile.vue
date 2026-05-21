<template>
    <div class="space-y-3">
        <!-- 加载骨架 -->
        <template v-if="loading">
            <div v-for="i in pageSize" :key="`skeleton-${i}`" class="bg-card rounded-xl border p-4 space-y-3">
                <div class="flex items-start justify-between">
                    <Skeleton class="h-5 w-48" />
                    <Skeleton class="h-6 w-16" />
                </div>
                <Skeleton class="h-4 w-32" />
                <Skeleton class="h-4 w-24" />
            </div>
        </template>

        <!-- 列表项 -->
        <template v-else-if="items.length > 0">
            <div v-for="item in items" :key="item.id"
                class="bg-card rounded-xl border p-4 space-y-3 cursor-pointer transition-colors hover:bg-muted/40"
                :class="{ 'ring-2 ring-primary': selectedId === item.id }" @click="handleItemClick(item)">
                <!-- 标题和类型 -->
                <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0 flex-1">
                        <h4 class="font-semibold leading-tight">{{ item.name }}</h4>
                        <div v-if="item.documentNumber" class="mt-1 text-xs text-muted-foreground">
                            {{ item.documentNumber }}
                        </div>
                    </div>
                    <LegalSearchStatusBadge :tone="getLegalTypeTone(item.type)">
                        {{ LegalTypeLabels[item.type] }}
                    </LegalSearchStatusBadge>
                </div>

                <!-- 发文机关 -->
                <div v-if="item.issuingAuthority" class="line-clamp-2 text-sm text-muted-foreground"
                    :title="formatIssuingAuthorities(item.issuingAuthority)">
                    {{ formatIssuingAuthorities(item.issuingAuthority) }}
                </div>

                <!-- 底部信息 -->
                <div class="flex items-center gap-3 text-sm text-muted-foreground">
                    <span>{{ formatLegalDate(item.effectiveDate) }}</span>
                    <LegalSearchStatusBadge :tone="getValidityTone(item)">
                        {{ getValidityLabel(item) }}
                    </LegalSearchStatusBadge>
                </div>
            </div>
        </template>

        <!-- 空状态 -->
        <template v-else>
            <div class="bg-card rounded-xl border p-8">
                <div class="flex flex-col items-center justify-center gap-3 text-center">
                    <FileText class="h-12 w-12 text-muted-foreground" />
                    <div class="text-muted-foreground">
                        <div class="font-medium">暂无数据</div>
                        <div class="text-sm">请尝试调整搜索条件</div>
                    </div>
                </div>
            </div>
        </template>

        <!-- 分页 -->
        <div v-if="!loading && items.length > 0" class="bg-card rounded-xl border p-4">
            <div class="mb-3 text-center text-sm text-muted-foreground">
                第 {{ currentPage }} / {{ totalPages }} 页，共 {{ total }} 条记录
            </div>
            <div class="flex items-center justify-center gap-1.5">
                <button type="button" :disabled="currentPage <= 1"
                    class="rounded-md border px-2.5 py-1.5 text-[13px] font-medium transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
                    @click="handlePageChange(1)">
                    首页
                </button>
                <button type="button" :disabled="currentPage <= 1"
                    class="rounded-md border p-1.5 transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
                    @click="handlePageChange(currentPage - 1)">
                    <ChevronLeft class="h-4 w-4" />
                </button>
                <div class="flex items-center gap-2">
                    <Input :model-value="pageInputValue" @update:model-value="handlePageInput"
                        @keyup.enter="handlePageInputConfirm" type="number" :min="1" :max="totalPages"
                        class="w-16 text-center" />
                    <span class="text-sm text-muted-foreground">/ {{ totalPages }}</span>
                </div>
                <button type="button" :disabled="currentPage >= totalPages"
                    class="rounded-md border p-1.5 transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
                    @click="handlePageChange(currentPage + 1)">
                    <ChevronRight class="h-4 w-4" />
                </button>
                <button type="button" :disabled="currentPage >= totalPages"
                    class="rounded-md border px-2.5 py-1.5 text-[13px] font-medium transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
                    @click="handlePageChange(totalPages)">
                    末页
                </button>
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
import { LegalTypeLabels } from '#shared/types/legal'
import LegalSearchStatusBadge from '~/components/legal-search/StatusBadge.vue'
import {
    getLegalTypeTone,
    getValidityLabel,
    getValidityTone,
    formatIssuingAuthorities,
    formatLegalDate,
} from '~/components/legal-search/legalDisplay'

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
        pageInputValue.value = props.currentPage.toString()
    }
}

/** 处理加载更多 */
const handleLoadMore = () => {
    emit('loadMore')
}
</script>
