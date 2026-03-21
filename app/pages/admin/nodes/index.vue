<template>
        <div class="space-y-6">
            <!-- 页面标题 -->
            <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                    <h1 class="text-2xl md:text-3xl font-bold mb-1">节点管理</h1>
                    <p class="text-muted-foreground text-sm">管理工作流分析节点配置</p>
                </div>
                <Button @click="formDialogRef?.openCreate()">
                    <Plus class="h-4 w-4 mr-2" />
                    新增节点
                </Button>
            </div>

            <!-- 筛选 -->
            <div class="flex flex-col md:flex-row gap-4">
                <Select v-model="groupFilter">
                    <SelectTrigger class="w-full md:w-48">
                        <SelectValue placeholder="选择分组" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">全部分组</SelectItem>
                        <SelectItem v-for="g in groups" :key="g.id" :value="String(g.id)">
                            {{ g.name }}
                        </SelectItem>
                    </SelectContent>
                </Select>
                <Select v-model="typeFilter">
                    <SelectTrigger class="w-full md:w-40">
                        <SelectValue placeholder="节点类型" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">全部类型</SelectItem>
                        <SelectItem value="analysis">分析模块</SelectItem>
                        <SelectItem value="document">文书模块</SelectItem>
                        <SelectItem value="extraction">数据提取</SelectItem>
                    </SelectContent>
                </Select>
                <Select v-model="statusFilter">
                    <SelectTrigger class="w-full md:w-32">
                        <SelectValue placeholder="状态" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">全部状态</SelectItem>
                        <SelectItem value="1">启用</SelectItem>
                        <SelectItem value="0">禁用</SelectItem>
                    </SelectContent>
                </Select>
                <div class="flex-1">
                    <Input v-model="keyword" placeholder="搜索节点名称/标题..." class="w-full md:w-64"
                        @keyup.enter="handleSearch" />
                </div>
                <Button variant="outline" @click="handleSearch">
                    <Search class="h-4 w-4 mr-2" />
                    筛选
                </Button>
            </div>

            <!-- 加载状态 -->
            <div v-if="loading" class="flex justify-center py-12">
                <Loader2 class="h-10 w-10 animate-spin text-muted-foreground" />
            </div>

            <!-- 空状态 -->
            <div v-else-if="!nodes.length" class="flex flex-col items-center justify-center py-12 text-center">
                <Workflow class="h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 class="text-lg font-medium mb-1">暂无节点</h3>
                <p class="text-muted-foreground text-sm">点击上方按钮新增节点</p>
            </div>

            <!-- 节点列表 -->
            <template v-else>
                <div class="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead class="w-[60px]">ID</TableHead>
                                <TableHead>节点名称</TableHead>
                                <TableHead>标题</TableHead>
                                <TableHead>分组</TableHead>
                                <TableHead class="w-[100px]">类型</TableHead>
                                <TableHead class="w-[80px]">优先级</TableHead>
                                <TableHead>关联模型</TableHead>
                                <TableHead class="w-[80px]">状态</TableHead>
                                <TableHead class="w-[100px] text-right">操作</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            <TableRow v-for="node in nodes" :key="node.id">
                                <TableCell class="font-medium">{{ node.id }}</TableCell>
                                <TableCell class="font-mono text-sm">{{ node.name }}</TableCell>
                                <TableCell>{{ node.title || '-' }}</TableCell>
                                <TableCell>{{ node.group?.name || '-' }}</TableCell>
                                <TableCell>
                                    <Badge :variant="getTypeVariant(node.type)">
                                        {{ getTypeLabel(node.type) }}
                                    </Badge>
                                </TableCell>
                                <TableCell>{{ node.priority }}</TableCell>
                                <TableCell>{{ node.model?.displayName || '-' }}</TableCell>
                                <TableCell>
                                    <Badge :variant="node.status === 1 ? 'default' : 'secondary'">
                                        {{ node.status === 1 ? '启用' : '禁用' }}
                                    </Badge>
                                </TableCell>
                                <TableCell class="text-right">
                                    <DropdownMenu>
                                        <DropdownMenuTrigger as-child>
                                            <Button variant="ghost" size="icon">
                                                <MoreHorizontal class="h-4 w-4" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            <DropdownMenuItem @click="navigateTo(`/admin/nodes/${node.id}`)">
                                                <Eye class="h-4 w-4 mr-2" />
                                                查看详情
                                            </DropdownMenuItem>
                                            <DropdownMenuItem @click="formDialogRef?.openEdit(node)">
                                                <Pencil class="h-4 w-4 mr-2" />
                                                编辑
                                            </DropdownMenuItem>
                                            <DropdownMenuItem @click="handleToggleStatus(node)">
                                                <Power class="h-4 w-4 mr-2" />
                                                {{ node.status === 1 ? '禁用' : '启用' }}
                                            </DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem class="text-destructive" @click="handleDelete(node)">
                                                <Trash2 class="h-4 w-4 mr-2" />
                                                删除
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </TableCell>
                            </TableRow>
                        </TableBody>
                    </Table>
                </div>

                <!-- 分页 -->
                <GeneralPagination :current-page="pagination.page" :page-size="pagination.pageSize"
                    :total="pagination.total" @change="changePage" />
            </template>
        </div>

        <!-- 创建/编辑对话框 -->
        <AdminNodesNodeFormDialog ref="formDialogRef" :groups="groups" :models="models" @success="loadNodes" />

        <!-- 删除确认对话框 -->
        <AlertDialog v-model:open="deleteDialogOpen">
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>确认删除</AlertDialogTitle>
                    <AlertDialogDescription>
                        确定要删除节点「{{ selectedNode?.title || selectedNode?.name }}」吗？此操作不可撤销。
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
import { Plus, Loader2, Workflow, Search, MoreHorizontal, Pencil, Trash2, Eye, Power } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { NodeWithRelations, NodeGroup } from '#shared/types/node'
import type { Model } from '#shared/types/model'

