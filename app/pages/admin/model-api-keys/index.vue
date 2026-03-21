<template>
        <div class="space-y-6">
            <!-- 页面标题 -->
            <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                    <h1 class="text-2xl md:text-3xl font-bold mb-1">API 密钥管理</h1>
                    <p class="text-muted-foreground text-sm">管理模型提供商的 API 密钥</p>
                </div>
                <Button @click="formDialogRef?.openCreate()">
                    <Plus class="h-4 w-4 mr-2" />
                    新增密钥
                </Button>
            </div>

            <!-- 筛选 -->
            <div class="flex flex-col md:flex-row gap-4">
                <Select v-model="providerFilter">
                    <SelectTrigger class="w-full md:w-48">
                        <SelectValue placeholder="选择提供商" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">全部提供商</SelectItem>
                        <SelectItem v-for="p in providers" :key="p.id" :value="String(p.id)">
                            {{ p.name }}
                        </SelectItem>
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
            <div v-else-if="!apiKeys.length" class="flex flex-col items-center justify-center py-12 text-center">
                <Key class="h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 class="text-lg font-medium mb-1">暂无 API 密钥</h3>
                <p class="text-muted-foreground text-sm">点击上方按钮新增 API 密钥</p>
            </div>

            <!-- 密钥列表 -->
            <template v-else>
                <div class="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead class="w-[60px]">ID</TableHead>
                                <TableHead>名称</TableHead>
                                <TableHead>提供商</TableHead>
                                <TableHead>API 密钥</TableHead>
                                <TableHead class="w-[80px]">默认</TableHead>
                                <TableHead class="w-[80px]">状态</TableHead>
                                <TableHead class="w-[100px] text-right">操作</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            <TableRow v-for="key in apiKeys" :key="key.id">
                                <TableCell class="font-medium">{{ key.id }}</TableCell>
                                <TableCell>{{ key.name }}</TableCell>
                                <TableCell>{{ key.modelProvider?.name || '-' }}</TableCell>
                                <TableCell class="font-mono text-sm">{{ key.apiKey }}</TableCell>
                                <TableCell>
                                    <Badge v-if="key.isDefault" variant="default">默认</Badge>
                                    <span v-else class="text-muted-foreground">-</span>
                                </TableCell>
                                <TableCell>
                                    <Badge :variant="key.status === 1 ? 'default' : 'secondary'">
                                        {{ key.status === 1 ? '启用' : '禁用' }}
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
                                            <DropdownMenuItem v-if="!key.isDefault" @click="handleSetDefault(key)">
                                                <Star class="h-4 w-4 mr-2" />
                                                设为默认
                                            </DropdownMenuItem>
                                            <DropdownMenuItem @click="formDialogRef?.openEdit(key)">
                                                <Pencil class="h-4 w-4 mr-2" />
                                                编辑
                                            </DropdownMenuItem>
                                            <DropdownMenuItem class="text-destructive" @click="handleDelete(key)">
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
        <AdminModelApiKeysApiKeyFormDialog ref="formDialogRef" :providers="providers" @success="loadApiKeys" />

        <!-- 删除确认对话框 -->
        <AlertDialog v-model:open="deleteDialogOpen">
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>确认删除</AlertDialogTitle>
                    <AlertDialogDescription>
                        确定要删除 API 密钥「{{ selectedKey?.name }}」吗？此操作不可撤销。
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
import { Plus, Loader2, Key, Search, MoreHorizontal, Pencil, Trash2, Star } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { ModelProvider, ModelApiKey } from '#shared/types/model'

definePageMeta({ layout: 'admin-layout', title: 'API 密钥管理' })

// 扩展类型，包含关联的提供商
interface ApiKeyWithProvider extends ModelApiKey {
    modelProvider?: ModelProvider
}

// 组件引用
const formDialogRef = ref<InstanceType<typeof import('~/components/admin/model-api-keys/ApiKeyFormDialog.vue').default> | null>(null)

// 状态
const loading = ref(false)
const deleting = ref(false)
const apiKeys = ref<ApiKeyWithProvider[]>([])
const providers = ref<ModelProvider[]>([])
const pagination = ref({ page: 1, pageSize: 20, total: 0 })
const providerFilter = ref('all')
const statusFilter = ref('all')

// 删除对话框状态
const deleteDialogOpen = ref(false)
const selectedKey = ref<ApiKeyWithProvider | null>(null)

// 加载提供商列表
const loadProviders = async () => {
    const data = await useApiFetch<{ items: ModelProvider[] }>('/api/v1/admin/model-providers', {
        query: { pageSize: 100 }
    })
    if (data) providers.value = data.items
}

// 加载 API 密钥列表
const loadApiKeys = async () => {
    loading.value = true
    try {
        const params: Record<string, any> = {
            page: pagination.value.page,
            pageSize: pagination.value.pageSize,
        }
        if (providerFilter.value !== 'all') params.providerId = parseInt(providerFilter.value)
        if (statusFilter.value !== 'all') params.status = parseInt(statusFilter.value)

        const data = await useApiFetch<{ items: ApiKeyWithProvider[]; total: number }>('/api/v1/admin/model-api-keys', { query: params })
        if (data) {
            apiKeys.value = data.items
            pagination.value.total = data.total
        }
    } finally {
        loading.value = false
    }
}

// 筛选
const handleSearch = () => {
    pagination.value.page = 1
    loadApiKeys()
}

// 翻页
const changePage = (page: number) => {
    pagination.value.page = page
    loadApiKeys()
}

// 设置默认
const handleSetDefault = async (key: ApiKeyWithProvider) => {
    const result = await useApiFetch(`/api/v1/admin/model-api-keys/default/${key.id}`, { method: 'PUT' })
    if (result !== null) {
        toast.success('设置成功')
        loadApiKeys()
    }
}

// 删除密钥
const handleDelete = (key: ApiKeyWithProvider) => {
    selectedKey.value = key
    deleteDialogOpen.value = true
}

const confirmDelete = async () => {
    if (!selectedKey.value) return
    deleting.value = true
    try {
        const result = await useApiFetch(`/api/v1/admin/model-api-keys/${selectedKey.value.id}`, { method: 'DELETE' })
        if (result !== null) {
            toast.success('删除成功')
            deleteDialogOpen.value = false
            loadApiKeys()
        }
    } finally {
        deleting.value = false
    }
}

onMounted(() => {
    loadProviders()
    loadApiKeys()
})
</script>
