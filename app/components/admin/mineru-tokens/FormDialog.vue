<template>
    <!-- MinerU Token 创建/编辑对话框 -->
    <Dialog v-model:open="open">
        <DialogContent class="max-w-lg max-h-[85vh] flex flex-col" @interactOutside="(e) => e.preventDefault()">
            <DialogHeader class="shrink-0">
                <DialogTitle>{{ isEdit ? '编辑 MinerU Token' : '新增 MinerU Token' }}</DialogTitle>
                <DialogDescription>{{ isEdit ? '修改 Token 配置' : '创建新的 MinerU API Token' }}</DialogDescription>
            </DialogHeader>
            <form class="flex-1 flex flex-col min-h-0" @submit.prevent="handleSubmit">
            <div class="flex-1 overflow-y-auto space-y-4 py-4 px-1">
                <!-- Token 名称 -->
                <div class="space-y-2">
                    <Label>Token 名称 <span class="text-destructive">*</span></Label>
                    <Input v-model="form.name" placeholder="如：主账号 Token" autocomplete="off" />
                    <p class="text-xs text-muted-foreground">用于标识不同的 Token</p>
                </div>

                <!-- Token 值 -->
                <div class="space-y-2">
                    <Label>Token 值 <span class="text-destructive">*</span></Label>
                    <div class="relative">
                        <Input v-model="form.token" :type="showToken ? 'text' : 'password'"
                            :placeholder="isEdit ? '留空则不修改' : '请输入 MinerU API Token'" class="pr-10"
                            autocomplete="new-password" />
                        <Button type="button" variant="ghost" size="icon"
                            class="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                            @click="showToken = !showToken">
                            <Eye v-if="!showToken" class="h-4 w-4 text-muted-foreground" />
                            <EyeOff v-else class="h-4 w-4 text-muted-foreground" />
                        </Button>
                    </div>
                    <p v-if="isEdit" class="text-xs text-muted-foreground">编辑时留空表示不修改 Token 值</p>
                </div>

                <!-- 备注 -->
                <div class="space-y-2">
                    <Label>备注</Label>
                    <Textarea v-model="form.remark" placeholder="Token 的用途说明或备注信息" rows="3" />
                </div>

                <!-- 状态 -->
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
                    <p class="text-xs text-muted-foreground">多个启用且未过期的 Token 之间会按 LRU 自动负载均衡</p>
                </div>

                <!-- 到期时间 -->
                <div class="space-y-2">
                    <Label>到期时间</Label>
                    <Popover v-model:open="datetimePickerOpen">
                        <PopoverTrigger as-child>
                            <Button type="button" variant="outline" :class="cn(
                                'w-full justify-start text-left font-normal',
                                !form.expiresDate && 'text-muted-foreground',
                            )">
                                <CalendarIcon class="mr-2 h-4 w-4" />
                                <span>{{ expiresDisplay || '永不过期（点击设置到期时间）' }}</span>
                                <span v-if="form.expiresDate" class="ml-auto flex items-center"
                                    @click.stop.prevent="clearExpiresAt">
                                    <X class="h-4 w-4 opacity-50 hover:opacity-100" />
                                </span>
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent class="w-auto p-0" align="start">
                            <Calendar :model-value="calendarValue" locale="zh-CN" layout="month-and-year"
                                initial-focus @update:model-value="handleCalendarSelect" />
                            <div class="border-t p-3 flex items-center gap-2">
                                <Clock class="h-4 w-4 text-muted-foreground shrink-0" />
                                <Select v-model="expiresHour" :disabled="!form.expiresDate">
                                    <SelectTrigger class="w-24">
                                        <SelectValue placeholder="时" />
                                    </SelectTrigger>
                                    <SelectContent class="max-h-60">
                                        <SelectItem v-for="h in 24" :key="h - 1"
                                            :value="String(h - 1).padStart(2, '0')">
                                            {{ String(h - 1).padStart(2, '0') }} 时
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                                <span class="text-muted-foreground">:</span>
                                <Select v-model="expiresMinute" :disabled="!form.expiresDate">
                                    <SelectTrigger class="w-24">
                                        <SelectValue placeholder="分" />
                                    </SelectTrigger>
                                    <SelectContent class="max-h-60">
                                        <SelectItem v-for="m in 60" :key="m - 1"
                                            :value="String(m - 1).padStart(2, '0')">
                                            {{ String(m - 1).padStart(2, '0') }} 分
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </PopoverContent>
                    </Popover>
                    <p class="text-xs text-muted-foreground">
                        {{ form.expiresDate
                            ? '到期后该 Token 不再被新任务选用，但已在跑的任务仍会用它继续轮询'
                            : '不设到期则永不过期；选择日期后默认时间为 23:59，可在弹出框内调整时分' }}
                    </p>
                </div>
            </div>
            <DialogFooter class="shrink-0">
                <Button type="button" variant="outline" @click="open = false">取消</Button>
                <Button type="submit" :disabled="submitting">
                    <Loader2 v-if="submitting" class="h-4 w-4 mr-2 animate-spin" />
                    {{ isEdit ? '保存' : '创建' }}
                </Button>
            </DialogFooter>
            </form>
        </DialogContent>
    </Dialog>
</template>

<script setup lang="ts">
import type { DateValue } from 'reka-ui'
import { CalendarDate } from '@internationalized/date'
import { Loader2, Eye, EyeOff, X, Calendar as CalendarIcon, Clock } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import dayjs from 'dayjs'
import { cn } from '@/lib/utils'
import { useApiFetch } from '~/composables/useApiFetch'

