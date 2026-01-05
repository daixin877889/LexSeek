<template>
    <NuxtLayout name="admin-layout">
        <div class="space-y-6">
            <!-- 页面标题 -->
            <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                    <h1 class="text-2xl md:text-3xl font-bold mb-1">模型提供商</h1>
                    <p class="text-muted-foreground text-sm">管理 AI 模型服务提供商</p>
                </div>
                <Button @click="formDialogRef?.openCreate()">
                    <Plus class="h-4 w-4 mr-2" />
                    新增提供商
                </Button>
            </div>

            <!-- 加载状态 -->
            <div v-if="loading" class="flex justify-center py-12">
                <Loader2 class="h-10 w-10 animate-spin text-muted-foreground" />
            </div>

            <!-- 空状态 -->
            <div v-else-if="!providers.length" class="flex flex-col items-center justify-center py-12 text-center">
                <Server class="h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 class="text-lg font-medium mb-1">暂无提供商</h3>
                <p class="text-muted-foreground text-sm">点击上方按钮新增模型提供商</p>
            </div>

            <!-- 提供商列表 -->
            <template v-else>
                <div class="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead class="w-[80px]">ID</TableHead>
                                <TableHead>名称</TableHead>
                                <TableHead>API 基础 URL</TableHead>
                                <TableHead>描述</TableHead>
                                <TableHead class="w-[100px] text-right">操作</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            <TableRow v-for="provider in providers" :key="provider.id">
                                <TableCell class="font-medium">{{ provider.id }}</TableCell>
                                <TableCell>{{ provider.name }}</TableCell>
                                <TableCell class="max-w-[200px] truncate">{{ provider.baseUrl }}</TableCell>
                                <TableCell class="max-w-[200px] truncate">{{ provider.description || '-' }}</TableCell>
                                <TableCell class="text-right">
                                    <DropdownMenu>
                                        <DropdownMenuTrigger as-child>
                                            <Button variant="ghost" size="icon">
                                                <MoreHorizontal class="h-4 w-4" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            <DropdownMenuItem @click="navigateToDetail(provider)">
                                                <Eye class="h-4 w-4 mr-2" />
                                                查看详情
                                            </DropdownMenuItem>
                                            <DropdownMenuItem @click="formDialogRef?.openEdit(provider)">
                                                <Pencil class="h-4 w-4 mr-2" />
                                                编辑
                                            </DropdownMenuItem>
                                            <DropdownMenuItem class="text-destructive" @click="handleDelete(provider)">
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
        <AdminModelProvidersProviderFormDialog ref="formDialogRef" @success="loadProviders" />

        <!-- 删除确认对话框 -->
        <AlertDialog v-model:open="deleteDialogOpen">
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>确认删除</AlertDialogTitle>
                    <AlertDialogDescription>
                        确定要删除提供商「{{ selectedProvider?.name }}」吗？此操作不可撤销。
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
import { Plus, Loader2, Server, MoreHorizontal, Pencil, Trash2, Eye } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { ModelProvider } from '#shared/types/model'

definePageMeta({ layout: false, title: '模型提供商' })

// 组件引用
const formDialogRef = ref<InstanceType<typeof import('~/components/admin/model-providers/ProviderFormDialog.vue').default> | null>(null)

// 状态
const loading = ref(false)
const deleting = ref(false)
const providers = ref<ModelProvider[]>([])
const pagination = ref({ page: 1, pageSize: 20, total: 0 })

// 删除对话框状态
const deleteDialogOpen = ref(false)
const selectedProvider = ref<ModelProvider | null>(null)

// 加载提供商列表
const loadProviders = async () => {
    loading.value = true
    try {
        const data = await useApiFetch<{ items: ModelProvider[]; total: number }>('/api/v1/admin/model-providers', {
            query: { page: pagination.value.page, pageSize: pagination.value.pageSize }
        })
        if (data) {
            providers.value = data.items
            pagination.value.total = data.total
        }
    } finally {
        loading.value = false
    }
}

// 翻页
const changePage = (page: number) => {
    pagination.value.page = page
    loadProviders()
}

// 导航到详情页
const navigateToDetail = (provider: ModelProvider) => {
    navigateTo(`/admin/model-providers/${provider.id}`)
}

// 删除提供商
const handleDelete = (provider: ModelProvider) => {
    selectedProvider.value = provider
    deleteDialogOpen.value = true
}

const confirmDelete = async () => {
    if (!selectedProvider.value) return
    deleting.value = true
    try {
        const result = await useApiFetch(`/api/v1/admin/model-providers/${selectedProvider.value.id}`, { method: 'DELETE' })
        if (result !== null) {
            toast.success('删除成功')
            deleteDialogOpen.value = false
            loadProviders()
        }
    } finally {
        deleting.value = false
    }
}

onMounted(() => {
    loadProviders()
})
</script>
