<template>
    <!-- 产品创建/编辑对话框 -->
    <Dialog v-model:open="open">
        <DialogContent class="theme-brand max-h-[85vh] max-w-lg flex flex-col">
            <DialogHeader class="shrink-0">
                <DialogTitle>{{ isEdit ? '编辑产品' : '新增产品' }}</DialogTitle>
                <DialogDescription>{{ isEdit ? '修改产品信息' : '创建新的产品' }}</DialogDescription>
            </DialogHeader>
            <div class="flex-1 overflow-y-auto space-y-4 py-4 px-1">
                <div class="space-y-2">
                    <Label>产品名称 <span class="text-destructive">*</span></Label>
                    <Input v-model="form.name" placeholder="输入产品名称" :class="adminBrandFocusClass" />
                </div>
                <div class="space-y-2">
                    <Label>产品描述</Label>
                    <Input v-model="form.description" placeholder="输入产品描述" :class="adminBrandFocusClass" />
                </div>
                <div v-if="!isEdit" class="space-y-2">
                    <Label>产品类型 <span class="text-destructive">*</span></Label>
                    <Select v-model="form.type">
                        <SelectTrigger :class="['w-full', adminBrandFocusClass]">
                            <SelectValue placeholder="选择产品类型" />
                        </SelectTrigger>
                        <SelectContent class="theme-brand">
                            <SelectItem value="1">会员商品</SelectItem>
                            <SelectItem value="2">积分商品</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <!-- 会员商品字段 -->
                <template v-if="form.type === '1'">
                    <div class="space-y-2">
                        <Label>会员级别 <span class="text-destructive">*</span></Label>
                        <Select v-model="form.levelId">
                            <SelectTrigger :class="['w-full', adminBrandFocusClass]">
                                <SelectValue placeholder="选择会员级别" />
                            </SelectTrigger>
                            <SelectContent class="theme-brand">
                                <SelectItem v-for="level in membershipLevels" :key="level.id" :value="String(level.id)">
                                    {{ level.name }}
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div class="space-y-2">
                        <Label>默认售卖周期 <span class="text-destructive">*</span></Label>
                        <Select v-model="form.defaultDuration">
                            <SelectTrigger :class="['w-full', adminBrandFocusClass]">
                                <SelectValue placeholder="选择售卖周期" />
                            </SelectTrigger>
                            <SelectContent class="theme-brand">
                                <SelectItem value="1">按月售卖</SelectItem>
                                <SelectItem value="2">按年售卖</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div class="grid grid-cols-2 gap-4">
                        <div class="space-y-2">
                            <Label>月付价格</Label>
                            <Input v-model.number="form.priceMonthly" type="number" min="0" step="0.01"
                                placeholder="0.00" :class="adminBrandFocusClass" />
                        </div>
                        <div class="space-y-2">
                            <Label>年付价格</Label>
                            <Input v-model.number="form.priceYearly" type="number" min="0" step="0.01"
                                placeholder="0.00" :class="adminBrandFocusClass" />
                        </div>
                    </div>
                    <div class="grid grid-cols-2 gap-4">
                        <div class="space-y-2">
                            <Label>原月付价格</Label>
                            <Input v-model.number="form.originalPriceMonthly" type="number" min="0" step="0.01"
                                placeholder="划线价" :class="adminBrandFocusClass" />
                        </div>
                        <div class="space-y-2">
                            <Label>原年付价格</Label>
                            <Input v-model.number="form.originalPriceYearly" type="number" min="0" step="0.01"
                                placeholder="划线价" :class="adminBrandFocusClass" />
                        </div>
                    </div>
                </template>
                <!-- 积分商品字段 -->
                <template v-if="form.type === '2'">
                    <div class="grid grid-cols-2 gap-4">
                        <div class="space-y-2">
                            <Label>积分数量 <span class="text-destructive">*</span></Label>
                            <Input v-model.number="form.pointAmount" type="number" min="1" placeholder="积分数量"
                                :class="adminBrandFocusClass" />
                        </div>
                        <div class="space-y-2">
                            <Label>单价 <span class="text-destructive">*</span></Label>
                            <Input v-model.number="form.unitPrice" type="number" min="0" step="0.01"
                                placeholder="0.00" :class="adminBrandFocusClass" />
                        </div>
                    </div>
                    <div class="space-y-2">
                        <Label>原单价</Label>
                        <Input v-model.number="form.originalUnitPrice" type="number" min="0" step="0.01"
                            placeholder="划线价" :class="adminBrandFocusClass" />
                    </div>
                </template>
                <!-- 通用字段 -->
                <div class="grid grid-cols-2 gap-4">
                    <div class="space-y-2">
                        <Label>最小购买数量</Label>
                        <Input v-model.number="form.minQuantity" type="number" min="1" placeholder="1"
                            :class="adminBrandFocusClass" />
                    </div>
                    <div class="space-y-2">
                        <Label>最大购买数量</Label>
                        <Input v-model.number="form.maxQuantity" type="number" min="1" placeholder="不限"
                            :class="adminBrandFocusClass" />
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-4">
                    <div class="space-y-2">
                        <Label>赠送积分</Label>
                        <Input v-model.number="form.giftPoint" type="number" min="0" placeholder="0"
                            :class="adminBrandFocusClass" />
                    </div>
                    <div class="space-y-2">
                        <Label>购买限制</Label>
                        <Input v-model.number="form.purchaseLimit" type="number" min="0" placeholder="0=不限"
                            :class="adminBrandFocusClass" />
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-4">
                    <div class="space-y-2">
                        <Label>排序值</Label>
                        <Input v-model.number="form.sortOrder" type="number" min="0" placeholder="0"
                            :class="adminBrandFocusClass" />
                    </div>
                    <div class="space-y-2">
                        <Label>状态</Label>
                        <Select v-model="form.status">
                            <SelectTrigger :class="['w-full', adminBrandFocusClass]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent class="theme-brand">
                                <SelectItem value="1">上架</SelectItem>
                                <SelectItem value="0">下架</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </div>
            <DialogFooter class="shrink-0">
                <Button variant="outline" :class="adminBrandFocusClass" @click="open = false">取消</Button>
                <Button :class="adminBrandPrimaryButtonClass" @click="handleSubmit" :disabled="submitting">
                    <Loader2 v-if="submitting" class="h-4 w-4 mr-2 animate-spin" />
                    {{ isEdit ? '保存' : '创建' }}
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
</template>

