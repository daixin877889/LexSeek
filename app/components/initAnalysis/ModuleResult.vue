<template>
  <div v-if="state.status !== 'idle'" :id="`module-${module.name}`" class="scroll-mt-20">
    <!-- 模块标题行 -->
    <div class="flex items-center gap-3 mb-3">
      <component :is="getModuleIcon(module.icon)" class="size-5 text-muted-foreground" />
      <h3 class="text-base font-semibold flex-1">{{ module.title }}</h3>
      <Badge :variant="badgeVariant">{{ statusText }}</Badge>
    </div>

    <!-- 内容区 -->
    <div class="pl-8">
      <!-- 流式输出 -->
      <div v-if="state.status === 'streaming'" class="prose prose-sm max-w-none dark:prose-invert">
        <AiElementsMessageResponse :content="state.content" />
        <span class="inline-block size-2 rounded-full bg-primary animate-pulse ml-1" />
      </div>

      <!-- 完成 -->
      <div v-else-if="state.status === 'complete'" class="prose prose-sm max-w-none dark:prose-invert">
        <AiElementsMessageResponse :content="state.content" />
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

      <!-- 中断 -->
      <div v-else-if="state.status === 'interrupted'" class="text-sm text-amber-600 dark:text-amber-400">
        分析已中断
      </div>
    </div>

    <!-- 分隔线 -->
    <Separator class="mt-6" />
  </div>
</template>

<script lang="ts" setup>
import { RefreshCwIcon } from 'lucide-vue-next'
import { getModuleIcon } from '~/utils/moduleIcons'
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
</script>
