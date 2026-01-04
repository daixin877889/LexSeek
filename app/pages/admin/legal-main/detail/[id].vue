<template>
    <NuxtLayout name="admin-layout">
        <div class="space-y-6">
            <!-- 页面头部 -->
            <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div class="flex items-center gap-4">
                    <Button variant="ghost" size="icon" @click="navigateTo('/admin/legal-main')">
                        <ArrowLeft class="h-4 w-4" />
                    </Button>
                    <div>
                        <h1 class="text-2xl md:text-3xl font-bold mb-1">{{ legalData?.name || '法律法规详情' }}</h1>
                        <p class="text-muted-foreground text-sm">查看法律法规的完整信息和统计数据</p>
                    </div>
                </div>
                <div class="flex gap-2 w-full md:w-auto flex-wrap">
                    <Button variant="outline" @click="navigateToEdit" class="flex-1 md:flex-none">
                        <Pencil class="h-4 w-4 mr-2" />
                        编辑
                    </Button>
                    <Button variant="outline" @click="handleBatchEmbed" class="flex-1 md:flex-none"
                        :disabled="batchEmbedding">
                        <Loader2 v-if="batchEmbedding" class="h-4 w-4 mr-2 animate-spin" />
                        <Zap v-else class="h-4 w-4 mr-2" />
                        批量向量化
                    </Button>
                </div>
            </div>

            <!-- 加载状态 -->
            <div v-if="loading" class="flex justify-center py-12">
                <Loader2 class="h-10 w-10 animate-spin text-muted-foreground" />
            </div>

            <!-- 错误状态 -->
            <div v-else-if="!legalData" class="flex flex-col items-center justify-center py-12 text-center">
                <AlertCircle class="h-12 w-12 text-destructive mb-4" />
                <h3 class="text-lg font-medium mb-1">未找到该法律法规</h3>
                <p class="text-muted-foreground text-sm mb-4">该法律法规可能已被删除或不存在</p>
                <Button @click="navigateTo('/admin/legal-main')">
                    返回列表
                </Button>
            </div>

            <!-- 内容区域 -->
            <template v-else>
                <!-- 基本信息卡片 -->
                <div class="bg-card rounded-lg border p-6">
                    <div class="flex items-center gap-2 mb-4">
                        <FileText class="h-5 w-5 text-primary" />
                        <h2 class="text-lg font-semibold">基本信息</h2>
                    </div>
                    <div class="space-y-4">
                        <!-- 法律名称和状态 -->
                        <div class="flex flex-col md:flex-row md:items-center gap-2">
                            <div class="flex-1">
                                <p class="text-sm text-muted-foreground mb-1">法律名称</p>
                                <p class="text-lg font-medium">{{ legalData.name }}</p>
                            </div>
                            <div class="flex items-center gap-2">
                                <span :class="getTypeClass(legalData.type)">
                                    {{ getTypeName(legalData.type) }}
                                </span>
                                <span :class="getStatusClass(legalData)">
                                    {{ getStatusText(legalData) }}
                                </span>
                            </div>
                        </div>

                        <!-- 法律代码 -->
                        <div>
                            <p class="text-sm text-muted-foreground mb-1">法律代码</p>
                            <p class="font-mono text-sm">{{ legalData.code }}</p>
                        </div>

                        <!-- 详细信息网格 -->
                        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t">
                            <div v-if="legalData.issuingAuthority">
                                <p class="text-sm text-muted-foreground mb-1">发文机关</p>
                                <p class="font-medium">{{ legalData.issuingAuthority }}</p>
                            </div>
                            <div v-if="legalData.documentNumber">
                                <p class="text-sm text-muted-foreground mb-1">文号</p>
                                <p class="font-medium">{{ legalData.documentNumber }}</p>
                            </div>
                            <div v-if="legalData.category">
                                <p class="text-sm text-muted-foreground mb-1">分类</p>
                                <p class="font-medium">{{ legalData.category }}</p>
                            </div>
                            <div v-if="legalData.publishDate">
                                <p class="text-sm text-muted-foreground mb-1">发布日期</p>
                                <p class="font-medium">{{ legalData.publishDate }}</p>
                            </div>
                            <div v-if="legalData.effectiveDate">
                                <p class="text-sm text-muted-foreground mb-1">生效日期</p>
                                <p class="font-medium">{{ legalData.effectiveDate }}</p>
                            </div>
                            <div v-if="legalData.invalidDate">
                                <p class="text-sm text-muted-foreground mb-1">失效日期</p>
                                <p class="font-medium">{{ legalData.invalidDate }}</p>
                            </div>
                        </div>

                        <!-- 时间信息 -->
                        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t">
                            <div>
                                <p class="text-sm text-muted-foreground mb-1">创建时间</p>
                                <p class="text-sm">{{ formatDateTime(legalData.createdAt) }}</p>
                            </div>
                            <div>
                                <p class="text-sm text-muted-foreground mb-1">最后编辑</p>
                                <p class="text-sm">{{ formatDateTime(legalData.lastEditedAt) }}</p>
                            </div>
                            <div>
                                <p class="text-sm text-muted-foreground mb-1">最后向量化</p>
                                <p class="text-sm">{{ formatDateTime(legalData.lastEmbeddingAt) }}</p>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 统计信息卡片 -->
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
                        <div class="pt-4 border-t">
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

                <!-- 功能入口卡片 -->
                <div class="bg-card rounded-lg border p-6">
                    <div class="flex items-center gap-2 mb-4">
                        <Layers class="h-5 w-5 text-primary" />
                        <h2 class="text-lg font-semibold">功能入口</h2>
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        <!-- 查看条文 -->
                        <Button variant="outline" class="h-auto py-4 flex-col items-start gap-2"
                            @click="navigateTo(`/admin/legal-main/articles/${legalId}`)">
                            <div class="flex items-center gap-2 w-full">
                                <FileText class="h-5 w-5" />
                                <span class="font-semibold">查看条文</span>
                            </div>
                            <p class="text-xs text-muted-foreground text-left">
                                查看和管理法律条文内容
                            </p>
                        </Button>

                        <!-- 编辑法律法规 -->
                        <Button variant="outline" class="h-auto py-4 flex-col items-start gap-2"
                            @click="navigateToEdit">
                            <div class="flex items-center gap-2 w-full">
                                <Pencil class="h-5 w-5" />
                                <span class="font-semibold">编辑法律法规</span>
                            </div>
                            <p class="text-xs text-muted-foreground text-left">
                                修改法律法规基本信息
                            </p>
                        </Button>

                        <!-- 全量更新 -->
                        <Button variant="outline" class="h-auto py-4 flex-col items-start gap-2"
                            @click="navigateTo(`/admin/legal-main/full-update/${legalId}`)">
                            <div class="flex items-center gap-2 w-full">
                                <RefreshCw class="h-5 w-5" />
                                <span class="font-semibold">全量更新</span>
                            </div>
                            <p class="text-xs text-muted-foreground text-left">
                                重新解析和更新所有条文
                            </p>
                        </Button>

                        <!-- 嵌入记录 -->
                        <Button variant="outline" class="h-auto py-4 flex-col items-start gap-2"
                            @click="navigateTo(`/admin/legal-main/embeddings/${legalId}`)">
                            <div class="flex items-center gap-2 w-full">
                                <Database class="h-5 w-5" />
                                <span class="font-semibold">嵌入记录</span>
                            </div>
                            <p class="text-xs text-muted-foreground text-left">
                                查看向量嵌入记录
                            </p>
                        </Button>
                    </div>
                </div>
            </template>
        </div>
    </NuxtLayout>
