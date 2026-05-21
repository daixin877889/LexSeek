<template>
    <!-- 节点分组创建/编辑对话框 -->
    <Dialog v-model:open="open">
        <DialogContent class="theme-brand max-w-md" @interactOutside="(e) => e.preventDefault()">
            <DialogHeader>
                <DialogTitle>{{ isEdit ? '编辑分组' : '新增分组' }}</DialogTitle>
                <DialogDescription>{{ isEdit ? '修改节点分组信息' : '创建新的节点分组' }}</DialogDescription>
            </DialogHeader>
            <div class="space-y-4 py-4">
                <!-- 分组名称 -->
                <div class="space-y-2">
                    <Label>分组名称 <span class="text-destructive">*</span></Label>
                    <Input v-model="form.name" placeholder="如：分析模块" maxlength="100" :class="adminBrandFocusClass" />
                </div>

                <!-- 分组描述 -->
                <div class="space-y-2">
                    <Label>分组描述</Label>
                    <Textarea v-model="form.description" placeholder="描述分组的用途" rows="3" maxlength="255" :class="adminBrandFocusClass" />
                </div>

                <!-- 优先级 -->
                <div class="space-y-2">
                    <Label>优先级</Label>
                    <Input v-model.number="form.priority" type="number" min="1" placeholder="100" :class="adminBrandFocusClass" />
                    <p class="text-xs text-muted-foreground">数值越小优先级越高，用于排序</p>
                </div>
            </div>
            <DialogFooter>
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
import type { NodeGroup } from '#shared/types/node'
import { useApiFetch } from '~/composables/useApiFetch'
import { adminBrandFocusClass, adminBrandPrimaryButtonClass } from '~/utils/adminBrandStyles'

// 定义事件
const emit = defineEmits<{
    success: []
}>()

// 对话框状态
const open = defineModel<boolean>('open', { default: false })
const isEdit = ref(false)
const submitting = ref(false)
const selectedGroup = ref<NodeGroup | null>(null)

// 表单数据
const form = ref(getDefaultForm())

// 获取默认表单值
function getDefaultForm() {
    return {
        name: '',
        description: '',
        priority: 100,
    }
}

// 重置表单
const resetForm = () => {
    form.value = getDefaultForm()
}

// 打开创建对话框
const openCreate = () => {
    isEdit.value = false
    selectedGroup.value = null
    resetForm()
    open.value = true
}

// 打开编辑对话框
const openEdit = (group: NodeGroup) => {
    isEdit.value = true
    selectedGroup.value = group
    form.value = {
        name: group.name,
        description: group.description || '',
        priority: group.priority,
    }
    open.value = true
}

// 提交表单
const handleSubmit = async () => {
    // 验证必填字段
    if (!form.value.name.trim()) {
        toast.error('请输入分组名称')
        return
    }

    submitting.value = true
    try {
        const body = {
            name: form.value.name.trim(),
            description: form.value.description.trim() || null,
            priority: form.value.priority || 100,
        }

        let result
        if (isEdit.value && selectedGroup.value) {
            result = await useApiFetch(`/api/v1/admin/node-groups/${selectedGroup.value.id}`, {
                method: 'PUT',
                body,
            })
        } else {
            result = await useApiFetch('/api/v1/admin/node-groups', {
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
