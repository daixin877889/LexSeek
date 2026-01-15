<template>
    <div class="bg-card rounded-lg border">
        <form @submit.prevent="handleSubmit">
            <!-- 可滚动内容区域 -->
            <div class="p-6 space-y-6">
                <!-- 基本信息 -->
                <div class="space-y-4">
                    <h3 class="text-lg font-medium">基本信息</h3>

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <!-- 法律名称 -->
                        <div class="space-y-2">
                            <Label for="name">法律名称 <span class="text-destructive">*</span></Label>
                            <Input id="name" v-model="form.name" placeholder="请输入法律名称" />
                        </div>

                        <!-- 法律代码 -->
                        <div class="space-y-2">
                            <Label for="code">法律代码 <span class="text-destructive">*</span></Label>
                            <Input id="code" v-model="form.code" placeholder="请输入唯一标识代码" />
                        </div>
                    </div>

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <!-- 法律类型 -->
                        <div class="space-y-2">
                            <Label for="type">法律类型 <span class="text-destructive">*</span></Label>
                            <Select v-model="form.type">
                                <SelectTrigger class="w-full">
                                    <SelectValue placeholder="请选择法律类型" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="law">法律</SelectItem>
                                    <SelectItem value="regulation">行政法规</SelectItem>
                                    <SelectItem value="judicial_interp">司法解释</SelectItem>
                                    <SelectItem value="guideline">指导意见</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <!-- 分类 -->
                        <div class="space-y-2">
                            <Label for="category">分类</Label>
                            <Input id="category" v-model="form.category" placeholder="请输入分类（可选）" />
                        </div>
                    </div>
                </div>

                <!-- 发文信息 -->
                <div class="space-y-4">
                    <h3 class="text-lg font-medium">发文信息</h3>

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <!-- 发文机关 -->
                        <div class="space-y-2">
                            <Label for="issuingAuthority">发文机关</Label>
                            <Input id="issuingAuthority" v-model="form.issuingAuthority" placeholder="请输入发文机关" />
                        </div>

                        <!-- 文号 -->
                        <div class="space-y-2">
                            <Label for="documentNumber">文号</Label>
                            <Input id="documentNumber" v-model="form.documentNumber" placeholder="请输入文号" />
                        </div>
                    </div>
                </div>

                <!-- 日期信息 -->
                <div class="space-y-4">
                    <h3 class="text-lg font-medium">日期信息</h3>

                    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <!-- 发布日期 -->
                        <div class="space-y-2">
                            <Label>发布日期</Label>
                            <GeneralDatePicker v-model="form.publishDate" placeholder="选择发布日期" />
                        </div>

                        <!-- 生效日期 -->
                        <div class="space-y-2">
                            <Label>生效日期</Label>
                            <GeneralDatePicker v-model="form.effectiveDate" placeholder="选择生效日期" />
                        </div>

                        <!-- 失效日期 -->
                        <div class="space-y-2">
                            <Label>失效日期</Label>
                            <GeneralDatePicker v-model="form.invalidDate" placeholder="选择失效日期" />
                        </div>
                    </div>
                </div>

                <!-- 法律内容 -->
                <div class="space-y-4">
                    <div class="flex items-center justify-between">
                        <h3 class="text-lg font-medium">法律内容 <span class="text-destructive">*</span></h3>
                        <Button v-if="initialData" type="button" variant="outline" size="sm" @click="handleFullUpdate">
                            <FileEdit class="h-4 w-4 mr-2" />
                            全量更新
                        </Button>
                    </div>

                    <!-- 内容预览（编辑模式） - 不滚动 -->
                    <div v-if="initialData" class="border rounded-lg p-6 bg-muted/30">
                        <ClientOnly>
                            <MarkstreamVue v-if="form.content" :content="form.content" :is-dark="isDark" />
                            <p v-else class="text-muted-foreground">暂无内容</p>
                            <template #fallback>
                                <div class="flex items-center justify-center py-8">
                                    <Loader2 class="h-6 w-6 animate-spin text-muted-foreground" />
                                </div>
                            </template>
                        </ClientOnly>
                    </div>

                    <!-- 内容编辑器（创建模式） -->
                    <GeneralRichTextEditor v-else outputFormat="markdown" v-model="form.content" placeholder="请输入法律全文内容"
                        content-class="min-h-[300px]" />
                </div>
            </div>

            <!-- 固定在底部的操作按钮 -->
            <div
                class="sticky bottom-0 flex items-center justify-end gap-3 px-6 py-2 border-t bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
                <Button type="button" variant="outline" size="sm" @click="$emit('cancel')">
                    取消
                </Button>
                <Button type="submit" size="sm" :disabled="submitting">
                    <Loader2 v-if="submitting" class="h-4 w-4 mr-2 animate-spin" />
                    {{ initialData ? '保存修改' : '创建' }}
                </Button>
            </div>
        </form>
    </div>
