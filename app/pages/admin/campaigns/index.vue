<template>
    <NuxtLayout name="admin-layout">
        <div class="space-y-6">
            <!-- 页面标题 -->
            <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                    <h1 class="text-2xl md:text-3xl font-bold mb-1">营销活动管理</h1>
                    <p class="text-muted-foreground text-sm">管理注册赠送、邀请奖励等营销活动</p>
                </div>
                <Button @click="openCreateDialog">
                    <Plus class="h-4 w-4 mr-2" />
                    新增活动
                </Button>
            </div>

            <!-- 筛选 -->
            <div class="flex flex-col md:flex-row gap-4">
                <Select v-model="typeFilter">
                    <SelectTrigger class="w-full md:w-40">
                        <SelectValue placeholder="活动类型" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">全部类型</SelectItem>
                        <SelectItem value="1">注册赠送</SelectItem>
                        <SelectItem value="2">邀请奖励</SelectItem>
                        <SelectItem value="3">活动奖励</SelectItem>
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
            <div v-else-if="!campaigns.length" class="flex flex-col items-center justify-center py-12 text-center">
                <Megaphone class="h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 class="text-lg font-medium mb-1">暂无营销活动</h3>
                <p class="text-muted-foreground text-sm">点击上方按钮新增活动</p>
            </div>

            <!-- 活动列表 -->
            <template v-else>
                <!-- 桌面端表格 -->
                <div class="bg-card rounded-lg border overflow-hidden hidden md:block">
                    <div class="overflow-x-auto">
                        <table class="w-full">
                            <thead>
                                <tr class="border-b bg-muted/50">
                                    <th class="px-4 py-3 text-left text-sm font-medium">活动名称</th>
                                    <th class="px-4 py-3 text-left text-sm font-medium">类型</th>
                                    <th class="px-4 py-3 text-left text-sm font-medium">奖励内容</th>
                                    <th class="px-4 py-3 text-left text-sm font-medium">活动时间</th>
                                    <th class="px-4 py-3 text-center text-sm font-medium">状态</th>
                                    <th class="px-4 py-3 text-center text-sm font-medium w-32">操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="campaign in campaigns" :key="campaign.id"
                                    class="border-b last:border-b-0 hover:bg-muted/30 transition-colors">
                                    <td class="px-4 py-3">
                                        <div class="font-medium">{{ campaign.name }}</div>
                                        <div v-if="campaign.remark"
                                            class="text-xs text-muted-foreground truncate max-w-48">
                                            {{ campaign.remark }}
                                        </div>
                                    </td>
                                    <td class="px-4 py-3">
                                        <Badge :variant="getTypeVariant(campaign.type)">
                                            {{ getTypeName(campaign.type) }}
                                        </Badge>
                                    </td>
                                    <td class="px-4 py-3 text-sm">
                                        <div v-if="campaign.levelName">
                                            会员: {{ campaign.levelName }}
                                            <span v-if="campaign.duration">({{ campaign.duration }}天)</span>
                                        </div>
                                        <div v-if="campaign.giftPoint">积分: {{ campaign.giftPoint }}</div>
                                        <span v-if="!campaign.levelName && !campaign.giftPoint">-</span>
                                    </td>
                                    <td class="px-4 py-3 text-sm">
                                        <div>开始: {{ campaign.startAt }}</div>
                                        <div>结束: {{ campaign.endAt || '长期有效' }}</div>
                                    </td>
                                    <td class="px-4 py-3 text-center">
                                        <Badge :variant="campaign.status === 1 ? 'default' : 'outline'">
                                            {{ campaign.status === 1 ? '启用' : '禁用' }}
                                        </Badge>
                                    </td>
                                    <td class="px-4 py-3 text-center">
                                        <div class="flex items-center justify-center gap-1">
                                            <Button variant="ghost" size="sm" @click="openEditDialog(campaign)">
                                                <Pencil class="h-4 w-4" />
                                            </Button>
                                            <Button variant="ghost" size="sm" @click="handleToggleStatus(campaign)">
                                                <component :is="campaign.status === 1 ? Pause : Play" class="h-4 w-4" />
                                            </Button>
                                            <Button variant="ghost" size="sm" @click="handleDelete(campaign)">
                                                <Trash2 class="h-4 w-4 text-destructive" />
                                            </Button>
                                        </div>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- 移动端卡片 -->
                <div class="md:hidden space-y-3">
                    <div v-for="campaign in campaigns" :key="campaign.id"
                        class="bg-card rounded-lg border p-4 space-y-3">
                        <div class="flex items-start justify-between">
                            <div>
                                <div class="font-medium">{{ campaign.name }}</div>
                                <div v-if="campaign.remark" class="text-xs text-muted-foreground">
                                    {{ campaign.remark }}
                                </div>
                            </div>
                            <Badge :variant="campaign.status === 1 ? 'default' : 'outline'">
                                {{ campaign.status === 1 ? '启用' : '禁用' }}
                            </Badge>
                        </div>
                        <div class="flex flex-wrap gap-2">
                            <Badge :variant="getTypeVariant(campaign.type)">
                                {{ getTypeName(campaign.type) }}
                            </Badge>
                        </div>
                        <div class="text-sm">
                            <div v-if="campaign.levelName">
                                会员: {{ campaign.levelName }}
                                <span v-if="campaign.duration">({{ campaign.duration }}天)</span>
                            </div>
                            <div v-if="campaign.giftPoint">积分: {{ campaign.giftPoint }}</div>
                        </div>
                        <div class="text-xs text-muted-foreground">
                            {{ campaign.startAt }} ~ {{ campaign.endAt || '长期有效' }}
                        </div>
                        <div class="pt-2 border-t flex gap-2">
                            <Button variant="outline" size="sm" class="flex-1" @click="openEditDialog(campaign)">
                                <Pencil class="h-3 w-3 mr-1" />
                                编辑
                            </Button>
                            <Button variant="outline" size="sm" @click="handleToggleStatus(campaign)">
                                <component :is="campaign.status === 1 ? Pause : Play" class="h-3 w-3" />
                            </Button>
                            <Button variant="outline" size="sm" @click="handleDelete(campaign)">
                                <Trash2 class="h-3 w-3 text-destructive" />
                            </Button>
                        </div>
                    </div>
                </div>

                <!-- 分页 -->
                <GeneralPagination :current-page="pagination.page" :page-size="pagination.pageSize"
                    :total="pagination.total" @change="changePage" />
            </template>
        </div>

        <!-- 创建/编辑对话框 -->
        <Dialog v-model:open="dialogOpen">
            <DialogContent class="max-w-lg max-h-[85vh] flex flex-col">
                <DialogHeader class="flex-shrink-0">
                    <DialogTitle>{{ isEdit ? '编辑活动' : '新增活动' }}</DialogTitle>
                    <DialogDescription>{{ isEdit ? '修改营销活动信息' : '创建新的营销活动' }}</DialogDescription>
                </DialogHeader>
                <div class="flex-1 overflow-y-auto space-y-4 py-4 px-1">
                    <div class="space-y-2">
                        <Label>活动名称 <span class="text-destructive">*</span></Label>
                        <Input v-model="form.name" placeholder="输入活动名称" />
                    </div>
                    <div class="space-y-2">
                        <Label>活动类型 <span class="text-destructive">*</span></Label>
                        <Select v-model="form.type" :disabled="isEdit">
                            <SelectTrigger class="w-full">
                                <SelectValue placeholder="选择活动类型" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="1">注册赠送</SelectItem>
                                <SelectItem value="2">邀请奖励</SelectItem>
                                <SelectItem value="3">活动奖励</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div class="space-y-2">
                        <Label>赠送会员级别</Label>
                        <Select v-model="form.levelId">
                            <SelectTrigger class="w-full">
                                <SelectValue placeholder="选择会员级别（可选）" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="none">不赠送会员</SelectItem>
                                <SelectItem v-for="level in membershipLevels" :key="level.id" :value="String(level.id)">
                                    {{ level.name }}
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div v-if="form.levelId && form.levelId !== 'none'" class="space-y-2">
                        <Label>会员时长（天） <span class="text-destructive">*</span></Label>
                        <Input v-model.number="form.duration" type="number" min="1" placeholder="天数" />
                    </div>
                    <div class="space-y-2">
                        <Label>赠送积分</Label>
                        <Input v-model.number="form.giftPoint" type="number" min="0" placeholder="0" />
                    </div>
                    <div class="space-y-2">
                        <Label>开始时间 <span class="text-destructive">*</span></Label>
                        <Popover v-model:open="startDatePickerOpen">
                            <PopoverTrigger as-child>
                                <Button variant="outline" :class="[
                                    'w-full justify-start text-left font-normal',
                                    !form.startAt && 'text-muted-foreground'
                                ]">
                                    <CalendarIcon class="mr-2 h-4 w-4" />
                                    {{ form.startAt ? formatDisplayDate(form.startAt) : '选择开始日期' }}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent class="w-auto p-0" align="start">
                                <Calendar v-model="(form.startAt as any)" locale="zh-CN" initial-focus
                                    @update:model-value="startDatePickerOpen = false" />
                            </PopoverContent>
                        </Popover>
                    </div>
                    <div class="space-y-2">
                        <Label>结束时间</Label>
                        <Popover v-model:open="endDatePickerOpen">
                            <PopoverTrigger as-child>
                                <Button variant="outline" :class="[
                                    'w-full justify-start text-left font-normal',
                                    !form.endAt && 'text-muted-foreground'
                                ]">
                                    <CalendarIcon class="mr-2 h-4 w-4" />
                                    {{ form.endAt ? formatDisplayDate(form.endAt) : '选择结束日期（可选，不选为长期）' }}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent class="w-auto p-0" align="start">
                                <Calendar v-model="(form.endAt as any)" locale="zh-CN" initial-focus
                                    @update:model-value="endDatePickerOpen = false" />
                            </PopoverContent>
                        </Popover>
                        <Button v-if="form.endAt" variant="ghost" size="sm" @click="form.endAt = undefined">
                            清除结束时间
                        </Button>
                    </div>
                    <div class="space-y-2">
                        <Label>状态</Label>
                        <Select v-model="form.status">
                            <SelectTrigger class="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="1">启用</SelectItem>
                                <SelectItem value="0">禁用</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div class="space-y-2">
                        <Label>备注</Label>
                        <Input v-model="form.remark" placeholder="可选备注" />
                    </div>
                </div>
                <DialogFooter class="flex-shrink-0">
                    <Button variant="outline" @click="dialogOpen = false">取消</Button>
                    <Button @click="handleSubmit" :disabled="submitting">
                        <Loader2 v-if="submitting" class="h-4 w-4 mr-2 animate-spin" />
                        {{ isEdit ? '保存' : '创建' }}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>

        <!-- 删除确认对话框 -->
        <AlertDialog v-model:open="deleteDialogOpen">
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>确认删除</AlertDialogTitle>
                    <AlertDialogDescription>
                        确定要删除活动「{{ selectedCampaign?.name }}」吗？此操作不可撤销。
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
import { Search, Plus, Loader2, Megaphone, Pencil, Trash2, Play, Pause, CalendarIcon } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { getLocalTimeZone, parseDate, type DateValue } from '@internationalized/date'
import dayjs from 'dayjs'
import type { CampaignInfo } from '#shared/types/campaign'

