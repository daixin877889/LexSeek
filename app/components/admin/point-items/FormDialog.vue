<template>
    <!-- 积分消耗项目创建/编辑对话框 -->
    <Dialog v-model:open="open">
        <DialogContent class="theme-brand max-w-lg max-h-[85vh] flex flex-col" @interactOutside="(e) => e.preventDefault()">
            <DialogHeader class="shrink-0">
                <DialogTitle>{{ isEdit ? '编辑积分消耗项目' : '新增积分消耗项目' }}</DialogTitle>
                <DialogDescription>{{ isEdit ? '修改积分消耗项目配置' : '创建新的积分消耗项目' }}</DialogDescription>
            </DialogHeader>
            <div class="flex-1 overflow-y-auto space-y-4 py-4 px-1">
                <!-- Key（必填，用于代码引用） -->
                <div v-if="!isEdit" class="space-y-2">
                    <Label>Key <span class="text-destructive">*</span></Label>
                    <Input v-model="form.key" placeholder="如：doc_parse" :class="adminBrandFocusClass" />
                    <p class="text-xs text-muted-foreground">用于代码中引用的唯一标识符，只能包含小写字母、数字和下划线，创建后不可修改</p>
                </div>

                <!-- 项目名称（创建时必填，编辑时不可修改） -->
                <div v-if="!isEdit" class="space-y-2">
                    <Label>项目名称 <span class="text-destructive">*</span></Label>
                    <Input v-model="form.name" placeholder="如：PDF 解析" :class="adminBrandFocusClass" />
                    <p class="text-xs text-muted-foreground">显示名称，创建后不可修改</p>
                </div>

                <!-- 分组 -->
                <div class="space-y-2">
                    <Label>分组 <span class="text-destructive">*</span></Label>
                    <Select v-model="form.group">
                        <SelectTrigger :class="['w-full', adminBrandFocusClass]">
                            <SelectValue placeholder="选择分组" />
                        </SelectTrigger>
                        <SelectContent class="theme-brand">
                            <SelectItem v-for="g in groupOptions" :key="g.value" :value="g.value">
                                {{ g.label }}
                            </SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                <!-- 描述 -->
                <div class="space-y-2">
                    <Label>描述</Label>
                    <Input v-model="form.description" placeholder="如：PDF 文档解析" :class="adminBrandFocusClass" />
                </div>

                <!-- 单位和积分数量 -->
                <div class="grid grid-cols-2 gap-4">
                    <div class="space-y-2">
                        <Label>单位 <span class="text-destructive">*</span></Label>
                        <Input v-model="form.unit" placeholder="如：次、页、分钟、千tokens" :class="adminBrandFocusClass" />
                    </div>
                    <div class="space-y-2">
                        <Label>积分数量 <span class="text-destructive">*</span></Label>
                        <Input v-model.number="form.pointAmount" type="number" min="0" placeholder="10" :class="adminBrandFocusClass" />
                    </div>
                </div>
                <p class="text-xs text-muted-foreground -mt-2">每个单位消耗的积分数量。如 unit=千tokens 且积分数量=5，则每 1000 tokens 消耗 5 积分</p>

                <!-- 折扣 -->
                <div class="space-y-2">
                    <Label>折扣</Label>
                    <div class="flex items-center gap-2">
                        <Input v-model.number="form.discountPercent" type="number" min="0" max="100" placeholder="100"
                            :class="['w-24', adminBrandFocusClass]" />
                        <span class="text-muted-foreground">%</span>
                    </div>
                    <p class="text-xs text-muted-foreground">实际消耗 = 积分数量 × 折扣，100% 表示无折扣</p>
                </div>

                <!-- 状态 -->
                <div class="space-y-2">
                    <Label>状态</Label>
                    <Select v-model="form.status">
                        <SelectTrigger :class="['w-full', adminBrandFocusClass]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent class="theme-brand">
                            <SelectItem value="1">启用</SelectItem>
                            <SelectItem value="0">禁用</SelectItem>
                        </SelectContent>
                    </Select>
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
import type { PointConsumptionItem } from '#shared/types/point.types'
import { useApiFetch } from '~/composables/useApiFetch'
import { adminBrandFocusClass, adminBrandPrimaryButtonClass } from '~/utils/adminBrandStyles'

// 定义 props
const props = defineProps<{
    groups?: string[]
}>()

// 定义事件
const emit = defineEmits<{
    success: []
}>()

// 对话框状态
const open = defineModel<boolean>('open', { default: false })
const isEdit = ref(false)
const submitting = ref(false)
const selectedItem = ref<PointConsumptionItem | null>(null)

// 分组选项
const groupLabels: Record<string, string> = {
    material: '材料处理',
    analysisModules: '分析模块',
    agentToken: 'Agent Token 消耗',
}

const groupOptions = computed(() => {
    const defaultGroups = [
        { value: 'material', label: '材料处理' },
        { value: 'analysisModules', label: '分析模块' },
        { value: 'agentToken', label: 'Agent Token 消耗' },
    ]
    if (!props.groups?.length) return defaultGroups
    return props.groups.map(g => ({
        value: g,
        label: groupLabels[g] || g,
    }))
})

// 表单数据
const form = ref(getDefaultForm())

// 获取默认表单值
function getDefaultForm() {
    return {
        key: '',
        name: '',
        group: '',
        description: '',
        unit: '次',
        pointAmount: 10,
        discountPercent: 100,
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
    selectedItem.value = null
    resetForm()
    open.value = true
}

// 打开编辑对话框
const openEdit = (item: PointConsumptionItem) => {
    isEdit.value = true
    selectedItem.value = item
    // 将折扣转换为百分比
    let discountPercent = 100
    if (item.discount !== null && item.discount !== undefined) {
        const num = typeof item.discount === 'string' ? parseFloat(item.discount) : item.discount
        discountPercent = Math.round(num * 100)
    }
    form.value = {
        key: item.key || '',
        name: item.name,
        group: item.group,
        description: item.description || '',
        unit: item.unit,
        pointAmount: item.pointAmount,
        discountPercent,
        status: String(item.status),
    }
    open.value = true
}

// 提交表单
const handleSubmit = async () => {
    // 验证必填字段
    if (!isEdit.value && !form.value.key) {
        toast.error('请输入 Key')
        return
    }
    if (!isEdit.value && !/^[a-z][a-z0-9_]*$/.test(form.value.key)) {
        toast.error('Key 只能包含小写字母、数字和下划线，且必须以字母开头')
        return
    }
    if (!isEdit.value && !form.value.name) {
        toast.error('请输入项目名称')
        return
    }
    if (!form.value.group) {
        toast.error('请选择分组')
        return
    }
    if (!form.value.unit) {
        toast.error('请输入单位')
        return
    }
    if (form.value.pointAmount < 0) {
        toast.error('积分数量不能为负数')
        return
    }

    submitting.value = true
    try {
        const body: Record<string, any> = {
            group: form.value.group,
            description: form.value.description || null,
            unit: form.value.unit,
            pointAmount: form.value.pointAmount,
            discount: form.value.discountPercent / 100,
            status: parseInt(form.value.status),
        }

        let result
        if (isEdit.value && selectedItem.value) {
            result = await useApiFetch(`/api/v1/admin/point-consumption-items/${selectedItem.value.id}`, {
                method: 'PUT',
                body,
            })
        } else {
            body.key = form.value.key
            body.name = form.value.name
            result = await useApiFetch('/api/v1/admin/point-consumption-items', {
                method: 'POST',
                body,
            })
        }

        if (result !== null) {
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
