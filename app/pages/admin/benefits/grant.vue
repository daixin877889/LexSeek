<template>
    <NuxtLayout name="admin-layout">
        <div class="space-y-6">
            <!-- 页面标题 -->
            <div>
                <h1 class="text-2xl md:text-3xl font-bold mb-1">用户权益发放</h1>
                <p class="text-muted-foreground text-sm">给用户手动发放权益</p>
            </div>

            <!-- 用户搜索 -->
            <div class="flex gap-4">
                <Input v-model="searchKeyword" placeholder="输入用户ID、手机号或姓名搜索..." class="max-w-xs"
                    @keyup.enter="handleSearch" />
                <Button @click="handleSearch" :disabled="searching">
                    <Loader2 v-if="searching" class="h-4 w-4 mr-2 animate-spin" />
                    <Search v-else class="h-4 w-4 mr-2" />
                    搜索
                </Button>
            </div>

            <!-- 搜索结果 -->
            <div v-if="searchResults.length > 0 && !selectedUser" class="bg-card rounded-lg border p-4">
                <h3 class="text-sm font-medium mb-3">搜索结果</h3>
                <div class="space-y-2">
                    <div v-for="user in searchResults" :key="user.id"
                        class="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                        @click="selectUser(user)">
                        <div class="flex items-center gap-3">
                            <Avatar class="h-10 w-10">
                                <AvatarFallback>{{ user.name?.[0] || user.phone[0] }}</AvatarFallback>
                            </Avatar>
                            <div>
                                <div class="font-medium">{{ user.name || '未设置姓名' }}</div>
                                <div class="text-sm text-muted-foreground">ID: {{ user.id }} | {{ maskPhone(user.phone)
                                }}</div>
                            </div>
                        </div>
                        <Button variant="outline" size="sm">选择</Button>
                    </div>
                </div>
            </div>

            <!-- 已选用户信息 -->
            <div v-if="selectedUser" class="space-y-6">
                <!-- 用户信息卡片 -->
                <Card>
                    <CardHeader class="pb-3">
                        <div class="flex items-center justify-between">
                            <div class="flex items-center gap-3">
                                <Avatar class="h-12 w-12">
                                    <AvatarFallback>{{ selectedUser.name?.[0] || selectedUser.phone[0]
                                    }}</AvatarFallback>
                                </Avatar>
                                <div>
                                    <CardTitle class="text-lg">{{ selectedUser.name || '未设置姓名' }}</CardTitle>
                                    <p class="text-sm text-muted-foreground">ID: {{ selectedUser.id }} | {{
                                        maskPhone(selectedUser.phone) }}</p>
                                </div>
                            </div>
                            <Button variant="ghost" size="sm" @click="clearSelection">
                                <X class="h-4 w-4" />
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <!-- 权益汇总 -->
                        <div v-if="userBenefits" class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                            <div v-for="benefit in userBenefits.summary" :key="benefit.code"
                                class="p-4 rounded-lg bg-muted/50">
                                <div class="text-sm text-muted-foreground mb-1">{{ benefit.name }}</div>
                                <div class="text-lg font-semibold">{{ benefit.formatted.used }} / {{
                                    benefit.formatted.total }}</div>
                                <div class="mt-2">
                                    <Progress :model-value="benefit.formatted.percentage"
                                        :class="getProgressColor(benefit.formatted.percentage)" />
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <!-- 发放权益表单 -->
                <Card>
                    <CardHeader>
                        <CardTitle>发放权益</CardTitle>
                    </CardHeader>
                    <CardContent class="space-y-4">
                        <div class="grid gap-4 md:grid-cols-2">
                            <div class="space-y-2">
                                <Label>权益类型 <span class="text-destructive">*</span></Label>
                                <Select v-model="grantForm.benefitId">
                                    <SelectTrigger>
                                        <SelectValue placeholder="选择权益类型" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem v-for="benefit in availableBenefits" :key="benefit.id"
                                            :value="String(benefit.id)">
                                            {{ benefit.name }}
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div class="space-y-2">
                                <Label>权益值 <span class="text-destructive">*</span></Label>
                                <div class="flex gap-2">
                                    <Input v-model.number="grantForm.inputValue" type="number" min="1" class="flex-1" />
                                    <Select v-model="grantForm.unit" class="w-24"
                                        v-if="selectedBenefitUnitType === 'byte'">
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="MB">MB</SelectItem>
                                            <SelectItem value="GB">GB</SelectItem>
                                            <SelectItem value="TB">TB</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <p v-if="selectedBenefitUnitType === 'byte'" class="text-xs text-muted-foreground">
                                    = {{ formatByteSize(computedBenefitValue) }}
                                </p>
                            </div>
                        </div>
                        <div class="grid gap-4 md:grid-cols-2">
                            <div class="space-y-2">
                                <Label>生效时间 <span class="text-destructive">*</span></Label>
                                <Popover v-model:open="effectiveDateOpen">
                                    <PopoverTrigger as-child>
                                        <Button variant="outline" :class="[
                                            'w-full justify-start text-left font-normal',
                                            !grantForm.effectiveAt && 'text-muted-foreground'
                                        ]">
                                            <CalendarIcon class="mr-2 h-4 w-4" />
                                            {{ grantForm.effectiveAt ? formatDisplayDate(grantForm.effectiveAt) :
                                                '选择生效日期'
                                            }}
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent class="w-auto p-0" align="start">
                                        <Calendar v-model="(grantForm.effectiveAt as any)" locale="zh-CN" initial-focus
                                            @update:model-value="effectiveDateOpen = false" />
                                    </PopoverContent>
                                </Popover>
                            </div>
                            <div class="space-y-2">
                                <Label>过期时间 <span class="text-destructive">*</span></Label>
                                <Popover v-model:open="expiredDateOpen">
                                    <PopoverTrigger as-child>
                                        <Button variant="outline" :class="[
                                            'w-full justify-start text-left font-normal',
                                            !grantForm.expiredAt && 'text-muted-foreground'
                                        ]">
                                            <CalendarIcon class="mr-2 h-4 w-4" />
                                            {{ grantForm.expiredAt ? formatDisplayDate(grantForm.expiredAt) : '选择过期日期'
                                            }}
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent class="w-auto p-0" align="start">
                                        <Calendar v-model="(grantForm.expiredAt as any)" locale="zh-CN" initial-focus
                                            @update:model-value="expiredDateOpen = false" />
                                    </PopoverContent>
                                </Popover>
                            </div>
                        </div>
                        <div class="space-y-2">
                            <Label>备注</Label>
                            <Input v-model="grantForm.remark" placeholder="可选备注" />
                        </div>
                        <Button @click="handleGrant" :disabled="granting" class="w-full md:w-auto">
                            <Loader2 v-if="granting" class="h-4 w-4 mr-2 animate-spin" />
                            <Gift v-else class="h-4 w-4 mr-2" />
                            发放权益
                        </Button>
                    </CardContent>
                </Card>

                <!-- 权益记录 -->
                <Card>
                    <CardHeader>
                        <div class="flex items-center justify-between">
                            <CardTitle>权益记录</CardTitle>
                            <div class="flex gap-2">
                                <Select v-model="recordFilter.benefitCode">
                                    <SelectTrigger class="w-32">
                                        <SelectValue placeholder="权益类型" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">全部类型</SelectItem>
                                        <SelectItem v-for="benefit in availableBenefits" :key="benefit.code"
                                            :value="benefit.code">
                                            {{ benefit.name }}
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                                <Select v-model="recordFilter.status">
                                    <SelectTrigger class="w-24">
                                        <SelectValue placeholder="状态" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">全部</SelectItem>
                                        <SelectItem value="1">有效</SelectItem>
                                        <SelectItem value="0">无效</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div v-if="loadingRecords" class="flex justify-center py-8">
                            <Loader2 class="h-8 w-8 animate-spin text-muted-foreground" />
                        </div>
                        <div v-else-if="!filteredRecords.length"
                            class="flex flex-col items-center justify-center py-8 text-center">
                            <FileText class="h-10 w-10 text-muted-foreground/50 mb-2" />
                            <p class="text-muted-foreground text-sm">暂无权益记录</p>
                        </div>
                        <div v-else class="overflow-x-auto">
                            <table class="w-full">
                                <thead>
                                    <tr class="border-b">
                                        <th class="px-4 py-3 text-left text-sm font-medium">权益名称</th>
                                        <th class="px-4 py-3 text-center text-sm font-medium">权益值</th>
                                        <th class="px-4 py-3 text-center text-sm font-medium">来源</th>
                                        <th class="px-4 py-3 text-center text-sm font-medium">生效时间</th>
                                        <th class="px-4 py-3 text-center text-sm font-medium">过期时间</th>
                                        <th class="px-4 py-3 text-center text-sm font-medium">状态</th>
                                        <th class="px-4 py-3 text-center text-sm font-medium w-20">操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr v-for="record in filteredRecords" :key="record.id"
                                        class="border-b last:border-b-0 hover:bg-muted/30">
                                        <td class="px-4 py-3 text-sm">{{ record.benefitName }}</td>
                                        <td class="px-4 py-3 text-center text-sm">{{ record.formattedValue }}</td>
                                        <td class="px-4 py-3 text-center">
                                            <Badge variant="outline">{{ record.sourceTypeName }}</Badge>
                                        </td>
                                        <td class="px-4 py-3 text-center text-sm text-muted-foreground">
                                            {{ formatDate(record.effectiveAt) }}
                                        </td>
                                        <td class="px-4 py-3 text-center text-sm text-muted-foreground">
                                            {{ formatDate(record.expiredAt) }}
                                        </td>
                                        <td class="px-4 py-3 text-center">
                                            <Badge :variant="record.status === 1 ? 'default' : 'secondary'">
                                                {{ record.statusName }}
                                            </Badge>
                                        </td>
                                        <td class="px-4 py-3 text-center">
                                            <Button v-if="record.status === 1" variant="ghost" size="sm"
                                                @click="handleDisable(record)">
                                                <Ban class="h-4 w-4" />
                                            </Button>
                                            <span v-else class="text-muted-foreground">-</span>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>

        <!-- 禁用确认对话框 -->
        <AlertDialog v-model:open="disableDialogOpen">
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>确认禁用</AlertDialogTitle>
                    <AlertDialogDescription>
                        确定要禁用该权益记录吗？禁用后该权益将不再生效。
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction @click="confirmDisable" :disabled="disabling"
                        class="bg-destructive text-white hover:bg-destructive/90">
                        <Loader2 v-if="disabling" class="h-4 w-4 mr-2 animate-spin" />
                        确认禁用
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    </NuxtLayout>
</template>

