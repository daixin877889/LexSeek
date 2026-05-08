<template>
        <div class="space-y-6">
            <!-- 页面标题 -->
            <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                    <h1 class="text-2xl md:text-3xl font-bold mb-1">提示词管理</h1>
                    <p class="text-muted-foreground text-sm">管理节点的提示词配置和版本</p>
                </div>
                <Button @click="formDialogRef?.openCreate()">
                    <Plus class="h-4 w-4 mr-2" />
                    新增提示词
                </Button>
            </div>

            <!-- 筛选 -->
            <div class="flex flex-col md:flex-row gap-4">
                <Select v-model="typeFilter">
                    <SelectTrigger class="w-full md:w-40">
                        <SelectValue placeholder="提示词类型" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">全部类型</SelectItem>
                        <SelectItem value="system">系统提示词</SelectItem>
                        <SelectItem value="user">用户提示词</SelectItem>
                        <SelectItem value="assistant">助手提示词</SelectItem>
                    </SelectContent>
                </Select>
                <Select v-model="statusFilter">
                    <SelectTrigger class="w-full md:w-32">
                        <SelectValue placeholder="状态" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">全部状态</SelectItem>
                        <SelectItem value="1">生效</SelectItem>
                        <SelectItem value="0">未生效</SelectItem>
                    </SelectContent>
                </Select>
                <div class="flex-1">
                    <Input v-model="keyword" placeholder="搜索提示词名称/标题..." class="w-full md:w-64"
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
            <div v-else-if="!prompts.length" class="flex flex-col items-center justify-center py-12 text-center">
                <FileText class="h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 class="text-lg font-medium mb-1">暂无提示词</h3>
                <p class="text-muted-foreground text-sm">点击上方按钮新增提示词</p>
            </div>

            <!-- 提示词列表 -->
            <template v-else>
                <div class="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead class="w-[60px]">ID</TableHead>
                                <TableHead>名称</TableHead>
                                <TableHead>标题</TableHead>
                                <TableHead class="w-[120px]">被引用次数</TableHead>
                                <TableHead class="w-[100px]">类型</TableHead>
                                <TableHead class="w-[80px]">版本</TableHead>
                                <TableHead class="w-[80px]">状态</TableHead>
                                <TableHead class="w-[140px]">更新时间</TableHead>
                                <TableHead class="w-[120px] text-right">操作</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            <TableRow v-for="prompt in prompts" :key="prompt.id">
                                <TableCell class="font-medium">{{ prompt.id }}</TableCell>
                                <TableCell class="font-mono text-sm">{{ prompt.name }}</TableCell>
                                <TableCell>{{ prompt.title || '-' }}</TableCell>
                                <TableCell>{{ prompt.referencedByCount ?? 0 }} 个节点</TableCell>
                                <TableCell>
                                    <Badge :variant="getTypeVariant(prompt.type)">
                                        {{ getTypeLabel(prompt.type) }}
                                    </Badge>
                                </TableCell>
                                <TableCell class="font-mono text-sm">{{ prompt.version }}</TableCell>
                                <TableCell>
                                    <Badge :variant="prompt.status === 1 ? 'default' : 'secondary'">
                                        {{ prompt.status === 1 ? '生效' : '未生效' }}
                                    </Badge>
                                </TableCell>
                                <TableCell>{{ formatDate(prompt.updatedAt) }}</TableCell>
                                <TableCell class="text-right">
                                    <DropdownMenu>
                                        <DropdownMenuTrigger as-child>
                                            <Button variant="ghost" size="icon">
                                                <MoreHorizontal class="h-4 w-4" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            <DropdownMenuItem @click="navigateTo(`/admin/prompts/${prompt.id}`)">
                                                <Eye class="h-4 w-4 mr-2" />
                                                查看详情
                                            </DropdownMenuItem>
                                            <DropdownMenuItem @click="handleViewVersions(prompt)">
                                                <History class="h-4 w-4 mr-2" />
                                                版本历史
                                            </DropdownMenuItem>
                                            <DropdownMenuItem v-if="prompt.status !== 1"
                                                @click="handleActivate(prompt)">
                                                <CheckCircle class="h-4 w-4 mr-2" />
                                                激活此版本
                                            </DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem class="text-destructive" @click="handleDelete(prompt)">
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
        <AdminPromptsPromptFormDialog ref="formDialogRef" @success="loadPrompts" />

        <!-- 版本历史对话框 -->
        <AdminPromptsVersionHistoryDialog ref="versionDialogRef" @activate="handleActivateVersion" />

        <!-- 删除确认对话框 -->
        <AlertDialog v-model:open="deleteDialogOpen">
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>确认删除</AlertDialogTitle>
                    <AlertDialogDescription>
                        确定要删除提示词「{{ selectedPrompt?.title || selectedPrompt?.name }}」吗？此操作不可撤销。
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
import { Plus, Loader2, FileText, Search, MoreHorizontal, Eye, Trash2, History, CheckCircle } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import dayjs from 'dayjs'
import type { PromptWithRelations } from '#shared/types/node'
import AdminPromptsPromptFormDialog from '~/components/admin/prompts/PromptFormDialog.vue'
import AdminPromptsVersionHistoryDialog from '~/components/admin/prompts/VersionHistoryDialog.vue'
import GeneralPagination from '~/components/general/pagination.vue'
import { useApiFetch } from '~/composables/useApiFetch'

