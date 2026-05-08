<template>
    <div class="space-y-6">
        <!-- 页面标题和操作 -->
        <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div class="flex items-center gap-4">
                <Button variant="ghost" size="icon" @click="navigateTo('/admin/nodes')">
                    <ArrowLeft class="h-4 w-4" />
                </Button>
                <div>
                    <h1 class="text-2xl md:text-3xl font-bold mb-1">节点详情</h1>
                    <p class="text-muted-foreground text-sm">查看和编辑节点配置</p>
                </div>
            </div>
            <div class="flex gap-2">
                <Button v-if="node" variant="outline" @click="formDialogRef?.openEdit(node, activeTab)" :disabled="loading">
                    <Pencil class="h-4 w-4 mr-2" />
                    编辑
                </Button>
                <Button variant="outline" @click="handleToggleStatus" :disabled="loading">
                    <Power class="h-4 w-4 mr-2" />
                    {{ node?.status === 1 ? '禁用' : '启用' }}
                </Button>
                <Button variant="destructive" @click="deleteDialogOpen = true" :disabled="loading">
                    <Trash2 class="h-4 w-4 mr-2" />
                    删除
                </Button>
            </div>
        </div>

        <!-- 加载状态 -->
        <div v-if="loading" class="flex justify-center py-12">
            <Loader2 class="h-10 w-10 animate-spin text-muted-foreground" />
        </div>

        <!-- 节点不存在 -->
        <div v-else-if="!node" class="flex flex-col items-center justify-center py-12 text-center">
            <AlertCircle class="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 class="text-lg font-medium mb-1">节点不存在</h3>
            <p class="text-muted-foreground text-sm mb-4">该节点可能已被删除</p>
            <Button @click="navigateTo('/admin/nodes')">返回列表</Button>
        </div>

        <!-- 节点详情 -->
        <template v-else>
            <Tabs v-model="activeTab" class="w-full">
                <TabsList class="grid w-full grid-cols-4">
                    <TabsTrigger value="basic">基本信息</TabsTrigger>
                    <TabsTrigger value="prompts">提示词</TabsTrigger>
                    <TabsTrigger value="tools">工具</TabsTrigger>
                    <TabsTrigger value="skills">Skills</TabsTrigger>
                </TabsList>

                <!-- 基本信息 Tab -->
                <TabsContent value="basic" class="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>基本信息</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div class="space-y-1">
                                    <Label class="text-muted-foreground">节点名称</Label>
                                    <p class="font-mono">{{ node.name }}</p>
                                </div>
                                <div class="space-y-1">
                                    <Label class="text-muted-foreground">节点标题</Label>
                                    <p>{{ node.title || '-' }}</p>
                                </div>
                                <div class="space-y-1">
                                    <Label class="text-muted-foreground">节点类型</Label>
                                    <Badge :variant="NodeTypeVariants[node.type as keyof typeof NodeTypeVariants] || 'default'">
                                        {{ NodeTypeLabels[node.type as keyof typeof NodeTypeLabels] || node.type }}
                                    </Badge>
                                </div>
                                <div class="space-y-1">
                                    <Label class="text-muted-foreground">状态</Label>
                                    <Badge :variant="node.status === 1 ? 'default' : 'secondary'">
                                        {{ node.status === 1 ? '启用' : '禁用' }}
                                    </Badge>
                                </div>
                                <div class="space-y-1">
                                    <Label class="text-muted-foreground">优先级</Label>
                                    <p>{{ node.priority }}</p>
                                </div>
                                <div class="space-y-1">
                                    <Label class="text-muted-foreground">节点分组</Label>
                                    <p>{{ node.group?.name || '无分组' }}</p>
                                </div>
                                <div class="space-y-1">
                                    <Label class="text-muted-foreground">关联模型</Label>
                                    <p>{{ node.model?.displayName || '-' }}</p>
                                </div>
                                <div class="space-y-1">
                                    <Label class="text-muted-foreground">创建时间</Label>
                                    <p>{{ formatDate(node.createdAt) }}</p>
                                </div>
                                <div class="col-span-full space-y-1">
                                    <Label class="text-muted-foreground">节点描述</Label>
                                    <p>{{ node.description || '暂无描述' }}</p>
                                </div>
                                <!-- outputSchema 展示 -->
                                <div v-if="node.outputSchema" class="col-span-full space-y-1">
                                    <Label class="text-muted-foreground">结构化输出 Schema</Label>
                                    <div class="bg-muted rounded-md p-4 overflow-auto max-h-96">
                                        <pre class="text-sm font-mono whitespace-pre-wrap">{{ formatOutputSchema(node.outputSchema) }}</pre>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <!-- 提示词 Tab：列表 + 完整 prompt 预览 -->
                <TabsContent value="prompts" class="space-y-6">
                    <!-- 提示词列表卡片（按 type 分组只读展示） -->
                    <Card>
                        <CardHeader>
                            <CardTitle>关联提示词</CardTitle>
                            <CardDescription>该节点关联的提示词配置（按装配位置分组展示，只读；如需调整请回到节点列表点编辑）</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div v-if="!node.prompts?.length"
                                class="flex flex-col items-center justify-center py-8 text-center">
                                <FileText class="h-10 w-10 text-muted-foreground/50 mb-3" />
                                <p class="text-muted-foreground text-sm">暂无关联提示词</p>
                            </div>
                            <div v-else class="rounded-md border overflow-hidden bg-card">
                                <template v-for="group in visiblePromptGroups" :key="group.type">
                                    <!-- 分组标题 -->
                                    <div
                                        class="flex flex-wrap items-center gap-x-2 gap-y-1 bg-muted/80 px-3 py-1.5 border-b text-xs"
                                    >
                                        <span class="font-semibold text-foreground">{{ group.label }}</span>
                                        <span class="text-muted-foreground">· {{ group.items.length }} 段</span>
                                        <span class="text-primary bg-primary/10 px-1.5 py-0.5 rounded text-[10px]">
                                            {{ group.position }}
                                        </span>
                                    </div>
                                    <!-- 行（只读，无拖拽 / 编辑 / 移除按钮） -->
                                    <div class="divide-y">
                                        <div
                                            v-for="p in group.items"
                                            :key="p.id"
                                            class="flex items-center gap-3 p-3"
                                        >
                                            <span class="w-12 shrink-0 text-center font-mono text-xs text-muted-foreground">
                                                {{ p.displayOrder }}
                                            </span>
                                            <div class="flex-1 min-w-0">
                                                <div class="font-medium text-sm truncate">{{ p.title || p.name }}</div>
                                                <div class="text-xs text-muted-foreground font-mono truncate">
                                                    {{ p.name }} · {{ p.version }} · 被 {{ p.referencedByCount }} 个节点引用
                                                </div>
                                            </div>
                                            <Badge variant="outline" class="shrink-0">
                                                {{ getPromptTypeLabel(p.type) }}
                                            </Badge>
                                            <Badge :variant="p.status === 1 ? 'default' : 'secondary'" class="shrink-0">
                                                {{ p.status === 1 ? '生效' : '未生效' }}
                                            </Badge>
                                        </div>
                                    </div>
                                </template>
                            </div>
                        </CardContent>
                    </Card>

                    <!-- 完整 prompt 预览卡片（4 类分组动态展示） -->
                    <Card>
                        <CardHeader>
                            <CardTitle>完整 prompt 预览</CardTitle>
                            <CardDescription>
                                按提示词类型分组展示装配效果。模板变量（如 <code v-pre class="text-xs">{{xxx}}</code>）用占位值预览。
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div v-if="promptPreviewStatus === 'pending'" class="flex justify-center py-8">
                                <Loader2 class="h-6 w-6 animate-spin text-muted-foreground" />
                            </div>
                            <div v-else-if="promptPreviewError" class="flex flex-col items-center justify-center py-8 text-center">
                                <AlertCircle class="h-8 w-8 text-muted-foreground/50 mb-2" />
                                <p class="text-muted-foreground text-sm">加载预览失败</p>
                            </div>
                            <div v-else-if="!hasAnyPromptPreview" class="flex flex-col items-center justify-center py-8 text-center">
                                <FileText class="h-8 w-8 text-muted-foreground/50 mb-2" />
                                <p class="text-muted-foreground text-sm">暂无可预览的提示词</p>
                            </div>
                            <div v-else class="space-y-6">
                                <!-- 系统提示词段 -->
                                <div v-if="promptPreview?.system" class="space-y-2">
                                    <h3 class="text-sm font-semibold">系统提示词</h3>
                                    <p class="text-xs text-muted-foreground">
                                        → 装配到 system message · {{ promptPreview.system.count }} 段拼接
                                    </p>
                                    <div class="bg-muted rounded p-4 text-sm">
                                        <Markdown :content="promptPreview.system.content" mode="static" />
                                    </div>
                                </div>

                                <!-- 每轮隐藏注入段 -->
                                <div v-if="promptPreview?.userInjection" class="space-y-2">
                                    <h3 class="text-sm font-semibold">每轮隐藏注入</h3>
                                    <p class="text-xs text-muted-foreground">
                                        → 每轮紧贴最新用户消息前以 user 角色注入 · {{ promptPreview.userInjection.count }} 段拼接
                                    </p>
                                    <div class="bg-muted rounded p-4 text-sm">
                                        <Markdown :content="promptPreview.userInjection.content" mode="static" />
                                    </div>
                                </div>

                                <!-- 用户触发消息段（列表） -->
                                <div v-if="promptPreview?.userItems?.length" class="space-y-2">
                                    <h3 class="text-sm font-semibold">用户触发消息</h3>
                                    <p class="text-xs text-muted-foreground">
                                        → UI 触发时模拟用户发送 · {{ promptPreview.userItems.length }} 条
                                    </p>
                                    <div class="space-y-3">
                                        <div
                                            v-for="item in promptPreview.userItems"
                                            :key="item.name"
                                            class="space-y-1"
                                        >
                                            <div class="font-mono text-xs text-muted-foreground">
                                                {{ item.title || item.name }}
                                            </div>
                                            <div class="bg-muted rounded p-3 text-sm">
                                                <Markdown :content="item.content" mode="static" />
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <!-- 预设助手消息段（列表，罕用） -->
                                <div v-if="promptPreview?.assistantItems?.length" class="space-y-2">
                                    <h3 class="text-sm font-semibold">预设助手消息</h3>
                                    <p class="text-xs text-muted-foreground">
                                        → 罕用，预设 AI 回复 · {{ promptPreview.assistantItems.length }} 条
                                    </p>
                                    <div class="space-y-3">
                                        <div
                                            v-for="item in promptPreview.assistantItems"
                                            :key="item.name"
                                            class="space-y-1"
                                        >
                                            <div class="font-mono text-xs text-muted-foreground">
                                                {{ item.title || item.name }}
                                            </div>
                                            <div class="bg-muted rounded p-3 text-sm">
                                                <Markdown :content="item.content" mode="static" />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <!-- 工具 Tab -->
                <TabsContent value="tools" class="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>工具列表</CardTitle>
                            <CardDescription>该节点可调用的工具</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div v-if="toolDetails.length" class="rounded-md border divide-y bg-card">
                                <div
                                    v-for="tool in toolDetails"
                                    :key="tool.name"
                                    class="flex items-start gap-3 p-3"
                                >
                                    <Wrench class="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                                    <div class="flex-1 min-w-0">
                                        <div class="font-mono text-sm truncate">{{ tool.name }}</div>
                                        <div
                                            class="text-xs text-muted-foreground line-clamp-2"
                                            :title="tool.description ?? ''"
                                        >
                                            {{ tool.description || '该工具已从注册表移除或暂无描述' }}
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div v-else class="flex flex-col items-center justify-center py-8 text-center">
                                <Wrench class="h-10 w-10 text-muted-foreground/50 mb-3" />
                                <p class="text-muted-foreground text-sm">暂无配置工具</p>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <!-- Skills Tab -->
                <TabsContent value="skills" class="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>关联 Skills</CardTitle>
                            <CardDescription>该节点挂载的 Skills（按 priority 升序，只读；如需调整请回到节点列表点编辑）</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div
                                v-if="!nodeSkills.length"
                                class="flex flex-col items-center justify-center py-8 text-center"
                            >
                                <Sparkles class="h-10 w-10 text-muted-foreground/50 mb-3" />
                                <p class="text-muted-foreground text-sm">该节点未关联 Skills</p>
                            </div>
                            <div v-else class="rounded-md border divide-y bg-card">
                                <div
                                    v-for="skill in nodeSkills"
                                    :key="skill.name"
                                    class="flex items-start gap-3 p-3"
                                >
                                    <span class="w-12 shrink-0 text-center font-mono text-xs text-muted-foreground pt-0.5">
                                        {{ skill.priority }}
                                    </span>
                                    <div class="flex-1 min-w-0">
                                        <div class="font-medium text-sm truncate">
                                            {{ skill.customTitle || skill.title || skill.name }}
                                        </div>
                                        <div class="text-xs text-muted-foreground font-mono truncate">{{ skill.name }}</div>
                                        <div
                                            v-if="skill.description"
                                            class="text-xs text-muted-foreground mt-1 line-clamp-2"
                                            :title="skill.description"
                                        >
                                            {{ skill.description }}
                                        </div>
                                    </div>
                                    <Badge :variant="skill.status === 1 ? 'default' : 'secondary'" class="shrink-0">
                                        {{ skill.status === 1 ? '生效' : '停用' }}
                                    </Badge>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </template>
    </div>

    <!-- 编辑对话框 -->
    <AdminNodesNodeFormDialog ref="formDialogRef" @success="onEditSaved" />

    <!-- 删除确认对话框 -->
    <AlertDialog v-model:open="deleteDialogOpen">
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle>确认删除</AlertDialogTitle>
                <AlertDialogDescription>
                    确定要删除节点「{{ node?.title || node?.name }}」吗？此操作不可撤销。
                </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction @click="confirmDelete" :disabled="deleting">
                    <Loader2 v-if="deleting" class="h-4 w-4 mr-2 animate-spin" />
                    确认删除
                </AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
    </AlertDialog>
