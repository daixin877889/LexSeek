<template>
    <NuxtLayout name="admin-layout">
        <div class="space-y-6">
            <!-- 页面标题 -->
            <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                    <h1 class="text-2xl md:text-3xl font-bold mb-1">兑换码管理</h1>
                    <p class="text-muted-foreground text-sm">管理兑换码的生成、查看和作废</p>
                </div>
                <div class="flex gap-2">
                    <Button variant="outline" @click="exportDialogOpen = true" :disabled="exporting">
                        <Download v-if="!exporting" class="h-4 w-4 mr-2" />
                        <Loader2 v-else class="h-4 w-4 mr-2 animate-spin" />
                        导出
                    </Button>
                    <Button @click="generateDialogOpen = true">
                        <Plus class="h-4 w-4 mr-2" />
                        生成兑换码
                    </Button>
                </div>
            </div>

            <!-- 搜索和筛选 -->
            <div class="flex flex-col md:flex-row gap-4">
                <Input v-model="searchCode" placeholder="搜索兑换码..." class="md:max-w-xs" @keyup.enter="handleSearch" />
                <Input v-model="searchRemark" placeholder="搜索备注..." class="md:max-w-xs" @keyup.enter="handleSearch" />
                <Select v-model="statusFilter">
                    <SelectTrigger class="w-full md:w-32">
                        <SelectValue placeholder="状态" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">全部状态</SelectItem>
                        <SelectItem value="1">有效</SelectItem>
                        <SelectItem value="2">已使用</SelectItem>
                        <SelectItem value="3">已过期</SelectItem>
                        <SelectItem value="4">已作废</SelectItem>
                    </SelectContent>
                </Select>
                <Select v-model="typeFilter">
                    <SelectTrigger class="w-full md:w-32">
                        <SelectValue placeholder="类型" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">全部类型</SelectItem>
                        <SelectItem value="1">仅会员</SelectItem>
                        <SelectItem value="2">仅积分</SelectItem>
                        <SelectItem value="3">会员和积分</SelectItem>
                    </SelectContent>
                </Select>
                <Button variant="outline" @click="handleSearch">
                    <Search class="h-4 w-4 mr-2" />
                    搜索
                </Button>
            </div>

            <!-- 批量操作栏 -->
            <div v-if="selectedIds.length > 0" class="flex items-center gap-4 p-3 bg-muted/50 rounded-lg">
                <span class="text-sm">已选择 {{ selectedIds.length }} 项</span>
                <Button variant="outline" size="sm" @click="exportSelected">
                    <Download class="h-4 w-4 mr-1" />
                    导出选中
                </Button>
                <Button variant="ghost" size="sm" @click="clearSelection">清除选择</Button>
            </div>

            <!-- 加载状态 -->
            <div v-if="loading" class="flex justify-center py-12">
                <Loader2 class="h-10 w-10 animate-spin text-muted-foreground" />
            </div>

            <!-- 空状态 -->
            <div v-else-if="!codes.length" class="flex flex-col items-center justify-center py-12 text-center">
                <Ticket class="h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 class="text-lg font-medium mb-1">暂无兑换码</h3>
                <p class="text-muted-foreground text-sm">点击上方按钮生成兑换码</p>
            </div>

            <!-- 兑换码列表 -->
            <template v-else>
                <!-- 桌面端表格 -->
                <AdminRedemptionCodesRedemptionCodeTable :codes="codes" :selected-ids="selectedIds"
                    :is-all-selected="isAllSelected" @toggle-select="toggleSelect" @toggle-select-all="toggleSelectAll"
                    @invalidate="handleInvalidate" />

                <!-- 移动端卡片 -->
                <AdminRedemptionCodesRedemptionCodeMobile :codes="codes" :selected-ids="selectedIds"
                    @toggle-select="toggleSelect" @invalidate="handleInvalidate" />

                <!-- 分页 -->
                <GeneralPagination :current-page="pagination.page" :page-size="pagination.pageSize"
                    :total="pagination.total" @change="changePage" />
            </template>
        </div>

        <!-- 生成兑换码对话框 -->
        <AdminRedemptionCodesRedemptionCodeGenerateDialog v-model:open="generateDialogOpen"
            :membership-levels="membershipLevels" @success="handleGenerateSuccess" />

        <!-- 生成成功对话框 -->
        <Dialog v-model:open="generateSuccessDialogOpen">
            <DialogContent class="max-w-sm">
                <DialogHeader>
                    <DialogTitle>生成成功</DialogTitle>
                    <DialogDescription>
                        成功生成 {{ generatedCount }} 个兑换码
                    </DialogDescription>
                </DialogHeader>
                <div class="py-4 text-center">
                    <p class="text-muted-foreground text-sm mb-4">是否立即下载生成的兑换码？</p>
                </div>
                <DialogFooter class="flex gap-2">
                    <Button variant="outline" @click="generateSuccessDialogOpen = false" class="flex-1">稍后下载</Button>
                    <Button @click="downloadGeneratedCodes" class="flex-1">
                        <Download class="h-4 w-4 mr-2" />
                        立即下载
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>

        <!-- 导出选项对话框 -->
        <AdminRedemptionCodesRedemptionCodeExportDialog v-model:open="exportDialogOpen"
            :selected-count="selectedIds.length" :selected-ids="selectedIds"
            :filters="{ code: searchCode, remark: searchRemark, status: statusFilter, type: typeFilter }" />

        <!-- 作废确认对话框 -->
        <AlertDialog v-model:open="invalidateDialogOpen">
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>确认作废</AlertDialogTitle>
                    <AlertDialogDescription>
                        确定要作废兑换码「{{ selectedCode?.code }}」吗？此操作不可撤销。
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction @click="confirmInvalidate" :disabled="invalidating">
                        <Loader2 v-if="invalidating" class="h-4 w-4 mr-2 animate-spin" />
                        确认作废
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    </NuxtLayout>
</template>