definePageMeta({ layout: 'admin-layout', title: '提示词管理' })

// 组件引用
const formDialogRef = ref<InstanceType<typeof import('~/components/admin/prompts/PromptFormDialog.vue').default> | null>(null)
const versionDialogRef = ref<InstanceType<typeof import('~/components/admin/prompts/VersionHistoryDialog.vue').default> | null>(null)

// 状态
const loading = ref(false)
const deleting = ref(false)
const prompts = ref<PromptWithRelations[]>([])
const pagination = ref({ page: 1, pageSize: 20, total: 0 })
const typeFilter = ref('all')
const statusFilter = ref('all')
const keyword = ref('')

// 删除对话框状态
const deleteDialogOpen = ref(false)
const selectedPrompt = ref<PromptWithRelations | null>(null)

// 格式化日期
const formatDate = (date: string | Date | null | undefined) => {
    if (!date) return '-'
    return dayjs(date).format('YYYY-MM-DD HH:mm')
}

// 提示词类型标签
const getTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
        system: '系统提示词',
        user: '用户提示词',
        user_injection: '用户每轮注入',
        assistant: '助手提示词',
    }
    return labels[type] || type
}

// 提示词类型样式
const getTypeVariant = (type: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'outline'> = {
        system: 'default',
        user: 'secondary',
        user_injection: 'secondary',
        assistant: 'outline',
    }
    return variants[type] || 'default'
}

// 加载提示词列表
const loadPrompts = async () => {
    loading.value = true
    try {
        const params: Record<string, any> = {
            page: pagination.value.page,
            pageSize: pagination.value.pageSize,
        }
        if (typeFilter.value !== 'all') params.type = typeFilter.value
        if (statusFilter.value !== 'all') params.status = parseInt(statusFilter.value)
        if (keyword.value) params.keyword = keyword.value

        const data = await useApiFetch<{ items: PromptWithRelations[]; total: number }>('/api/v1/admin/prompts', { query: params })
        if (data) {
            prompts.value = data.items
            pagination.value.total = data.total
        }
    } finally {
        loading.value = false
    }
}

// 筛选
const handleSearch = () => {
    pagination.value.page = 1
    loadPrompts()
}

// 翻页
const changePage = (page: number) => {
    pagination.value.page = page
    loadPrompts()
}

// 查看版本历史
const handleViewVersions = (prompt: PromptWithRelations) => {
    versionDialogRef.value?.open(prompt.id)
}

// 激活提示词
const handleActivate = async (prompt: PromptWithRelations) => {
    const result = await useApiFetch(`/api/v1/admin/prompts/activate/${prompt.id}`, { method: 'PUT' })
    if (result !== null) {
        toast.success('激活成功')
        loadPrompts()
    }
}

// 从版本历史激活
const handleActivateVersion = async (promptId: number) => {
    const result = await useApiFetch(`/api/v1/admin/prompts/activate/${promptId}`, { method: 'PUT' })
    if (result !== null) {
        toast.success('激活成功')
        loadPrompts()
    }
}

// 删除提示词
const handleDelete = (prompt: PromptWithRelations) => {
    selectedPrompt.value = prompt
    deleteDialogOpen.value = true
}

const confirmDelete = async () => {
    if (!selectedPrompt.value) return
    deleting.value = true
    try {
        const result = await useApiFetch(`/api/v1/admin/prompts/${selectedPrompt.value.id}`, { method: 'DELETE' })
        if (result !== null) {
            toast.success('删除成功')
            deleteDialogOpen.value = false
            loadPrompts()
        }
    } finally {
        deleting.value = false
    }
}

onMounted(() => {
    loadPrompts()
})
</script>
