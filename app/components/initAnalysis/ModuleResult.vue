<template>
  <div :id="`module-${module.name}`" class="scroll-mt-20 rounded-xl border bg-card p-5">
    <!-- 头部 -->
    <div class="flex items-center gap-3 mb-4">
      <component :is="getIcon(module.icon)" class="size-5 text-muted-foreground" />
      <h3 class="text-base font-semibold flex-1">{{ module.title }}</h3>
      <Badge :variant="badgeVariant">{{ statusText }}</Badge>
    </div>

    <!-- 内容区 -->
    <div class="min-h-[60px]">
      <!-- 等待中 -->
      <div v-if="state.status === 'idle'" class="text-sm text-muted-foreground">
        等待执行...
      </div>

      <!-- 流式输出 -->
      <div v-else-if="state.status === 'streaming'" class="prose prose-sm max-w-none dark:prose-invert">
        <MessageResponse :content="state.content" />
        <span class="inline-block size-2 rounded-full bg-primary animate-pulse ml-1" />
      </div>

      <!-- 完成 -->
      <div v-else-if="state.status === 'complete'" class="prose prose-sm max-w-none dark:prose-invert">
        <MessageResponse :content="state.content" />
      </div>

      <!-- 失败 -->
      <div v-else-if="state.status === 'failed'" class="space-y-3">
        <Alert variant="destructive">
          <AlertDescription>{{ state.error || '模块执行失败' }}</AlertDescription>
        </Alert>
        <Button variant="outline" size="sm" @click="emit('retry', module.name)">
          <RefreshCwIcon class="size-3.5 mr-1.5" />
          重试
        </Button>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import {
  FileTextIcon,
  CalendarIcon,
  ScaleIcon,
  TrendingUpIcon,
  TagIcon,
  ShieldIcon,
  ClipboardListIcon,
  RefreshCwIcon,
} from 'lucide-vue-next'
import { MessageResponse } from '@/components/ai-elements/message'
import type { InitAnalysisModule, ModuleRunState } from '#shared/types/initAnalysis'

const props = defineProps<{
  module: InitAnalysisModule
  state: ModuleRunState
}>()

const emit = defineEmits<{
  retry: [moduleName: string]
}>()

const statusText = computed(() => {
  switch (props.state.status) {
    case 'idle': return '等待中'
    case 'streaming': return '执行中'
    case 'complete': return '已完成'
    case 'failed': return '失败'
    case 'interrupted': return '已中断'
    default: return '等待中'
  }
})

const badgeVariant = computed<'default' | 'secondary' | 'destructive' | 'outline'>(() => {
  switch (props.state.status) {
    case 'streaming': return 'default'
    case 'complete': return 'secondary'
    case 'failed': return 'destructive'
    default: return 'outline'
  }
})

const iconMap: Record<string, unknown> = {
  FileText: FileTextIcon,
  Calendar: CalendarIcon,
  Scale: ScaleIcon,
  TrendingUp: TrendingUpIcon,
  Tag: TagIcon,
  Shield: ShieldIcon,
  ClipboardList: ClipboardListIcon,
}

function getIcon(iconName: string) {
  return iconMap[iconName] ?? FileTextIcon
}
</script>
