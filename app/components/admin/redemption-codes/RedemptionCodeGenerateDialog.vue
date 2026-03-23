<template>
    <!-- 生成兑换码对话框 -->
    <Dialog :open="open" @update:open="$emit('update:open', $event)">
        <DialogContent class="max-w-md max-h-[85vh] flex flex-col">
            <DialogHeader class="shrink-0">
                <DialogTitle>生成兑换码</DialogTitle>
                <DialogDescription>批量生成兑换码，最多一次生成 1000 个</DialogDescription>
            </DialogHeader>
            <div class="flex-1 overflow-y-auto space-y-4 py-4 px-1">
                <div class="space-y-2">
                    <Label>兑换码类型 <span class="text-destructive">*</span></Label>
                    <Select v-model="form.type">
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
                    <Input v-model.number="form.quantity" type="number" min="1" max="1000" placeholder="1-1000" />
                </div>
                <div v-if="form.type === '1' || form.type === '3'" class="space-y-2">
                    <Label>会员级别 <span class="text-destructive">*</span></Label>
                    <Select v-model="form.levelId">
                        <SelectTrigger class="w-full">
                            <SelectValue placeholder="选择会员级别" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem v-for="level in membershipLevels" :key="level.id" :value="String(level.id)">
                                {{ level.name }}</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div v-if="form.type === '1' || form.type === '3'" class="space-y-2">
                    <Label>会员时长（天） <span class="text-destructive">*</span></Label>
                    <Input v-model.number="form.duration" type="number" min="1" placeholder="天数" />
                </div>
                <div v-if="form.type === '2' || form.type === '3'" class="space-y-2">
                    <Label>积分数量 <span class="text-destructive">*</span></Label>
                    <Input v-model.number="form.pointAmount" type="number" min="1" placeholder="积分数量" />
                </div>
                <div class="space-y-2">
                    <Label>过期时间</Label>
                    <Popover v-model:open="datePickerOpen">
                        <PopoverTrigger as-child>
                            <Button variant="outline" :class="[
                                'w-full justify-start text-left font-normal',
                                !form.expiredAt && 'text-muted-foreground'
                            ]">
                                <CalendarIcon class="mr-2 h-4 w-4" />
                                {{ form.expiredAt ? formatDisplayDate(form.expiredAt) : '选择过期日期（可选）' }}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent class="w-auto p-0" align="start">
                            <Calendar v-model="(form.expiredAt as any)" :min-value="(minDate as any)" locale="zh-CN"
                                initial-focus @update:model-value="datePickerOpen = false" />
                        </PopoverContent>
                    </Popover>
                </div>
                <div class="space-y-2">
                    <Label>备注</Label>
                    <Input v-model="form.remark" placeholder="可选备注，方便后续搜索" />
                </div>
            </div>
            <DialogFooter class="shrink-0">
                <Button variant="outline" @click="$emit('update:open', false)">取消</Button>
                <Button @click="handleSubmit" :disabled="generating">
                    <Loader2 v-if="generating" class="h-4 w-4 mr-2 animate-spin" />
                    生成
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
</template>

<script setup lang="ts">
import { CalendarIcon, Loader2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { getLocalTimeZone, today, type DateValue } from '@internationalized/date'
import dayjs from 'dayjs'

// 定义 props
const props = defineProps<{
    open: boolean
    membershipLevels: Array<{ id: number; name: string }>
}>()

// 定义事件
const emit = defineEmits<{
    'update:open': [value: boolean]
    success: [count: number, remark: string]
}>()

// 表单数据
const form = ref({
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

// 生成中状态
const generating = ref(false)

// 最小可选日期（今天）
const minDate = computed(() => today(getLocalTimeZone()))

// 格式化显示日期
const formatDisplayDate = (date: any) => {
    if (!date) return ''
    return dayjs(date.toDate(getLocalTimeZone())).format('YYYY-MM-DD')
}

// 重置表单
const resetForm = () => {
    form.value = {
        type: '',
        quantity: 10,
        levelId: '',
        duration: 30,
        pointAmount: 100,
        expiredAt: undefined,
        remark: '',
    }
}

// 监听对话框打开，重置表单
watch(() => props.open, (newVal) => {
    if (newVal) {
        resetForm()
    }
})

// 提交生成
const handleSubmit = async () => {
    const { type, quantity, levelId, duration, pointAmount, expiredAt, remark } = form.value

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
        // 根据类型只传递相关字段
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
            emit('update:open', false)
            emit('success', result.count, remark || '')
        }
    } finally {
        generating.value = false
    }
}
</script>