<script setup lang="ts">
import { Search, Loader2, X, Gift, CalendarIcon, FileText, Ban } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Progress } from '@/components/ui/progress'
import { getLocalTimeZone, today, type DateValue } from '@internationalized/date'
import dayjs from 'dayjs'
import type {
    UserBenefitSummary,
    UserBenefitRecordAdmin,
    AvailableBenefit,
} from '#shared/types/benefit'
import { formatByteSize } from '#shared/utils/unitConverision'

definePageMeta({ layout: false, title: '用户权益发放' })

// 用户搜索
const searchKeyword = ref('')
const searching = ref(false)
const searchResults = ref<Array<{
    id: number
    phone: string
    name: string
}>>([])

// 已选用户
const selectedUser = ref<{
    id: number
    phone: string
    name: string
} | null>(null)

// 用户权益数据
const userBenefits = ref<{
    summary: UserBenefitSummary[]
    records: UserBenefitRecordAdmin[]
} | null>(null)
const loadingRecords = ref(false)

// 可用权益列表
const availableBenefits = ref<AvailableBenefit[]>([])

// 发放表单
const grantForm = ref({
    benefitId: '',
    inputValue: 1,
    unit: 'GB',
    effectiveAt: today(getLocalTimeZone()) as DateValue | undefined,
    expiredAt: undefined as DateValue | undefined,
    remark: '',
})
const granting = ref(false)
const effectiveDateOpen = ref(false)
const expiredDateOpen = ref(false)

