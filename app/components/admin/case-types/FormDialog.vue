<template>
    <!-- 案件类型创建/编辑对话框 -->
    <Dialog v-model:open="open">
        <DialogContent class="max-w-lg max-h-[85vh] flex flex-col" @interactOutside="(e) => e.preventDefault()">
            <DialogHeader class="shrink-0">
                <DialogTitle>{{ isEdit ? '编辑案件类型' : '新增案件类型' }}</DialogTitle>
                <DialogDescription>{{ isEdit ? '修改案件类型配置' : '创建新的案件类型' }}</DialogDescription>
            </DialogHeader>
            <div class="flex-1 overflow-y-auto space-y-4 py-4 px-1">
                <!-- 类型名称 -->
                <div class="space-y-2">
                    <Label>类型名称 <span class="text-destructive">*</span></Label>
                    <Input v-model="form.name" placeholder="如：民事纠纷" />
                </div>

                <!-- 描述 -->
                <div class="space-y-2">
                    <Label>描述</Label>
                    <Textarea v-model="form.description" placeholder="案件类型的详细描述" rows="3" />
                </div>

                <!-- 图标 -->
                <div class="space-y-2">
                    <Label>图标</Label>
                    <Input v-model="form.icon" placeholder="图标名称或 URL" />
                    <p class="text-xs text-muted-foreground">可选，用于前台展示</p>
                </div>

                <!-- 优先级 -->
                <div class="space-y-2">
                    <Label>优先级</Label>
                    <Input v-model.number="form.priority" type="number" min="0" placeholder="100" />
                    <p class="text-xs text-muted-foreground">数值越小排序越靠前，默认 100</p>
                </div>

                <!-- 状态 -->
                <div class="space-y-2">
                    <Label>状态</Label>
                    <Select v-model="form.status">
                        <SelectTrigger class="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="1">启用</SelectItem>
                            <SelectItem value="0">禁用</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>
            <DialogFooter class="shrink-0">
                <Button variant="outline" @click="open = false">取消</Button>
                <Button @click="handleSubmit" :disabled="submitting">
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

// 案件类型接口
interface CaseType {
    id: number
    name: string
    description?: string | null
    icon?: string | null
    priority: number
    status: number
    createdAt: Date | string
    updatedAt: Date | string
}

// 定义事件
const emit = defineEmits<{
    success: []
}>()

// 对话框状态
const open = defineModel<boolean>('open', { default: false })
const isEdit = ref(false)
const submitting = ref(false)
const selectedItem = ref<CaseType | null>(null)

// 表单数据
const form = ref(getDefaultForm())

// 获取默认表单值
function getDefaultForm() {
    return {
        name: '',
        description: '',
        icon: '',
        priority: 100,
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
const openEdit = (item: CaseType) => {
    isEdit.value = true
    selectedItem.value = item
    form.value = {
        name: item.name,
        description: item.description || '',
        icon: item.icon || '',
        priority: item.priority,
        status: String(item.status),
    }
    open.value = true
}

// 提交表单
const handleSubmit = async () => {
    // 验证必填字段
    if (!form.value.name.trim()) {
        toast.error('请输入类型名称')
        return
    }

    submitting.value = true
    try {
        const body: Record<string, any> = {
            name: form.value.name.trim(),
            description: form.value.description?.trim() || null,
            icon: form.value.icon?.trim() || null,
            priority: form.value.priority,
            status: parseInt(form.value.status),
        }

        let result
        if (isEdit.value && selectedItem.value) {
            result = await useApiFetch(`/api/v1/admin/case-types/${selectedItem.value.id}`, {
                method: 'PUT',
                body,
            })
        } else {
            result = await useApiFetch('/api/v1/admin/case-types', {
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