</template>

<script setup lang="ts">
import {
    ArrowLeft,
    Pencil,
    Loader2,
    AlertCircle,
    FileText,
    BarChart3,
    Layers,
    Database,
    RefreshCw,
    Zap,
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import dayjs from 'dayjs'
import type { LegalMainInfo, LegalStatistics, LegalType } from '#shared/types/legal'

definePageMeta({
    layout: false,
    title: "法律法规详情",
})

const route = useRoute()
const legalId = route.params.id as string

/** 动态面包屑标题（与面包屑组件共享） */
const dynamicBreadcrumbTitle = useState<string | null>('breadcrumb-dynamic-title', () => null)

/** 加载状态 */
const loading = ref(true)

/** 法律法规数据 */
const legalData = ref<LegalMainInfo | null>(null)

/** 统计信息 */
const statistics = ref<LegalStatistics | null>(null)

/** 批量向量化进行中 */
const batchEmbedding = ref(false)

/** 格式化日期时间 */
const formatDateTime = (date: string | null | undefined): string => {
    if (!date) return '-'
    return dayjs(date).format('YYYY-MM-DD HH:mm')
}

/** 获取类型名称 */
const getTypeName = (type: LegalType): string => {
    const typeMap: Record<string, string> = {
        law: '法律',
        regulation: '行政法规',
        judicial_interp: '司法解释',
        guideline: '指导意见',
    }
    return typeMap[type] || type
}

/** 获取类型样式类 */
const getTypeClass = (type: LegalType): string => {
    const baseClass = 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium'
    const typeClasses: Record<string, string> = {
        law: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
        regulation: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
        judicial_interp: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
        guideline: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
    }
    return `${baseClass} ${typeClasses[type] || typeClasses.guideline}`
}

/** 获取状态文本 */
const getStatusText = (legal: LegalMainInfo): string => {
    if (legal.invalidDate) {
        const invalidDate = dayjs(legal.invalidDate)
        if (invalidDate.isBefore(dayjs())) {
            return '已失效'
        }
    }
    if (legal.effectiveDate) {
        const effectiveDate = dayjs(legal.effectiveDate)
        if (effectiveDate.isAfter(dayjs())) {
            return '未生效'
        }
    }
    return '有效'
}

/** 获取状态样式类 */
const getStatusClass = (legal: LegalMainInfo): string => {
    const baseClass = 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap'
    const status = getStatusText(legal)
    if (status === '有效') {
        return `${baseClass} bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400`
    }
    if (status === '已失效') {
        return `${baseClass} bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400`
    }
    return `${baseClass} bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400`
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

/** 计算百分比 */
const getPercentage = (value: number, total: number): string => {
    if (total === 0) return '0%'
    return `${Math.round((value / total) * 100)}%`
}

/** 加载法律法规详情 */
const loadLegalData = async () => {
    loading.value = true
    try {
        const data = await useApiFetch<LegalMainInfo>(`/api/v1/admin/legal-main/${legalId}`)
        if (data) {
            legalData.value = data
            // 设置动态面包屑标题
            dynamicBreadcrumbTitle.value = data.name
        }
    } finally {
        loading.value = false
    }
}

/** 加载统计信息 */
const loadStatistics = async () => {
    const data = await useApiFetch<LegalStatistics>(`/api/v1/admin/legal-main/${legalId}/statistics`)
    if (data) {
        statistics.value = data
    }
}

/** 导航到编辑页面 */
const navigateToEdit = () => {
    navigateTo(`/admin/legal-main/edit/${legalId}`)
}

/** 批量向量化 */
const handleBatchEmbed = async () => {
    batchEmbedding.value = true
    try {
        const response = await $fetch<{
            success: boolean
            message: string
            data: { total: number; processed: number; skipped: number; upToDate: number; failed: number }
        }>('/api/v1/admin/legal-articles/batch-embed', {
            method: 'POST',
            body: {
                legalId,
                forceAll: false,
            },
        })

        if (response.success) {
            const { processed, failed } = response.data || {}
            if (failed > 0) {
                toast.warning(response.message)
            } else if (processed === 0) {
                toast.info(response.message)
            } else {
                toast.success(response.message)
            }
            // 刷新统计信息
            loadStatistics()
        } else {
            toast.error(response.message || '批量嵌入失败')
        }
    } catch (error: any) {
        const message = error?.data?.message || error?.message || '批量嵌入失败'
        toast.error(message)
    } finally {
        batchEmbedding.value = false
    }
}

// 初始加载
onMounted(() => {
    loadLegalData()
    loadStatistics()
})

// 页面离开时清除动态标题
onUnmounted(() => {
    dynamicBreadcrumbTitle.value = null
})
</script>
