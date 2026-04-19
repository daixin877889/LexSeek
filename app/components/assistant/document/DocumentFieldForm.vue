<template>
  <div class="space-y-4">
    <div
      v-for="placeholder in placeholders"
      :key="placeholder.name"
      class="space-y-1.5"
    >
      <div class="flex items-center gap-2">
        <label class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
          {{ placeholder.name }}
        </label>
        <!-- 建议值提示（hover 查看） -->
        <TooltipProvider v-if="suggestions?.[placeholder.name]">
          <Tooltip>
            <TooltipTrigger as-child>
              <span
                class="inline-flex items-center text-muted-foreground/70 cursor-help"
              >
                <LightbulbIcon class="size-3.5" />
              </span>
            </TooltipTrigger>
            <TooltipContent side="right" class="max-w-xs">
              <p class="text-xs">{{ suggestions[placeholder.name] }}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <!-- 日期选择 -->
      <template v-if="inferFieldType(placeholder.name, localValues[placeholder.name]) === 'date'">
        <Popover>
          <PopoverTrigger as-child>
            <Button
              variant="outline"
              class="w-full justify-start text-left font-normal"
              :class="!localValues[placeholder.name] && 'text-muted-foreground'"
            >
              <CalendarIcon class="mr-2 size-4" />
              {{ localValues[placeholder.name] || '请选择日期' }}
            </Button>
          </PopoverTrigger>
          <PopoverContent class="w-auto p-0" align="start">
            <Calendar
              layout="month-and-year"
              @update:model-value="(v) => onDateSelect(placeholder.name, v)"
            />
          </PopoverContent>
        </Popover>
      </template>

      <!-- 数字输入 -->
      <template v-else-if="inferFieldType(placeholder.name, localValues[placeholder.name]) === 'number'">
        <Input
          type="number"
          :model-value="localValues[placeholder.name] ?? ''"
          :placeholder="`请输入${placeholder.name}`"
          @update:model-value="(v) => onInputChange(placeholder.name, String(v))"
        />
      </template>

      <!-- 长文本 -->
      <template v-else-if="inferFieldType(placeholder.name, localValues[placeholder.name]) === 'textarea'">
        <Textarea
          :model-value="localValues[placeholder.name] ?? ''"
          :placeholder="`请输入${placeholder.name}`"
          :rows="4"
          @update:model-value="(v) => onInputChange(placeholder.name, String(v))"
        />
      </template>

      <!-- 默认：单行输入 -->
      <template v-else>
        <Input
          :model-value="localValues[placeholder.name] ?? ''"
          :placeholder="`请输入${placeholder.name}`"
          @update:model-value="(v) => onInputChange(placeholder.name, String(v))"
        />
      </template>

    </div>

    <div v-if="!placeholders.length" class="flex items-center justify-center py-8 text-muted-foreground">
      <p class="text-sm">该模板无需填写字段</p>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { CalendarIcon, LightbulbIcon } from 'lucide-vue-next'
import { useDebounceFn } from '@vueuse/core'
import type { DateValue } from 'reka-ui'
import type { DocumentTemplate, Placeholder } from '#shared/types/document'

const props = defineProps<{
  /** 各字段当前值 */
  values: Record<string, string | null>
  /** 模板（用于获取字段列表） */
  template: DocumentTemplate
  /** AI 建议值（可选） */
  suggestions?: Record<string, string>
}>()

const emit = defineEmits<{
  change: [fieldName: string, value: string]
}>()

// 提取 placeholders 列表
const placeholders = computed<Placeholder[]>(
  () => props.template.placeholders ?? [],
)

// 本地副本，避免直接改 props（immutable 原则）
const localValues = ref<Record<string, string | null>>({ ...props.values })

// 当外部 values 变化时同步（例如 AI 生成完成后更新）
watch(
  () => props.values,
  (newVals) => {
    localValues.value = { ...newVals }
  },
  { deep: true },
)

/** 推断字段控件类型 */
function inferFieldType(name: string, value: string | null | undefined): 'date' | 'number' | 'textarea' | 'input' {
  if (/日期|date|time/i.test(name)) return 'date'
  if (/金额|amount|数量|number|count/i.test(name)) return 'number'
  if ((value?.length ?? 0) > 50 || /description|内容|详情/i.test(name)) return 'textarea'
  return 'input'
}

// 防抖 emit，500ms
const debouncedEmit = useDebounceFn((fieldName: string, value: string) => {
  emit('change', fieldName, value)
}, 500)

function onInputChange(fieldName: string, value: string) {
  localValues.value = { ...localValues.value, [fieldName]: value }
  debouncedEmit(fieldName, value)
}

function onDateSelect(fieldName: string, dateValue: DateValue | undefined) {
  if (!dateValue) return
  // 格式化为 YYYY-MM-DD
  const formatted = `${dateValue.year}-${String(dateValue.month).padStart(2, '0')}-${String(dateValue.day).padStart(2, '0')}`
  localValues.value = { ...localValues.value, [fieldName]: formatted }
  emit('change', fieldName, formatted)
}

</script>
