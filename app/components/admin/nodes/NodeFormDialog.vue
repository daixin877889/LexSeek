<template>
    <!-- 节点创建/编辑对话框 -->
    <Dialog v-model:open="open">
        <DialogContent
            class="top-0 left-0 right-0 bottom-0 max-w-none sm:max-w-none translate-x-0 translate-y-0 rounded-none p-4 md:top-[50%] md:left-[50%] md:right-auto md:bottom-auto md:translate-x-[-50%] md:translate-y-[-50%] md:w-[85vw] md:max-w-[85vw] md:h-[85vh] md:rounded-lg md:p-6 flex flex-col overflow-hidden"
            @interactOutside="(e) => e.preventDefault()">
            <DialogHeader class="shrink-0">
                <DialogTitle>{{ isEdit ? '编辑节点' : '新增节点' }}</DialogTitle>
                <DialogDescription>{{ isEdit ? '修改节点配置信息' : '创建新的工作流节点' }}</DialogDescription>
            </DialogHeader>

            <Tabs v-model="activeTab" class="flex-1 flex flex-col overflow-hidden mt-2 min-h-0">
                <TabsList class="shrink-0 grid w-full" :class="showOutputSchema ? 'grid-cols-4' : 'grid-cols-3'">
                    <TabsTrigger value="basic">基础信息</TabsTrigger>
                    <TabsTrigger value="tools">工具列表</TabsTrigger>
                    <TabsTrigger value="skills">关联 Skills</TabsTrigger>
                    <TabsTrigger v-if="showOutputSchema" value="schema">结构化输出</TabsTrigger>
                </TabsList>

                <!-- 基础信息 -->
                <TabsContent value="basic"
                    class="flex-1 overflow-y-auto py-4 px-1 space-y-4 data-[state=inactive]:hidden mt-0">
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

                    <!-- 关联模型（带搜索） -->
                    <div class="space-y-2">
                        <Label>关联模型 <span class="text-destructive">*</span></Label>
                        <Popover v-model:open="modelOpen">
                            <PopoverTrigger as-child>
                                <Button
                                    variant="outline"
                                    role="combobox"
                                    :aria-expanded="modelOpen"
                                    class="w-full justify-between font-normal"
                                >
                                    <span class="flex items-center gap-2 min-w-0"
                                        :class="form.modelId ? '' : 'text-muted-foreground'">
                                        <AdminModelTypeBadge v-if="selectedModel" :type="selectedModel.modelType" />
                                        <span class="truncate">{{ selectedModelLabel || '选择模型' }}</span>
                                    </span>
                                    <ChevronsUpDown class="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent class="w-(--reka-popover-trigger-width) p-0" align="start">
                                <Command>
                                    <CommandInput placeholder="搜索模型..." />
                                    <CommandList>
                                        <CommandEmpty>没有匹配的模型</CommandEmpty>
                                        <CommandGroup>
                                            <CommandItem
                                                v-for="m in models"
                                                :key="m.id"
                                                :value="String(m.id)"
                                                :keywords="[m.displayName, modelTypeLabel(m.modelType)]"
                                                @select="onSelectModel(String(m.id))"
                                            >
                                                <AdminModelTypeBadge :type="m.modelType" />
                                                <span class="truncate flex-1">{{ m.displayName }}</span>
                                                <Check
                                                    v-if="form.modelId === String(m.id)"
                                                    class="h-4 w-4 shrink-0"
                                                />
                                            </CommandItem>
                                        </CommandGroup>
                                    </CommandList>
                                </Command>
                            </PopoverContent>
                        </Popover>
                    </div>

                    <!-- 仅当选中的模型支持思考切换时显示 -->
                    <div v-if="selectedModelSupportsThinking" class="flex items-center space-x-2">
                        <Checkbox id="thinkingEnabled" v-model="form.thinkingEnabled" />
                        <Label for="thinkingEnabled" class="cursor-pointer">
                            启用思考模式
                            <span class="text-xs text-muted-foreground ml-2">
                                （前端用户深度思考开关优先；前端无开关的场景将使用此默认值）
                            </span>
                        </Label>
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
                </TabsContent>

                <!-- 工具列表 -->
                <TabsContent value="tools"
                    class="flex-1 flex flex-col overflow-hidden py-4 px-1 gap-2 data-[state=inactive]:hidden mt-0">
                    <Label class="shrink-0">工具列表</Label>
                    <div v-if="toolsLoading" class="flex items-center gap-2 text-sm text-muted-foreground shrink-0">
                        <Loader2 class="h-4 w-4 animate-spin" />
                        加载工具列表...
                    </div>
                    <div v-else-if="availableTools.length === 0" class="text-sm text-muted-foreground shrink-0">
                        暂无可用工具
                    </div>
                    <template v-else>
                        <!-- 搜索框 -->
                        <div class="relative shrink-0">
                            <Search
                                class="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input v-model="toolSearch" placeholder="搜索工具名或描述" class="pl-8" />
                        </div>
                        <!-- 已选工具展示 -->
                        <div v-if="form.tools.length" class="flex flex-wrap gap-2 shrink-0">
                            <Badge v-for="toolName in form.tools" :key="toolName" variant="secondary"
                                class="cursor-pointer" @click="toggleTool(toolName)">
                                {{ toolName }}
                                <X class="h-3 w-3 ml-1" />
                            </Badge>
                        </div>
                        <!-- 工具选择列表（撑满剩余高度） -->
                        <div class="flex-1 min-h-0 border rounded-md overflow-y-auto">
                            <div v-if="filteredTools.length === 0"
                                class="p-6 text-center text-sm text-muted-foreground">
                                没有匹配的工具
                            </div>
                            <div v-for="tool in filteredTools" :key="tool.name"
                                class="flex items-start gap-3 p-3 hover:bg-muted/50 cursor-pointer border-b last:border-b-0"
                                @click="toggleTool(tool.name)">
                                <div class="size-4 shrink-0 mt-0.5 flex items-center justify-center rounded border"
                                    :class="form.tools.includes(tool.name) ? 'bg-primary border-primary text-primary-foreground' : 'border-input'">
                                    <Check v-if="form.tools.includes(tool.name)" class="size-3" />
                                </div>
                                <div class="flex-1 min-w-0">
                                    <div class="font-medium text-sm">{{ tool.name }}</div>
                                    <div class="text-xs text-muted-foreground line-clamp-2">{{ tool.description }}
                                    </div>
                                </div>
                            </div>
                        </div>
                        <p class="text-xs text-muted-foreground shrink-0">选择节点可调用的工具</p>
                    </template>
                </TabsContent>

                <!-- 关联 Skills -->
                <TabsContent value="skills"
                    class="flex-1 flex flex-col overflow-hidden py-4 px-1 gap-2 data-[state=inactive]:hidden mt-0">
                    <Label class="shrink-0">关联 Skills</Label>
                    <AdminNodesNodeSkillSelector v-model="form.skills" class="flex-1 min-h-0" />
                </TabsContent>

                <!-- 结构化输出（仅 extraction/agent 类型） -->
                <TabsContent v-if="showOutputSchema" value="schema"
                    class="flex-1 overflow-y-auto py-4 px-1 data-[state=inactive]:hidden mt-0">
                    <AdminNodesOutputSchemaEditor v-model="form.outputSchema" />
                </TabsContent>
            </Tabs>

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
import { Check, ChevronsUpDown, Loader2, Search, X } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { NodeTypeLabels } from '#shared/types/node'
import type { NodeGroup, NodeWithRelations } from '#shared/types/node'
import type { Model, ModelType } from '#shared/types/model'
import { ModelTypeShortLabels } from '#shared/types/model'
import AdminModelTypeBadge from '~/components/admin/ModelTypeBadge.vue'
import AdminNodesOutputSchemaEditor from '~/components/admin/nodes/OutputSchemaEditor.vue'
import AdminNodesNodeSkillSelector from '~/components/admin/nodes/NodeSkillSelector.vue'
import { useApiFetch } from '~/composables/useApiFetch'

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

