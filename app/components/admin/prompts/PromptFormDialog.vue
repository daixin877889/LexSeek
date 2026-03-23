<template>
    <!-- 提示词创建/编辑对话框 -->
    <Dialog v-model:open="open">
        <DialogContent
            class="!w-full !h-full !max-w-none !max-h-none md:!w-[80vw] md:!max-h-[90vh] flex flex-col !rounded-none md:!rounded-lg"
            @interactOutside="(e) => e.preventDefault()">
            <DialogHeader class="shrink-0">
                <DialogTitle>{{ isEdit ? '编辑提示词' : '新增提示词' }}</DialogTitle>
                <DialogDescription>
                    {{ isEdit ? '修改提示词内容将创建新版本，不会覆盖当前版本' : '创建新的提示词配置' }}
                </DialogDescription>
            </DialogHeader>
            <div class="flex-1 overflow-y-auto space-y-4 py-4 px-1">
                <!-- 提示词名称（创建时必填，编辑时不可修改） -->
                <div v-if="!isEdit" class="space-y-2">
                    <Label>提示词名称 <span class="text-destructive">*</span></Label>
                    <Input v-model="form.name" placeholder="如：case_summary_system" />
                    <p class="text-xs text-muted-foreground">唯一标识符，同名称的提示词会自动管理版本</p>
                </div>

                <!-- 提示词标题 -->
                <div class="space-y-2">
                    <Label>提示词标题</Label>
                    <Input v-model="form.title" placeholder="如：案件概要系统提示词" />
                </div>

                <!-- 关联节点和类型 -->
                <div class="grid grid-cols-2 gap-4">
                    <div v-if="!isEdit" class="space-y-2">
                        <Label>关联节点 <span class="text-destructive">*</span></Label>
                        <Select v-model="form.nodeId">
                            <SelectTrigger class="w-full">
                                <SelectValue placeholder="选择节点" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem v-for="n in nodes" :key="n.id" :value="String(n.id)">
                                    {{ n.title || n.name }}
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div v-if="!isEdit" class="space-y-2">
                        <Label>提示词类型 <span class="text-destructive">*</span></Label>
                        <Select v-model="form.type">
                            <SelectTrigger class="w-full">
                                <SelectValue placeholder="选择类型" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="system">系统提示词</SelectItem>
                                <SelectItem value="user">用户提示词</SelectItem>
                                <SelectItem value="assistant">助手提示词</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                <!-- 提示词内容 -->
                <div class="space-y-2">
                    <div class="flex items-center justify-between">
                        <Label>提示词内容 <span class="text-destructive">*</span></Label>
                        <Button type="button" variant="ghost" size="sm" @click="insertVariable">
                            <Plus class="h-3 w-3 mr-1" />
                            插入变量
                        </Button>
                    </div>
                    <GeneralRichTextEditor v-model="form.content" placeholder="输入提示词内容，使用 {{变量名}} 格式插入变量"
                        output-format="markdown" :show-toolbar="true" content-class="min-h-[250px]" />
                    <p class="text-xs text-muted-foreground">
                        支持 Markdown 格式和变量占位符，变量格式：双花括号variableName双花括号
                    </p>
                </div>

                <!-- 提取的变量 -->
                <div v-if="extractedVariables.length" class="space-y-2">
                    <Label class="text-muted-foreground">检测到的变量</Label>
                    <div class="flex flex-wrap gap-2">
                        <Badge v-for="(v, index) in extractedVariables" :key="index" variant="outline">
                            {{ formatVariable(v) }}
                        </Badge>
                    </div>
                </div>
            </div>
            <DialogFooter class="shrink-0">
                <Button variant="outline" @click="open = false">取消</Button>
                <Button @click="handleSubmit" :disabled="submitting">
                    <Loader2 v-if="submitting" class="h-4 w-4 mr-2 animate-spin" />
                    {{ isEdit ? '保存（创建新版本）' : '创建' }}
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>

    <!-- 插入变量对话框 -->
    <Dialog v-model:open="variableDialogOpen">
        <DialogContent class="max-w-sm">
            <DialogHeader>
                <DialogTitle>插入变量</DialogTitle>
                <DialogDescription>输入变量名称，将自动插入到提示词内容中</DialogDescription>
            </DialogHeader>
            <div class="space-y-4 py-4">
                <div class="space-y-2">
                    <Label>变量名称</Label>
                    <Input v-model="newVariable" placeholder="如：caseInfo" @keyup.enter="confirmInsertVariable" />
                </div>
                <div class="space-y-2">
                    <Label class="text-muted-foreground">常用变量</Label>
                    <div class="flex flex-wrap gap-2">
                        <Badge v-for="v in commonVariables" :key="v" variant="outline" class="cursor-pointer"
                            @click="newVariable = v">
                            {{ v }}
                        </Badge>
                    </div>
                </div>
            </div>
            <DialogFooter>
                <Button variant="outline" @click="variableDialogOpen = false">取消</Button>
                <Button @click="confirmInsertVariable" :disabled="!newVariable.trim()">插入</Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
