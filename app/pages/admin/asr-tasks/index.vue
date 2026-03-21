<template>
        <div class="space-y-6">
            <!-- 页面标题 -->
            <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                    <h1 class="text-2xl md:text-3xl font-bold mb-1">ASR 任务管理</h1>
                    <p class="text-muted-foreground text-sm">管理 ASR 音频转录任务的状态和结果</p>
                </div>
                <div class="flex gap-2">
                    <Button variant="outline" @click="handleBatchQuery"
                        :disabled="!selectedIds.length || batchQuerying">
                        <Loader2 v-if="batchQuerying" class="h-4 w-4 mr-2 animate-spin" />
                        <RefreshCw v-else class="h-4 w-4 mr-2" />
                        批量查询状态 ({{ selectedIds.length }})
                    </Button>
                </div>
            </div>

            <!-- 筛选区域 -->
            <div class="flex flex-col md:flex-row gap-4 flex-wrap">
                <!-- 状态筛选 -->
                <Select v-model="statusFilter">
                    <SelectTrigger class="w-full md:w-32">
                        <SelectValue placeholder="状态" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">全部状态</SelectItem>
                        <SelectItem value="0">待处理</SelectItem>
                        <SelectItem value="1">处理中</SelectItem>
                        <SelectItem value="2">成功</SelectItem>
                        <SelectItem value="3">失败</SelectItem>
                    </SelectContent>
                </Select>

                <!-- 开始日期 -->
                <GeneralDatePicker v-model="startDate" placeholder="开始日期" clearable class="w-full md:w-44" />

                <!-- 结束日期 -->
                <GeneralDatePicker v-model="endDate" placeholder="结束日期" clearable class="w-full md:w-44" />

                <!-- 关键词搜索 -->
                <div class="flex-1">
                    <Input v-model="keyword" placeholder="搜索任务ID..." class="w-full md:w-64"
                        @keyup.enter="handleSearch" />
                </div>

                <Button variant="outline" @click="handleSearch">
                    <Search class="h-4 w-4 mr-2" />
                    筛选
                </Button>

                <Button variant="ghost" @click="handleReset">
                    <RotateCcw class="h-4 w-4 mr-2" />
                    重置
                </Button>
            </div>

            <!-- 加载状态 -->
            <div v-if="loading" class="flex justify-center py-12">
                <Loader2 class="h-10 w-10 animate-spin text-muted-foreground" />
            </div>

            <!-- 空状态 -->
            <div v-else-if="!items.length" class="flex flex-col items-center justify-center py-12 text-center">
                <Mic class="h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 class="text-lg font-medium mb-1">暂无 ASR 任务</h3>
                <p class="text-muted-foreground text-sm">当用户上传音频文件时，任务将自动创建</p>
            </div>

            <!-- 任务列表 -->
            <template v-else>
                <div class="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead class="w-[50px]">
                                    <Checkbox :checked="isAllSelected" @update:checked="handleSelectAll" />
                                </TableHead>
                                <TableHead class="w-[60px]">ID</TableHead>
                                <TableHead>任务ID</TableHead>
                                <TableHead class="w-[100px]">状态</TableHead>
                                <TableHead class="w-[80px]">关联记录</TableHead>
                                <TableHead class="w-[160px]">创建时间</TableHead>
                                <TableHead class="w-[160px]">更新时间</TableHead>
                                <TableHead class="w-[120px] text-right">操作</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            <TableRow v-for="item in items" :key="item.id">
                                <TableCell>
                                    <Checkbox :checked="selectedIds.includes(item.id)"
                                        @update:checked="(checked: boolean) => handleSelect(item.id, checked)" />
                                </TableCell>
                                <TableCell class="font-medium">{{ item.id }}</TableCell>
                                <TableCell>
                                    <code v-if="item.taskId"
                                        class="px-2 py-1 bg-muted rounded text-xs font-mono max-w-[200px] truncate block">
                                        {{ item.taskId }}
                                    </code>
                                    <span v-else class="text-muted-foreground">-</span>
                                </TableCell>
                                <TableCell>
                                    <Badge :variant="getStatusVariant(item.status)">
                                        {{ getStatusText(item.status) }}
                                    </Badge>
                                </TableCell>
                                <TableCell class="text-center">
                                    {{ item.recordCount || 0 }}
                                </TableCell>
                                <TableCell class="text-muted-foreground">
                                    {{ formatDate(item.createdAt) }}
                                </TableCell>
                                <TableCell class="text-muted-foreground">
                                    {{ formatDate(item.updatedAt) }}
                                </TableCell>
                                <TableCell class="text-right">
                                    <DropdownMenu>
                                        <DropdownMenuTrigger as-child>
                                            <Button variant="ghost" size="icon">
                                                <MoreHorizontal class="h-4 w-4" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            <DropdownMenuItem @click="handleViewDetail(item)">
                                                <Eye class="h-4 w-4 mr-2" />
                                                查看详情
                                            </DropdownMenuItem>
                                            <DropdownMenuItem @click="handleQueryStatus(item)"
                                                :disabled="item.status === 2 || item.status === 3">
                                                <RefreshCw class="h-4 w-4 mr-2" />
                                                查询状态
                                            </DropdownMenuItem>
                                            <DropdownMenuSeparator v-if="item.status === 3" />
                                            <DropdownMenuItem v-if="item.status === 3" @click="handleRetry(item)">
                                                <RotateCcw class="h-4 w-4 mr-2" />
                                                重试任务
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

        <!-- 任务详情对话框 -->
        <Dialog v-model:open="detailDialogOpen">
            <DialogContent class="max-w-2xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>任务详情</DialogTitle>
                    <DialogDescription>
                        查看 ASR 任务的完整信息
                    </DialogDescription>
                </DialogHeader>
                <div v-if="selectedItem" class="space-y-4">
                    <!-- 基本信息 -->
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <Label class="text-muted-foreground">任务 ID</Label>
                            <p class="font-medium">{{ selectedItem.id }}</p>
                        </div>
                        <div>
                            <Label class="text-muted-foreground">ASR 任务 ID</Label>
                            <p class="font-mono text-sm">{{ selectedItem.taskId || '-' }}</p>
                        </div>
                        <div>
                            <Label class="text-muted-foreground">状态</Label>
                            <Badge :variant="getStatusVariant(selectedItem.status)" class="mt-1">
                                {{ getStatusText(selectedItem.status) }}
                            </Badge>
                        </div>
                        <div>
                            <Label class="text-muted-foreground">关联记录数</Label>
                            <p class="font-medium">{{ selectedItem.recordCount || 0 }}</p>
                        </div>
                        <div>
                            <Label class="text-muted-foreground">创建时间</Label>
                            <p class="font-medium">{{ formatDate(selectedItem.createdAt) }}</p>
                        </div>
                        <div>
                            <Label class="text-muted-foreground">更新时间</Label>
                            <p class="font-medium">{{ formatDate(selectedItem.updatedAt) }}</p>
                        </div>
                    </div>

                    <!-- 关联文件 -->
                    <div v-if="selectedItem.fileNames && selectedItem.fileNames.length">
                        <Label class="text-muted-foreground">关联文件</Label>
                        <div class="mt-1 space-y-1">
                            <div v-for="(fileName, index) in selectedItem.fileNames" :key="index"
                                class="flex items-center gap-2 p-2 bg-muted rounded text-sm">
                                <Mic class="h-4 w-4 text-muted-foreground" />
                                <span class="truncate">{{ fileName }}</span>
                            </div>
                        </div>
                    </div>

                    <!-- 任务原始数据 -->
                    <div v-if="selectedItem.taskRawData && Object.keys(selectedItem.taskRawData).length">
                        <Label class="text-muted-foreground">任务参数</Label>
                        <pre class="mt-1 p-3 bg-muted rounded-md text-sm overflow-x-auto">{{
                            JSON.stringify(selectedItem.taskRawData, null, 2) }}</pre>
                    </div>

                    <!-- 识别结果 -->
                    <div v-if="selectedItem.result && Object.keys(selectedItem.result).length">
                        <Label class="text-muted-foreground">识别结果</Label>
                        <pre class="mt-1 p-3 bg-muted rounded-md text-sm overflow-x-auto max-h-[200px]">{{
                            JSON.stringify(selectedItem.result, null, 2) }}</pre>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" @click="detailDialogOpen = false">关闭</Button>
                    <Button v-if="selectedItem?.status === 3" @click="handleRetry(selectedItem!)" :disabled="retrying">
                        <Loader2 v-if="retrying" class="h-4 w-4 mr-2 animate-spin" />
                        <RotateCcw v-else class="h-4 w-4 mr-2" />
                        重试任务
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>

        <!-- 批量查询进度对话框 -->
        <Dialog v-model:open="batchProgressDialogOpen">
            <DialogContent class="max-w-md">
                <DialogHeader>
                    <DialogTitle>批量查询进度</DialogTitle>
                    <DialogDescription>
                        正在查询选中任务的状态...
                    </DialogDescription>
                </DialogHeader>
                <div class="space-y-4">
                    <Progress :model-value="batchProgress" />
                    <p class="text-sm text-muted-foreground text-center">
                        {{ batchProgressText }}
                    </p>
                </div>
            </DialogContent>
        </Dialog>

        <!-- 批量查询结果对话框 -->
        <Dialog v-model:open="batchResultDialogOpen">
            <DialogContent class="max-w-md">
                <DialogHeader>
                    <DialogTitle>批量查询结果</DialogTitle>
                </DialogHeader>
                <div v-if="batchResult" class="space-y-4">
                    <div class="grid grid-cols-2 gap-4 text-center">
                        <div class="p-4 bg-muted rounded-lg">
                            <p class="text-2xl font-bold text-green-600">{{ batchResult.success }}</p>
                            <p class="text-sm text-muted-foreground">查询成功</p>
                        </div>
                        <div class="p-4 bg-muted rounded-lg">
                            <p class="text-2xl font-bold text-red-600">{{ batchResult.failed }}</p>
                            <p class="text-sm text-muted-foreground">查询失败</p>
                        </div>
                    </div>
                    <div class="p-4 bg-muted rounded-lg text-center">
                        <p class="text-2xl font-bold text-blue-600">{{ batchResult.changed }}</p>
                        <p class="text-sm text-muted-foreground">状态变更</p>
                    </div>
                </div>
                <DialogFooter>
                    <Button @click="batchResultDialogOpen = false">确定</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
