<template>
    <!-- 示范案例创建/编辑对话框 -->
    <Dialog v-model:open="open">
        <DialogContent class="max-w-2xl max-h-[85vh] flex flex-col" @interactOutside="(e) => e.preventDefault()">
            <DialogHeader class="flex-shrink-0">
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

                <!-- 预设材料 -->
                <div class="space-y-2">
                    <div class="flex items-center justify-between">
                        <Label>预设材料</Label>
                        <Button variant="outline" size="sm" @click="addMaterial">
                            <Plus class="h-4 w-4 mr-1" />
                            添加材料
                        </Button>
                    </div>
                    <div v-if="form.materials.length === 0"
                        class="text-sm text-muted-foreground py-4 text-center border rounded-md">
                        暂无预设材料，点击上方按钮添加
                    </div>
                    <div v-else class="space-y-3">
                        <div v-for="(material, index) in form.materials" :key="index"
                            class="border rounded-md p-3 space-y-3">
                            <div class="flex items-center justify-between">
                                <span class="text-sm font-medium">材料 {{ index + 1 }}</span>
                                <Button variant="ghost" size="icon" @click="removeMaterial(index)">
                                    <X class="h-4 w-4" />
                                </Button>
                            </div>
                            <div class="grid grid-cols-2 gap-3">
                                <div class="space-y-1">
                                    <Label class="text-xs">材料名称</Label>
                                    <Input v-model="material.name" placeholder="材料名称" class="h-9" />
                                </div>
                                <div class="space-y-1">
                                    <Label class="text-xs">材料类型</Label>
                                    <Select v-model="material.type">
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="1">文本</SelectItem>
                                            <SelectItem value="2">文档</SelectItem>
                                            <SelectItem value="3">图片</SelectItem>
                                            <SelectItem value="4">音频</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <!-- 文本类型显示内容输入 -->
                            <div v-if="material.type === '1'" class="space-y-1">
                                <Label class="text-xs">材料内容</Label>
                                <Textarea v-model="material.content" placeholder="请输入材料内容" rows="3" />
                            </div>
                            <!-- 文件类型显示 URL 输入 -->
                            <div v-else class="space-y-1">
                                <Label class="text-xs">文件 URL</Label>
                                <Input v-model="material.fileUrl" placeholder="请输入文件 URL" />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <DialogFooter class="flex-shrink-0">
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
import { Loader2, Plus, X } from 'lucide-vue-next'
import { toast } from 'vue-sonner'

/** 示范案例类型 */
interface DemoCase {
    id: number
    title: string
    description?: string | null
    caseTypeId: number
    materials: DemoCaseMaterial[]
    coverImage?: string | null
    priority: number
    status: number
}

/** 材料项类型 */
interface DemoCaseMaterial {
    name: string
    type: string
    content?: string
    fileUrl?: string
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
        caseTypeId: '',
        coverImage: '',
        priority: 100,
        status: '1',
        materials: [] as DemoCaseMaterial[],
    }
}

// 重置表单
const resetForm = () => {
    form.value = getDefaultForm()
}

// 添加材料
const addMaterial = () => {
    form.value.materials.push({
        name: '',
        type: '1',
        content: '',
        fileUrl: '',
    })
}

// 移除材料
const removeMaterial = (index: number) => {
    form.value.materials.splice(index, 1)
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
    // 处理材料数据，确保 type 是字符串
    const materials = Array.isArray(item.materials)
        ? item.materials.map(m => ({
            name: m.name || '',
            type: String(m.type || '1'),
            content: m.content || '',
            fileUrl: m.fileUrl || '',
        }))
        : []
    form.value = {
        title: item.title,
        description: item.description || '',
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

    // 验证材料
    for (let i = 0; i < form.value.materials.length; i++) {
        const m = form.value.materials[i]
        if (!m) continue
        if (!m.name) {
            toast.error(`材料 ${i + 1} 的名称不能为空`)
            return
        }
        if (m.type === '1' && !m.content) {
            toast.error(`材料 ${i + 1} 的内容不能为空`)
            return
        }
        if (m.type !== '1' && !m.fileUrl) {
            toast.error(`材料 ${i + 1} 的文件 URL 不能为空`)
            return
        }
    }

    submitting.value = true
    try {
        // 构建材料数据，type 转为数字
        const materials = form.value.materials.map(m => ({
            name: m.name,
            type: parseInt(m.type),
            content: m.type === '1' ? m.content : undefined,
            fileUrl: m.type !== '1' ? m.fileUrl : undefined,
        }))

        const body: Record<string, any> = {
            title: form.value.title,
            description: form.value.description || null,
            caseTypeId: parseInt(form.value.caseTypeId),
            coverImage: form.value.coverImage || null,
            priority: form.value.priority,
            status: parseInt(form.value.status),
            materials,
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