</template>

<script setup lang="ts">
import { ArrowLeft, Loader2, AlertCircle, Pencil, Power, Trash2, FileText, Sparkles, Wrench } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import dayjs from 'dayjs'
import { Markdown } from 'vue-stream-markdown'
import 'vue-stream-markdown/index.css'
import { NodeTypeLabels, NodeTypeVariants } from '#shared/types/node'
import type { NodePromptRef, NodePromptsPreview, NodeSkillRef, NodeToolDetailRef, NodeWithRelations, PromptType } from '#shared/types/node'
import AdminNodesNodeFormDialog from '~/components/admin/nodes/NodeFormDialog.vue'
import { useApi } from '~/composables/useApi'
import { useApiFetch } from '~/composables/useApiFetch'

definePageMeta({ layout: 'admin-layout', title: '节点详情' })

const route = useRoute()
const router = useRouter()
const nodeId = computed(() => Number(route.params.id))

// 组件引用
const formDialogRef = ref<InstanceType<typeof import('~/components/admin/nodes/NodeFormDialog.vue').default> | null>(null)

// 状态
const loading = ref(false)
const deleting = ref(false)
const node = ref<NodeWithRelations | null>(null)
const deleteDialogOpen = ref(false)

// Tab 状态：与 NodeFormDialog 内部 TabKey 子集对应（不含弹框独有的 'schema'）
// 通过 URL ?tab=xxx 持久化，刷新 / 浏览器前进后退都能保持当前 Tab。
type DetailTab = 'basic' | 'prompts' | 'tools' | 'skills'
const VALID_TABS: readonly DetailTab[] = ['basic', 'prompts', 'tools', 'skills']
function parseTab(raw: unknown): DetailTab {
    return VALID_TABS.includes(raw as DetailTab) ? (raw as DetailTab) : 'basic'
}
const activeTab = ref<DetailTab>(parseTab(route.query.tab))