definePageMeta({ layout: false, title: '营销活动管理' })

// 状态
const loading = ref(false)
const submitting = ref(false)
const deleting = ref(false)
const campaigns = ref<CampaignInfo[]>([])
const pagination = ref({ page: 1, pageSize: 20, total: 0 })
const typeFilter = ref('all')
const statusFilter = ref('all')

// 对话框状态
const dialogOpen = ref(false)
const deleteDialogOpen = ref(false)
const isEdit = ref(false)
const selectedCampaign = ref<CampaignInfo | null>(null)
const startDatePickerOpen = ref(false)
const endDatePickerOpen = ref(false)

// 会员级别列表
const membershipLevels = ref<Array<{ id: number; name: string }>>([])

// 表单
const form = ref({
    name: '',
    type: '',
    levelId: '',
    duration: undefined as number | undefined,
    giftPoint: undefined as number | undefined,
    startAt: undefined as DateValue | undefined,
    endAt: undefined as DateValue | undefined,
    status: '1',
    remark: '',
})

// 获取类型名称
const getTypeName = (type: number) => {
    const names: Record<number, string> = { 1: '注册赠送', 2: '邀请奖励', 3: '活动奖励' }
    return names[type] || '未知'
}

// 获取类型样式
const getTypeVariant = (type: number) => {
    const variants: Record<number, 'default' | 'secondary' | 'outline'> = { 1: 'default', 2: 'secondary', 3: 'outline' }
    return variants[type] || 'default'
}

