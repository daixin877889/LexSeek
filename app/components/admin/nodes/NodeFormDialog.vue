<template>
    <!-- 节点创建/编辑对话框 -->
    <Dialog v-model:open="open">
        <DialogContent
            class="top-0 left-0 right-0 bottom-0 max-w-none sm:max-w-none translate-x-0 translate-y-0 rounded-none p-4 md:top-[50%] md:left-[50%] md:right-auto md:bottom-auto md:translate-x-[-50%] md:translate-y-[-50%] md:max-w-4xl md:max-h-[85vh] md:rounded-lg md:p-6 flex flex-col overflow-hidden"
            @interactOutside="(e) => e.preventDefault()">
            <DialogHeader class="shrink-0">
                <DialogTitle>{{ isEdit ? '编辑节点' : '新增节点' }}</DialogTitle>
                <DialogDescription>{{ isEdit ? '修改节点配置信息' : '创建新的工作流节点' }}</DialogDescription>
            </DialogHeader>
            <div class="flex-1 overflow-y-auto space-y-4 py-4 px-1">
                <!-- 节点名称（创建时必填，编辑时不可修改） -->
                <div v-if="!isEdit" class="space-y-2">
                    <Label>节点名称 <span class="text-destructive">*</span></Label>
                    <Input v-model="form.name" placeholder="如：case_summary" />
                    <p class="text-xs text-muted-foreground">唯一标识符，创建后不可修改</p>
                </div>

                <!-- 节点标题 -->
                <div class="space-y-2">
                    <Label>节点标题</Label>
                    <Input v-model="form.title" placeholder="如：案件概要" />
                </div>

                <!-- 节点描述 -->
                <div class="space-y-2">
                    <Label>节点描述</Label>
                    <Textarea v-model="form.description" placeholder="描述节点的功能和用途" rows="2" />
                </div>

                <!-- 节点类型和优先级 -->
                <div class="grid grid-cols-2 gap-4">
                    <div class="space-y-2">
                        <Label>节点类型 <span class="text-destructive">*</span></Label>
                        <Select v-model="form.type">
                            <SelectTrigger class="w-full">
                                <SelectValue placeholder="选择类型" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem v-for="(label, value) in NodeTypeLabels" :key="value" :value="value">
                                    {{ label }}
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div class="space-y-2">
                        <Label>优先级</Label>
                        <Input v-model.number="form.priority" type="number" min="1" placeholder="100" />
                        <p class="text-xs text-muted-foreground">数值越小优先级越高</p>
                    </div>
                </div>

                <!-- 关联模型 -->
                <div class="space-y-2">
                    <Label>关联模型 <span class="text-destructive">*</span></Label>
                    <Select v-model="form.modelId">
                        <SelectTrigger class="w-full">
                            <SelectValue placeholder="选择模型" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem v-for="m in models" :key="m.id" :value="String(m.id)">
                                {{ m.displayName }}
                            </SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                <!-- 节点分组 -->
                <div class="space-y-2">
                    <Label>节点分组</Label>
                    <Select v-model="form.groupId">
                        <SelectTrigger class="w-full">
                            <SelectValue placeholder="选择分组（可选）" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="none">无分组</SelectItem>
                            <SelectItem v-for="g in groups" :key="g.id" :value="String(g.id)">
                                {{ g.name }}
                            </SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                <!-- 工具列表 -->
                <div class="space-y-2">
                    <Label>工具列表</Label>
                    <div v-if="toolsLoading" class="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 class="h-4 w-4 animate-spin" />
                        加载工具列表...
                    </div>
                    <div v-else-if="availableTools.length === 0" class="text-sm text-muted-foreground">
                        暂无可用工具
                    </div>
                    <div v-else class="space-y-2">
                        <!-- 已选工具展示 -->
                        <div v-if="form.tools.length" class="flex flex-wrap gap-2">
                            <Badge v-for="toolName in form.tools" :key="toolName" variant="secondary"
                                class="cursor-pointer" @click="toggleTool(toolName)">
                                {{ toolName }}
                                <X class="h-3 w-3 ml-1" />
                            </Badge>
                        </div>
                        <!-- 工具选择列表 -->
                        <div class="border rounded-md max-h-64 overflow-y-auto">
                            <div v-for="tool in availableTools" :key="tool.name"
                                class="flex items-start gap-3 p-3 hover:bg-muted/50 cursor-pointer border-b last:border-b-0"
                                @click="toggleTool(tool.name)">
                                <div class="size-4 shrink-0 mt-0.5 flex items-center justify-center rounded border"
                                    :class="form.tools.includes(tool.name) ? 'bg-primary border-primary text-primary-foreground' : 'border-input'">
                                    <Check v-if="form.tools.includes(tool.name)" class="size-3" />
                                </div>
                                <div class="flex-1 min-w-0">
                                    <div class="font-medium text-sm">{{ tool.name }}</div>
                                    <div class="text-xs text-muted-foreground line-clamp-2">{{ tool.description }}</div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <p class="text-xs text-muted-foreground">选择节点可调用的工具</p>
                </div>

                <!-- 结构化输出 Schema（仅 extraction/agent 类型） -->
                <div v-if="showOutputSchema" class="space-y-2">
                    <AdminNodesOutputSchemaEditor v-model="form.outputSchema" />
                </div>

                <!-- Skills 多选（仅编辑时显示，创建时 nodeId 未知） -->
                <div v-if="isEdit" class="space-y-2">
                    <Label>关联 Skills</Label>
                    <AdminNodesNodeSkillSelector v-model="form.skills" />
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
import { Check, Loader2, X } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { NodeTypeLabels } from '#shared/types/node'
import type { NodeGroup, NodeWithRelations } from '#shared/types/node'
import type { Model } from '#shared/types/model'
import AdminNodesOutputSchemaEditor from '~/components/admin/nodes/OutputSchemaEditor.vue'
import { useApiFetch } from '~/composables/useApiFetch'
import type { models } from '~~/generated/prisma/client'

