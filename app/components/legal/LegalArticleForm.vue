<template>
    <form @submit.prevent="handleSubmit" class="theme-brand flex flex-col h-full">
        <!-- 可滚动的表单内容区域 -->
        <div class="flex-1 overflow-y-auto space-y-4 pr-1">
            <!-- 条文类型 + 排序（sm 以上各占 50%） -->
            <div class="flex flex-col sm:flex-row gap-4">
                <!-- 条文类型 -->
                <div class="w-full sm:w-1/2 space-y-2">
                    <Label for="type">条文类型 <span class="text-destructive">*</span></Label>
                    <Select v-model="form.type">
                        <SelectTrigger :class="['w-full', adminBrandFocusClass]">
                            <SelectValue placeholder="请选择条文类型" />
                        </SelectTrigger>
                        <SelectContent class="theme-brand">
                            <SelectItem value="notice">通知</SelectItem>
                            <SelectItem value="header">正文头部</SelectItem>
                            <SelectItem value="footer">正文尾部</SelectItem>
                            <SelectItem value="annex">附件</SelectItem>
                            <SelectItem value="l1">编</SelectItem>
                            <SelectItem value="l2">分编</SelectItem>
                            <SelectItem value="l3">章</SelectItem>
                            <SelectItem value="l4">节</SelectItem>
                            <SelectItem value="l5">条</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                <!-- 排序 -->
                <div class="w-full sm:w-1/2 space-y-2">
                    <Label for="order">排序序号</Label>
                    <Input id="order" v-model.number="form.order" type="number" placeholder="用于排序的序号" :class="adminBrandFocusClass" />
                </div>
            </div>

            <!-- 层级信息 -->
            <div class="space-y-2">
                <h4 class="text-sm font-medium">层级信息</h4>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div class="space-y-1.5">
                        <Label for="l1" class="text-xs">编</Label>
                        <Input id="l1" v-model="form.l1" placeholder="第一编" :class="['h-9', adminBrandFocusClass]" />
                    </div>
                    <div class="space-y-1.5">
                        <Label for="l2" class="text-xs">分编</Label>
                        <Input id="l2" v-model="form.l2" placeholder="第一分编" :class="['h-9', adminBrandFocusClass]" />
                    </div>
                    <div class="space-y-1.5">
                        <Label for="l3" class="text-xs">章</Label>
                        <Input id="l3" v-model="form.l3" placeholder="第一章" :class="['h-9', adminBrandFocusClass]" />
                    </div>
                    <div class="space-y-1.5">
                        <Label for="l4" class="text-xs">节</Label>
                        <Input id="l4" v-model="form.l4" placeholder="第一节" :class="['h-9', adminBrandFocusClass]" />
                    </div>
                    <div class="space-y-1.5">
                        <Label for="l5" class="text-xs">条</Label>
                        <Input id="l5" v-model="form.l5" placeholder="第一条" :class="['h-9', adminBrandFocusClass]" />
                    </div>
                </div>
            </div>

            <!-- 日期信息 -->
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <!-- 发布日期 -->
                <div class="space-y-2">
                    <Label>发布日期</Label>
                    <GeneralDatePicker v-model="form.publishDate" placeholder="选择发布日期" :class="adminBrandFocusClass" />
                </div>

                <!-- 生效日期 -->
                <div class="space-y-2">
                    <Label>生效日期</Label>
                    <GeneralDatePicker v-model="form.effectiveDate" placeholder="选择生效日期" :class="adminBrandFocusClass" />
                </div>

                <!-- 失效日期 -->
                <div class="space-y-2">
                    <Label>失效日期</Label>
                    <GeneralDatePicker v-model="form.invalidDate" placeholder="选择失效日期" :class="adminBrandFocusClass" />
                </div>
            </div>

            <!-- 条文内容 -->
            <div class="space-y-2">
                <Label>条文内容</Label>
                <GeneralRichTextEditor outputFormat="markdown" v-model="form.content" placeholder="请输入条文内容"
                    content-class="min-h-[150px]" />
            </div>
        </div>

        <!-- 固定底部操作按钮 -->
        <div class="flex items-center justify-end gap-4 pt-4 mt-4 border-t shrink-0">
            <Button type="button" variant="outline" :class="adminBrandFocusClass" @click="$emit('cancel')">
                取消
            </Button>
            <Button type="submit" :class="adminBrandPrimaryButtonClass" :disabled="submitting">
                <Loader2 v-if="submitting" class="h-4 w-4 mr-2 animate-spin" />
                {{ initialData ? '保存修改' : '创建' }}
            </Button>
        </div>
    </form>
