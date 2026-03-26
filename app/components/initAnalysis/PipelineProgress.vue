<template>
  <div class="sticky top-0 z-10 bg-background/95 backdrop-blur border-b py-3 px-4 overflow-x-auto">
    <div class="flex items-center gap-2 min-w-max mx-auto max-w-4xl">
      <template v-for="(mod, index) in modules" :key="mod.name">
        <!-- 连接线 -->
        <div v-if="index > 0" class="h-px w-6 shrink-0" :class="lineColor(mod.name)" />

        <!-- 模块 pill -->
        <button
          class="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all whitespace-nowrap"
          :class="pillClasses(mod.name)"
          @click="scrollToModule(mod.name)"
        >
          <!-- 状态图标 -->
          <Loader2Icon v-if="getStatus(mod.name) === 'streaming'" class="size-3 animate-spin" />
          <CheckCircleIcon v-else-if="getStatus(mod.name) === 'complete'" class="size-3" />
          <XCircleIcon v-else-if="getStatus(mod.name) === 'failed'" class="size-3" />
          <CircleIcon v-else class="size-3" />

          {{ mod.title }}
        </button>
      </template>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { Loader2Icon, CheckCircleIcon, XCircleIcon, CircleIcon } from 'lucide-vue-next'
import type { InitAnalysisModule, ModuleRunState, ModuleStatus } from '#shared/types/initAnalysis'

const props = defineProps<{
  modules: InitAnalysisModule[]
  moduleStates: Record<string, ModuleRunState>
}>()

function getStatus(name: string): ModuleStatus {
  return props.moduleStates[name]?.status ?? 'idle'
}

function pillClasses(name: string): string {
  const status = getStatus(name)
  switch (status) {
    case 'streaming':
      return 'border-primary bg-primary/10 text-primary animate-pulse'
    case 'complete':
      return 'border-green-500 bg-green-500/10 text-green-700 dark:text-green-400'
    case 'failed':
      return 'border-destructive bg-destructive/10 text-destructive'
    default:
      return 'border-border text-muted-foreground'
  }
}

function lineColor(name: string): string {
  const status = getStatus(name)
  if (status === 'complete') return 'bg-green-500'
  if (status === 'streaming') return 'bg-primary'
  if (status === 'failed') return 'bg-destructive'
  return 'bg-border'
}

function scrollToModule(name: string) {
  const el = document.getElementById(`module-${name}`)
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
</script>
