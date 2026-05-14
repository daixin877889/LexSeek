<script lang="ts" setup>
/**
 * 三段式立场单选控件（原告/被告/中立）。
 * 封装 shadcn-vue ToggleGroup 的"再次点击取消选中"行为：
 * 若 v-model 变为空字符串，watch 拦截并还原为上一个有效值，
 * 保证业务上始终有立场被选中。
 */
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { CaseStance, CaseStanceText } from '#shared/types/case'

const props = defineProps<{
  modelValue: CaseStance
}>()

const emit = defineEmits<{
  'update:modelValue': [val: CaseStance]
}>()

const stances: CaseStance[] = [
  CaseStance.PLAINTIFF,
  CaseStance.DEFENDANT,
  CaseStance.NEUTRAL,
]

function handleChange(val: string | string[] | null | undefined) {
  // shadcn-vue ToggleGroup type=single 在用户"再次点击当前项"取消选中时
  // 会发出空字符串或 null —— 业务上必须始终有立场被选中，统一拦截还原。
  if (val == null || val === '' || (Array.isArray(val) && val.length === 0)) {
    emit('update:modelValue', props.modelValue)
    return
  }
  const v = Array.isArray(val) ? val[0] : val
  if (typeof v !== 'string' || v === '') {
    emit('update:modelValue', props.modelValue)
    return
  }
  emit('update:modelValue', v as CaseStance)
}
</script>

<template>
  <ToggleGroup
    type="single"
    variant="outline"
    :model-value="props.modelValue"
    class="w-full grid grid-cols-3 gap-2"
    @update:model-value="handleChange"
  >
    <ToggleGroupItem
      v-for="s in stances"
      :key="s"
      :value="s"
      class="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
    >
      {{ CaseStanceText[s] }}
    </ToggleGroupItem>
  </ToggleGroup>
</template>