// 切换 Tab 时同步到 URL（replace 当前 history，不堆栈历史）
watch(activeTab, (newTab) => {
    if (route.query.tab === newTab) return
    router.replace({ query: { ...route.query, tab: newTab } })
})

// 监听 URL 变化（如浏览器后退 / 用户手动改 query）反向同步 activeTab
watch(() => route.query.tab, (newTab) => {
    const parsed = parseTab(newTab)
    if (parsed !== activeTab.value) activeTab.value = parsed
})

/**
 * 工具列表（带描述）
 *
 * 节点详情接口返回 `toolDetails: NodeToolDetailRef[]`，但 `NodeWithRelations` 类型还停留在
 * 旧形态（只有 `tools: JsonValue`）；这里做一次窄化以便模板访问 `name` / `description`。
 *
 * 历史节点（已下线工具）若注册表里查不到，description 为 null，模板降级展示提示文字。
 */
const toolDetails = computed<NodeToolDetailRef[]>(() => {
    const list = (node.value as unknown as { toolDetails?: NodeToolDetailRef[] } | null)?.toolDetails
    return Array.isArray(list) ? list : []
})

/**
 * 关联 Skills 列表（按 priority 升序）
 *
 * 节点详情接口返回 `skills: NodeSkillRef[]`；`NodeWithRelations` 类型未含该字段，做一次窄化。
 */