<script setup lang="ts">
import { Loader2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { ProductInfo } from '#shared/types/product'
import { useApiFetch } from '~/composables/useApiFetch'
import {
    adminBrandFocusClass,
    adminBrandPrimaryButtonClass,
} from '~/utils/adminBrandStyles'

// 定义 props
defineProps<{
    membershipLevels: Array<{ id: number; name: string }>
}>()

// 定义事件
const emit = defineEmits<{
    success: []
}>()

// 对话框状态
const open = defineModel<boolean>('open', { default: false })
const isEdit = ref(false)
const submitting = ref(false)
const selectedProduct = ref<ProductInfo | null>(null)

// 表单数据
const form = ref(getDefaultForm())

// 获取默认表单值
function getDefaultForm() {
    return {
        name: '',
        description: '',
        type: '',
        levelId: '',
        defaultDuration: '',
        priceMonthly: undefined as number | undefined,
        priceYearly: undefined as number | undefined,
        originalPriceMonthly: undefined as number | undefined,
        originalPriceYearly: undefined as number | undefined,
        unitPrice: undefined as number | undefined,
        originalUnitPrice: undefined as number | undefined,
        pointAmount: undefined as number | undefined,
        giftPoint: undefined as number | undefined,
        purchaseLimit: undefined as number | undefined,
        minQuantity: 1 as number | undefined,
        maxQuantity: undefined as number | undefined,
        sortOrder: 0,
        status: '1',
    }
}

// 重置表单
const resetForm = () => {
    form.value = getDefaultForm()
}

// 打开创建对话框
const openCreate = () => {
    isEdit.value = false
    selectedProduct.value = null
    resetForm()
    open.value = true
}

// 打开编辑对话框
const openEdit = (product: ProductInfo) => {
    isEdit.value = true
    selectedProduct.value = product
    form.value = {
        name: product.name,
        description: product.description || '',
        type: String(product.type),
        levelId: product.levelId ? String(product.levelId) : '',
        defaultDuration: product.defaultDuration ? String(product.defaultDuration) : '',
        priceMonthly: product.priceMonthly ?? undefined,
        priceYearly: product.priceYearly ?? undefined,
        originalPriceMonthly: product.originalPriceMonthly ?? undefined,
        originalPriceYearly: product.originalPriceYearly ?? undefined,
        unitPrice: product.unitPrice ?? undefined,
        originalUnitPrice: product.originalUnitPrice ?? undefined,
        pointAmount: product.pointAmount ?? undefined,
        giftPoint: product.giftPoint ?? undefined,
        purchaseLimit: product.purchaseLimit ?? undefined,
        minQuantity: product.minQuantity ?? 1,
        maxQuantity: product.maxQuantity ?? undefined,
        sortOrder: product.sortOrder,
        status: String(product.status),
    }
    open.value = true
}

// 提交表单
const handleSubmit = async () => {
    if (!form.value.name) {
        toast.error('请输入产品名称')
        return
    }
    if (!isEdit.value && !form.value.type) {
        toast.error('请选择产品类型')
        return
    }

    submitting.value = true
    try {
        const body: Record<string, any> = {
            name: form.value.name,
            description: form.value.description || null,
            status: parseInt(form.value.status),
            sortOrder: form.value.sortOrder || 0,
            giftPoint: form.value.giftPoint || null,
            purchaseLimit: form.value.purchaseLimit || null,
            minQuantity: form.value.minQuantity || 1,
            maxQuantity: form.value.maxQuantity || null,
        }

        if (!isEdit.value) {
            body.type = parseInt(form.value.type)
        }

        // 根据类型添加字段
        const type = isEdit.value ? selectedProduct.value?.type : parseInt(form.value.type)
        if (type === 1) {
            body.levelId = form.value.levelId ? parseInt(form.value.levelId) : null
            body.defaultDuration = form.value.defaultDuration ? parseInt(form.value.defaultDuration) : null
            body.priceMonthly = form.value.priceMonthly
            body.priceYearly = form.value.priceYearly
            body.originalPriceMonthly = form.value.originalPriceMonthly
            body.originalPriceYearly = form.value.originalPriceYearly
        } else if (type === 2) {
            body.pointAmount = form.value.pointAmount
            body.unitPrice = form.value.unitPrice
            body.originalUnitPrice = form.value.originalUnitPrice
        }

        let result
        if (isEdit.value && selectedProduct.value) {
            result = await useApiFetch(`/api/v1/admin/products/${selectedProduct.value.id}`, {
                method: 'PUT',
                body,
            })
        } else {
            result = await useApiFetch('/api/v1/admin/products', {
                method: 'POST',
                body,
            })
        }

        if (result) {
            toast.success(isEdit.value ? '保存成功' : '创建成功')
            open.value = false
            emit('success')
        }
    } finally {
        submitting.value = false
    }
}

// 暴露方法给父组件
defineExpose({
    openCreate,
    openEdit,
})
</script>
