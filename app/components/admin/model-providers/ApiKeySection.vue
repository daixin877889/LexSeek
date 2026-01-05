<template>
    <Card>
        <CardHeader>
            <div class="flex justify-between items-center">
                <div>
                    <CardTitle>API 密钥</CardTitle>
                    <CardDescription>管理该提供商下的 API 密钥</CardDescription>
                </div>
                <Button @click="createApiKey">
                    <Plus class="h-4 w-4 mr-2" />
                    新增密钥
                </Button>
            </div>
        </CardHeader>
        <CardContent>
            <!-- 加载状态 -->
            <div v-if="loading" class="flex justify-center py-8">
                <Loader2 class="h-8 w-8 animate-spin text-muted-foreground" />
            </div>

            <!-- 空状态 -->
            <div v-else-if="!apiKeys.length" class="flex flex-col items-center justify-center py-8 text-center">
                <Key class="h-8 w-8 text-muted-foreground/50 mb-3" />
                <h4 class="text-sm font-medium mb-1">暂无 API 密钥</h4>
                <p class="text-xs text-muted-foreground">点击上方按钮新增 API 密钥</p>
            </div>

            <!-- API 密钥列表 -->
            <template v-else>
                <div class="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead class="w-[80px]">ID</TableHead>
                                <TableHead>名称</TableHead>
                                <TableHead>API 密钥</TableHead>
                                <TableHead class="w-[80px]">状态</TableHead>
                                <TableHead class="w-[80px]">默认</TableHead>
                                <TableHead>创建时间</TableHead>
                                <TableHead class="w-[100px] text-right">操作</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            <TableRow v-for="apiKey in apiKeys" :key="apiKey.id">
                                <TableCell class="font-medium">{{ apiKey.id }}</TableCell>
                                <TableCell>{{ apiKey.name }}</TableCell>
                                <TableCell class="font-mono text-xs">
                                    {{ maskApiKey(apiKey.apiKey) }}
                                </TableCell>
                                <TableCell>
                                    <Badge :variant="apiKey.status === 1 ? 'default' : 'secondary'">
                                        {{ apiKey.status === 1 ? '启用' : '禁用' }}
                                    </Badge>
                                </TableCell>
                                <TableCell>
                                    <Badge v-if="apiKey.isDefault" variant="outline">
                                        <Star class="h-3 w-3 mr-1 fill-current" />
                                        默认
                                    </Badge>
                                    <span v-else class="text-muted-foreground text-xs">-</span>
                                </TableCell>
                                <TableCell class="text-xs text-muted-foreground">
                                    {{ formatDate(apiKey.createdAt) }}
                                </TableCell>
                                <TableCell class="text-right">
                                    <DropdownMenu>
                                        <DropdownMenuTrigger as-child>
                                            <Button variant="ghost" size="icon">
                                                <MoreHorizontal class="h-4 w-4" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            <DropdownMenuItem @click="editApiKey(apiKey)">
                                                <Pencil class="h-4 w-4 mr-2" />
                                                编辑
                                            </DropdownMenuItem>
                                            <DropdownMenuItem v-if="!apiKey.isDefault"
                                                @click="setDefaultApiKey(apiKey)">
                                                <Star class="h-4 w-4 mr-2" />
                                                设为默认
                                            </DropdownMenuItem>
                                            <DropdownMenuItem class="text-destructive" @click="handleDelete(apiKey)">
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
                <div v-if="pagination.total > pagination.pageSize" class="mt-4">
                    <GeneralPagination :current-page="pagination.page" :page-size="pagination.pageSize"
                        :total="pagination.total" @change="changePage" />
                </div>
            </template>
        </CardContent>

        <!-- 创建/编辑对话框 -->
        <AdminModelApiKeysApiKeyFormDialog ref="formDialogRef" :default-provider-id="providerId"
            @success="loadApiKeys" />

        <!-- 删除确认对话框 -->
        <AlertDialog v-model:open="deleteDialogOpen">
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>确认删除</AlertDialogTitle>
                    <AlertDialogDescription>
                        确定要删除 API 密钥「{{ selectedApiKey?.name }}」吗？此操作不可撤销。
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
    </Card>
</template>

<script setup lang="ts">
import { Plus, Loader2, Key, MoreHorizontal, Pencil, Star, Trash2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { ModelApiKey } from '#shared/types/model'
import dayjs from 'dayjs'

interface Props {
    providerId: number
}

const props = defineProps<Props>()

// 组件引用
const formDialogRef = ref<InstanceType<typeof import('~/components/admin/model-api-keys/ApiKeyFormDialog.vue').default> | null>(null)

// 状态
const loading = ref(false)
const deleting = ref(false)
const apiKeys = ref<ModelApiKey[]>([])
const pagination = ref({ page: 1, pageSize: 10, total: 0 })

// 删除对话框状态
const deleteDialogOpen = ref(false)
const selectedApiKey = ref<ModelApiKey | null>(null)

// 格式化日期
const formatDate = (date: string | Date | null) => {
    if (!date) return '-'
    return dayjs(date).format('MM-DD HH:mm')
}

// 隐藏 API 密钥
const maskApiKey = (apiKey: string) => {
    if (!apiKey || apiKey.length < 8) return '***'
    return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`
}

// 加载 API 密钥列表
const loadApiKeys = async () => {
    loading.value = true
    try {
        const data = await useApiFetch<{ items: ModelApiKey[]; total: number }>('/api/v1/admin/model-api-keys', {
            query: {
                providerId: props.providerId,
                page: pagination.value.page,
                pageSize: pagination.value.pageSize
            }
        })
        if (data) {
            apiKeys.value = data.items
            pagination.value.total = data.total
        }
    } finally {
        loading.value = false
    }
}

// 翻页
const changePage = (page: number) => {
    pagination.value.page = page
    loadApiKeys()
}

// 新增 API 密钥
const createApiKey = () => {
    formDialogRef.value?.openCreate()
}

// 编辑 API 密钥
const editApiKey = (apiKey: ModelApiKey) => {
    formDialogRef.value?.openEdit(apiKey)
}

// 设置默认 API 密钥
const setDefaultApiKey = async (apiKey: ModelApiKey) => {
    try {
        const result = await useApiFetch(`/api/v1/admin/model-api-keys/default/${apiKey.id}`, {
            method: 'PUT'
        })
        if (result !== null) {
            toast.success('设置默认成功')
            loadApiKeys()
        }
    } catch (error) {
        console.error('设置默认失败:', error)
    }
}

// 删除 API 密钥
const handleDelete = (apiKey: ModelApiKey) => {
    selectedApiKey.value = apiKey
    deleteDialogOpen.value = true
}

const confirmDelete = async () => {
    if (!selectedApiKey.value) return
    deleting.value = true
    try {
        const result = await useApiFetch(`/api/v1/admin/model-api-keys/${selectedApiKey.value.id}`, {
            method: 'DELETE'
        })
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
    loadApiKeys()
})

// 监听 providerId 变化
watch(() => props.providerId, () => {
    pagination.value.page = 1
    loadApiKeys()
})
</script>