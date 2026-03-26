<template>
  <div class="flex flex-col items-center py-12 px-4">
    <div class="text-center mb-10">
      <h1 class="text-3xl font-bold tracking-tight">选择分析模块</h1>
      <p class="mt-2 text-muted-foreground">选择需要执行的分析模块，AI 将按顺序逐一分析</p>
    </div>

    <!-- 模块网格 -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-4xl w-full">
      <button
        v-for="mod in INIT_ANALYSIS_MODULES"
        :key="mod.name"
        class="group relative flex flex-col items-start gap-3 rounded-xl border-2 p-5 text-left transition-all hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        :class="isSelected(mod.name) ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'"
        @click="toggle(mod.name)"
      >
        <!-- 选中指示 -->
        <div
          class="absolute top-3 right-3 size-5 rounded-full border-2 flex items-center justify-center transition-colors"
          :class="isSelected(mod.name) ? 'border-primary bg-primary' : 'border-muted-foreground/30'"
        >
          <CheckIcon v-if="isSelected(mod.name)" class="size-3 text-primary-foreground" />
        </div>

        <!-- 图标 -->
        <div class="rounded-lg bg-muted p-2.5">
          <component :is="getModuleIcon(mod.icon)" class="size-5 text-muted-foreground" />
        </div>

        <!-- 文字 -->
        <div>
          <h3 class="text-sm font-semibold">{{ mod.title }}</h3>
          <p class="mt-1 text-xs text-muted-foreground leading-relaxed">{{ mod.description }}</p>
        </div>
      </button>
    </div>

    <!-- 底部操作 -->
    <div class="mt-10 flex flex-col items-center gap-3">
      <Button :disabled="modelValue.length === 0" size="lg" @click="emit('start')">
        开始分析（{{ modelValue.length }} 个模块）
      </Button>
      <Button variant="link" class="text-muted-foreground" @click="emit('skip')">
        跳过，直接进入案件详情
      </Button>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { CheckIcon } from 'lucide-vue-next'
import { INIT_ANALYSIS_MODULES } from '#shared/types/initAnalysis'
import { getModuleIcon } from '~/utils/moduleIcons'

const props = defineProps<{
  modelValue: string[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string[]]
  start: []
  skip: []
}>()

function isSelected(name: string): boolean {
  return props.modelValue.includes(name)
}

function toggle(name: string) {
  const updated = isSelected(name)
    ? props.modelValue.filter(n => n !== name)
    : [...props.modelValue, name]
  emit('update:modelValue', updated)
}
</script>
