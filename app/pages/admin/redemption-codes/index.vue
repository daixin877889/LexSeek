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
                    <Button variant="outline" @click="openExportDialog" :disabled="exporting">
                        <Download v-if="!exporting" class="h-4 w-4 mr-2" />
                        <Loader2 v-else class="h-4 w-4 mr-2 animate-spin" />
                        导出
                    </Button>
                    <Button @click="openGenerateDialog">
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
                <div class="bg-card rounded-lg border overflow-hidden hidden md:block">
                    <div class="overflow-x-auto">
                        <table class="w-full">
                            <thead>
                                <tr class="border-b bg-muted/50">
                                    <th class="px-4 py-3 text-left text-sm font-medium w-12">
                                        <Checkbox :model-value="isAllSelected" @update:model-value="toggleSelectAll" />
                                    </th>
                                    <th class="px-4 py-3 text-left text-sm font-medium">兑换码</th>
                                    <th class="px-4 py-3 text-left text-sm font-medium">类型</th>
                                    <th class="px-4 py-3 text-left text-sm font-medium">会员级别</th>
                                    <th class="px-4 py-3 text-center text-sm font-medium">时长/积分</th>
                                    <th class="px-4 py-3 text-center text-sm font-medium">状态</th>
                                    <th class="px-4 py-3 text-left text-sm font-medium">备注</th>
                                    <th class="px-4 py-3 text-left text-sm font-medium">过期时间</th>
                                    <th class="px-4 py-3 text-center text-sm font-medium w-24">操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="code in codes" :key="code.id"
                                    class="border-b last:border-b-0 hover:bg-muted/30 transition-colors">
                                    <td class="px-4 py-3">
                                        <Checkbox :model-value="selectedIds.includes(code.id)"
                                            @update:model-value="(checked: boolean | 'indeterminate') => toggleSelect(code.id, checked)" />
                                    </td>
                                    <td class="px-4 py-3 font-mono text-sm">{{ code.code }}</td>
                                    <td class="px-4 py-3">
                                        <Badge :variant="getTypeVariant(code.type)">{{ code.typeName }}</Badge>
                                    </td>
                                    <td class="px-4 py-3 text-sm">{{ code.levelName || '-' }}</td>
                                    <td class="px-4 py-3 text-center text-sm">
                                        <span v-if="code.duration">{{ code.duration }}天</span>
                                        <span v-if="code.duration && code.pointAmount"> / </span>
                                        <span v-if="code.pointAmount">{{ code.pointAmount }}积分</span>
                                        <span v-if="!code.duration && !code.pointAmount">-</span>
                                    </td>
                                    <td class="px-4 py-3 text-center">
                                        <Badge :variant="getStatusVariant(code.status)">{{ code.statusName }}</Badge>
                                    </td>
                                    <td class="px-4 py-3 text-sm text-muted-foreground max-w-32 truncate"
                                        :title="code.remark || ''">
                                        {{ code.remark || '-' }}
                                    </td>
                                    <td class="px-4 py-3 text-sm text-muted-foreground">{{ code.expiredAt || '永不过期' }}
                                    </td>
                                    <td class="px-4 py-3 text-center">
                                        <Button v-if="code.status === 1" variant="ghost" size="sm"
                                            @click="handleInvalidate(code)">
                                            <Ban class="h-4 w-4 mr-1" />
                                            作废
                                        </Button>
                                        <span v-else class="text-muted-foreground text-sm">-</span>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- 移动端卡片 -->
                <div class="md:hidden space-y-3">
                    <div v-for="code in codes" :key="code.id" class="bg-card rounded-lg border p-4 space-y-3">
                        <div class="flex items-start justify-between">
                            <div class="flex items-center gap-2">
                                <Checkbox :model-value="selectedIds.includes(code.id)"
                                    @update:model-value="(checked: boolean | 'indeterminate') => toggleSelect(code.id, checked)" />
                                <span class="font-mono text-sm">{{ code.code }}</span>
                            </div>
                            <Badge :variant="getStatusVariant(code.status)">{{ code.statusName }}</Badge>
                        </div>
                        <div class="flex flex-wrap gap-2">
                            <Badge :variant="getTypeVariant(code.type)">{{ code.typeName }}</Badge>
                            <span v-if="code.levelName" class="text-sm text-muted-foreground">{{ code.levelName
                            }}</span>
                        </div>
                        <div class="text-sm text-muted-foreground">
                            <span v-if="code.duration">{{ code.duration }}天</span>
                            <span v-if="code.duration && code.pointAmount"> / </span>
                            <span v-if="code.pointAmount">{{ code.pointAmount }}积分</span>
                        </div>
                        <div v-if="code.remark" class="text-xs text-muted-foreground">备注：{{ code.remark }}</div>
                        <div class="text-xs text-muted-foreground">
                            过期：{{ code.expiredAt || '永不过期' }} | 创建：{{ code.createdAt }}
                        </div>
                        <div v-if="code.status === 1" class="pt-2 border-t">
                            <Button variant="outline" size="sm" class="w-full" @click="handleInvalidate(code)">
                                <Ban class="h-3 w-3 mr-1" />
                                作废
                            </Button>
                        </div>
                    </div>
                </div>

                <!-- 分页 -->
                <GeneralPagination :current-page="pagination.page" :page-size="pagination.pageSize"
                    :total="pagination.total" @change="changePage" />
            </template>
        </div>

        <!-- 生成兑换码对话框 -->
        <Dialog v-model:open="generateDialogOpen">
            <DialogContent class="max-w-md max-h-[85vh] flex flex-col">
                <DialogHeader class="flex-shrink-0">
                    <DialogTitle>生成兑换码</DialogTitle>
                    <DialogDescription>批量生成兑换码，最多一次生成 1000 个</DialogDescription>
                </DialogHeader>
                <div class="flex-1 overflow-y-auto space-y-4 py-4 px-1">
                    <div class="space-y-2">
                        <Label>兑换码类型 <span class="text-destructive">*</span></Label>
                        <Select v-model="generateForm.type">
                            <SelectTrigger class="w-full">
                                <SelectValue placeholder="选择类型" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="1">仅会员</SelectItem>
                                <SelectItem value="2">仅积分</SelectItem>
                                <SelectItem value="3">会员和积分</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div class="space-y-2">
                        <Label>生成数量 <span class="text-destructive">*</span></Label>
                        <Input v-model.number="generateForm.quantity" type="number" min="1" max="1000"
                            placeholder="1-1000" />
                    </div>
                    <div v-if="generateForm.type === '1' || generateForm.type === '3'" class="space-y-2">
                        <Label>会员级别 <span class="text-destructive">*</span></Label>
                        <Select v-model="generateForm.levelId">
                            <SelectTrigger class="w-full">
                                <SelectValue placeholder="选择会员级别" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem v-for="level in membershipLevels" :key="level.id" :value="String(level.id)">
                                    {{ level.name }}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div v-if="generateForm.type === '1' || generateForm.type === '3'" class="space-y-2">
                        <Label>会员时长（天） <span class="text-destructive">*</span></Label>
                        <Input v-model.number="generateForm.duration" type="number" min="1" placeholder="天数" />
                    </div>
                    <div v-if="generateForm.type === '2' || generateForm.type === '3'" class="space-y-2">
                        <Label>积分数量 <span class="text-destructive">*</span></Label>
                        <Input v-model.number="generateForm.pointAmount" type="number" min="1" placeholder="积分数量" />
                    </div>
                    <div class="space-y-2">
                        <Label>过期时间</Label>
                        <Popover v-model:open="datePickerOpen">
                            <PopoverTrigger as-child>
                                <Button variant="outline" :class="[
                                    'w-full justify-start text-left font-normal',
                                    !generateForm.expiredAt && 'text-muted-foreground'
                                ]">
                                    <CalendarIcon class="mr-2 h-4 w-4" />
                                    {{ generateForm.expiredAt ? formatDisplayDate(generateForm.expiredAt) : '选择过期日期（可选）'
                                    }}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent class="w-auto p-0" align="start">
                                <Calendar v-model="(generateForm.expiredAt as any)" :min-value="(minDate as any)"
                                    locale="zh-CN" initial-focus @update:model-value="datePickerOpen = false" />
                            </PopoverContent>
                        </Popover>
                    </div>
                    <div class="space-y-2">
                        <Label>备注</Label>
                        <Input v-model="generateForm.remark" placeholder="可选备注，方便后续搜索" />
                    </div>
                </div>
                <DialogFooter class="flex-shrink-0">
                    <Button variant="outline" @click="generateDialogOpen = false">取消</Button>
                    <Button @click="handleGenerate" :disabled="generating">
                        <Loader2 v-if="generating" class="h-4 w-4 mr-2 animate-spin" />
                        生成
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>

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
        <Dialog v-model:open="exportDialogOpen">
            <DialogContent class="max-w-sm">
                <DialogHeader>
                    <DialogTitle>导出兑换码</DialogTitle>
                    <DialogDescription>选择导出范围</DialogDescription>
                </DialogHeader>
                <div class="py-4 space-y-3">
                    <div class="flex items-center space-x-2">
                        <RadioGroup v-model="exportOption" class="space-y-2">
                            <div class="flex items-center space-x-2">
                                <RadioGroupItem value="current" id="export-current" />
                                <Label for="export-current">导出当前筛选结果</Label>
                            </div>
                            <div class="flex items-center space-x-2">
                                <RadioGroupItem value="all" id="export-all" />
                                <Label for="export-all">导出全部兑换码</Label>
                            </div>
                            <div v-if="selectedIds.length > 0" class="flex items-center space-x-2">
                                <RadioGroupItem value="selected" id="export-selected" />
                                <Label for="export-selected">导出选中的 {{ selectedIds.length }} 项</Label>
                            </div>
                        </RadioGroup>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" @click="exportDialogOpen = false">取消</Button>
                    <Button @click="confirmExport" :disabled="exporting">
                        <Loader2 v-if="exporting" class="h-4 w-4 mr-2 animate-spin" />
                        导出
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>

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
import { Search, Plus, Download, Loader2, Ticket, Ban, CalendarIcon } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Checkbox } from '@/components/ui/checkbox'
import { getLocalTimeZone, today, type DateValue } from '@internationalized/date'
import dayjs from 'dayjs'
import type { RedemptionCodeAdminInfo } from '#shared/types/redemption'