// 格式化显示日期
const formatDisplayDate = (date: any) => {
    if (!date) return ''
    return dayjs(date.toDate(getLocalTimeZone())).format('YYYY-MM-DD')
}

// 加载会员级别
const loadMembershipLevels = async () => {
    const data = await useApiFetch<Array<{ id: number; name: string }>>('/api/v1/memberships/levels')
    if (data) membershipLevels.value = data
}

// 加载活动列表
const loadCampaigns = async () => {
    loading.value = true
    try {
        const params: Record<string, any> = {
            page: pagination.value.page,
            pageSize: pagination.value.pageSize,
        }
        if (typeFilter.value !== 'all') params.type = parseInt(typeFilter.value)
        if (statusFilter.value !== 'all') params.status = parseInt(statusFilter.value)

        const data = await useApiFetch<{ items: CampaignInfo[]; total: number }>('/api/v1/admin/campaigns', { query: params })
        if (data) {
            campaigns.value = data.items
            pagination.value.total = data.total
        }
    } finally {
        loading.value = false
    }
}

// 筛选
const handleSearch = () => {
    pagination.value.page = 1
    loadCampaigns()
}

// 翻页
const changePage = (page: number) => {
    pagination.value.page = page
    loadCampaigns()
}

// 重置表单
const resetForm = () => {
    form.value = {
        name: '',
        type: '',
        levelId: 'none',
        duration: undefined,
        giftPoint: undefined,
        startAt: undefined,
        endAt: undefined,
        status: '1',
        remark: '',
    }
}