const nodeSkills = computed<NodeSkillRef[]>(() => {
    const list = (node.value as unknown as { skills?: NodeSkillRef[] } | null)?.skills
    return Array.isArray(list) ? list : []
})

// 格式化日期
const formatDate = (date: string | Date | null | undefined) => {
    if (!date) return '-'
    return dayjs(date).format('YYYY-MM-DD HH:mm')
}

// 格式化 outputSchema
const formatOutputSchema = (schema: unknown) => {
    try {
        return JSON.stringify(schema, null, 2)
    } catch {
        return String(schema)
    }
}

// 提示词类型行内 Badge 短标签（与节点弹框 NodePromptManager 对齐）
const getPromptTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
        system: '系统',
        user: '用户',
        user_injection: '每轮注入',
        assistant: '助手',
    }
    return labels[type] || type
}

/**
 * 提示词分组定义（顺序与节点弹框一致：system → user_injection → user → assistant）。
 * 详情页只读展示，不允许拖拽 / 编辑 / 移除。
 */
const PROMPT_TYPE_GROUPS: Array<{
    type: PromptType
    label: string
    position: string
}> = [
    { type: 'system', label: '系统提示词', position: '→ 装配到 system message' },
    { type: 'user_injection', label: '每轮隐藏注入', position: '→ 每轮紧贴最新用户消息前注入' },
    { type: 'user', label: '用户触发消息', position: '→ UI 触发时模拟用户发送' },
    { type: 'assistant', label: '预设助手消息', position: '→ 罕用，预设 AI 回复' },
]

