<template>
  <div class="space-y-1.5">
    <Label v-if="label" :for="inputId">{{ label }}</Label>
    <Popover v-model:open="isOpen">
      <PopoverTrigger as-child>
        <Button
          :id="inputId"
          type="button"
          variant="outline"
          :class="cn(
            'w-full justify-start text-left font-normal',
            !modelValue && 'text-muted-foreground',
          )"
        >
          <CalendarIcon class="mr-2 h-4 w-4 shrink-0" />
          <span v-if="modelValue">{{ formattedDate }}</span>
          <span v-else>{{ placeholder }}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent class="w-auto p-0" align="start">
        <Calendar
          v-model="calendarValue"
          locale="zh-CN"
          layout="month-and-year"
          initial-focus
          @update:model-value="handleSelect"
        />
      </PopoverContent>
    </Popover>
    <p v-if="hint" class="text-xs text-muted-foreground">{{ hint }}</p>
    <p v-if="error" class="text-xs text-destructive">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import type { DateValue } from 'reka-ui'
import { CalendarDate } from '@internationalized/date'
import { CalendarIcon } from 'lucide-vue-next'
import dayjs from 'dayjs'
import { cn } from '@/lib/utils'

const props = withDefaults(defineProps<{
  /** 绑定值（YYYY-MM-DD 字符串） */
  modelValue?: string | null
  /** 标签文字 */
  label?: string
  /** 输入框 id（用于 label for 关联） */
  inputId?: string
  /** 占位符 */
  placeholder?: string
  /** 补充提示文字 */
  hint?: string
  /** 校验错误信息 */
  error?: string
}>(), {
  modelValue: null,
  label: undefined,
  inputId: undefined,
  placeholder: '选择日期',
  hint: undefined,
  error: undefined,
})

const emit = defineEmits<{
  'update:modelValue': [value: string | null]
}>()

const isOpen = ref(false)

/** 格式化显示文字 */
const formattedDate = computed(() => {
  if (!props.modelValue) return ''
  return dayjs(props.modelValue).format('YYYY年MM月DD日')
})

/** 将字符串转为 reka-ui CalendarDate */
const calendarValue = computed<DateValue | undefined>({
  get() {
    if (!props.modelValue) return undefined
    const d = dayjs(props.modelValue)
    if (!d.isValid()) return undefined
    return new CalendarDate(d.year(), d.month() + 1, d.date())
  },
  set(_value: DateValue | undefined) {
    // 由 handleSelect 处理
  },
})

/** 选中日期后转换为 YYYY-MM-DD 并 emit */
function handleSelect(value: DateValue | undefined) {
  if (!value) {
    emit('update:modelValue', null)
    return
  }
  const dateStr = [
    value.year,
    String(value.month).padStart(2, '0'),
    String(value.day).padStart(2, '0'),
  ].join('-')
  emit('update:modelValue', dateStr)
  isOpen.value = false
}
</script>
