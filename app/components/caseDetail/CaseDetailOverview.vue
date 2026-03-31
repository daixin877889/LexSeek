<script lang="ts" setup>
import type { AnalysisResult } from '#shared/types/case'
import type { ActiveView } from '~/composables/useCaseDetail'
import { EyeIcon } from 'lucide-vue-next'

const props = defineProps<{
  caseId: number
  analysisResults: AnalysisResult[]
}>()

const emit = defineEmits<{
  navigateView: [view: ActiveView]
}>()

// 概览中分析结果始终为 dashboard 模式
const analysisViewMode = ref<'dashboard' | 'detail'>('dashboard')

// 拦截分析结果卡片点击：切换到分析视图并重置
function handleAnalysisCardClick(mode: 'dashboard' | 'detail') {
  if (mode === 'detail') {
    nextTick(() => { analysisViewMode.value = 'dashboard' })
    emit('navigateView', 'analysis')
  }
}

watch(analysisViewMode, handleAnalysisCardClick)
</script>

<template>
  <div class="overflow-y-auto h-full">
    <!-- 案件信息 -->
    <InitAnalysisCaseInfoCard :case-id="caseId" />
    <Separator class="opacity-50" />

    <!-- 案件材料 -->
    <div class="relative">
      <button
        class="absolute top-4 right-4 z-10 flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
        @click="emit('navigateView', 'materials')"
      >
        <EyeIcon class="size-3" />
        查看
      </button>
      <InitAnalysisMaterialList
        :case-id="caseId"
        @preview="emit('navigateView', 'materials')"
      />
    </div>
    <Separator class="opacity-50" />

    <!-- 分析结果 -->
    <div class="relative">
      <button
        v-if="analysisResults.length > 0"
        class="absolute top-4 right-4 z-10 flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
        @click="emit('navigateView', 'analysis')"
      >
        <EyeIcon class="size-3" />
        查看
      </button>
      <CaseAnalysisResults
        :results="analysisResults"
        v-model:view-mode="analysisViewMode"
        :show-regenerate="false"
        :show-copy="false"
      />
    </div>
  </div>
</template>
