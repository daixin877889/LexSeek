<template>
  <div class="flex flex-col items-center justify-center py-12 px-4">
    <div class="text-center mb-10">
      <h1 class="text-3xl font-bold tracking-tight">创建新案件</h1>
      <p class="mt-2 text-muted-foreground">选择一种方式开始创建您的案件</p>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl w-full">
      <!-- 手动创建 -->
      <button
        class="group relative flex flex-col items-center gap-4 rounded-xl border-2 border-border p-8 text-left transition-all hover:border-primary hover:shadow-lg hover:shadow-primary/10 hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        @click="emit('select', 'manual')"
      >
        <div class="rounded-full bg-primary/10 p-4 transition-colors group-hover:bg-primary/20">
          <PenLineIcon class="size-8 text-primary" />
        </div>
        <div class="text-center">
          <h3 class="text-lg font-semibold">手动创建</h3>
          <p class="mt-1 text-sm text-muted-foreground">
            填写案件基本信息和上传材料
          </p>
        </div>
      </button>

      <!-- AI 智能创建 -->
      <button
        class="group relative flex flex-col items-center gap-4 rounded-xl border-2 border-border p-8 text-left transition-all hover:border-primary hover:shadow-lg hover:shadow-primary/10 hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        @click="emit('select', 'ai')"
      >
        <div class="rounded-full bg-primary/10 p-4 transition-colors group-hover:bg-primary/20">
          <SparklesIcon class="size-8 text-primary" />
        </div>
        <div class="text-center">
          <h3 class="text-lg font-semibold">AI 智能创建</h3>
          <p class="mt-1 text-sm text-muted-foreground">
            通过对话描述案情，AI 自动提取信息
          </p>
        </div>
        <Badge variant="secondary" class="absolute top-3 right-3 text-xs">推荐</Badge>
      </button>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { PenLineIcon, SparklesIcon } from 'lucide-vue-next'

const emit = defineEmits<{
  select: [mode: 'manual' | 'ai']
}>()
</script>
