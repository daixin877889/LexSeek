<template>
    <!-- API 密钥创建/编辑对话框 -->
    <Dialog v-model:open="open">
        <DialogContent class="theme-brand max-w-lg" @interactOutside="(e) => e.preventDefault()">
            <DialogHeader>
                <DialogTitle>{{ isEdit ? '编辑 API 密钥' : '新增 API 密钥' }}</DialogTitle>
                <DialogDescription>{{ isEdit ? '修改 API 密钥信息' : '创建新的 API 密钥' }}</DialogDescription>
            </DialogHeader>
            <form @submit.prevent="handleSubmit" class="space-y-4 py-4">
                <div v-if="!isEdit" class="space-y-2">
                    <Label>提供商 <span class="text-destructive">*</span></Label>
                    <Select v-model="form.providerId">
                        <SelectTrigger :class="['w-full', adminBrandFocusClass]">
                            <SelectValue placeholder="选择提供商" />
                        </SelectTrigger>
                        <SelectContent class="theme-brand">
                            <SelectItem v-for="p in providers" :key="p.id" :value="String(p.id)">
                                {{ p.name }}
                            </SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div class="space-y-2">
                    <Label>名称 <span class="text-destructive">*</span></Label>
                    <Input v-model="form.name" placeholder="如：主密钥、备用密钥" autocomplete="username" :class="adminBrandFocusClass" />
                </div>
                <div class="space-y-2">
                    <Label>API 密钥 <span class="text-destructive">*</span></Label>
                    <form>
                        <Input v-model="form.apiKey" type="password" placeholder="输入 API 密钥"
                            autocomplete="current-password" :class="adminBrandFocusClass" />
                    </form>
                </div>
                <div class="grid grid-cols-2 gap-4">
                    <div class="space-y-2">
                        <Label>日调用限制</Label>
                        <Input v-model.number="form.dailyLimit" type="number" min="0" placeholder="不限" :class="adminBrandFocusClass" />
                    </div>
                    <div class="space-y-2">
                        <Label>月调用限制</Label>
                        <Input v-model.number="form.monthlyLimit" type="number" min="0" placeholder="不限" :class="adminBrandFocusClass" />
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-4">
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
                    <div class="flex items-end space-x-2 pb-1">
                        <Checkbox id="isDefault" v-model="form.isDefault" :class="adminBrandCheckboxClass" />
                        <Label for="isDefault" class="cursor-pointer">设为默认</Label>
                    </div>
                </div>
            </form>
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
import type { ModelProvider, ModelApiKey } from '#shared/types/model'
import { useApiFetch } from '~/composables/useApiFetch'
import { adminBrandCheckboxClass, adminBrandFocusClass, adminBrandPrimaryButtonClass } from '~/utils/adminBrandStyles'

// 定义 props
const props = defineProps<{
    providers?: ModelProvider[]
    defaultProviderId?: number
}>()

// 定义事件
const emit = defineEmits<{
    success: []
}>()

// 对话框状态
const open = defineModel<boolean>('open', { default: false })
const isEdit = ref(false)
const submitting = ref(false)
const selectedKey = ref<ModelApiKey | null>(null)

// 提供商列表
const providers = ref<ModelProvider[]>([])

// 加载提供商列表
const loadProviders = async () => {
    if (props.providers) {
        providers.value = props.providers
        return
    }

    try {
        const data = await useApiFetch<{ items: ModelProvider[] }>('/api/v1/admin/model-providers')
        if (data) {
            providers.value = data.items
        }
    } catch (error) {
        console.error('加载提供商列表失败:', error)
    }
}

// 表单数据
const form = ref(getDefaultForm())

// 获取默认表单值
function getDefaultForm() {
    return {
        providerId: props.defaultProviderId ? String(props.defaultProviderId) : '',
        name: '',
        apiKey: '',
        isDefault: false,
        status: '1',
        dailyLimit: undefined as number | undefined,
        monthlyLimit: undefined as number | undefined,
    }
}

// 重置表单
const resetForm = () => {
    form.value = getDefaultForm()
}

// 打开创建对话框
const openCreate = () => {
    isEdit.value = false
    selectedKey.value = null
    resetForm()
    loadProviders()
    open.value = true
}

// 打开编辑对话框
const openEdit = (key: ModelApiKey) => {
    isEdit.value = true
    selectedKey.value = key
    form.value = {
        providerId: String(key.providerId),
        name: key.name,
        apiKey: '', // 编辑时不显示原密钥
        isDefault: key.isDefault,
        status: String(key.status),
        dailyLimit: key.dailyLimit ?? undefined,
        monthlyLimit: key.monthlyLimit ?? undefined,
    }
    loadProviders()
    open.value = true
}

// 提交表单
const handleSubmit = async () => {
    if (!isEdit.value && !form.value.providerId) {
        toast.error('请选择提供商')
        return
    }
    if (!form.value.name) {
        toast.error('请输入密钥名称')
        return
    }
    if (!form.value.apiKey) {
        toast.error('请输入 API 密钥')
        return
    }

    submitting.value = true
    try {
        const body: Record<string, any> = {
            name: form.value.name,
            isDefault: form.value.isDefault,
            status: parseInt(form.value.status),
            dailyLimit: form.value.dailyLimit || null,
            monthlyLimit: form.value.monthlyLimit || null,
        }

        // 编辑和创建都需要密钥
        body.apiKey = form.value.apiKey

        let result
        if (isEdit.value && selectedKey.value) {
            result = await useApiFetch(`/api/v1/admin/model-api-keys/${selectedKey.value.id}`, {
                method: 'PUT',
                body,
            })
        } else {
            body.providerId = parseInt(form.value.providerId)
            result = await useApiFetch('/api/v1/admin/model-api-keys', {
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