definePageMeta({ layout: false, title: '兑换码管理' })

// 状态
const loading = ref(false)
const exporting = ref(false)
const generating = ref(false)
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

// 导出选项
const exportOption = ref<'current' | 'all' | 'selected'>('current')

// 生成表单
const generateForm = ref({
    type: '',
    quantity: 10,
    levelId: '',
    duration: 30,
    pointAmount: 100,
    expiredAt: undefined as DateValue | undefined,
    remark: '',
})

// 日期选择器弹窗状态
const datePickerOpen = ref(false)

// 最小可选日期（今天）
const minDate = computed(() => today(getLocalTimeZone()))

// 是否全选
const isAllSelected = computed(() => {
    if (codes.value.length === 0) return false
    if (selectedIds.value.length === codes.value.length) return true
    if (selectedIds.value.length > 0) return 'indeterminate'
    return false
})

// 格式化显示日期
const formatDisplayDate = (date: any) => {
    if (!date) return ''
    return dayjs(date.toDate(getLocalTimeZone())).format('YYYY-MM-DD')
}

// 会员级别列表
const membershipLevels = ref<Array<{ id: number; name: string }>>([])

// 获取类型样式
const getTypeVariant = (type: number) => {
    const variants: Record<number, 'default' | 'secondary' | 'outline'> = {
        1: 'default',
        2: 'secondary',
        3: 'outline',
    }
    return variants[type] || 'default'
}

