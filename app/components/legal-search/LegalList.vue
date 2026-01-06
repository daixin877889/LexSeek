<template>
    <div class="bg-card rounded-lg border">
        <!-- 表格头部 -->
        <div class="p-4 border-b">
            <div class="flex items-center justify-between">
                <h3 class="text-lg font-semibold">法律法规列表</h3>
                <div class="text-sm text-muted-foreground">
                    共 {{ total }} 条记录
                </div>
            </div>
        </div>

        <!-- 表格内容 -->
        <div class="overflow-x-auto">
            <table class="w-full">
                <thead class="bg-muted/50">
                    <tr>
                        <th class="px-4 py-3 text-left text-sm font-medium text-muted-foreground">法律名称</th>
                        <th class="px-4 py-3 text-left text-sm font-medium text-muted-foreground">类型</th>
                        <th class="px-4 py-3 text-left text-sm font-medium text-muted-foreground">发文机关</th>
                        <th class="px-4 py-3 text-left text-sm font-medium text-muted-foreground">生效日期</th>
                        <th class="px-4 py-3 text-left text-sm font-medium text-muted-foreground">生效状态</th>
                    </tr>
                </thead>
                <tbody>
                    <!-- 加载状态 -->
                    <template v-if="loading">
                        <tr v-for="i in pageSize" :key="`skeleton-${i}`">
                            <td class="px-4 py-3">
                                <Skeleton class="h-4 w-48" />
                            </td>
                            <td class="px-4 py-3">
                                <Skeleton class="h-4 w-16" />
                            </td>
                            <td class="px-4 py-3">
                                <Skeleton class="h-4 w-24" />
                            </td>
                            <td class="px-4 py-3">
                                <Skeleton class="h-4 w-20" />
                            </td>
                            <td class="px-4 py-3">
                                <Skeleton class="h-4 w-12" />
                            </td>
                        </tr>
                    </template>

                    <!-- 数据行 -->
                    <template v-else-if="items.length > 0">
                        <tr v-for="item in items" :key="item.id"
                            class="border-b hover:bg-muted/50 transition-colors cursor-pointer"
                            :class="{ 'bg-muted/30': selectedId === item.id }" @click="handleRowClick(item)">
                            <td class="px-4 py-3">
                                <div class="font-medium">{{ item.name }}</div>
                                <div v-if="item.documentNumber" class="text-sm text-muted-foreground">
                                    {{ item.documentNumber }}
                                </div>
                            </td>
                            <td class="px-4 py-3">
                                <Badge :variant="getTypeVariant(item.type)">
                                    {{ getTypeLabel(item.type) }}
                                </Badge>
                            </td>
                            <td class="px-4 py-3">
                                <div v-if="item.issuingAuthority" class="flex flex-wrap gap-1">
                                    <span v-for="(authority, index) in parseIssuingAuthorities(item.issuingAuthority)"
                                        :key="index"
                                        class="inline-flex items-center px-2 py-0.5 rounded text-xs bg-muted text-muted-foreground">
                                        {{ authority }}
                                    </span>
                                </div>
                                <span v-else class="text-sm text-muted-foreground">-</span>
                            </td>
                            <td class="px-4 py-3 text-sm">
                                {{ formatDate(item.effectiveDate) }}
                            </td>
                            <td class="px-4 py-3">
                                <Badge :variant="getValidityVariant(item)">
                                    {{ getValidityLabel(item) }}
                                </Badge>
                            </td>
                        </tr>
                    </template>

                    <!-- 空状态 -->
                    <template v-else>
                        <tr>
                            <td colspan="5" class="px-4 py-12 text-center">
                                <div class="flex flex-col items-center justify-center space-y-3">
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
        <div v-if="!loading && items.length > 0" class="p-4 border-t">
            <div class="flex items-center justify-between">
                <div class="text-sm text-muted-foreground">
                    显示第 {{ (currentPage - 1) * pageSize + 1 }} - {{ Math.min(currentPage * pageSize, total) }} 条，共 {{
                        total }} 条
                </div>
                <div class="flex items-center space-x-2">
                    <Button variant="outline" size="sm" :disabled="currentPage <= 1"
                        @click="handlePageChange(currentPage - 1)">
                        <ChevronLeft class="h-4 w-4" />
                        上一页
                    </Button>

                    <!-- 页码按钮 -->
                    <div class="flex items-center space-x-1">
                        <template v-for="page in visiblePages" :key="page">
                            <Button v-if="page !== '...'" size="sm"
                                :variant="page === currentPage ? 'default' : 'outline'"
                                @click="handlePageChange(page as number)">
                                {{ page }}
                            </Button>
                            <span v-else class="px-2 text-muted-foreground">...</span>
                        </template>
                    </div>

                    <Button variant="outline" size="sm" :disabled="currentPage >= totalPages"
                        @click="handlePageChange(currentPage + 1)">
                        下一页
                        <ChevronRight class="h-4 w-4" />
                    </Button>
                </div>
            </div>
        </div>
    </div>
</template>

<script lang="ts" setup>
import { FileText, ChevronLeft, ChevronRight } from 'lucide-vue-next'
import type { LegalListItemWithValidity } from '~/composables/useLegalSearch'
import { LegalType } from '#shared/types/legal'
import dayjs from 'dayjs'

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

// ==================== 计算属性 ====================

/** 可见的页码列表 */
const visiblePages = computed(() => {
    const pages: (number | string)[] = []
    const { currentPage, totalPages } = props

    if (totalPages <= 7) {
        // 总页数少于等于7页，显示所有页码
        for (let i = 1; i <= totalPages; i++) {
            pages.push(i)
        }
    } else {
        // 总页数大于7页，显示省略号
        if (currentPage <= 4) {
            // 当前页在前面
            for (let i = 1; i <= 5; i++) {
                pages.push(i)
            }
            pages.push('...')
            pages.push(totalPages)
        } else if (currentPage >= totalPages - 3) {
            // 当前页在后面
            pages.push(1)
            pages.push('...')
            for (let i = totalPages - 4; i <= totalPages; i++) {
                pages.push(i)
            }
        } else {
            // 当前页在中间
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