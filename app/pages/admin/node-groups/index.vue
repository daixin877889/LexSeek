<template>
    <NuxtLayout name="admin-layout">
        <div class="space-y-6">
            <!-- 页面标题 -->
            <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                    <h1 class="text-2xl md:text-3xl font-bold mb-1">节点分组管理</h1>
                    <p class="text-muted-foreground text-sm">管理工作流节点的分组配置</p>
                </div>
                <Button @click="formDialogRef?.openCreate()">
                    <Plus class="h-4 w-4 mr-2" />
                    新增分组
                </Button>
            </div>

            <!-- 筛选 -->
            <div class="flex flex-col md:flex-row gap-4">
                <div class="flex-1">
                    <Input v-model="keyword" placeholder="搜索分组名称..." class="w-full md:w-64"
                        @keyup.enter="handleSearch" />
                </div>
                <Button variant="outline" @click="handleSearch">
                    <Search class="h-4 w-4 mr-2" />
                    搜索
                </Button>
            </div>

            <!-- 加载状态 -->
            <div v-if="loading" class="flex justify-center py-12">
                <Loader2 class="h-10 w-10 animate-spin text-muted-foreground" />
            </div>

            <!-- 空状态 -->
            <div v-else-if="!groups.length" class="flex flex-col items-center justify-center py-12 text-center">
                <FolderTree class="h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 class="text-lg font-medium mb-1">暂无分组</h3>
                <p class="text-muted-foreground text-sm">点击上方按钮新增分组</p>
            </div>

            <!-- 分组列表 -->
            <template v-else>
                <div class="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead class="w-[60px]">ID</TableHead>
                                <TableHead>分组名称</TableHead>
                                <TableHead>描述</TableHead>
                                <TableHead class="w-[100px]">节点数量</TableHead>
                                <TableHead class="w-[80px]">优先级</TableHead>
                                <TableHead class="w-[160px]">创建时间</TableHead>
                                <TableHead class="w-[100px] text-right">操作</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            <TableRow v-for="group in groups" :key="group.id">
                                <TableCell class="font-medium">{{ group.id }}</TableCell>
                                <TableCell class="font-medium">{{ group.name }}</TableCell>
                                <TableCell class="text-muted-foreground">
                                    {{ group.description || '-' }}
                                </TableCell>
                                <TableCell>
                                    <Badge variant="secondary">
                                        {{ group._count?.nodes ?? 0 }} 个节点
                                    </Badge>
                                </TableCell>
                                <TableCell>{{ group.priority }}</TableCell>
                                <TableCell class="text-muted-foreground">
                                    {{ formatDate(group.createdAt) }}
                                </TableCell>
                                <TableCell class="text-right">
                                    <DropdownMenu>
                                        <DropdownMenuTrigger as-child>
                                            <Button variant="ghost" size="icon">
                                                <MoreHorizontal class="h-4 w-4" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            <DropdownMenuItem @click="formDialogRef?.openEdit(group)">
                                                <Pencil class="h-4 w-4 mr-2" />
                                                编辑
                                            </DropdownMenuItem>
                                            <DropdownMenuItem @click="viewNodes(group)">
                                                <Eye class="h-4 w-4 mr-2" />
                                                查看节点
                                            </DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem class="text-destructive" @click="handleDelete(group)"
                                                :disabled="(group._count?.nodes ?? 0) > 0">
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
        <AdminNodeGroupsNodeGroupFormDialog ref="formDialogRef" @success="loadGroups" />

        <!-- 删除确认对话框 -->
        <AlertDialog v-model:open="deleteDialogOpen">
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>确认删除</AlertDialogTitle>
                    <AlertDialogDescription>
                        确定要删除分组「{{ selectedGroup?.name }}」吗？此操作不可撤销。
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
    </NuxtLayout>
</template>

<script setup lang="ts">
import { Plus, Loader2, FolderTree, Search, MoreHorizontal, Pencil, Trash2, Eye } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import dayjs from 'dayjs'
import type { NodeGroupWithCount } from '#shared/types/node'

definePageMeta({ layout: false, title: '节点分组' })

// 组件引用
const formDialogRef = ref<InstanceType<typeof import('~/components/admin/node-groups/NodeGroupFormDialog.vue').default> | null>(null)

// 状态
const loading = ref(false)
const deleting = ref(false)
const groups = ref<NodeGroupWithCount[]>([])
const pagination = ref({ page: 1, pageSize: 20, total: 0 })
const keyword = ref('')

// 删除对话框状态
const deleteDialogOpen = ref(false)
const selectedGroup = ref<NodeGroupWithCount | null>(null)

// 格式化日期
const formatDate = (date: Date | string) => {
    return dayjs(date).format('YYYY-MM-DD HH:mm')
}

// 加载分组列表
const loadGroups = async () => {
    loading.value = true
    try {
        const params: Record<string, any> = {
            page: pagination.value.page,
            pageSize: pagination.value.pageSize,
        }
        if (keyword.value) params.keyword = keyword.value

        const data = await useApiFetch<{ items: NodeGroupWithCount[]; total: number }>('/api/v1/admin/node-groups', { query: params })
        if (data) {
            groups.value = data.items
            pagination.value.total = data.total
        }
    } finally {
        loading.value = false
    }
}

// 搜索
const handleSearch = () => {
    pagination.value.page = 1
    loadGroups()
}

// 翻页
const changePage = (page: number) => {
    pagination.value.page = page
    loadGroups()
}

// 查看分组下的节点
const viewNodes = (group: NodeGroupWithCount) => {
    navigateTo(`/admin/nodes?groupId=${group.id}`)
}

// 删除分组
const handleDelete = (group: NodeGroupWithCount) => {
    if ((group._count?.nodes ?? 0) > 0) {
        toast.error('该分组下存在节点，无法删除')
        return
    }
    selectedGroup.value = group
    deleteDialogOpen.value = true
}

const confirmDelete = async () => {
    if (!selectedGroup.value) return
    deleting.value = true
    try {
        const result = await useApiFetch(`/api/v1/admin/node-groups/${selectedGroup.value.id}`, { method: 'DELETE' })
        if (result !== null) {
            toast.success('删除成功')
            deleteDialogOpen.value = false
            loadGroups()
        }
    } finally {
        deleting.value = false
    }
}

onMounted(() => {
    loadGroups()
})
</script>