/** 工具元信息类型 */
interface ToolMeta {
    name: string
    description: string
    parameters: Array<{
        name: string
        type: string
        description: string
        required: boolean
    }>
}

// 定义 props
const props = defineProps<{
    groups?: NodeGroup[]
    models?: Model[]
}>()

// 定义事件
const emit = defineEmits<{
    success: []
}>()

// 对话框状态
const open = defineModel<boolean>('open', { default: false })
const isEdit = ref(false)
const submitting = ref(false)
const selectedNode = ref<NodeWithRelations | null>(null)

// 分组和模型列表
const groups = ref<NodeGroup[]>([])
const models = ref<Model[]>([])

// 工具列表
const availableTools = ref<ToolMeta[]>([])
const toolsLoading = ref(false)

// 表单数据
const form = ref(getDefaultForm())

// 是否显示 outputSchema 编辑器
const showOutputSchema = computed(() =>
    ['extraction', 'agent'].includes(form.value.type)
)

// 类型切换时自动清空 outputSchema
watch(() => form.value.type, (newType) => {
    if (!['extraction', 'agent'].includes(newType)) {
        form.value.outputSchema = null
    }
})

// 获取默认表单值
function getDefaultForm() {
    return {
        name: '',
        title: '',
        description: '',
        type: '',
        priority: 100,
        modelId: '',
        groupId: 'none',
        tools: [] as string[],
        status: '1',
        outputSchema: null as Record<string, unknown> | null,
        skills: [] as string[],
    }
}

// 重置表单
const resetForm = () => {
    form.value = getDefaultForm()
}

// 加载分组列表
const loadGroups = async () => {
    if (props.groups) {
        groups.value = props.groups
        return
    }
    const data = await useApiFetch<{ items: NodeGroup[] }>('/api/v1/admin/node-groups', {
        query: { all: true }
    })
    if (data) groups.value = data.items
}