definePageMeta({ layout: 'admin-layout', title: '节点管理' })

// 组件引用
const formDialogRef = ref<InstanceType<typeof import('~/components/admin/nodes/NodeFormDialog.vue').default> | null>(null)

// 状态
const loading = ref(false)
const deleting = ref(false)
const nodes = ref<NodeWithRelations[]>([])
const groups = ref<NodeGroup[]>([])
const models = ref<Model[]>([])
const pagination = ref({ page: 1, pageSize: 20, total: 0 })
const groupFilter = ref('all')
const typeFilter = ref('all')
const statusFilter = ref('all')
const keyword = ref('')

// 删除对话框状态
const deleteDialogOpen = ref(false)
const selectedNode = ref<NodeWithRelations | null>(null)

// 节点类型标签
const getTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
        analysis: '分析模块',
        document: '文书模块',
        extraction: '数据提取',
    }
    return labels[type] || type
}

// 节点类型样式
const getTypeVariant = (type: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'outline'> = {
        analysis: 'default',
        document: 'secondary',
        extraction: 'outline',
    }
    return variants[type] || 'default'
}

// 加载分组列表
const loadGroups = async () => {
    const data = await useApiFetch<{ items: NodeGroup[] }>('/api/v1/admin/node-groups', {
        query: { all: true }
    })
    if (data) groups.value = data.items
}

// 加载模型列表
const loadModels = async () => {
    const data = await useApiFetch<{ items: Model[] }>('/api/v1/admin/models', {
        query: { pageSize: 100, status: 1 }
    })
    if (data) models.value = data.items
}

// 加载节点列表
const loadNodes = async () => {
    loading.value = true
    try {
        const params: Record<string, any> = {
            page: pagination.value.page,
            pageSize: pagination.value.pageSize,
        }
        if (groupFilter.value !== 'all') params.groupId = parseInt(groupFilter.value)
        if (typeFilter.value !== 'all') params.type = typeFilter.value
        if (statusFilter.value !== 'all') params.status = parseInt(statusFilter.value)
        if (keyword.value) params.keyword = keyword.value

        const data = await useApiFetch<{ items: NodeWithRelations[]; total: number }>('/api/v1/admin/nodes', { query: params })
        if (data) {
            nodes.value = data.items
            pagination.value.total = data.total
        }
    } finally {
        loading.value = false
    }
}

// 筛选
const handleSearch = () => {
    pagination.value.page = 1
    loadNodes()
}

// 翻页
const changePage = (page: number) => {
    pagination.value.page = page
    loadNodes()
}

// 切换状态
const handleToggleStatus = async (node: NodeWithRelations) => {
    const newStatus = node.status === 1 ? 0 : 1
    const result = await useApiFetch(`/api/v1/admin/nodes/${node.id}`, {
        method: 'PUT',
        body: { status: newStatus }
    })
    if (result !== null) {
        toast.success(newStatus === 1 ? '已启用' : '已禁用')
        loadNodes()
    }
}

// 删除节点
const handleDelete = (node: NodeWithRelations) => {
    selectedNode.value = node
    deleteDialogOpen.value = true
}

const confirmDelete = async () => {
    if (!selectedNode.value) return
    deleting.value = true
    try {
        const result = await useApiFetch(`/api/v1/admin/nodes/${selectedNode.value.id}`, { method: 'DELETE' })
        if (result !== null) {
            toast.success('删除成功')
            deleteDialogOpen.value = false
            loadNodes()
        }
    } finally {
        deleting.value = false
    }
}

// 从 URL 查询参数初始化筛选条件
const route = useRoute()
onMounted(() => {
    // 如果 URL 中有 groupId 参数，设置分组筛选
    if (route.query.groupId) {
        groupFilter.value = String(route.query.groupId)
    }
    loadGroups()
    loadModels()
    loadNodes()
})
</script>
