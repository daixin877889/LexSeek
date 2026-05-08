<template>
    <Popover v-model:open="isOpen">
        <PopoverTrigger as-child>
            <Button variant="outline" :class="cn(
                'w-full justify-start text-left font-normal',
                !modelValue && 'text-muted-foreground',
                props.class
            )">
                <CalendarIcon class="mr-2 h-4 w-4" />
                <span v-if="modelValue">{{ formattedDate }}</span>
                <span v-else>{{ placeholder }}</span>
                <!-- 清除按钮 -->
                <span v-if="modelValue && clearable" class="ml-auto flex items-center"
                    @click.stop.prevent="handleClear">
                    <X class="h-4 w-4 opacity-50 hover:opacity-100" />
                </span>
            </Button>
        </PopoverTrigger>
        <PopoverContent class="w-auto p-0" align="start">
            <Calendar v-model="calendarValue" :locale="locale" layout="month-and-year" initial-focus
                @update:model-value="handleSelect" />
        </PopoverContent>
    </Popover>
</template>

<script setup lang="ts">
import type { DateValue } from 'reka-ui'
import { CalendarDate, getLocalTimeZone, today } from '@internationalized/date'
import { CalendarIcon, X } from 'lucide-vue-next'
import dayjs from 'dayjs'
import { cn } from '@/lib/utils'

/** Props 定义 */
const props = withDefaults(defineProps<{
    /** 日期值（YYYY-MM-DD 格式字符串） */
    modelValue?: string | null
    /** 占位符文本 */
    placeholder?: string
    /** 是否可清除 */
    clearable?: boolean
    /** 自定义类名 */
    class?: string
    /** 语言环境 */
    locale?: string
}>(), {
    modelValue: null,
    placeholder: '选择日期',
    clearable: true,
    class: '',
    locale: 'zh-CN',
})

/** Emits 定义 */
const emit = defineEmits<{
    'update:modelValue': [value: string | null]
}>()

/** Popover 打开状态 */
const isOpen = ref(false)

/** 格式化显示的日期 */
const formattedDate = computed(() => {
    if (!props.modelValue) return ''
    return dayjs(props.modelValue).format('YYYY年MM月DD日')
})

/** 将字符串日期转换为 CalendarDate */
const calendarValue = computed<DateValue | undefined>({
    get() {
        if (!props.modelValue) return undefined
        const date = dayjs(props.modelValue)
        if (!date.isValid()) return undefined
        return new CalendarDate(date.year(), date.month() + 1, date.date())
    },
    set(value: DateValue | undefined) {
        // 由 handleSelect 处理
    }
})

/** 处理日期选择 */
const handleSelect = (value: DateValue | undefined) => {
    if (!value) {
        emit('update:modelValue', null)
        return
    }
    // 转换为 YYYY-MM-DD 格式字符串
    const dateStr = `${value.year}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}`
    emit('update:modelValue', dateStr)
}

/** 清除日期 */
const handleClear = (e: Event) => {
    e.stopPropagation()
    e.preventDefault()
    emit('update:modelValue', null)
    // 确保 Popover 不会打开
    isOpen.value = false
}
</script>