</template>

<script setup lang="ts">
import { Loader2, FileEdit } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import MarkstreamVue, { enableMermaid, setDefaultI18nMap } from 'markstream-vue'
import 'markstream-vue/index.css'
import type { LegalMainInfo, CreateLegalMainRequest, UpdateLegalMainRequest, LegalType } from '#shared/types/legal'

// 启用 Mermaid 渲染（传入 mermaid 模块的动态导入函数）
enableMermaid(() => import('mermaid'))

// 配置中文国际化
setDefaultI18nMap({
    'common.copy': '复制',
    'common.copied': '已复制',
    'common.expand': '展开',
    'common.collapse': '收起',
    'common.preview': '预览',
    'common.source': '源码',
})

// 获取当前主题是否为暗色模式
const { isDark } = useColorMode()

/** Props */
const props = defineProps<{
    initialData?: LegalMainInfo
}>()

/** Emits */
const emit = defineEmits<{
    submit: [data: CreateLegalMainRequest | UpdateLegalMainRequest]
    cancel: []
    fullUpdate: []
}>()

/** 表单数据 */
const form = ref({
    name: props.initialData?.name || '',
    code: props.initialData?.code || '',
    type: (props.initialData?.type || 'law') as LegalType,
    category: props.initialData?.category || '',
    issuingAuthority: props.initialData?.issuingAuthority || '',
    documentNumber: props.initialData?.documentNumber || '',
    publishDate: props.initialData?.publishDate || '',
    effectiveDate: props.initialData?.effectiveDate || '',
    invalidDate: props.initialData?.invalidDate || '',
    content: props.initialData?.content || '',
})

/** 提交状态 */
const submitting = ref(false)

/** 处理全量更新 */
const handleFullUpdate = () => {
    emit('fullUpdate')
}

/** 表单验证 */
const validateForm = (): boolean => {
    if (!form.value.name.trim()) {
        toast.error('请输入法律名称')
        return false
    }
    if (!form.value.code.trim()) {
        toast.error('请输入法律代码')
        return false
    }
    if (!form.value.type) {
        toast.error('请选择法律类型')
        return false
    }
    if (!form.value.content.trim()) {
        toast.error('请输入法律内容')
        return false
    }
    return true
}

/** 提交表单 */
const handleSubmit = async () => {
    if (!validateForm()) return

    submitting.value = true
    try {
        const data: CreateLegalMainRequest | UpdateLegalMainRequest = {
            name: form.value.name.trim(),
            code: form.value.code.trim(),
            type: form.value.type,
            content: form.value.content.trim(),
            // 可选文本字段：有值时发送，无值时不发送（用于清空时发送 null）
            ...(form.value.category?.trim() && { category: form.value.category.trim() }),
            ...(form.value.issuingAuthority?.trim() && { issuingAuthority: form.value.issuingAuthority.trim() }),
            ...(form.value.documentNumber?.trim() && { documentNumber: form.value.documentNumber.trim() }),
        } as CreateLegalMainRequest | UpdateLegalMainRequest

        // 日期字段：编辑模式下始终发送（有值发送值，无值发送 null 以清除）
        // 创建模式下只在有值时发送
        if (props.initialData) {
            // 编辑模式：始终发送日期字段，允许清空
            ; (data as UpdateLegalMainRequest).publishDate = form.value.publishDate || null
                ; (data as UpdateLegalMainRequest).effectiveDate = form.value.effectiveDate || null
                ; (data as UpdateLegalMainRequest).invalidDate = form.value.invalidDate || null
        } else {
            // 创建模式：只在有值时发送
            if (form.value.publishDate) {
                (data as CreateLegalMainRequest).publishDate = form.value.publishDate
            }
            if (form.value.effectiveDate) {
                (data as CreateLegalMainRequest).effectiveDate = form.value.effectiveDate
            }
            if (form.value.invalidDate) {
                (data as CreateLegalMainRequest).invalidDate = form.value.invalidDate
            }
        }

        emit('submit', data)
    } finally {
        submitting.value = false
    }
}
</script>