// MinerU Token 接口（脱敏版本）
interface MineruTokenMasked {
    id: number
    name: string
    tokenMasked: string
    remark?: string | null
    status: number
    expiresAt?: Date | string | null
    lastUsedAt?: Date | string | null
    expired?: boolean
    createdAt: Date | string
    updatedAt: Date | string
}

// 定义事件
const emit = defineEmits<{
    success: []
}>()

// 对话框状态
const open = defineModel<boolean>('open', { default: false })
const isEdit = ref(false)
const submitting = ref(false)
const showToken = ref(false)
const selectedItem = ref<MineruTokenMasked | null>(null)

// 表单数据
const form = ref(getDefaultForm())

// 把 expiresTime 'HH:mm' 拆成两个 Select 双向绑定
const expiresHour = computed({
    get: () => form.value.expiresTime.split(':')[0] || '23',
    set: (v: string) => {
        const minute = form.value.expiresTime.split(':')[1] || '59'
        form.value.expiresTime = `${v}:${minute}`
    },
})
const expiresMinute = computed({
    get: () => form.value.expiresTime.split(':')[1] || '59',
    set: (v: string) => {
        const hour = form.value.expiresTime.split(':')[0] || '23'
        form.value.expiresTime = `${hour}:${v}`
    },
})

// 一体化 datetime picker 的 popover 开关 + 显示
const datetimePickerOpen = ref(false)

const expiresDisplay = computed(() => {
    if (!form.value.expiresDate) return ''
    return `${dayjs(form.value.expiresDate).format('YYYY年MM月DD日')} ${form.value.expiresTime}`
})

// 把 form.expiresDate（YYYY-MM-DD）转成 reka-ui Calendar 期望的 DateValue
const calendarValue = computed<DateValue | undefined>(() => {
    if (!form.value.expiresDate) return undefined
    const d = dayjs(form.value.expiresDate)
    if (!d.isValid()) return undefined
    return new CalendarDate(d.year(), d.month() + 1, d.date())
})

// Calendar 选中后只更新日期；时间保持当前 expiresTime 不变
const handleCalendarSelect = (v: DateValue | undefined) => {
    if (!v) {
        clearExpiresAt()
        return
    }
    form.value.expiresDate = `${v.year}-${String(v.month).padStart(2, '0')}-${String(v.day).padStart(2, '0')}`
}

// 获取默认表单值
function getDefaultForm() {
    return {
        name: '',
        token: '',
        remark: '',
        status: '1',
        // 到期日期 'YYYY-MM-DD'（GeneralDatePicker） + 到期时间 'HH:mm'（type=time），分开承接两个原生控件
        expiresDate: null as string | null,
        expiresTime: '23:59',
    }
}

// 重置表单
const resetForm = () => {
    form.value = getDefaultForm()
    showToken.value = false
}

// 打开创建对话框
const openCreate = () => {
    isEdit.value = false
    selectedItem.value = null
    resetForm()
    open.value = true
}

// 打开编辑对话框
const openEdit = (item: MineruTokenMasked) => {
    isEdit.value = true
    selectedItem.value = item
    const expires = item.expiresAt ? dayjs(item.expiresAt) : null
    form.value = {
        name: item.name,
        token: '', // 编辑时不显示原 Token
        remark: item.remark || '',
        status: String(item.status),
        expiresDate: expires ? expires.format('YYYY-MM-DD') : null,
        expiresTime: expires ? expires.format('HH:mm') : '23:59',
    }
    showToken.value = false
    open.value = true
}

// 把表单里的到期日期 + 时间合并成提交给后端的 ISO 字符串：
// - 选了日期：合并日期 + 时间（默认 23:59）→ ISO，精确到分钟
// - 编辑时清空：null（后端清空字段）
// - 创建时未选：undefined（后端默认 → 永不过期）
const buildExpiresAtPayload = (): string | null | undefined => {
    if (form.value.expiresDate) {
        const time = form.value.expiresTime || '23:59'
        return dayjs(`${form.value.expiresDate}T${time}`).toISOString()
    }
    return isEdit.value ? null : undefined
}

// 清空到期时间（让 token 永不过期）
const clearExpiresAt = () => {
    form.value.expiresDate = null
    form.value.expiresTime = '23:59'
}

// 提交表单
const handleSubmit = async () => {
    // 验证必填字段
    if (!form.value.name.trim()) {
        toast.error('请输入 Token 名称')
        return
    }

    // 创建时 Token 必填
    if (!isEdit.value && !form.value.token.trim()) {
        toast.error('请输入 Token 值')
        return
    }

    submitting.value = true
    try {
        const body: Record<string, any> = {
            name: form.value.name.trim(),
            remark: form.value.remark?.trim() || null,
            status: parseInt(form.value.status),
            expiresAt: buildExpiresAtPayload(),
        }

        // 只有填写了 Token 才传递
        if (form.value.token.trim()) {
            body.token = form.value.token.trim()
        }

        let result
        if (isEdit.value && selectedItem.value) {
            result = await useApiFetch(`/api/v1/admin/mineru-tokens/${selectedItem.value.id}`, {
                method: 'PUT',
                body,
            })
        } else {
            result = await useApiFetch('/api/v1/admin/mineru-tokens', {
                method: 'POST',
                body,
            })
        }

        if (result !== null) {
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
