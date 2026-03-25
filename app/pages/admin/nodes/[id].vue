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
            <!-- 基本信息卡片 -->
            <Card>
                <CardHeader>
                    <div class="flex items-center justify-between">
                        <CardTitle>基本信息</CardTitle>
                        <Button variant="outline" size="sm" @click="formDialogRef?.openEdit(node)">
                            <Pencil class="h-4 w-4 mr-2" />
                            编辑
                        </Button>
                    </div>
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
                        <div class="col-span-full space-y-1">
                            <Label class="text-muted-foreground">工具列表</Label>
                            <div v-if="nodeTools.length" class="flex flex-wrap gap-2">
                                <Badge v-for="(tool, index) in nodeTools" :key="index" variant="outline">
                                    {{ tool }}
                                </Badge>
                            </div>
                            <p v-else class="text-muted-foreground">暂无配置工具</p>
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

            <!-- 提示词列表卡片 -->
            <Card>
                <CardHeader>
                    <div class="flex items-center justify-between">
                        <CardTitle>关联提示词</CardTitle>
                        <Button variant="outline" size="sm" @click="navigateTo('/admin/prompts')">
                            <Settings class="h-4 w-4 mr-2" />
                            管理提示词
                        </Button>
                    </div>
                    <CardDescription>该节点关联的提示词配置</CardDescription>
                </CardHeader>
                <CardContent>
                    <div v-if="!node.prompts?.length"
                        class="flex flex-col items-center justify-center py-8 text-center">
                        <FileText class="h-10 w-10 text-muted-foreground/50 mb-3" />
                        <p class="text-muted-foreground text-sm">暂无关联提示词</p>
                    </div>
                    <div v-else class="rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>名称</TableHead>
                                    <TableHead>类型</TableHead>
                                    <TableHead>版本</TableHead>
                                    <TableHead>状态</TableHead>
                                    <TableHead>更新时间</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                <TableRow v-for="prompt in node.prompts" :key="prompt.id">
                                    <TableCell>{{ prompt.title || prompt.name }}</TableCell>
                                    <TableCell>
                                        <Badge variant="outline">{{ getPromptTypeLabel(prompt.type) }}</Badge>
                                    </TableCell>
                                    <TableCell class="font-mono text-sm">{{ prompt.version }}</TableCell>
                                    <TableCell>
                                        <Badge :variant="prompt.status === 1 ? 'default' : 'secondary'">
                                            {{ prompt.status === 1 ? '生效' : '未生效' }}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>{{ formatDate(prompt.updatedAt) }}</TableCell>
                                </TableRow>
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>
        </template>
    </div>

    <!-- 编辑对话框 -->
    <AdminNodesNodeFormDialog ref="formDialogRef" @success="loadNode" />

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
import { ArrowLeft, Loader2, AlertCircle, Pencil, Power, Trash2, Settings, FileText } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import dayjs from 'dayjs'
import { NodeTypeLabels, NodeTypeVariants } from '#shared/types/node'
import type { NodeWithRelations } from '#shared/types/node'

definePageMeta({ layout: 'admin-layout', title: '节点详情' })

const route = useRoute()
const nodeId = computed(() => Number(route.params.id))

// 组件引用
const formDialogRef = ref<InstanceType<typeof import('~/components/admin/nodes/NodeFormDialog.vue').default> | null>(null)

// 状态
const loading = ref(false)
const deleting = ref(false)
const node = ref<NodeWithRelations | null>(null)
const deleteDialogOpen = ref(false)

// 计算属性：工具列表（处理 JSON 类型）
const nodeTools = computed(() => {
    if (!node.value?.tools || !Array.isArray(node.value.tools)) return []
    return node.value.tools.filter((t): t is string => typeof t === 'string')
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

// 提示词类型标签
const getPromptTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
        system: '系统提示词',
        user: '用户提示词',
        assistant: '助手提示词',
    }
    return labels[type] || type
}

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