// 记录筛选
const recordFilter = ref({
    benefitCode: 'all',
    status: 'all',
})

// 禁用对话框
const disableDialogOpen = ref(false)
const disabling = ref(false)
const selectedRecord = ref<UserBenefitRecordAdmin | null>(null)

// 计算选中权益的单位类型
const selectedBenefitUnitType = computed(() => {
    if (!grantForm.value.benefitId) return ''
    const benefit = availableBenefits.value.find(b => b.id === parseInt(grantForm.value.benefitId))
    return benefit?.unitType || ''
})

// 计算权益值
const computedBenefitValue = computed(() => {
    const value = grantForm.value.inputValue || 0
    const multipliers: Record<string, number> = {
        B: 1,
        KB: 1024,
        MB: 1024 * 1024,
        GB: 1024 * 1024 * 1024,
        TB: 1024 * 1024 * 1024 * 1024,
    }
    return value * (multipliers[grantForm.value.unit] || 1)
})

// 筛选后的记录
const filteredRecords = computed(() => {
    if (!userBenefits.value) return []
    let records = userBenefits.value.records
    if (recordFilter.value.benefitCode !== 'all') {
        records = records.filter(r => r.benefitCode === recordFilter.value.benefitCode)
    }
    if (recordFilter.value.status !== 'all') {
        records = records.filter(r => r.status === parseInt(recordFilter.value.status))
    }
    return records
})

// 手机号脱敏
const maskPhone = (phone: string) => {
    if (phone.length !== 11) return phone
    return phone.slice(0, 3) + '****' + phone.slice(7)
}

// 格式化日期
const formatDate = (dateStr: string) => {
    return dayjs(dateStr).format('YYYY-MM-DD')
}

const formatDisplayDate = (date: any) => {
    if (!date) return ''
    return dayjs(date.toDate(getLocalTimeZone())).format('YYYY-MM-DD')
}