</template>

<script setup lang="ts">
import {
    Loader2,
    Mic,
    Search,
    MoreHorizontal,
    Eye,
    RefreshCw,
    RotateCcw
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import dayjs from 'dayjs'

// ASR 任务接口
interface AsrTask {
    id: number
    taskId: string | null
    status: number
    taskRawData: Record<string, any> | null
    result: Record<string, any> | null
    createdAt: Date | string
    updatedAt: Date | string
    recordCount?: number
    fileNames?: string[]
}

// 批量查询结果接口
interface BatchQueryResult {
    total: number
    success: number
    failed: number
    changed: number
    results: Array<{
        id: number
        status: number
        changed: boolean
        error?: string
    }>
}

definePageMeta({ layout: 'admin-layout', title: 'ASR 任务管理' })

// 状态
const loading = ref(false)
const retrying = ref(false)
const batchQuerying = ref(false)
const items = ref<AsrTask[]>([])
const pagination = ref({ page: 1, pageSize: 20, total: 0 })

// 筛选条件
const statusFilter = ref('all')
const startDate = ref<string | null>(null)
const endDate = ref<string | null>(null)
const keyword = ref('')

// 选择状态
const selectedIds = ref<number[]>([])

// 详情对话框
const detailDialogOpen = ref(false)
const selectedItem = ref<AsrTask | null>(null)

// 批量查询进度对话框
const batchProgressDialogOpen = ref(false)
const batchProgress = ref(0)
const batchProgressText = ref('')

// 批量查询结果对话框
const batchResultDialogOpen = ref(false)
const batchResult = ref<BatchQueryResult | null>(null)

// 是否全选
const isAllSelected = computed(() => {
    if (!items.value.length) return false
    return items.value.every(item => selectedIds.value.includes(item.id))
})

// 状态文本映射
const getStatusText = (status: number) => {
    const map: Record<number, string> = {
        0: '待处理',
        1: '处理中',
        2: '成功',
        3: '失败',
    }
    return map[status] || '未知'
}

// 状态样式映射
const getStatusVariant = (status: number): 'default' | 'secondary' | 'destructive' | 'outline' => {
    const map: Record<number, 'default' | 'secondary' | 'destructive' | 'outline'> = {
        0: 'outline',
        1: 'secondary',
        2: 'default',
        3: 'destructive',
    }
    return map[status] || 'outline'
}

// 格式化日期
const formatDate = (date: Date | string | null) => {
    if (!date) return '-'
    return dayjs(date).format('YYYY-MM-DD HH:mm')
}

// 加载任务列表
const loadItems = async () => {
    loading.value = true
    try {
        const params: Record<string, any> = {
            page: pagination.value.page,
            pageSize: pagination.value.pageSize,
        }
        if (statusFilter.value !== 'all') params.status = parseInt(statusFilter.value)
        if (startDate.value) params.startDate = startDate.value
        if (endDate.value) params.endDate = endDate.value
        if (keyword.value) params.keyword = keyword.value

        const data = await useApiFetch<{ items: AsrTask[]; total: number }>('/api/v1/admin/asr-tasks', { query: params })
        if (data) {
            items.value = data.items
            pagination.value.total = data.total
            // 清空选择
            selectedIds.value = []
        }
    } finally {
        loading.value = false
    }
}

// 筛选
const handleSearch = () => {
    pagination.value.page = 1
    loadItems()
}

// 重置筛选
const handleReset = () => {
    statusFilter.value = 'all'
    startDate.value = null
    endDate.value = null
    keyword.value = ''
    pagination.value.page = 1
    loadItems()
}

// 翻页
const changePage = (page: number) => {
    pagination.value.page = page
    loadItems()
}

// 全选/取消全选
const handleSelectAll = (checked: boolean) => {
    if (checked) {
        selectedIds.value = items.value.map(item => item.id)
    } else {
        selectedIds.value = []
    }
}

// 单选
const handleSelect = (id: number, checked: boolean) => {
    if (checked) {
        if (!selectedIds.value.includes(id)) {
            selectedIds.value.push(id)
        }
    } else {
        selectedIds.value = selectedIds.value.filter(i => i !== id)
    }
}

// 查看详情
const handleViewDetail = async (item: AsrTask) => {
    // 获取最新的任务详情
    const data = await useApiFetch<AsrTask>(`/api/v1/admin/asr-tasks/${item.id}`)
    if (data) {
        selectedItem.value = data
        detailDialogOpen.value = true
    }
}

// 查询单个任务状态
const handleQueryStatus = async (item: AsrTask) => {
    const data = await useApiFetch<AsrTask>(`/api/v1/admin/asr-tasks/query/${item.id}`, {
        method: 'POST',
    })
    if (data) {
        toast.success('查询成功')
        // 更新列表中的任务
        const index = items.value.findIndex(i => i.id === item.id)
        if (index !== -1) {
            items.value[index] = data
        }
    }
}

// 重试任务
const handleRetry = async (item: AsrTask) => {
    retrying.value = true
    try {
        const data = await useApiFetch<AsrTask>(`/api/v1/admin/asr-tasks/retry/${item.id}`, {
            method: 'POST',
        })
        if (data) {
            toast.success('重试任务已提交')
            // 更新列表中的任务
            const index = items.value.findIndex(i => i.id === item.id)
            if (index !== -1) {
                items.value[index] = data
            }
            // 如果在详情对话框中，也更新
            if (selectedItem.value?.id === item.id) {
                selectedItem.value = data
            }
        }
    } finally {
        retrying.value = false
    }
}

// 批量查询状态
const handleBatchQuery = async () => {
    if (!selectedIds.value.length) {
        toast.warning('请先选择要查询的任务')
        return
    }

    batchQuerying.value = true
    batchProgress.value = 0
    batchProgressText.value = `正在查询 0/${selectedIds.value.length} 个任务...`
    batchProgressDialogOpen.value = true

    try {
        const data = await useApiFetch<BatchQueryResult>('/api/v1/admin/asr-tasks/query-batch', {
            method: 'POST',
            body: { ids: selectedIds.value },
        })

        if (data) {
            batchResult.value = data
            batchProgressDialogOpen.value = false
            batchResultDialogOpen.value = true
            // 刷新列表
            loadItems()
        }
    } finally {
        batchQuerying.value = false
        batchProgressDialogOpen.value = false
    }
}

onMounted(() => {
    loadItems()
})
</script>
