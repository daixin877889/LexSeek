<script lang="ts" setup>
/**
 * 三段式立场单选控件（原告/被告/中立）。
 * 始终有一项被选中——点击只切换到目标项，不会取消选中。
 */
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
</script>

<template>
  <div role="radiogroup" class="inline-flex w-fit gap-1 rounded-[9px] border border-border bg-muted p-1">
    <button
      v-for="s in stances"
      :key="s"
      type="button"
      role="radio"
      :aria-checked="props.modelValue === s"
      class="rounded-md px-4 py-1.5 text-xs font-medium transition-all"
      :class="props.modelValue === s
        ? 'bg-gradient-brand-button text-white shadow-[0_6px_14px_-7px_rgba(30,158,237,0.5)]'
        : 'text-muted-foreground hover:text-foreground'"
      @click="emit('update:modelValue', s)"
    >
      {{ CaseStanceText[s] }}
    </button>
  </div>
</template>
