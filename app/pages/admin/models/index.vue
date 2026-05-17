<template>
        <div class="theme-brand space-y-6">
            <!-- 页面标题 -->
            <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                    <h1 class="text-2xl md:text-3xl font-bold mb-1">模型管理</h1>
                    <p class="text-muted-foreground text-sm">管理 AI 模型配置</p>
                </div>
                <Button :class="adminBrandPrimaryButtonClass" @click="formDialogRef?.openCreate()">
                    <Plus class="h-4 w-4 mr-2" />
                    新增模型
                </Button>
            </div>

            <!-- 筛选 -->
            <div class="flex flex-col md:flex-row gap-4">
                <Select v-model="providerFilter">
                    <SelectTrigger :class="['w-full md:w-48', adminBrandFocusClass]">
                        <SelectValue placeholder="选择提供商" />
                    </SelectTrigger>
                    <SelectContent class="theme-brand">
                        <SelectItem value="all">全部提供商</SelectItem>
                        <SelectItem v-for="p in providers" :key="p.id" :value="String(p.id)">
                            {{ p.name }}
                        </SelectItem>
                    </SelectContent>
                </Select>
                <Select v-model="typeFilter">
                    <SelectTrigger :class="['w-full md:w-40', adminBrandFocusClass]">
                        <SelectValue placeholder="模型类型" />
                    </SelectTrigger>
                    <SelectContent class="theme-brand">
                        <SelectItem value="all">全部类型</SelectItem>
                        <SelectItem v-for="(label, type) in ModelTypeLabels" :key="type" :value="type">
                            {{ label }}
                        </SelectItem>
                    </SelectContent>
                </Select>
                <Select v-model="statusFilter">
                    <SelectTrigger :class="['w-full md:w-32', adminBrandFocusClass]">
                        <SelectValue placeholder="状态" />
                    </SelectTrigger>
                    <SelectContent class="theme-brand">
                        <SelectItem value="all">全部状态</SelectItem>
                        <SelectItem value="1">启用</SelectItem>
                        <SelectItem value="0">禁用</SelectItem>
                    </SelectContent>
                </Select>
                <Button variant="outline" :class="adminBrandFocusClass" @click="handleSearch">
                    <Search class="h-4 w-4 mr-2" />
                    筛选
                </Button>
            </div>

            <!-- 加载状态 -->
            <div v-if="loading" class="flex justify-center py-12">
                <Loader2 class="h-10 w-10 animate-spin text-muted-foreground" />
            </div>

            <!-- 空状态 -->
            <div v-else-if="!models.length" class="flex flex-col items-center justify-center py-12 text-center">
                <Bot class="h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 class="text-lg font-medium mb-1">暂无模型</h3>
                <p class="text-muted-foreground text-sm">点击上方按钮新增模型</p>
            </div>

            <!-- 模型列表 -->
            <template v-else>
                <div class="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead class="w-[60px]">ID</TableHead>
                                <TableHead>显示名称</TableHead>
                                <TableHead>模型名称</TableHead>
                                <TableHead>提供商</TableHead>
                                <TableHead class="w-[100px]">类型</TableHead>
                                <TableHead class="w-[100px]">SDK 类型</TableHead>
                                <TableHead class="w-[80px]">默认</TableHead>
                                <TableHead class="w-[80px]">思考</TableHead>
                                <TableHead class="w-[80px]">状态</TableHead>
                                <TableHead class="w-[100px] text-right">操作</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            <TableRow v-for="model in models" :key="model.id">
                                <TableCell class="font-medium">{{ model.id }}</TableCell>
                                <TableCell>{{ model.displayName }}</TableCell>
                                <TableCell class="font-mono text-sm">{{ model.name }}</TableCell>
                                <TableCell>{{ model.modelProvider?.name || '-' }}</TableCell>
                                <TableCell>
                                    <Badge variant="outline" :class="getAdminModelTypeBadgeClass(model.modelType)">
                                        {{ getTypeLabel(model.modelType) }}
                                    </Badge>
                                </TableCell>
                                <TableCell>
                                    <Badge variant="outline" :class="adminBrandDisabledBadgeClass">
                                        {{ SdkTypeLabels[model.sdkType as SdkType] || model.sdkType || '-' }}
                                    </Badge>
                                </TableCell>
                                <TableCell>
                                    <Badge v-if="model.isDefault" variant="outline" :class="adminBrandActiveBadgeClass">默认</Badge>
                                    <span v-else class="text-muted-foreground">-</span>
                                </TableCell>
                                <TableCell>
                                    <Badge v-if="model.modelType === 'chat'" variant="outline"
                                        :class="getAdminThinkingBadgeClass(Boolean(model.supportsThinking))">
                                        {{ model.supportsThinking ? '开启' : '关闭' }}
                                    </Badge>
                                    <span v-else class="text-muted-foreground">-</span>
                                </TableCell>
                                <TableCell>
                                    <Badge variant="outline" :class="getAdminStatusBadgeClass(model.status === 1)">
                                        {{ model.status === 1 ? '启用' : '禁用' }}
                                    </Badge>
                                </TableCell>
                                <TableCell class="text-right">
                                    <DropdownMenu>
                                        <DropdownMenuTrigger as-child>
                                            <Button variant="ghost" size="icon" :class="adminBrandFocusClass">
                                                <MoreHorizontal class="h-4 w-4" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" class="theme-brand shadow-none">
                                            <DropdownMenuItem v-if="!model.isDefault" @click="handleSetDefault(model)">
                                                <Star class="h-4 w-4 mr-2" />
                                                设为默认
                                            </DropdownMenuItem>
                                            <DropdownMenuItem @click="formDialogRef?.openEdit(model)">
                                                <Pencil class="h-4 w-4 mr-2" />
                                                编辑
                                            </DropdownMenuItem>
                                            <DropdownMenuItem class="text-destructive" @click="handleDelete(model)">
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
        <AdminModelsModelFormDialog ref="formDialogRef" :providers="providers" @success="loadModels" />

        <!-- 删除确认对话框 -->
        <AlertDialog v-model:open="deleteDialogOpen">
            <AlertDialogContent class="theme-brand">
                <AlertDialogHeader>
                    <AlertDialogTitle>确认删除</AlertDialogTitle>
                    <AlertDialogDescription>
                        确定要删除模型「{{ selectedModel?.displayName }}」吗？此操作不可撤销。
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel :class="adminBrandFocusClass">取消</AlertDialogCancel>
                    <AlertDialogAction :class="adminBrandDestructiveActionClass" @click="confirmDelete" :disabled="deleting">
                        <Loader2 v-if="deleting" class="h-4 w-4 mr-2 animate-spin" />
                        确认删除
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
</template>