type TabKey = 'basic' | 'tools' | 'skills' | 'schema'

/** 取模型类型简短标签（仅给 Command 搜索 keywords 用，UI 显示走 AdminModelTypeBadge 组件） */
const modelTypeLabel = (t: string) => ModelTypeShortLabels[t as ModelType] ?? t

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

// 当前激活的 Tab
const activeTab = ref<TabKey>('basic')

// 分组和模型列表
const groups = ref<NodeGroup[]>([])
const models = ref<Model[]>([])

// 工具列表
const availableTools = ref<ToolMeta[]>([])
const toolsLoading = ref(false)
const toolSearch = ref('')
const filteredTools = computed(() => {
    const q = toolSearch.value.trim().toLowerCase()
    if (!q) return availableTools.value
    return availableTools.value.filter(t =>
        t.name.toLowerCase().includes(q)
        || (t.description ?? '').toLowerCase().includes(q)
    )
})

// 表单数据
const form = ref(getDefaultForm())

// 是否显示 outputSchema 编辑器（仅 extraction / agent 类型）
const showOutputSchema = computed(() =>
    ['extraction', 'agent'].includes(form.value.type)
)

// 类型切换：非 extraction/agent 时清空 schema，且若当前停在「结构化输出」Tab 自动跳回基础信息
watch(() => form.value.type, (newType) => {
    if (!['extraction', 'agent'].includes(newType)) {
        form.value.outputSchema = null
        if (activeTab.value === 'schema') {
            activeTab.value = 'basic'
        }
    }
})

