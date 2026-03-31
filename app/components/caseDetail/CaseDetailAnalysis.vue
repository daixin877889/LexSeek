<script lang="ts" setup>
import type { AnalysisResult } from '#shared/types/case'

const props = defineProps<{
  results: AnalysisResult[]
}>()

const activeIndex = ref(0)
const viewMode = ref<'dashboard' | 'detail'>('dashboard')

// 外部可以设置初始 activeIndex
function setActiveIndex(index: number) {
  if (index >= 0 && index < props.results.length) {
    activeIndex.value = index
    viewMode.value = 'detail'
  }
}

defineExpose({ setActiveIndex })
</script>

<template>
  <div class="h-full">
    <CaseAnalysisResults
      :results="results"
      v-model:active-index="activeIndex"
      v-model:view-mode="viewMode"
      :show-regenerate="true"
      :show-copy="true"
      class="h-full"
    />
  </div>
</template>