<script setup lang="ts">
import { Search, Plus, Download, Loader2, Ticket } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { RedemptionCodeAdminInfo } from '#shared/types/redemption'

definePageMeta({ layout: false, title: '兑换码管理' })

// 状态
const loading = ref(false)
const exporting = ref(false)
const invalidating = ref(false)
const codes = ref<RedemptionCodeAdminInfo[]>([])
const pagination = ref({ page: 1, pageSize: 20, total: 0, totalPages: 0 })
const searchCode = ref('')
const searchRemark = ref('')
const statusFilter = ref('all')
const typeFilter = ref('all')

// 选择状态
const selectedIds = ref<number[]>([])

// 对话框状态
const generateDialogOpen = ref(false)
const generateSuccessDialogOpen = ref(false)
const exportDialogOpen = ref(false)
const invalidateDialogOpen = ref(false)
const selectedCode = ref<RedemptionCodeAdminInfo | null>(null)

// 生成结果
const generatedCount = ref(0)
const generatedRemark = ref('')

// 是否全选
const isAllSelected = computed(() => {
    if (codes.value.length === 0) return false
    if (selectedIds.value.length === codes.value.length) return true
    if (selectedIds.value.length > 0) return 'indeterminate'
    return false
})

// 会员级别列表
const membershipLevels = ref<Array<{ id: number; name: string }>>([])

// 加载会员级别
const loadMembershipLevels = async () => {
    const data = await useApiFetch<Array<{ id: number; name: string }>>('/api/v1/memberships/levels')
    if (data) membershipLevels.value = data
}

// 加载兑换码列表
const loadCodes = async () => {
    loading.value = true
    try {
        const params: Record<string, any> = {
            page: pagination.value.page,
            pageSize: pagination.value.pageSize,
        }
        if (searchCode.value) params.code = searchCode.value
        if (searchRemark.value) params.remark = searchRemark.value
        if (statusFilter.value !== 'all') params.status = parseInt(statusFilter.value)
        if (typeFilter.value !== 'all') params.type = parseInt(typeFilter.value)

        const data = await useApiFetch<{
            items: RedemptionCodeAdminInfo[]
            total: number
            totalPages: number
        }>('/api/v1/admin/redemption-codes', { query: params })

        if (data) {
            codes.value = data.items
            pagination.value.total = data.total
            pagination.value.totalPages = data.totalPages
        }
    } finally {
        loading.value = false
    }
}

// 搜索
const handleSearch = () => {
    pagination.value.page = 1
    selectedIds.value = []
    loadCodes()
}

// 翻页
const changePage = (page: number) => {
    pagination.value.page = page
    loadCodes()
}

// 选择操作
const toggleSelect = (id: number, checked: boolean | 'indeterminate') => {
    if (checked === true) {
        if (!selectedIds.value.includes(id)) {
            selectedIds.value.push(id)
        }
    } else {
        selectedIds.value = selectedIds.value.filter(i => i !== id)
    }
}

const toggleSelectAll = (checked: boolean | 'indeterminate') => {
    if (checked === true) {
        selectedIds.value = codes.value.map(code => code.id)
    } else {
        selectedIds.value = []
    }
}

const clearSelection = () => {
    selectedIds.value = []
}

// 生成成功回调
const handleGenerateSuccess = (count: number, remark: string) => {
    generatedCount.value = count
    generatedRemark.value = remark
    generateSuccessDialogOpen.value = true
    loadCodes()
}

// 下载生成的兑换码
const downloadGeneratedCodes = () => {
    const params: Record<string, any> = { limit: generatedCount.value }
    if (generatedRemark.value) params.remark = generatedRemark.value
    params.status = 1

    const queryString = new URLSearchParams(params).toString()
    const url = `/api/v1/admin/redemption-codes/export?${queryString}`
    window.open(url, '_blank')
    generateSuccessDialogOpen.value = false
}

// 导出选中项
const exportSelected = () => {
    if (selectedIds.value.length === 0) {
        toast.error('请先选择要导出的兑换码')
        return
    }
    const params = { ids: selectedIds.value.join(',') }
    const queryString = new URLSearchParams(params).toString()
    const url = `/api/v1/admin/redemption-codes/export?${queryString}`
    window.open(url, '_blank')
    toast.success('导出成功')
}

// 作废兑换码
const handleInvalidate = (code: RedemptionCodeAdminInfo) => {
    selectedCode.value = code
    invalidateDialogOpen.value = true
}

const confirmInvalidate = async () => {
    if (!selectedCode.value) return

    invalidating.value = true
    try {
        const result = await useApiFetch(`/api/v1/admin/redemption-codes/${selectedCode.value.id}/invalidate`, {
            method: 'PUT',
        })

        if (result !== null) {
            toast.success('作废成功')
            invalidateDialogOpen.value = false
            loadCodes()
        }
    } finally {
        invalidating.value = false
    }
}

onMounted(() => {
    loadMembershipLevels()
    loadCodes()
})
</script>
