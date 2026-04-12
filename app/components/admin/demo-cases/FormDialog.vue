<template>
    <!-- 示范案例创建/编辑对话框 -->
    <Dialog v-model:open="open">
        <DialogContent class="sm:max-w-4xl max-h-[85vh] flex flex-col" @interactOutside="(e) => e.preventDefault()">
            <DialogHeader class="shrink-0">
                <DialogTitle>{{ isEdit ? '编辑示范案例' : '新增示范案例' }}</DialogTitle>
                <DialogDescription>{{ isEdit ? '修改示范案例配置' : '创建新的示范案例' }}</DialogDescription>
            </DialogHeader>
            <div class="flex-1 overflow-y-auto space-y-4 py-4 px-1">
                <!-- 案例标题 -->
                <div class="space-y-2">
                    <Label>案例标题 <span class="text-destructive">*</span></Label>
                    <Input v-model="form.title" placeholder="请输入案例标题" />
                </div>

                <!-- 案例简介 -->
                <div class="space-y-2">
                    <Label>案例简介</Label>
                    <Textarea v-model="form.description" placeholder="请输入案例简介" rows="3" />
                </div>

                <!-- 案件类型 -->
                <div class="space-y-2">
                    <Label>案件类型 <span class="text-destructive">*</span></Label>
                    <Select v-model="form.caseTypeId">
                        <SelectTrigger class="w-full">
                            <SelectValue placeholder="选择案件类型" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem v-for="t in caseTypes" :key="t.id" :value="String(t.id)">
                                {{ t.name }}
                            </SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                <!-- 封面图片 -->
                <div class="space-y-2">
                    <Label>封面图片</Label>
                    <Input v-model="form.coverImage" placeholder="请输入封面图片 URL" />
                </div>

                <!-- 优先级和状态 -->
                <div class="grid grid-cols-2 gap-4">
                    <div class="space-y-2">
                        <Label>排序优先级</Label>
                        <Input v-model.number="form.priority" type="number" min="0" placeholder="100" />
                        <p class="text-xs text-muted-foreground">数字越小越靠前</p>
                    </div>
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

                <!-- 案件描述（点击示范案例时填入用户输入框） -->
                <div class="space-y-2">
                    <Label>案件描述</Label>
                    <Textarea v-model="form.content" placeholder="点击示范案例时填入用户输入框的案情描述" rows="6" />
                </div>

                <!-- 预设文件材料 -->
                <AdminDemoCasesMaterialUploader v-model="form.materials" />
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
import type { DemoCaseFileMaterial } from '#shared/types/case'

/** 示范案例类型 */
interface DemoCase {
    id: number
    title: string
    description?: string | null
    content?: string | null
    caseTypeId: number
    materials: any[]
    coverImage?: string | null
    priority: number
    status: number
}

/** 案件类型 */
interface CaseType {
    id: number
    name: string
}

// 定义 props
const props = defineProps<{
    caseTypes?: CaseType[]
}>()

// 定义事件
const emit = defineEmits<{
    success: []
}>()

// 对话框状态
const open = defineModel<boolean>('open', { default: false })
const isEdit = ref(false)
const submitting = ref(false)
const selectedItem = ref<DemoCase | null>(null)

// 表单数据
const form = ref(getDefaultForm())

// 获取默认表单值
function getDefaultForm() {
    return {
        title: '',
        description: '',
        content: '',
        caseTypeId: '',
        coverImage: '',
        priority: 100,
        status: '1',
        materials: [] as DemoCaseFileMaterial[],
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
const openEdit = (item: DemoCase) => {
    isEdit.value = true
    selectedItem.value = item
    // 防御性过滤：只保留 type ∈ [2,3,4] 且 sourceOssFileId 为正整数的项
    // 跳过旧 schema 残留的 type=1 文本项
    const materials: DemoCaseFileMaterial[] = Array.isArray(item.materials)
        ? (item.materials as any[]).filter(m =>
            m && typeof m.sourceOssFileId === 'number' && m.sourceOssFileId > 0 && [2, 3, 4].includes(m.type))
        : []
    form.value = {
        title: item.title,
        description: item.description || '',
        content: item.content || '',
        caseTypeId: String(item.caseTypeId),
        coverImage: item.coverImage || '',
        priority: item.priority,
        status: String(item.status),
        materials,
    }
    open.value = true
}

// 提交表单
const handleSubmit = async () => {
    // 验证必填字段
    if (!form.value.title) {
        toast.error('请输入案例标题')
        return
    }
    if (!form.value.caseTypeId) {
        toast.error('请选择案件类型')
        return
    }

    submitting.value = true
    try {
        const body: Record<string, any> = {
            title: form.value.title,
            description: form.value.description || null,
            content: form.value.content || null,
            caseTypeId: parseInt(form.value.caseTypeId),
            coverImage: form.value.coverImage || null,
            priority: form.value.priority,
            status: parseInt(form.value.status),
            materials: form.value.materials,
        }

        let result
        if (isEdit.value && selectedItem.value) {
            result = await useApiFetch(`/api/v1/admin/demo-cases/${selectedItem.value.id}`, {
                method: 'PUT',
                body,
            })
        } else {
            result = await useApiFetch('/api/v1/admin/demo-cases', {
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

