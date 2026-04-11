<script lang="ts" setup>
import type { AnalysisResult } from '#shared/types/case'
import type { AnalysisModuleCard } from '#shared/types/case'

const props = defineProps<{
  caseId: number
  results: AnalysisResult[]
  moduleCards?: AnalysisModuleCard[]
  showBatchButton?: boolean
  hasPendingInterrupt?: boolean
}>()

const emit = defineEmits<{
  versionChanged: []
  regenerate: [result: AnalysisResult]
  generateModule: [moduleName: string, moduleTitle: string]
  batchGenerate: []
  goToInterrupt: []
}>()

const activeModule = defineModel<string | null>('activeModule', { default: null })
const viewMode = defineModel<'dashboard' | 'detail'>('viewMode', { default: 'dashboard' })
</script>

<template>
  <div class="h-full">
    <CaseAnalysisResults
      :results="results"
      :module-cards="moduleCards"
      :case-id="caseId"
      v-model:active-module="activeModule"
      v-model:view-mode="viewMode"
      :show-regenerate="true"
      :show-copy="true"
      :show-versions="true"
      :show-batch-button="showBatchButton"
      :has-pending-interrupt="hasPendingInterrupt"
      class="h-full"
      @version-changed="emit('versionChanged')"
      @regenerate="(result) => emit('regenerate', result)"
      @generate-module="(name, title) => emit('generateModule', name, title)"
      @batch-generate="emit('batchGenerate')"
      @go-to-interrupt="emit('goToInterrupt')"
    />
  </div>
</template>