// 获取状态样式
const getStatusVariant = (status: number) => {
    const variants: Record<number, 'default' | 'secondary' | 'destructive' | 'outline'> = {
        1: 'default',
        2: 'secondary',
        3: 'outline',
        4: 'destructive',
    }
    return variants[status] || 'default'
}

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

// 打开生成对话框
const openGenerateDialog = () => {
    generateForm.value = {
        type: '',
        quantity: 10,
        levelId: '',
        duration: 30,
        pointAmount: 100,
        expiredAt: undefined,
        remark: '',
    }
    generateDialogOpen.value = true
}

// 生成兑换码
const handleGenerate = async () => {
    const { type, quantity, levelId, duration, pointAmount, expiredAt, remark } = generateForm.value

    if (!type) {
        toast.error('请选择兑换码类型')
        return
    }
    if (!quantity || quantity < 1 || quantity > 1000) {
        toast.error('生成数量必须在 1-1000 之间')
        return
    }
    if ((type === '1' || type === '3') && !levelId) {
        toast.error('请选择会员级别')
        return
    }
    if ((type === '1' || type === '3') && (!duration || duration < 1)) {
        toast.error('请输入有效的会员时长')
        return
    }
    if ((type === '2' || type === '3') && (!pointAmount || pointAmount < 1)) {
        toast.error('请输入有效的积分数量')
        return
    }

    generating.value = true
    try {
        const body: Record<string, any> = {
            type: parseInt(type),
            quantity,
        }
        // 根据类型只传递相关字段，避免数据库存储不相关的值
        const needsMembership = type === '1' || type === '3'
        const needsPoints = type === '2' || type === '3'

        if (needsMembership && levelId) body.levelId = parseInt(levelId)
        if (needsMembership && duration) body.duration = duration
        if (needsPoints && pointAmount) body.pointAmount = pointAmount
        if (expiredAt) {
            const date = expiredAt.toDate(getLocalTimeZone())
            date.setHours(23, 59, 59, 999)
            body.expiredAt = date.toISOString()
        }
        if (remark) body.remark = remark

        const result = await useApiFetch<{ count: number }>('/api/v1/admin/redemption-codes', {
            method: 'POST',
            body,
        })

        if (result) {
            generatedCount.value = result.count
            generatedRemark.value = remark || ''
            generateDialogOpen.value = false
            generateSuccessDialogOpen.value = true
            loadCodes()
        }
    } finally {
        generating.value = false
    }
}

