<template>
    <!-- 提供商创建/编辑对话框 -->
    <Dialog v-model:open="open">
        <DialogContent class="max-w-lg" @interactOutside="(e) => e.preventDefault()">
            <DialogHeader>
                <DialogTitle>{{ isEdit ? '编辑提供商' : '新增提供商' }}</DialogTitle>
                <DialogDescription>{{ isEdit ? '修改模型提供商信息' : '创建新的模型提供商' }}</DialogDescription>
            </DialogHeader>
            <div class="space-y-4 py-4">
                <div class="space-y-2">
                    <Label>名称 <span class="text-destructive">*</span></Label>
                    <Input v-model="form.name" placeholder="如：OpenAI、阿里云" />
                </div>
                <div class="space-y-2">
                    <Label>API 基础 URL <span class="text-destructive">*</span></Label>
                    <Input v-model="form.baseUrl" placeholder="如：https://api.openai.com/v1" />
                </div>
                <div class="space-y-2">
                    <Label>描述</Label>
                    <Textarea v-model="form.description" placeholder="提供商描述（可选）" rows="3" />
                </div>
            </div>
            <DialogFooter>
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
import type { ModelProvider } from '#shared/types/model'

// 定义事件
const emit = defineEmits<{
    success: []
}>()

// 对话框状态
const open = defineModel<boolean>('open', { default: false })
const isEdit = ref(false)
const submitting = ref(false)
const selectedProvider = ref<ModelProvider | null>(null)

// 表单数据
const form = ref(getDefaultForm())

// 获取默认表单值
function getDefaultForm() {
    return {
        name: '',
        baseUrl: '',
        description: '',
    }
}

// 重置表单
const resetForm = () => {
    form.value = getDefaultForm()
}

// 打开创建对话框
const openCreate = () => {
    isEdit.value = false
    selectedProvider.value = null
    resetForm()
    open.value = true
}

// 打开编辑对话框
const openEdit = (provider: ModelProvider) => {
    isEdit.value = true
    selectedProvider.value = provider
    form.value = {
        name: provider.name,
        baseUrl: provider.baseUrl,
        description: provider.description || '',
    }
    open.value = true
}

// 提交表单
const handleSubmit = async () => {
    if (!form.value.name) {
        toast.error('请输入提供商名称')
        return
    }
    if (!form.value.baseUrl) {
        toast.error('请输入 API 基础 URL')
        return
    }

    submitting.value = true
    try {
        const body = {
            name: form.value.name,
            baseUrl: form.value.baseUrl,
            description: form.value.description || null,
        }

        let result
        if (isEdit.value && selectedProvider.value) {
            result = await useApiFetch(`/api/v1/admin/model-providers/${selectedProvider.value.id}`, {
                method: 'PUT',
                body,
            })
        } else {
            result = await useApiFetch('/api/v1/admin/model-providers', {
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
