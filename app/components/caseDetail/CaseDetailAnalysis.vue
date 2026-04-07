<script lang="ts" setup>
import type { AnalysisResult } from '#shared/types/case'

const props = defineProps<{
  caseId: number
  results: AnalysisResult[]
}>()

const emit = defineEmits<{
  versionChanged: []
  regenerate: [result: AnalysisResult]
}>()

const activeIndex = defineModel<number>('activeIndex', { default: 0 })
const viewMode = defineModel<'dashboard' | 'detail'>('viewMode', { default: 'dashboard' })
</script>

<template>
  <div class="h-full">
    <CaseAnalysisResults
      :results="results"
      :case-id="caseId"
      v-model:active-index="activeIndex"
      v-model:view-mode="viewMode"
      :show-regenerate="true"
      :show-copy="true"
      :show-versions="true"
      class="h-full"
      @version-changed="emit('versionChanged')"
      @regenerate="(result) => emit('regenerate', result)"
    />
  </div>
</template>