<script setup lang="ts">
import { Plus, Loader2, Bot, Search, MoreHorizontal, Pencil, Trash2, Star } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { ModelProvider, Model, SdkType, ModelType } from '#shared/types/model'
import { SdkTypeLabels, ModelTypeLabels } from '#shared/types/model'
import AdminModelsModelFormDialog from '~/components/admin/models/ModelFormDialog.vue'
import GeneralPagination from '~/components/general/pagination.vue'
import { useApiFetch } from '~/composables/useApiFetch'
import type { models } from '~~/generated/prisma/client'
import {
    adminBrandActiveBadgeClass,
    adminBrandDestructiveActionClass,
    adminBrandDisabledBadgeClass,
    adminBrandFocusClass,
    adminBrandPrimaryButtonClass,
    getAdminModelTypeBadgeClass,
    getAdminStatusBadgeClass,
    getAdminThinkingBadgeClass,
} from '~/utils/adminBrandStyles'

definePageMeta({ layout: 'admin-layout', title: '模型管理' })

// 扩展类型，包含关联的提供商
interface ModelWithProvider extends Model {
    modelProvider?: ModelProvider
}

// 组件引用
const formDialogRef = ref<InstanceType<typeof import('~/components/admin/models/ModelFormDialog.vue').default> | null>(null)

// 状态
const loading = ref(false)
const deleting = ref(false)
const models = ref<ModelWithProvider[]>([])
const providers = ref<ModelProvider[]>([])
const pagination = ref({ page: 1, pageSize: 20, total: 0 })
const providerFilter = ref('all')
const typeFilter = ref('all')
const statusFilter = ref('all')

// 删除对话框状态
const deleteDialogOpen = ref(false)
const selectedModel = ref<ModelWithProvider | null>(null)

// 模型类型标签（复用 shared 定义，保证前后端一致）
const getTypeLabel = (type: string) => ModelTypeLabels[type as ModelType] ?? type

// 加载提供商列表
const loadProviders = async () => {
    const data = await useApiFetch<{ items: ModelProvider[] }>('/api/v1/admin/model-providers', {
        query: { pageSize: 100 }
    })
    if (data) providers.value = data.items
}

// 加载模型列表
const loadModels = async () => {
    loading.value = true
    try {
        const params: Record<string, any> = {
            page: pagination.value.page,
            pageSize: pagination.value.pageSize,
        }
        if (providerFilter.value !== 'all') params.providerId = parseInt(providerFilter.value)
        if (typeFilter.value !== 'all') params.modelType = typeFilter.value
        if (statusFilter.value !== 'all') params.status = parseInt(statusFilter.value)

        const data = await useApiFetch<{ items: ModelWithProvider[]; total: number }>('/api/v1/admin/models', { query: params })
        if (data) {
            models.value = data.items
            pagination.value.total = data.total
        }
    } finally {
        loading.value = false
    }
}

// 筛选
const handleSearch = () => {
    pagination.value.page = 1
    loadModels()
}

// 翻页
const changePage = (page: number) => {
    pagination.value.page = page
    loadModels()
}

// 设置默认
const handleSetDefault = async (model: ModelWithProvider) => {
    const result = await useApiFetch(`/api/v1/admin/models/default/${model.id}`, { method: 'PUT' })
    if (result !== null) {
        toast.success('设置成功')
        loadModels()
    }
}

// 删除模型
const handleDelete = (model: ModelWithProvider) => {
    selectedModel.value = model
    deleteDialogOpen.value = true
}

const confirmDelete = async () => {
    if (!selectedModel.value) return
    deleting.value = true
    try {
        const result = await useApiFetch(`/api/v1/admin/models/${selectedModel.value.id}`, { method: 'DELETE' })
        if (result !== null) {
            toast.success('删除成功')
            deleteDialogOpen.value = false
            loadModels()
        }
    } finally {
        deleting.value = false
    }
}

onMounted(() => {
    loadProviders()
    loadModels()
})
</script>