</template>

<script setup lang="ts">
import { Loader2, Plus } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { Node, PromptWithRelations } from '#shared/types/node'

// 定义 props
const props = defineProps<{
    nodes?: Node[]
}>()

// 定义事件
const emit = defineEmits<{
    success: []
}>()

// 对话框状态
const open = defineModel<boolean>('open', { default: false })
const isEdit = ref(false)
const submitting = ref(false)
const selectedPrompt = ref<PromptWithRelations | null>(null)

// 节点列表
const nodes = ref<Node[]>([])

// 变量插入对话框
const variableDialogOpen = ref(false)
const newVariable = ref('')
const commonVariables = ['caseInfo', 'materials', 'plaintiff', 'defendant', 'caseType', 'extractedInfo']

// 表单数据
const form = ref(getDefaultForm())

// 获取默认表单值
function getDefaultForm() {
    return {
        name: '',
        title: '',
        content: '',
        type: '',
        nodeId: '',
    }
}

// 计算属性：提取的变量
const extractedVariables = computed(() => {
    const regex = /\{\{(\w+)\}\}/g
    const variables: string[] = []
    let match
    while ((match = regex.exec(form.value.content)) !== null) {
        const varName = match[1]
        if (varName && !variables.includes(varName)) {
            variables.push(varName)
        }
    }
    return variables
})

// 格式化变量显示
const formatVariable = (v: string) => {
    return `\{\{${v}\}\}`
}

// 重置表单
const resetForm = () => {
    form.value = getDefaultForm()
}

// 加载节点列表
const loadNodes = async () => {
    if (props.nodes) {
        nodes.value = props.nodes
        return
    }
    const data = await useApiFetch<{ items: Node[] }>('/api/v1/admin/nodes', {
        query: { pageSize: 100, status: 1 }
    })
    if (data) nodes.value = data.items
}

// 插入变量
const insertVariable = () => {
    newVariable.value = ''
    variableDialogOpen.value = true
}

// 确认插入变量
const confirmInsertVariable = () => {
    const varName = newVariable.value.trim()
    if (varName) {
        form.value.content += `{{${varName}}}`
        variableDialogOpen.value = false
        newVariable.value = ''
    }
}

// 打开创建对话框
const openCreate = () => {
    isEdit.value = false
    selectedPrompt.value = null
    resetForm()
    loadNodes()
    open.value = true
}

// 打开编辑对话框
const openEdit = (prompt: PromptWithRelations) => {
    isEdit.value = true
    selectedPrompt.value = prompt
    form.value = {
        name: prompt.name,
        title: prompt.title || '',
        content: prompt.content,
        type: prompt.type,
        nodeId: String(prompt.nodeId),
    }
    loadNodes()
    open.value = true
}

// 提交表单
const handleSubmit = async () => {
    // 验证必填字段
    if (!isEdit.value) {
        if (!form.value.name) {
            toast.error('请输入提示词名称')
            return
        }
        if (!form.value.nodeId) {
            toast.error('请选择关联节点')
            return
        }
        if (!form.value.type) {
            toast.error('请选择提示词类型')
            return
        }
    }
    if (!form.value.content) {
        toast.error('请输入提示词内容')
        return
    }

    submitting.value = true
    try {
        let result
        if (isEdit.value && selectedPrompt.value) {
            // 编辑模式：创建新版本
            result = await useApiFetch('/api/v1/admin/prompts', {
                method: 'POST',
                body: {
                    name: selectedPrompt.value.name,
                    title: form.value.title || null,
                    content: form.value.content,
                    type: selectedPrompt.value.type,
                    nodeId: selectedPrompt.value.nodeId,
                    variables: extractedVariables.value,
                },
            })
        } else {
            // 创建模式
            result = await useApiFetch('/api/v1/admin/prompts', {
                method: 'POST',
                body: {
                    name: form.value.name,
                    title: form.value.title || null,
                    content: form.value.content,
                    type: form.value.type,
                    nodeId: parseInt(form.value.nodeId),
                    variables: extractedVariables.value,
                },
            })
        }

        if (result) {
            toast.success(isEdit.value ? '新版本创建成功' : '创建成功')
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
