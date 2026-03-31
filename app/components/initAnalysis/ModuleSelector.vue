<template>
  <div class="flex flex-col items-center py-12 px-4">
    <div class="text-center mb-10">
      <h1 class="text-3xl font-bold tracking-tight">选择分析模块</h1>
      <p class="mt-2 text-muted-foreground">选择需要执行的分析模块，AI 将按顺序逐一分析</p>
    </div>

    <!-- 模块网格：使用 auto-fill 确保在窄容器下也能正确换行 -->
    <div class="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4 w-full px-4">
      <button
        v-for="mod in INIT_ANALYSIS_MODULES"
        :key="mod.name"
        class="group relative flex items-center gap-4 rounded-xl border-2 p-5 text-left transition-all hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary min-h-[80px]"
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
        <div class="shrink-0 rounded-lg bg-muted p-2">
          <component :is="getModuleIcon(mod.icon)" class="size-5 text-muted-foreground" />
        </div>

        <!-- 文字内容：标题与说明对齐 -->
        <div class="flex flex-col gap-1 pr-6 min-w-0">
          <h3 class="text-sm font-semibold truncate">{{ mod.title }}</h3>
          <p class="text-xs text-muted-foreground leading-relaxed truncate">{{ mod.description }}</p>
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
