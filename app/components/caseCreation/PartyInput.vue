<template>
  <div class="space-y-2">
    <label v-if="label" class="text-[13px] font-semibold">{{ label }}</label>

    <div v-for="(_, index) in modelValue" :key="index" class="flex items-center gap-2">
      <Input :model-value="modelValue[index]" :placeholder="placeholder || `请输入${label}姓名或名称`"
        @update:model-value="updateItem(index, $event as string)" class="mt-1" />
      <Button v-if="modelValue.length > 1" type="button" variant="ghost" size="icon"
        class="size-9 shrink-0 text-muted-foreground hover:text-destructive" @click="removeItem(index)">
        <MinusCircleIcon class="size-4" />
        <span class="sr-only">删除</span>
      </Button>
    </div>

    <Button type="button" variant="outline" size="sm" class="mt-1" @click="addItem">
      <PlusIcon class="size-4 mr-1" />
      添加{{ label }}
    </Button>
  </div>
</template>

<script lang="ts" setup>
import { PlusIcon, MinusCircleIcon } from 'lucide-vue-next'

interface Props {
  modelValue: string[]
  label: string
  placeholder?: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:modelValue': [value: string[]]
}>()

function updateItem(index: number, value: string) {
  const updated = [...props.modelValue]
  updated[index] = value
  emit('update:modelValue', updated)
}

function removeItem(index: number) {
  const updated = props.modelValue.filter((_, i) => i !== index)
  emit('update:modelValue', updated.length === 0 ? [''] : updated)
}

function addItem() {
  emit('update:modelValue', [...props.modelValue, ''])
}
</script>