// 进度条颜色
const getProgressColor = (percentage: number) => {
    if (percentage >= 95) return '[&>div]:bg-red-500'
    if (percentage >= 80) return '[&>div]:bg-yellow-500'
    return ''
}

// 搜索用户
const handleSearch = async () => {
    if (!searchKeyword.value.trim()) {
        toast.error('请输入搜索关键词')
        return
    }

    searching.value = true
    try {
        const data = await useApiFetch<{
            users: Array<{
                id: number
                phone: string
                name: string
            }>
        }>('/api/v1/admin/users/search', {
            query: { keyword: searchKeyword.value },
        })

        if (data) {
            searchResults.value = data.users
            if (data.users.length === 0) {
                toast.info('未找到匹配的用户')
            }
        }
    } finally {
        searching.value = false
    }
}

// 选择用户
const selectUser = async (user: typeof searchResults.value[0]) => {
    selectedUser.value = user
    searchResults.value = []
    await loadUserBenefits()
}

// 清除选择
const clearSelection = () => {
    selectedUser.value = null
    userBenefits.value = null
    searchKeyword.value = ''
}

// 加载用户权益
const loadUserBenefits = async () => {
    if (!selectedUser.value) return

    loadingRecords.value = true
    try {
        const data = await useApiFetch<{
            user: { id: number; phone: string; nickname: string | null }
            summary: UserBenefitSummary[]
            records: UserBenefitRecordAdmin[]
        }>(`/api/v1/admin/users/${selectedUser.value.id}/benefits`)

        if (data) {
            userBenefits.value = {
                summary: data.summary,
                records: data.records,
            }
            // 提取可用权益列表
            availableBenefits.value = data.summary.map(s => ({
                id: 0, // 需要从其他地方获取
                code: s.code,
                name: s.name,
                unitType: s.unitType,
            }))
        }
    } finally {
        loadingRecords.value = false
    }

    // 加载可用权益列表
    const benefitsData = await useApiFetch<{
        items: Array<{
            id: number
            code: string
            name: string
            unitType: string
        }>
    }>('/api/v1/admin/benefits', { query: { status: 1, pageSize: 100 } })
    if (benefitsData) {
        availableBenefits.value = benefitsData.items.map(b => ({
            id: b.id,
            code: b.code,
            name: b.name,
            unitType: b.unitType,
        }))
    }
}

// 发放权益
const handleGrant = async () => {
    if (!selectedUser.value) return

    if (!grantForm.value.benefitId) {
        toast.error('请选择权益类型')
        return
    }
    if (!grantForm.value.inputValue || grantForm.value.inputValue <= 0) {
        toast.error('请输入有效的权益值')
        return
    }
    if (!grantForm.value.effectiveAt) {
        toast.error('请选择生效时间')
        return
    }
    if (!grantForm.value.expiredAt) {
        toast.error('请选择过期时间')
        return
    }

    granting.value = true
    try {
        const effectiveDate = grantForm.value.effectiveAt.toDate(getLocalTimeZone())
        const expiredDate = grantForm.value.expiredAt.toDate(getLocalTimeZone())
        expiredDate.setHours(23, 59, 59, 999)

        const result = await useApiFetch(`/api/v1/admin/users/${selectedUser.value.id}/benefits`, {
            method: 'POST',
            body: {
                benefitId: parseInt(grantForm.value.benefitId),
                benefitValue: computedBenefitValue.value.toString(),
                effectiveAt: effectiveDate.toISOString(),
                expiredAt: expiredDate.toISOString(),
                remark: grantForm.value.remark || undefined,
            },
        })

        if (result) {
            toast.success('发放成功')
            // 重置表单
            grantForm.value = {
                benefitId: '',
                inputValue: 1,
                unit: 'GB',
                effectiveAt: today(getLocalTimeZone()),
                expiredAt: undefined,
                remark: '',
            }
            // 刷新用户权益
            await loadUserBenefits()
        }
    } finally {
        granting.value = false
    }
}

// 禁用权益记录
const handleDisable = (record: UserBenefitRecordAdmin) => {
    selectedRecord.value = record
    disableDialogOpen.value = true
}

const confirmDisable = async () => {
    if (!selectedUser.value || !selectedRecord.value) return

    disabling.value = true
    try {
        const result = await useApiFetch(
            `/api/v1/admin/users/${selectedUser.value.id}/benefits/${selectedRecord.value.id}/disable`,
            { method: 'PUT' }
        )

        if (result) {
            toast.success('禁用成功')
            disableDialogOpen.value = false
            await loadUserBenefits()
        }
    } finally {
        disabling.value = false
    }
}
</script>
