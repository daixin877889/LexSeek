<template>
    <!-- 模型创建/编辑对话框 -->
    <Dialog v-model:open="open">
        <DialogContent class="max-w-lg max-h-[85vh] flex flex-col" @interactOutside="(e) => e.preventDefault()">
            <DialogHeader class="shrink-0">
                <DialogTitle>{{ isEdit ? '编辑模型' : '新增模型' }}</DialogTitle>
                <DialogDescription>{{ isEdit ? '修改模型配置信息' : '创建新的模型配置' }}</DialogDescription>
            </DialogHeader>
            <div class="flex-1 overflow-y-auto space-y-4 py-4 px-1">
                <div v-if="!isEdit" class="space-y-2">
                    <Label>提供商 <span class="text-destructive">*</span></Label>
                    <Select v-model="form.providerId">
                        <SelectTrigger class="w-full">
                            <SelectValue placeholder="选择提供商" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem v-for="p in providers" :key="p.id" :value="String(p.id)">
                                {{ p.name }}
                            </SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div class="grid grid-cols-2 gap-4">
                    <div class="space-y-2">
                        <Label>模型名称 <span class="text-destructive">*</span></Label>
                        <Input v-model="form.name" placeholder="如：gpt-4o" />
                    </div>
                    <div class="space-y-2">
                        <Label>显示名称 <span class="text-destructive">*</span></Label>
                        <Input v-model="form.displayName" placeholder="如：GPT-4o" />
                    </div>
                </div>
                <div v-if="!isEdit" class="space-y-2">
                    <Label>模型类型 <span class="text-destructive">*</span></Label>
                    <Select v-model="form.modelType">
                        <SelectTrigger class="w-full">
                            <SelectValue placeholder="选择模型类型" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="chat">对话模型</SelectItem>
                            <SelectItem value="embedding">嵌入模型</SelectItem>
                            <SelectItem value="asr">音频识别</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <!-- SDK 类型选择器 -->
                <div class="space-y-2">
                    <Label>SDK 类型 <span class="text-destructive">*</span></Label>
                    <Select v-model="form.sdkType">
                        <SelectTrigger class="w-full">
                            <SelectValue placeholder="选择 SDK 类型" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem v-for="option in sdkTypeOptions" :key="option.value" :value="option.value">
                                {{ option.label }}
                            </SelectItem>
                        </SelectContent>
                    </Select>
                    <p class="text-xs text-muted-foreground">选择模型使用的 LangChain SDK 包</p>
                </div>
                <div class="grid grid-cols-2 gap-4">
                    <div class="space-y-2">
                        <Label>模型版本</Label>
                        <Input v-model="form.modelVersion" placeholder="可选" />
                    </div>
                    <div class="space-y-2">
                        <Label>优先级</Label>
                        <Input v-model.number="form.priority" type="number" min="1" placeholder="10" />
                    </div>
                </div>
                <!-- 对话模型专用字段 -->
                <div v-if="form.modelType === 'chat'" class="space-y-2">
                    <Label>上下文窗口</Label>
                    <Input v-model.number="form.contextWindow" type="number" min="1" placeholder="如：128000" />
                </div>
                <!-- 嵌入模型专用字段 -->
                <template v-if="form.modelType === 'embedding'">
                    <div class="grid grid-cols-2 gap-4">
                        <div class="space-y-2">
                            <Label>嵌入维度</Label>
                            <Input v-model.number="form.dimensions" type="number" min="1" placeholder="如：1536" />
                        </div>
                        <div class="space-y-2">
                            <Label>批处理大小</Label>
                            <Input v-model.number="form.batchSize" type="number" min="1" placeholder="如：5" />
                        </div>
                    </div>
                </template>
                <!-- 成本配置 -->
                <div class="grid grid-cols-2 gap-4">
                    <div class="space-y-2">
                        <Label>输入成本（/百万tokens）</Label>
                        <Input v-model.number="form.inputCostPerMillionTokens" type="number" min="0" step="0.01"
                            placeholder="可选" />
                    </div>
                    <div class="space-y-2">
                        <Label>输出成本（/百万tokens）</Label>
                        <Input v-model.number="form.outputCostPerMillionTokens" type="number" min="0" step="0.01"
                            placeholder="可选" />
                    </div>
                </div>
                <!-- 状态配置 -->
                <div class="grid grid-cols-2 gap-4">
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
                    <div class="flex items-end space-x-2 pb-1">
                        <Checkbox id="isDefault" v-model:checked="form.isDefault" />
                        <Label for="isDefault" class="cursor-pointer">设为默认</Label>
                    </div>
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
import type { ModelProvider, Model, SdkType } from '#shared/types/model'
import { SDK_TYPES, SdkTypeLabels, DEFAULT_SDK_TYPE } from '#shared/types/model'