// 下载生成的兑换码
const downloadGeneratedCodes = () => {
    const params: Record<string, any> = { limit: generatedCount.value }
    if (generatedRemark.value) params.remark = generatedRemark.value
    // 只导出有效状态的最新生成的兑换码
    params.status = 1

    const queryString = new URLSearchParams(params).toString()
    const url = `/api/v1/admin/redemption-codes/export?${queryString}`
    window.open(url, '_blank')
    generateSuccessDialogOpen.value = false
}

// 打开导出对话框
const openExportDialog = () => {
    exportOption.value = selectedIds.value.length > 0 ? 'selected' : 'current'
    exportDialogOpen.value = true
}

// 确认导出
const confirmExport = () => {
    exporting.value = true
    try {
        const params: Record<string, any> = {}

        if (exportOption.value === 'selected' && selectedIds.value.length > 0) {
            params.ids = selectedIds.value.join(',')
        } else if (exportOption.value === 'current') {
            if (searchCode.value) params.code = searchCode.value
            if (searchRemark.value) params.remark = searchRemark.value
            if (statusFilter.value !== 'all') params.status = parseInt(statusFilter.value)
            if (typeFilter.value !== 'all') params.type = parseInt(typeFilter.value)
        }
        // exportOption === 'all' 时不传任何筛选参数

        const queryString = new URLSearchParams(params).toString()
        const url = `/api/v1/admin/redemption-codes/export${queryString ? '?' + queryString : ''}`
        window.open(url, '_blank')
        toast.success('导出成功')
        exportDialogOpen.value = false
    } finally {
        exporting.value = false
    }
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
