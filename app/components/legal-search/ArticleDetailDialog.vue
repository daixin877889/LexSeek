<template>
    <!-- 法条详情弹框 -->
    <Dialog :open="open" @update:open="emit('update:open', $event)">
        <DialogContent class="sm:max-w-[700px] max-h-[85vh] flex flex-col">
            <DialogHeader>
                <DialogTitle class="pr-8">{{ article?.legal_name }}</DialogTitle>
                <DialogDescription v-if="article?.chapter_hierarchy?.length">
                    {{ article.chapter_hierarchy.join(' > ') }}
                </DialogDescription>
            </DialogHeader>

            <!-- 法条内容区域 -->
            <div class="flex-1 overflow-y-auto py-4 pt-0">
                <!-- 元信息 -->
                <div class="flex flex-wrap gap-2 mb-4">
                    <Badge v-if="article?.metadata?.legal_type" :variant="getTypeVariant(article.metadata.legal_type)">
                        {{ getTypeLabel(article.metadata.legal_type) }}
                    </Badge>
                    <Badge v-if="validityStatus" :variant="validityStatus.variant">
                        {{ validityStatus.label }}
                    </Badge>
                </div>

                <!-- 法条正文 -->
                <div class="prose prose-sm dark:prose-invert max-w-none">
                    <div class="text-base leading-relaxed whitespace-pre-wrap">
                        {{ extractArticleContent(article?.content || '') }}
                    </div>
                </div>

                <!-- 相似度分数 -->
                <div v-if="article?.score" class="mt-4 pt-4 border-t">
                    <div class="text-sm text-muted-foreground">
                        相似度: {{ (article.score * 100).toFixed(1) }}%
                    </div>
                </div>

                <!-- 日期信息 -->
                <div v-if="hasDateInfo" class="mt-4 pt-4 border-t">
                    <div class="grid grid-cols-2 gap-4 text-sm">
                        <div v-if="article?.metadata?.publish_date">
                            <span class="text-muted-foreground">发布日期：</span>
                            <span>{{ formatDate(article.metadata.publish_date) }}</span>
                        </div>
                        <div v-if="article?.metadata?.effective_date">
                            <span class="text-muted-foreground">生效日期：</span>
                            <span>{{ formatDate(article.metadata.effective_date) }}</span>
                        </div>
                        <div v-if="article?.metadata?.invalid_date">
                            <span class="text-muted-foreground">失效日期：</span>
                            <span>{{ formatDate(article.metadata.invalid_date) }}</span>
                        </div>
                        <div v-if="article?.metadata?.document_number">
                            <span class="text-muted-foreground">文号：</span>
                            <span>{{ article.metadata.document_number }}</span>
                        </div>
                        <div v-if="article?.metadata?.issuing_authority" class="col-span-2">
                            <span class="text-muted-foreground">发文机关：</span>
                            <span>{{ article.metadata.issuing_authority }}</span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 底部操作区 -->
            <DialogFooter class="border-t pt-4">
                <Button variant="outline" @click="emit('update:open', false)">
                    关闭
                </Button>
                <Button @click="handleViewFullText">
                    <ExternalLink class="h-4 w-4 mr-2" />
                    查看法律全文
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
</template>

<script lang="ts" setup>
import { ExternalLink } from 'lucide-vue-next'
import type { LawSearchResultItem } from '#shared/types/legal'
import dayjs from 'dayjs'

// ==================== Props & Emits ====================

const props = defineProps<{
    open: boolean
    article: LawSearchResultItem | null
}>()

const emit = defineEmits<{
    'update:open': [value: boolean]
}>()

// ==================== 计算属性 ====================

/** 是否有日期信息 */
const hasDateInfo = computed(() => {
    const meta = props.article?.metadata
    return meta?.publish_date || meta?.effective_date || meta?.invalid_date || meta?.document_number || meta?.issuing_authority
})

/** 有效性状态 */
const validityStatus = computed(() => {
    const meta = props.article?.metadata
    if (!meta) return null

    const now = dayjs()
    const effectiveDate = meta.effective_date ? dayjs(meta.effective_date) : null
    const invalidDate = meta.invalid_date ? dayjs(meta.invalid_date) : null

    // 已失效
    if (invalidDate && now.isAfter(invalidDate)) {
        return { label: '已失效', variant: 'destructive' as const }
    }
    // 尚未生效
    if (effectiveDate && now.isBefore(effectiveDate)) {
        return { label: '尚未生效', variant: 'secondary' as const }
    }
    // 现行有效
    return { label: '现行有效', variant: 'default' as const }
})

// ==================== 辅助方法 ====================

/** 获取法律类型标签 */
const getTypeLabel = (type: string): string => {
    const labels: Record<string, string> = {
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

/** 提取法条实际内容（截取 "内容：" 后的部分） */
const extractArticleContent = (content: string): string => {
    const marker = '内容：'
    const index = content.indexOf(marker)
    if (index !== -1) {
        return content.substring(index + marker.length).trim()
    }
    return content
}

/** 格式化日期 */
const formatDate = (date: string | null): string => {
    if (!date) return '-'
    return dayjs(date).format('YYYY-MM-DD')
}

// ==================== 方法 ====================

/** 查看法律全文 */
const handleViewFullText = () => {
    if (props.article?.legal_id) {
        emit('update:open', false)
        navigateTo(`/dashboard/legal/preview/${props.article.legal_id}`)
    }
}
</script>
