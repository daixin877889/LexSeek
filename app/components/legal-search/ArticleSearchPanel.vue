<template>
    <div>
        <!-- 搜索筛选区域 -->
        <div class="bg-card rounded-lg border p-6 mb-6">
            <!-- 搜索框 -->
            <div class="mb-6">
                <label class="block text-sm font-medium text-foreground mb-3">搜索法条内容</label>
                <div class="relative">
                    <Input v-model="searchQuery" type="text" placeholder="输入法条内容或相关描述进行语义搜索..."
                        class="w-full pl-10 h-11" @keyup.enter="handleSearch" :disabled="loading" />
                    <Search class="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                </div>
            </div>

            <!-- 筛选条件 -->
            <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                <!-- 法律类型筛选 -->
                <div>
                    <label class="block text-sm font-medium text-foreground mb-2">法律类型</label>
                    <Select v-model="internalLegalType">
                        <SelectTrigger class="w-full">
                            <SelectValue placeholder="选择类型..." />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">全部类型</SelectItem>
                            <SelectItem value="law">法律</SelectItem>
                            <SelectItem value="regulation">行政法规</SelectItem>
                            <SelectItem value="judicial_interp">司法解释</SelectItem>
                            <SelectItem value="guideline">指导意见</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                <!-- 生效状态筛选 -->
                <div>
                    <label class="block text-sm font-medium text-foreground mb-2">生效状态</label>
                    <Select v-model="internalValidityStatus">
                        <SelectTrigger class="w-full">
                            <SelectValue placeholder="选择状态..." />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">全部状态</SelectItem>
                            <SelectItem value="valid">现行有效</SelectItem>
                            <SelectItem value="pending">尚未生效</SelectItem>
                            <SelectItem value="invalid">已失效</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                <!-- 占位 -->
                <div class="hidden xl:block" />

                <!-- 操作按钮 -->
                <div class="flex items-end gap-3">
                    <Button @click="handleSearch" class="flex-1" :disabled="!searchQuery.trim() || loading">
                        <template v-if="loading">
                            <Loader2 class="h-4 w-4 mr-2 animate-spin" />
                            搜索中
                        </template>
                        <template v-else>
                            <Search class="h-4 w-4 mr-2" />
                            搜索
                        </template>
                    </Button>
                    <Button variant="outline" @click="handleClearResults">
                        重置
                    </Button>
                </div>
            </div>
        </div>

        <!-- 搜索结果区域 -->
        <template v-if="hasSearched">
            <!-- 加载状态 -->
            <div v-if="loading" class="flex justify-center py-12">
                <Loader2 class="h-10 w-10 animate-spin text-muted-foreground" />
            </div>

            <!-- 错误状态 -->
            <div v-else-if="error" class="bg-card rounded-lg border p-12 text-center">
                <AlertCircle class="h-12 w-12 mx-auto mb-4 text-destructive" />
                <h3 class="text-lg font-medium mb-2">搜索失败</h3>
                <p class="text-muted-foreground text-sm mb-4">{{ error }}</p>
                <Button variant="outline" @click="handleRetry">
                    <RefreshCw class="h-4 w-4 mr-2" />
                    重试
                </Button>
            </div>

            <!-- 空状态 -->
            <div v-else-if="results.length === 0" class="bg-card rounded-lg border p-12 text-center">
                <FileSearch class="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <h3 class="text-lg font-medium mb-2">未找到相关法条</h3>
                <p class="text-muted-foreground text-sm mb-4">请尝试使用不同的关键词搜索</p>
                <Button variant="outline" @click="handleClearResults">
                    重置搜索
                </Button>
            </div>

            <!-- 搜索结果列表 -->
            <div v-else class="bg-card rounded-lg border">
                <!-- 结果统计 -->
                <div class="px-6 py-4 border-b">
                    <div class="text-sm text-muted-foreground">
                        找到 <span class="font-medium text-foreground">{{ total }}</span> 条相关法条
                    </div>
                </div>

                <!-- 结果列表 -->
                <div class="divide-y">
                    <div v-for="result in results" :key="result.articles_id"
                        class="p-6 hover:bg-muted/50 transition-colors cursor-pointer"
                        @click="handleResultClick(result)">
                        <!-- 法律信息 -->
                        <div class="flex items-start justify-between mb-3">
                            <div class="flex-1 min-w-0">
                                <h4 class="font-medium truncate">{{ result.legal_name }}</h4>
                                <div v-if="result.chapter_hierarchy?.length" class="text-sm text-muted-foreground mt-1">
                                    {{ result.chapter_hierarchy.join(' > ') }}
                                </div>
                            </div>
                            <Badge v-if="result.metadata?.legal_type"
                                :variant="getTypeVariant(result.metadata.legal_type as LegalType)"
                                class="ml-3 shrink-0">
                                {{ getTypeLabel(result.metadata.legal_type as LegalType) }}
                            </Badge>
                        </div>

                        <!-- 法条内容 -->
                        <div class="text-sm leading-relaxed text-muted-foreground line-clamp-3"
                            v-html="highlightContent(result.content)" />

                        <!-- 相似度分数 -->
                        <div v-if="showScore && result.score" class="mt-3">
                            <div class="text-xs text-muted-foreground">
                                相似度: {{ (result.score * 100).toFixed(1) }}%
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 底部提示 -->
                <div class="px-6 py-4 border-t bg-muted/30">
                    <div class="text-xs text-muted-foreground text-center">
                        点击法条可查看完整法律条文
                    </div>
                </div>
            </div>
        </template>
    </div>
