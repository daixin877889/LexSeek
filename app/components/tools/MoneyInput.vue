<template>
  <div class="space-y-1.5">
    <Label v-if="label" :for="inputId">{{ label }}</Label>
    <Input
      :id="inputId"
      type="number"
      :min="min"
      :step="step"
      :placeholder="placeholder"
      :model-value="modelValue ?? undefined"
      @update:model-value="handleInput"
    />
    <p v-if="showChinese && chineseAmount" class="text-xs text-muted-foreground">
      大写：{{ chineseAmount }}
    </p>
    <p v-if="hint" class="text-xs text-muted-foreground">{{ hint }}</p>
    <p v-if="error" class="text-xs text-destructive">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import { numberToChinese } from '#shared/utils/tools/utils/calculator'

const props = withDefaults(defineProps<{
  /** 绑定值（数字） */
  modelValue?: number | string | null
  /** 标签文字 */
  label?: string
  /** 输入框 id */
  inputId?: string
  /** 占位符 */
  placeholder?: string
  /** 最小值 */
  min?: number
  /** 步进值 */
  step?: number | string
  /** 是否显示中文大写 */
  showChinese?: boolean
  /** 补充提示文字 */
  hint?: string
  /** 校验错误信息 */
  error?: string
}>(), {
  modelValue: null,
  label: undefined,
  inputId: undefined,
  placeholder: '请输入金额',
  min: 0,
  step: 'any',
  showChinese: false,
  hint: undefined,
  error: undefined,
})

const emit = defineEmits<{
  'update:modelValue': [value: number | string | null]
}>()

/** 当前数字值（用于生成中文大写） */
const numericValue = computed<number | null>(() => {
  if (props.modelValue === null || props.modelValue === undefined || props.modelValue === '') return null
  const n = typeof props.modelValue === 'string' ? parseFloat(props.modelValue) : props.modelValue
  return Number.isFinite(n) ? n : null
})

/** 中文大写金额 */
const chineseAmount = computed(() => {
  if (numericValue.value === null) return ''
  return numberToChinese(numericValue.value)
})

function handleInput(value: string | number) {
  emit('update:modelValue', value)
}
</script>