</template>

<script setup lang="ts">
import { Loader2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { LegalArticleListItem, CreateLegalArticleRequest, UpdateLegalArticleRequest, ArticleType } from '#shared/types/legal'
import GeneralDatePicker from '~/components/general/DatePicker.vue'
import GeneralRichTextEditor from '~/components/general/RichTextEditor.vue'
import { adminBrandFocusClass, adminBrandPrimaryButtonClass } from '~/utils/adminBrandStyles'

/** Props */
const props = defineProps<{
    legalId: string
    initialData?: LegalArticleListItem | null
}>()

/** Emits */
const emit = defineEmits<{
    submit: [data: CreateLegalArticleRequest | UpdateLegalArticleRequest]
    cancel: []
}>()

/** 表单数据 */
const form = ref({
    type: (props.initialData?.type || 'l5') as ArticleType,
    l1: props.initialData?.l1 || '',
    l2: props.initialData?.l2 || '',
    l3: props.initialData?.l3 || '',
    l4: props.initialData?.l4 || '',
    l5: props.initialData?.l5 || '',
    order: props.initialData?.order || undefined as number | undefined,
    content: props.initialData?.content || '',
    publishDate: props.initialData?.publishDate || '',
    effectiveDate: props.initialData?.effectiveDate || '',
    invalidDate: props.initialData?.invalidDate || '',
})

/** 提交状态 */
const submitting = ref(false)

/** 表单验证 */
const validateForm = (): boolean => {
    if (!form.value.type) {
        toast.error('请选择条文类型')
        return false
    }
    return true
}

/** 提交表单 */
const handleSubmit = async () => {
    if (!validateForm()) return

    submitting.value = true
    try {
        const data: CreateLegalArticleRequest | UpdateLegalArticleRequest = {
            type: form.value.type,
            // 层级字段：有值时发送，无值时发送 null（用于清空）
            l1: form.value.l1?.trim() || null,
            l2: form.value.l2?.trim() || null,
            l3: form.value.l3?.trim() || null,
            l4: form.value.l4?.trim() || null,
            l5: form.value.l5?.trim() || null,
            // 排序和内容
            order: form.value.order ?? null,
            content: form.value.content?.trim() || null,
            // 日期字段：有值时发送，无值时发送 null（用于清空）
            publishDate: form.value.publishDate || null,
            effectiveDate: form.value.effectiveDate || null,
            invalidDate: form.value.invalidDate || null,
        }

        // 如果是创建，添加 legalId
        if (!props.initialData) {
            (data as CreateLegalArticleRequest).legalId = props.legalId
        }

        emit('submit', data)
    } finally {
        submitting.value = false
    }
}

// 监听 initialData 变化，更新表单
watch(() => props.initialData, (newData) => {
    if (newData) {
        form.value = {
            type: newData.type as ArticleType,
            l1: newData.l1 || '',
            l2: newData.l2 || '',
            l3: newData.l3 || '',
            l4: newData.l4 || '',
            l5: newData.l5 || '',
            order: newData.order || undefined,
            content: newData.content || '',
            publishDate: newData.publishDate || '',
            effectiveDate: newData.effectiveDate || '',
            invalidDate: newData.invalidDate || '',
        }
    } else {
        form.value = {
            type: 'l5' as ArticleType,
            l1: '',
            l2: '',
            l3: '',
            l4: '',
            l5: '',
            order: undefined,
            content: '',
            publishDate: '',
            effectiveDate: '',
            invalidDate: '',
        }
    }
}, { immediate: true })
</script>