</template>

<script lang="ts" setup>
import {
    Search,
    Loader2,
    RefreshCw,
    FileSearch,
    AlertCircle
} from 'lucide-vue-next'
import type { LawSearchResultItem } from '#shared/types/legal'
import type { ArticleSearchFilters, ValidityStatus } from '#shared/types/legal-search'
import { LegalType } from '#shared/types/legal'

// ==================== Props ====================

interface Props {
    /** 搜索结果 */
    results?: LawSearchResultItem[]
    /** 加载状态 */
    loading?: boolean
    /** 错误信息 */
    error?: string | null
    /** 结果总数 */
    total?: number
    /** 是否显示相似度分数 */
    showScore?: boolean
}

const props = withDefaults(defineProps<Props>(), {
    results: () => [],
    loading: false,
    error: null,
    total: 0,
    showScore: false,
})

// ==================== Emits ====================

const emit = defineEmits<{
    search: [query: string, filters: ArticleSearchFilters]
    resultClick: [result: LawSearchResultItem]
    clearResults: []
    retry: []
}>()

// ==================== 响应式状态 ====================

/** 搜索查询 */
const searchQuery = ref('')

/** 法律类型筛选 */
const legalType = ref<LegalType | null>(null)

/** 生效状态筛选 */
const validityStatus = ref<ValidityStatus>('valid')

/** 是否已搜索过 */
const hasSearched = ref(false)

// ==================== 内部状态（处理 Select 组件） ====================

/** 法律类型内部状态 */
const internalLegalType = computed({
    get: () => legalType.value || 'all',
    set: (val: string) => {
        legalType.value = val === 'all' ? null : val as LegalType
    },
})

/** 生效状态内部状态 */
const internalValidityStatus = computed({
    get: () => validityStatus.value,
    set: (val: string) => {
        validityStatus.value = val as ValidityStatus
    },
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
const getTypeVariant = (type: string): "default" | "secondary" | "outline" | "destructive" => {
    const variants: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
        law: 'default',
        regulation: 'secondary',
        judicial_interp: 'outline',
        guideline: 'destructive',
    }
    return variants[type] || 'default'
}

/** 高亮搜索内容 */
const highlightContent = (content: string): string => {
    if (!searchQuery.value.trim()) return content

    const keywords = searchQuery.value.trim().split(/\s+/)
    let highlightedContent = content

    keywords.forEach(keyword => {
        if (keyword.length > 0) {
            const regex = new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
            highlightedContent = highlightedContent.replace(
                regex,
                '<mark class="bg-yellow-200 dark:bg-yellow-800 px-1 rounded">$1</mark>'
            )
        }
    })

    return highlightedContent
}

/** 处理搜索 */
const handleSearch = () => {
    const query = searchQuery.value.trim()
    if (!query) return

    const filters: ArticleSearchFilters = {
        legalType: legalType.value,
        validityStatus: validityStatus.value,
    }

    hasSearched.value = true
    emit('search', query, filters)
}

/** 处理结果点击 */
const handleResultClick = (result: LawSearchResultItem) => {
    emit('resultClick', result)
}

/** 处理清空结果 */
const handleClearResults = () => {
    searchQuery.value = ''
    legalType.value = null
    validityStatus.value = 'valid'
    hasSearched.value = false
    emit('clearResults')
}

/** 处理重试 */
const handleRetry = () => {
    if (searchQuery.value.trim()) {
        handleSearch()
    }
}

// ==================== 暴露方法 ====================

defineExpose({
    /** 设置搜索查询 */
    setQuery: (query: string) => {
        searchQuery.value = query
        if (query.trim()) {
            handleSearch()
        }
    },
    /** 设置筛选条件并执行搜索 */
    setFiltersAndSearch: (query: string, filters: ArticleSearchFilters) => {
        searchQuery.value = query
        legalType.value = filters.legalType
        validityStatus.value = filters.validityStatus
        if (query.trim()) {
            hasSearched.value = true
            emit('search', query, filters)
        }
    },
    /** 清空搜索 */
    clear: () => {
        handleClearResults()
    },
})
</script>
