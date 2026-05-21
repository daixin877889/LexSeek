<template>
    <!-- 营销活动创建/编辑对话框 -->
    <Dialog v-model:open="open">
        <DialogContent class="theme-brand max-h-[85vh] max-w-lg flex flex-col">
            <DialogHeader class="shrink-0">
                <DialogTitle>{{ isEdit ? '编辑活动' : '新增活动' }}</DialogTitle>
                <DialogDescription>{{ isEdit ? '修改营销活动信息' : '创建新的营销活动' }}</DialogDescription>
            </DialogHeader>
            <div class="flex-1 overflow-y-auto space-y-4 py-4 px-1">
                <div class="space-y-2">
                    <Label>活动名称 <span class="text-destructive">*</span></Label>
                    <Input v-model="form.name" placeholder="输入活动名称" :class="adminBrandFocusClass" />
                </div>
                <div class="space-y-2">
                    <Label>活动类型 <span class="text-destructive">*</span></Label>
                    <Select v-model="form.type" :disabled="isEdit">
                        <SelectTrigger :class="['w-full', adminBrandFocusClass]">
                            <SelectValue placeholder="选择活动类型" />
                        </SelectTrigger>
                        <SelectContent class="theme-brand">
                            <SelectItem value="1">注册赠送</SelectItem>
                            <SelectItem value="2">邀请奖励</SelectItem>
                            <SelectItem value="3">活动奖励</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div class="space-y-2">
                    <Label>赠送会员级别</Label>
                    <Select v-model="form.levelId">
                        <SelectTrigger :class="['w-full', adminBrandFocusClass]">
                            <SelectValue placeholder="选择会员级别（可选）" />
                        </SelectTrigger>
                        <SelectContent class="theme-brand">
                            <SelectItem value="none">不赠送会员</SelectItem>
                            <SelectItem v-for="level in membershipLevels" :key="level.id" :value="String(level.id)">
                                {{ level.name }}
                            </SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div v-if="form.levelId && form.levelId !== 'none'" class="space-y-2">
                    <Label>会员时长（天） <span class="text-destructive">*</span></Label>
                    <Input v-model.number="form.duration" type="number" min="1" placeholder="天数"
                        :class="adminBrandFocusClass" />
                </div>
                <div class="space-y-2">
                    <Label>赠送积分</Label>
                    <Input v-model.number="form.giftPoint" type="number" min="0" placeholder="0"
                        :class="adminBrandFocusClass" />
                </div>
                <div class="space-y-2">
                    <Label>开始时间 <span class="text-destructive">*</span></Label>
                    <Popover v-model:open="startDatePickerOpen">
                        <PopoverTrigger as-child>
                            <Button variant="outline" :class="[
                                'w-full justify-start text-left font-normal',
                                adminBrandFocusClass,
                                !form.startAt && 'text-muted-foreground'
                            ]">
                                <CalendarIcon class="mr-2 h-4 w-4" />
                                {{ form.startAt ? formatDisplayDate(form.startAt) : '选择开始日期' }}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent class="theme-brand w-auto p-0" align="start">
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
                                adminBrandFocusClass,
                                !form.endAt && 'text-muted-foreground'
                            ]">
                                <CalendarIcon class="mr-2 h-4 w-4" />
                                {{ form.endAt ? formatDisplayDate(form.endAt) : '选择结束日期（可选，不选为长期）' }}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent class="theme-brand w-auto p-0" align="start">
                            <Calendar v-model="(form.endAt as any)" locale="zh-CN" initial-focus
                                @update:model-value="endDatePickerOpen = false" />
                        </PopoverContent>
                    </Popover>
                    <Button v-if="form.endAt" variant="ghost" size="sm" :class="adminBrandFocusClass"
                        @click="form.endAt = undefined">
                        清除结束时间
                    </Button>
                </div>
                <div class="space-y-2">
                    <Label>状态</Label>
                    <Select v-model="form.status">
                        <SelectTrigger :class="['w-full', adminBrandFocusClass]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent class="theme-brand">
                            <SelectItem value="1">启用</SelectItem>
                            <SelectItem value="0">禁用</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div class="space-y-2">
                    <Label>备注</Label>
                    <Input v-model="form.remark" placeholder="可选备注" :class="adminBrandFocusClass" />
                </div>
            </div>
            <DialogFooter class="shrink-0">
                <Button variant="outline" :class="adminBrandFocusClass" @click="open = false">取消</Button>
                <Button :class="adminBrandPrimaryButtonClass" @click="handleSubmit" :disabled="submitting">
                    <Loader2 v-if="submitting" class="h-4 w-4 mr-2 animate-spin" />
                    {{ isEdit ? '保存' : '创建' }}
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
</template>

<script setup lang="ts">
import { Loader2, CalendarIcon } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { getLocalTimeZone, parseDate, type DateValue } from '@internationalized/date'
import dayjs from 'dayjs'
import type { CampaignInfo } from '#shared/types/campaign'
import { useApiFetch } from '~/composables/useApiFetch'
import {
    adminBrandFocusClass,
    adminBrandPrimaryButtonClass,
} from '~/utils/adminBrandStyles'

// 定义 props
defineProps<{
    membershipLevels: Array<{ id: number; name: string }>
}>()

// 定义事件
const emit = defineEmits<{
    success: []
}>()

// 对话框状态
const open = defineModel<boolean>('open', { default: false })
const isEdit = ref(false)
const submitting = ref(false)
const selectedCampaign = ref<CampaignInfo | null>(null)
const startDatePickerOpen = ref(false)
const endDatePickerOpen = ref(false)

// 表单数据
const form = ref(getDefaultForm())

// 获取默认表单值
function getDefaultForm() {
    return {
        name: '',
        type: '',
        levelId: 'none',
        duration: undefined as number | undefined,
        giftPoint: undefined as number | undefined,
        startAt: undefined as DateValue | undefined,
        endAt: undefined as DateValue | undefined,
        status: '1',
        remark: '',
    }
}

// 格式化显示日期
const formatDisplayDate = (date: any) => {
    if (!date) return ''
    return dayjs(date.toDate(getLocalTimeZone())).format('YYYY-MM-DD')
}

// 重置表单
const resetForm = () => {
    form.value = getDefaultForm()
}

// 打开创建对话框
const openCreate = () => {
    isEdit.value = false
    selectedCampaign.value = null
    resetForm()
    open.value = true
}

// 打开编辑对话框
const openEdit = (campaign: CampaignInfo) => {
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
    open.value = true
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
            open.value = false
            emit('success')
        }
    } finally {
        submitting.value = false
    }
}

// 暴露方法给父组件
defineExpose({
    openCreate,
    openEdit,
})
</script>
