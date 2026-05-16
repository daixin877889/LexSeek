<template>
    <div class="bg-card rounded-xl border overflow-hidden">
        <TooltipProvider :delay-duration="200">
        <!-- 表格内容 -->
        <div class="overflow-x-auto">
            <table class="w-full min-w-[760px] table-fixed">
                <colgroup>
                    <col />
                    <col class="w-28" />
                    <col class="w-[30%]" />
                    <col class="w-32" />
                    <col class="w-28" />
                </colgroup>
                <thead>
                    <tr class="bg-muted/50">
                        <th v-for="h in TABLE_HEADERS" :key="h"
                            class="border-b px-4 py-3 text-left text-xs font-semibold text-muted-foreground">
                            {{ h }}
                        </th>
                    </tr>
                </thead>
                <tbody>
                    <!-- 加载骨架 -->
                    <template v-if="loading">
                        <tr v-for="i in pageSize" :key="`skeleton-${i}`" class="border-b">
                            <td class="px-4 py-3"><Skeleton class="h-4 w-48" /></td>
                            <td class="px-4 py-3"><Skeleton class="h-4 w-16" /></td>
                            <td class="px-4 py-3"><Skeleton class="h-4 w-24" /></td>
                            <td class="px-4 py-3"><Skeleton class="h-4 w-20" /></td>
                            <td class="px-4 py-3"><Skeleton class="h-4 w-12" /></td>
                        </tr>
                    </template>

                    <!-- 数据行 -->
                    <template v-else-if="items.length > 0">
                        <tr v-for="item in items" :key="item.id"
                            class="cursor-pointer border-b transition-colors hover:bg-muted/50"
                            :class="{ 'bg-muted/30': selectedId === item.id }" @click="handleRowClick(item)">
                            <td class="px-4 py-3 align-top">
                                <Tooltip>
                                    <TooltipTrigger as-child>
                                        <div class="font-semibold text-foreground line-clamp-2">
                                            {{ item.name }}
                                        </div>
                                    </TooltipTrigger>
                                    <TooltipContent class="max-w-sm whitespace-normal break-words">
                                        {{ item.name }}
                                    </TooltipContent>
                                </Tooltip>
                                <div v-if="item.documentNumber"
                                    class="mt-0.5 truncate text-xs text-muted-foreground"
                                    :title="item.documentNumber">
                                    {{ item.documentNumber }}
                                </div>
                            </td>
                            <td class="px-4 py-3 align-top">
                                <LegalSearchStatusBadge :tone="getLegalTypeTone(item.type)">
                                    {{ LegalTypeLabels[item.type] }}
                                </LegalSearchStatusBadge>
                            </td>
                            <td class="px-4 py-3 align-top">
                                <Tooltip v-if="item.issuingAuthority">
                                    <TooltipTrigger as-child>
                                        <div class="line-clamp-2 text-sm text-muted-foreground">
                                            {{ formatIssuingAuthorities(item.issuingAuthority) }}
                                        </div>
                                    </TooltipTrigger>
                                    <TooltipContent class="max-w-sm whitespace-normal break-words">
                                        {{ formatIssuingAuthorities(item.issuingAuthority) }}
                                    </TooltipContent>
                                </Tooltip>
                                <span v-else class="text-sm text-muted-foreground">-</span>
                            </td>
                            <td class="whitespace-nowrap px-4 py-3 align-top text-sm text-muted-foreground">
                                {{ formatLegalDate(item.effectiveDate) }}
                            </td>
                            <td class="px-4 py-3 align-top">
                                <LegalSearchStatusBadge :tone="getValidityTone(item)">
                                    {{ getValidityLabel(item) }}
                                </LegalSearchStatusBadge>
                            </td>
                        </tr>
                    </template>

                    <!-- 空状态 -->
                    <template v-else>
                        <tr>
                            <td :colspan="TABLE_HEADERS.length" class="px-4 py-12 text-center">
                                <div class="flex flex-col items-center justify-center gap-3">
                                    <FileText class="h-12 w-12 text-muted-foreground" />
                                    <div class="text-muted-foreground">
                                        <div class="font-medium">暂无数据</div>
                                        <div class="text-sm">请尝试调整搜索条件</div>
                                    </div>
                                </div>
                            </td>
                        </tr>
                    </template>
                </tbody>
            </table>
        </div>

        <!-- 分页 -->
        <div v-if="!loading && items.length > 0"
            class="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
            <span class="text-xs text-muted-foreground">
                显示第 {{ (currentPage - 1) * pageSize + 1 }}–{{ Math.min(currentPage * pageSize, total) }} 条，共 {{ total }} 条
            </span>
            <div class="flex flex-wrap items-center gap-1.5">
                <button type="button" :disabled="currentPage <= 1"
                    class="rounded-md border px-3 py-1.5 text-[13px] font-medium transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
                    @click="handlePageChange(currentPage - 1)">
                    上一页
                </button>
                <template v-for="(page, idx) in visiblePages" :key="idx">
                    <span v-if="page === '...'" class="px-1 text-muted-foreground">…</span>
                    <button v-else type="button"
                        class="min-w-8 rounded-md px-2 py-1.5 text-[13px] transition-colors"
                        :class="page === currentPage
                            ? 'bg-gradient-brand-button font-semibold text-white'
                            : 'border font-medium hover:bg-muted'"
                        @click="handlePageChange(page as number)">
                        {{ page }}
                    </button>
                </template>
                <button type="button" :disabled="currentPage >= totalPages"
                    class="rounded-md border px-3 py-1.5 text-[13px] font-medium transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
                    @click="handlePageChange(currentPage + 1)">
                    下一页
                </button>
            </div>
        </div>
        </TooltipProvider>
    </div>
</template>

<script lang="ts" setup>
import { FileText } from 'lucide-vue-next'
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
}

const props = withDefaults(defineProps<Props>(), {
    loading: false,
    selectedId: null,
})

// ==================== Emits ====================

const emit = defineEmits<{
    rowClick: [item: LegalListItemWithValidity]
    pageChange: [page: number]
}>()

// ==================== 常量 ====================

/** 表头列名 */
const TABLE_HEADERS = ['法律名称', '类型', '发文机关', '生效日期', '生效状态']

// ==================== 计算属性 ====================

/** 可见的页码列表 */
const visiblePages = computed(() => {
    const pages: (number | string)[] = []
    const { currentPage, totalPages } = props

    if (totalPages <= 7) {
        for (let i = 1; i <= totalPages; i++) {
            pages.push(i)
        }
    } else {
        if (currentPage <= 4) {
            for (let i = 1; i <= 5; i++) {
                pages.push(i)
            }
            pages.push('...')
            pages.push(totalPages)
        } else if (currentPage >= totalPages - 3) {
            pages.push(1)
            pages.push('...')
            for (let i = totalPages - 4; i <= totalPages; i++) {
                pages.push(i)
            }
        } else {
            pages.push(1)
            pages.push('...')
            for (let i = currentPage - 1; i <= currentPage + 1; i++) {
                pages.push(i)
            }
            pages.push('...')
            pages.push(totalPages)
        }
    }

    return pages
})

// ==================== 方法 ====================

/** 处理行点击 */
const handleRowClick = (item: LegalListItemWithValidity) => {
    emit('rowClick', item)
}

/** 处理页码变化 */
const handlePageChange = (page: number) => {
    if (page >= 1 && page <= props.totalPages && page !== props.currentPage) {
        emit('pageChange', page)
    }
}
</script>
