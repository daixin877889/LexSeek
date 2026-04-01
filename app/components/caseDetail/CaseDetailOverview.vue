<script lang="ts" setup>
import type { AnalysisResult } from '#shared/types/case'
import type { ActiveView, MaterialItem } from '~/composables/useCaseDetail'
import { CaseMaterialType } from '#shared/types/case'
import { EyeIcon } from 'lucide-vue-next'

const props = defineProps<{
  caseId: number
  analysisResults: AnalysisResult[]
}>()

const emit = defineEmits<{
  navigateView: [view: ActiveView]
  previewMaterial: [material: MaterialItem]
  navigateAnalysis: [index: number]
  updated: []
}>()

// 概览中分析结果始终为 dashboard 模式
const analysisViewMode = ref<'dashboard' | 'detail'>('dashboard')
const analysisActiveIndex = ref(0)

// 拦截分析结果卡片点击：切换到分析视图
watch(analysisViewMode, (mode) => {
  if (mode === 'detail') {
    nextTick(() => { analysisViewMode.value = 'dashboard' })
    emit('navigateAnalysis', analysisActiveIndex.value)
  }
})
</script>

<template>
  <div class="overflow-y-auto h-full">
    <!-- 案件信息 -->
    <InitAnalysisCaseInfoCard :case-id="caseId" editable @updated="emit('updated')" />
    <Separator class="opacity-50" />

    <!-- 案件材料 -->
    <div class="relative">
      <button
        class="absolute top-4 right-4 z-10 flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
        @click="emit('navigateView', 'materials')"
      >
        <EyeIcon class="size-3" />
        查看全部
      </button>
      <InitAnalysisMaterialList
        :case-id="caseId"
        @preview="(m: MaterialItem) => emit('previewMaterial', m)"
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
        查看全部
      </button>
      <CaseAnalysisResults
        :results="analysisResults"
        v-model:view-mode="analysisViewMode"
        v-model:active-index="analysisActiveIndex"
        :show-regenerate="false"
        :show-copy="false"
      />
    </div>
  </div>
</template>