// 打开创建对话框
const openCreateDialog = () => {
    isEdit.value = false
    resetForm()
    dialogOpen.value = true
}

// 打开编辑对话框
const openEditDialog = (campaign: CampaignInfo) => {
    isEdit.value = true
    selectedCampaign.value = campaign

    // 解析日期字符串
    let startAtDate: DateValue | undefined
    let endAtDate: DateValue | undefined

    if (campaign.startAt) {
        const dateStr = campaign.startAt.split(' ')[0]
        if (dateStr) {
            startAtDate = parseDate(dateStr)
        }
    }

    if (campaign.endAt) {
        const dateStr = campaign.endAt.split(' ')[0]
        if (dateStr) {
            endAtDate = parseDate(dateStr)
        }
    }

    form.value = {
        name: campaign.name,
        type: String(campaign.type),
        levelId: campaign.levelId ? String(campaign.levelId) : 'none',
        duration: campaign.duration ?? undefined,
        giftPoint: campaign.giftPoint ?? undefined,
        startAt: startAtDate,
        endAt: endAtDate,
        status: String(campaign.status),
        remark: campaign.remark || '',
    }
    dialogOpen.value = true
}

// 提交表单
const handleSubmit = async () => {
    if (!form.value.name) {
        toast.error('请输入活动名称')
        return
    }
    if (!form.value.type) {
        toast.error('请选择活动类型')
        return
    }
    if (!form.value.startAt) {
        toast.error('请选择开始时间')
        return
    }
    if (form.value.levelId && form.value.levelId !== 'none' && !form.value.duration) {
        toast.error('请输入会员时长')
        return
    }

    submitting.value = true
    try {
        const startDate = form.value.startAt.toDate(getLocalTimeZone())
        startDate.setHours(0, 0, 0, 0)

        let endDate = null
        if (form.value.endAt) {
            endDate = form.value.endAt.toDate(getLocalTimeZone())
            endDate.setHours(23, 59, 59, 999)
        }

        // 处理 levelId：'none' 表示不赠送会员
        const levelId = form.value.levelId && form.value.levelId !== 'none'
            ? parseInt(form.value.levelId)
            : null

        const body: Record<string, any> = {
            name: form.value.name,
            type: parseInt(form.value.type),
            levelId,
            duration: levelId ? (form.value.duration || null) : null,
            giftPoint: form.value.giftPoint || null,
            startAt: startDate.toISOString(),
            endAt: endDate ? endDate.toISOString() : null,
            status: parseInt(form.value.status),
            remark: form.value.remark || null,
        }

        let result
        if (isEdit.value && selectedCampaign.value) {
            result = await useApiFetch(`/api/v1/admin/campaigns/${selectedCampaign.value.id}`, {
                method: 'PUT',
                body,
            })
        } else {
            result = await useApiFetch('/api/v1/admin/campaigns', {
                method: 'POST',
                body,
            })
        }

        if (result) {
            toast.success(isEdit.value ? '保存成功' : '创建成功')
            dialogOpen.value = false
            loadCampaigns()
        }
    } finally {
        submitting.value = false
    }
}

// 切换状态
const handleToggleStatus = async (campaign: CampaignInfo) => {
    const result = await useApiFetch(`/api/v1/admin/campaigns/${campaign.id}/status`, { method: 'PATCH' })
    if (result) {
        toast.success('状态已更新')
        loadCampaigns()
    }
}

// 删除活动
const handleDelete = (campaign: CampaignInfo) => {
    selectedCampaign.value = campaign
    deleteDialogOpen.value = true
}

const confirmDelete = async () => {
    if (!selectedCampaign.value) return
    deleting.value = true
    try {
        const result = await useApiFetch(`/api/v1/admin/campaigns/${selectedCampaign.value.id}`, { method: 'DELETE' })
        if (result) {
            toast.success('删除成功')
            deleteDialogOpen.value = false
            loadCampaigns()
        }
    } finally {
        deleting.value = false
    }
}

onMounted(() => {
    loadMembershipLevels()
    loadCampaigns()
})
</script>