// 关联模型 Combobox 弹层开关
const modelOpen = ref(false)

// 当前选中的模型对象
const selectedModel = computed(() =>
    models.value.find(x => String(x.id) === form.value.modelId)
)

// 关联模型按钮上显示的文字
const selectedModelLabel = computed(() => selectedModel.value?.displayName ?? '')

// 当前选中的模型是否支持思考切换
const selectedModelSupportsThinking = computed(() =>
    selectedModel.value?.supportsThinking === true
)

const onSelectModel = (id: string) => {
    form.value.modelId = id
    modelOpen.value = false
}

// 模型切换时，若新模型不支持思考切换则强制重置为 false
watch(() => form.value.modelId, () => {
    if (!selectedModelSupportsThinking.value) {
        form.value.thinkingEnabled = false
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
        thinkingEnabled: false,
    }
}

// 重置表单
const resetForm = () => {
    form.value = getDefaultForm()
    activeTab.value = 'basic'
    toolSearch.value = ''
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
        thinkingEnabled: node.thinkingEnabled ?? false,
    }
    activeTab.value = 'basic'
    toolSearch.value = ''
    loadGroups()
    loadModels()
    loadTools()
    loadNodeSkills(node.id)
    open.value = true
}

/** 加载节点当前关联的 skill 名称列表（编辑回显） */
const loadNodeSkills = async (nodeId: number) => {
    const data = await useApiFetch<{ nodeId: number; skills: Array<{ skillName: string }> }>(
        `/api/v1/admin/nodes/skills/${nodeId}`
    )
    if (data) {
        form.value.skills = data.skills.map((s) => s.skillName)
    }
}

/** 同步节点关联的 skills */
const saveNodeSkills = async (nodeId: number) => {
    return await useApiFetch(`/api/v1/admin/nodes/skills/${nodeId}`, {
        method: 'PATCH',
        body: { skills: form.value.skills.map(name => ({ skillName: name })) },
    })
}

// 提交表单
const handleSubmit = async () => {
    // 校验必填字段：缺失任一字段时跳回基础信息 Tab 并提示
    if (!isEdit.value && !form.value.name) {
        activeTab.value = 'basic'
        toast.error('请输入节点名称')
        return
    }
    if (!form.value.type) {
        activeTab.value = 'basic'
        toast.error('请选择节点类型')
        return
    }
    if (!form.value.modelId) {
        activeTab.value = 'basic'
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
            thinkingEnabled: form.value.thinkingEnabled,
        }

        let nodeId: number | null = null
        if (isEdit.value && selectedNode.value) {
            const result = await useApiFetch<{ id: number }>(`/api/v1/admin/nodes/${selectedNode.value.id}`, {
                method: 'PUT',
                body,
            })
            if (!result) return
            nodeId = selectedNode.value.id
        } else {
            body.name = form.value.name
            const result = await useApiFetch<{ id: number }>('/api/v1/admin/nodes', {
                method: 'POST',
                body,
            })
            if (!result) return
            nodeId = result.id
        }

        // 同步节点关联的 skills（新增 / 编辑共用）
        // 节点已成功创建/更新，skills 关联失败仅给出告警，避免回滚已建节点
        const skillResult = await saveNodeSkills(nodeId)
        if (skillResult === null && form.value.skills.length > 0) {
            toast.warning(
                isEdit.value
                    ? '节点已保存，但 Skills 关联更新失败，请稍后重试'
                    : '节点已创建，但 Skills 关联保存失败，请到编辑里补上'
            )
        } else {
            toast.success(isEdit.value ? '保存成功' : '创建成功')
        }
        open.value = false
        emit('success')
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