/**
 * 节点详情接口实际返回 `NodePromptRef[]`（带 displayOrder + referencedByCount），
 * 但 NodeWithRelations.prompts 类型仍保留旧的 Prompt[] 形态，这里做一次窄化以便在
 * 模板里访问 displayOrder / referencedByCount。
 */
const visiblePromptGroups = computed(() => {
    const list = (node.value?.prompts ?? []) as unknown as NodePromptRef[]
    return PROMPT_TYPE_GROUPS
        .map((g) => {
            const items = list
                .filter(p => p.type === g.type)
                .slice()
                .sort((a, b) => a.displayOrder - b.displayOrder)
            return { ...g, items }
        })
        .filter(g => g.items.length > 0)
})

// 完整 prompt 预览（4 类分组，按节点 ID 自动加载，节点切换时自动刷新）
// 详情页是只读视图，拉的是后端已保存版本（与编辑弹框 staged 预览不同）。
const previewUrl = computed(() => `/api/v1/admin/nodes/${nodeId.value}/prompts/preview`)
const {
    data: promptPreview,
    error: promptPreviewError,
    status: promptPreviewStatus,
    refresh: refreshPromptPreview,
} = await useApi<NodePromptsPreview>(previewUrl, {
    showError: false,
    watch: [nodeId],
})

/** 4 段任意一类有内容即视为有可预览数据；4 类都为 null/空数组 → 显示空态 */
const hasAnyPromptPreview = computed(() => {
    const p = promptPreview.value
    if (!p) return false
    return Boolean(p.system || p.userInjection || p.userItems?.length || p.assistantItems?.length)
})

// 加载节点详情
const loadNode = async () => {
    loading.value = true
    try {
        const data = await useApiFetch<NodeWithRelations>(`/api/v1/admin/nodes/${nodeId.value}`)
        if (data) {
            node.value = data
        }
    } finally {
        loading.value = false
    }
}

/**
 * 编辑弹框保存成功：除了刷新节点详情数据，还要刷新预览数据
 * （详情数据 refresh 不会自动联动 useApi 的 preview，因此这里显式 refresh）。
 */
const onEditSaved = async () => {
    await Promise.all([loadNode(), refreshPromptPreview()])
}

// 切换状态
const handleToggleStatus = async () => {
    if (!node.value) return
    const newStatus = node.value.status === 1 ? 0 : 1
    const result = await useApiFetch(`/api/v1/admin/nodes/${node.value.id}`, {
        method: 'PUT',
        body: { status: newStatus }
    })
    if (result !== null) {
        toast.success(newStatus === 1 ? '已启用' : '已禁用')
        loadNode()
    }
}

// 删除节点
const confirmDelete = async () => {
    if (!node.value) return
    deleting.value = true
    try {
        const result = await useApiFetch(`/api/v1/admin/nodes/${node.value.id}`, { method: 'DELETE' })
        if (result !== null) {
            toast.success('删除成功')
            navigateTo('/admin/nodes')
        }
    } finally {
        deleting.value = false
    }
}

onMounted(() => {
    loadNode()
})
</script>
