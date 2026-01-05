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
                                <GeneralLegalTypeBadge :type="legalData.type" />
                                <GeneralLegalStatusBadge :effective-date="legalData.effectiveDate"
                                    :invalid-date="legalData.invalidDate" />
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
                <GeneralLegalStatisticsCard :statistics="statistics" :show-type-distribution="true" />

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
    Layers,
    Database,
    RefreshCw,
    Zap,
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import dayjs from 'dayjs'
import type { LegalMainInfo, LegalStatistics } from '#shared/types/legal'

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

/** 加载法律法规详情 */
const loadLegalData = async () => {
    loading.value = true
    try {
        const data = await useApiFetch<LegalMainInfo>(`/api/v1/admin/legal-main/${legalId}`)
        if (data) {
            legalData.value = data
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