// 加载模型列表
const loadModels = async () => {
    if (props.models) {
        models.value = props.models
        return
    }
    const data = await useApiFetch<{ items: Model[] }>('/api/v1/admin/models', {
        query: { pageSize: 100, status: 1 }
    })
    if (data) models.value = data.items
}

// 加载工具列表
const loadTools = async () => {
    toolsLoading.value = true
    try {
        const data = await useApiFetch<{ items: ToolMeta[] }>('/api/v1/admin/workflow-tools')
        if (data) {
            availableTools.value = data.items
        }
    } finally {
        toolsLoading.value = false
    }
}

// 切换工具选择状态
const toggleTool = (toolName: string) => {
    const index = form.value.tools.indexOf(toolName)
    if (index === -1) {
        form.value.tools.push(toolName)
    } else {
        form.value.tools.splice(index, 1)
    }
}

// 打开创建对话框
const openCreate = () => {
    isEdit.value = false
    selectedNode.value = null
    resetForm()
    loadGroups()
    loadModels()
    loadTools()
    open.value = true
}

// 打开编辑对话框
const openEdit = (node: NodeWithRelations) => {
    isEdit.value = true
    selectedNode.value = node
    // 处理 tools 字段，确保是字符串数组
    let toolsArray: string[] = []
    if (Array.isArray(node.tools)) {
        toolsArray = node.tools.filter((t): t is string => typeof t === 'string')
    }
    form.value = {
        name: node.name,
        title: node.title || '',
        description: node.description || '',
        type: node.type,
        priority: node.priority,
        modelId: String(node.modelId),
        groupId: node.groupId ? String(node.groupId) : 'none',
        tools: toolsArray,
        status: String(node.status),
        outputSchema: (node.outputSchema as Record<string, unknown>) ?? null,
        skills: [],
    }
    loadGroups()
    loadModels()
    loadTools()
    loadNodeSkills(node.id)
    open.value = true
}

/** 加载节点当前关联的 skill 名称列表（编辑回显） */
const loadNodeSkills = async (nodeId: number) => {
    const data = await useApiFetch<{ nodeId: number; skills: Array<{ skillName: string }> }>(
        `/api/v1/admin/nodes/${nodeId}/skills`
    )
    if (data) {
        form.value.skills = data.skills.map((s) => s.skillName)
    }
}

// 提交表单
const handleSubmit = async () => {
    // 验证必填字段
    if (!isEdit.value && !form.value.name) {
        toast.error('请输入节点名称')
        return
    }
    if (!form.value.type) {
        toast.error('请选择节点类型')
        return
    }
    if (!form.value.modelId) {
        toast.error('请选择关联模型')
        return
    }

    submitting.value = true
    try {
        const body: Record<string, any> = {
            title: form.value.title || null,
            description: form.value.description || null,
            type: form.value.type,
            priority: form.value.priority || 100,
            modelId: parseInt(form.value.modelId),
            groupId: form.value.groupId === 'none' ? null : parseInt(form.value.groupId),
            tools: form.value.tools,
            status: parseInt(form.value.status),
            outputSchema: showOutputSchema.value ? (form.value.outputSchema ?? null) : null,
        }

        let result
        if (isEdit.value && selectedNode.value) {
            result = await useApiFetch(`/api/v1/admin/nodes/${selectedNode.value.id}`, {
                method: 'PUT',
                body,
            })
        } else {
            body.name = form.value.name
            result = await useApiFetch('/api/v1/admin/nodes', {
                method: 'POST',
                body,
            })
        }

        if (result) {
            // 编辑时同步更新节点关联的 skills
            if (isEdit.value && selectedNode.value) {
                await useApiFetch(`/api/v1/admin/nodes/${selectedNode.value.id}/skills`, {
                    method: 'PATCH',
                    body: { skills: form.value.skills.map(name => ({ skillName: name })) },
                })
            }
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
