<template>
    <Card>
        <CardHeader>
            <div class="flex justify-between items-center">
                <div>
                    <CardTitle>模型配置</CardTitle>
                    <CardDescription>管理该提供商下的模型配置</CardDescription>
                </div>
                <Button @click="createModel">
                    <Plus class="h-4 w-4 mr-2" />
                    新增模型
                </Button>
            </div>
        </CardHeader>
        <CardContent>
            <!-- 加载状态 -->
            <div v-if="loading" class="flex justify-center py-8">
                <Loader2 class="h-8 w-8 animate-spin text-muted-foreground" />
            </div>

            <!-- 空状态 -->
            <div v-else-if="!models.length" class="flex flex-col items-center justify-center py-8 text-center">
                <Bot class="h-8 w-8 text-muted-foreground/50 mb-3" />
                <h4 class="text-sm font-medium mb-1">暂无模型配置</h4>
                <p class="text-xs text-muted-foreground">点击上方按钮新增模型配置</p>
            </div>

            <!-- 模型列表 -->
            <template v-else>
                <div class="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead class="w-[80px]">ID</TableHead>
                                <TableHead>模型名称</TableHead>
                                <TableHead>显示名称</TableHead>
                                <TableHead class="w-[100px]">类型</TableHead>
                                <TableHead class="w-[80px]">状态</TableHead>
                                <TableHead class="w-[80px]">默认</TableHead>
                                <TableHead class="w-[80px]">优先级</TableHead>
                                <TableHead class="w-[100px] text-right">操作</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            <TableRow v-for="model in models" :key="model.id">
                                <TableCell class="font-medium">{{ model.id }}</TableCell>
                                <TableCell class="font-mono text-xs">{{ model.name }}</TableCell>
                                <TableCell>{{ model.displayName }}</TableCell>
                                <TableCell>
                                    <Badge :variant="getModelTypeVariant(model.modelType)">
                                        {{ ModelTypeLabels[model.modelType as keyof typeof ModelTypeLabels] }}
                                    </Badge>
                                </TableCell>
                                <TableCell>
                                    <Badge :variant="model.status === 1 ? 'default' : 'secondary'">
                                        {{ model.status === 1 ? '启用' : '禁用' }}
                                    </Badge>
                                </TableCell>
                                <TableCell>
                                    <Badge v-if="model.isDefault" variant="outline">
                                        <Star class="h-3 w-3 mr-1 fill-current" />
                                        默认
                                    </Badge>
                                    <span v-else class="text-muted-foreground text-xs">-</span>
                                </TableCell>
                                <TableCell class="text-center">{{ model.priority }}</TableCell>
                                <TableCell class="text-right">
                                    <DropdownMenu>
                                        <DropdownMenuTrigger as-child>
                                            <Button variant="ghost" size="icon">
                                                <MoreHorizontal class="h-4 w-4" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            <DropdownMenuItem @click="editModel(model)">
                                                <Pencil class="h-4 w-4 mr-2" />
                                                编辑
                                            </DropdownMenuItem>
                                            <DropdownMenuItem v-if="!model.isDefault" @click="setDefaultModel(model)">
                                                <Star class="h-4 w-4 mr-2" />
                                                设为默认
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
                <div v-if="pagination.total > pagination.pageSize" class="mt-4">
                    <GeneralPagination :current-page="pagination.page" :page-size="pagination.pageSize"
                        :total="pagination.total" @change="changePage" />
                </div>
            </template>
        </CardContent>

        <!-- 创建/编辑对话框 -->
        <ModelFormDialog ref="formDialogRef" :default-provider-id="providerId" @success="loadModels" />

        <!-- 删除确认对话框 -->
        <AlertDialog v-model:open="deleteDialogOpen">
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>确认删除</AlertDialogTitle>
                    <AlertDialogDescription>
                        确定要删除模型「{{ selectedModel?.displayName }}」吗？此操作不可撤销。
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
import { Plus, Loader2, Bot, MoreHorizontal, Pencil, Star, Trash2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { Model } from '#shared/types/model'
import { ModelTypeLabels } from '#shared/types/model'

interface Props {
    providerId: number
}

const props = defineProps<Props>()

// 导入组件
import ModelFormDialog from '~/components/admin/models/ModelFormDialog.vue'

// 组件引用
const formDialogRef = ref<InstanceType<typeof ModelFormDialog> | null>(null)

// 状态
const loading = ref(false)
const deleting = ref(false)
const models = ref<Model[]>([])
const pagination = ref({ page: 1, pageSize: 10, total: 0 })

// 删除对话框状态
const deleteDialogOpen = ref(false)
const selectedModel = ref<Model | null>(null)

// 获取模型类型的 Badge 样式
const getModelTypeVariant = (type: string) => {
    switch (type) {
        case 'chat':
            return 'default'
        case 'embedding':
            return 'secondary'
        case 'asr':
            return 'outline'
        case 'rerank':
            return 'secondary'
        default:
            return 'secondary'
    }
}

// 加载模型列表
const loadModels = async () => {
    loading.value = true
    try {
        const data = await useApiFetch<{ items: Model[]; total: number }>('/api/v1/admin/models', {
            query: {
                providerId: props.providerId,
                page: pagination.value.page,
                pageSize: pagination.value.pageSize
            }
        })
        if (data) {
            models.value = data.items
            pagination.value.total = data.total
        }
    } finally {
        loading.value = false
    }
}

// 翻页
const changePage = (page: number) => {
    pagination.value.page = page
    loadModels()
}

// 新增模型
const createModel = () => {
    formDialogRef.value?.openCreate()
}

// 编辑模型
const editModel = (model: Model) => {
    formDialogRef.value?.openEdit(model)
}

// 设置默认模型
const setDefaultModel = async (model: Model) => {
    try {
        const result = await useApiFetch(`/api/v1/admin/models/default/${model.id}`, {
            method: 'PUT'
        })
        if (result !== null) {
            toast.success('设置默认成功')
            loadModels()
        }
    } catch (error) {
        console.error('设置默认失败:', error)
    }
}

// 删除模型
const handleDelete = (model: Model) => {
    selectedModel.value = model
    deleteDialogOpen.value = true
}

const confirmDelete = async () => {
    if (!selectedModel.value) return
    deleting.value = true
    try {
        const result = await useApiFetch(`/api/v1/admin/models/${selectedModel.value.id}`, {
            method: 'DELETE'
        })
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
    loadModels()
})

// 监听 providerId 变化
watch(() => props.providerId, () => {
    pagination.value.page = 1
    loadModels()
})
</script>