// SDK 类型选项列表
const sdkTypeOptions = SDK_TYPES.map(type => ({
    value: type,
    label: SdkTypeLabels[type]
}))

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
const selectedModel = ref<Model | null>(null)

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
        displayName: '',
        modelType: '',
        sdkType: DEFAULT_SDK_TYPE as SdkType, // SDK 类型，默认为 openai
        modelVersion: '',
        contextWindow: undefined as number | undefined,
        dimensions: undefined as number | undefined,
        batchSize: undefined as number | undefined,
        isDefault: false,
        status: '1',
        priority: 10,
        inputCostPerMillionTokens: undefined as number | undefined,
        outputCostPerMillionTokens: undefined as number | undefined,
    }
}

// 重置表单
const resetForm = () => {
    form.value = getDefaultForm()
}

// 打开创建对话框
const openCreate = () => {
    isEdit.value = false
    selectedModel.value = null
    resetForm()
    loadProviders()
    open.value = true
}

// 打开编辑对话框
const openEdit = (model: Model) => {
    isEdit.value = true
    selectedModel.value = model
    form.value = {
        providerId: String(model.providerId),
        name: model.name,
        displayName: model.displayName,
        modelType: model.modelType,
        sdkType: (model.sdkType as SdkType) || DEFAULT_SDK_TYPE, // 编辑时加载当前模型的 SDK 类型
        modelVersion: model.modelVersion || '',
        contextWindow: model.contextWindow ?? undefined,
        dimensions: model.dimensions ?? undefined,
        batchSize: model.batchSize ?? undefined,
        isDefault: model.isDefault,
        status: String(model.status),
        priority: model.priority,
        inputCostPerMillionTokens: model.inputCostPerMillionTokens ? Number(model.inputCostPerMillionTokens) : undefined,
        outputCostPerMillionTokens: model.outputCostPerMillionTokens ? Number(model.outputCostPerMillionTokens) : undefined,
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
        toast.error('请输入模型名称')
        return
    }
    if (!form.value.displayName) {
        toast.error('请输入显示名称')
        return
    }
    if (!isEdit.value && !form.value.modelType) {
        toast.error('请选择模型类型')
        return
    }

    submitting.value = true
    try {
        const body: Record<string, any> = {
            name: form.value.name,
            displayName: form.value.displayName,
            sdkType: form.value.sdkType, // 提交时包含 SDK 类型
            modelVersion: form.value.modelVersion || null,
            contextWindow: form.value.contextWindow || null,
            dimensions: form.value.dimensions || null,
            batchSize: form.value.batchSize || null,
            isDefault: form.value.isDefault,
            status: parseInt(form.value.status),
            priority: form.value.priority || 10,
            inputCostPerMillionTokens: form.value.inputCostPerMillionTokens || null,
            outputCostPerMillionTokens: form.value.outputCostPerMillionTokens || null,
        }

        let result
        if (isEdit.value && selectedModel.value) {
            result = await useApiFetch(`/api/v1/admin/models/${selectedModel.value.id}`, {
                method: 'PUT',
                body,
            })
        } else {
            body.providerId = parseInt(form.value.providerId)
            body.modelType = form.value.modelType
            result = await useApiFetch('/api/v1/admin/models', {
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
