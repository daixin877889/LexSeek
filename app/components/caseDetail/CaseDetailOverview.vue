<script lang="ts" setup>
import type { AnalysisResult } from '#shared/types/case'
import type { ActiveView, CaseDetailMaterialItem } from '~/composables/useCaseDetail'
import type { OssFileItem } from '~/store/file'
import { CaseMaterialType } from '#shared/types/case'
import { EyeIcon, FileTextIcon, SparklesIcon, PencilIcon, CheckIcon, XIcon, Loader2Icon, PlusIcon } from 'lucide-vue-next'

const props = defineProps<{
  caseId: number
  analysisResults: AnalysisResult[]
  disabledOssFileIds?: number[]
  isAddingMaterials?: boolean
}>()

const emit = defineEmits<{
  navigateView: [view: ActiveView]
  previewMaterial: [material: CaseDetailMaterialItem]
  navigateAnalysis: [index: number]
  updated: []
  addMaterials: [files: OssFileItem[]]
}>()

const infoCardRef = ref<{
  startEditing: () => void
  saveChanges: () => void
  cancelEditing: () => void
} | null>(null)
const isEditingCaseInfo = ref(false)
const isSavingCaseInfo = ref(false)

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

// 材料选择器弹窗
const showMaterialSelector = ref(false)

function handleFilesSelected(files: OssFileItem[]) {
  emit('addMaterials', files)
}
</script>

<template>
  <div class="overflow-y-auto h-full">
    <!-- 案件信息 -->
    <div class="p-4 flex items-center justify-between pb-2">
      <h3 class="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider flex items-center gap-2">
        <FileTextIcon class="size-4" />
        案件基本信息
      </h3>
      <div class="flex items-center gap-2">
        <template v-if="!isEditingCaseInfo">
          <button
            class="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
            @click="infoCardRef?.startEditing()"
          >
            <PencilIcon class="size-3" />
            编辑信息
          </button>
        </template>
        <template v-else>
          <button
            class="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors px-2 py-1 rounded hover:bg-destructive/10"
            @click="infoCardRef?.cancelEditing()"
          >
            <XIcon class="size-3" />
            取消
          </button>
          <button
            class="flex items-center gap-1 text-xs font-medium text-primary hover:bg-primary/10 px-2 py-1 rounded transition-colors"
            @click="infoCardRef?.saveChanges()"
          >
            <CheckIcon class="size-3" />
            保存生效
          </button>
        </template>
      </div>
    </div>
    <InitAnalysisCaseInfoCard
      ref="infoCardRef"
      :case-id="caseId"
      editable
      hide-header
      v-model:is-editing="isEditingCaseInfo"
      @updated="emit('updated')"
    />
    <Separator class="mx-4 opacity-50" />

    <!-- 案件材料 -->
    <div class="p-4 flex items-center justify-between pb-0">
      <h3 class="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider flex items-center gap-2">
        <FileTextIcon class="size-4" />
        案件材料
      </h3>
      <div class="flex items-center gap-4">
        <button
          class="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
          :disabled="isAddingMaterials"
          @click="showMaterialSelector = true"
        >
          <Loader2Icon v-if="isAddingMaterials" class="size-3 animate-spin" />
          <PlusIcon v-else class="size-3" />
          添加材料
        </button>
        <div class="w-px h-3 bg-border"></div>
        <button
          class="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
          @click="emit('navigateView', 'materials')"
        >
          <EyeIcon class="size-3" />
          查看全部
        </button>
      </div>
    </div>
    <InitAnalysisMaterialList
      :case-id="caseId"
      hide-header
      @preview="(m: CaseDetailMaterialItem) => emit('previewMaterial', m)"
    />
    <Separator class="mx-4 opacity-50" />

    <!-- 分析结果 -->
    <div class="p-4 flex items-center justify-between pb-0">
      <h3 class="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider flex items-center gap-2">
        <SparklesIcon class="size-4" />
        分析结果
        <span v-if="analysisResults.length > 0" class="font-normal text-[10px] bg-muted px-1.5 py-0.5 rounded">{{ analysisResults.length }}</span>
      </h3>
      <button
        v-if="analysisResults.length > 0"
        class="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
        @click="emit('navigateView', 'analysis')"
      >
        <EyeIcon class="size-3" />
        查看全部
      </button>
    </div>
    <CaseAnalysisResults
      :results="analysisResults"
      v-model:view-mode="analysisViewMode"
      v-model:active-index="analysisActiveIndex"
      :show-regenerate="false"
      :show-copy="false"
      hide-header
      class="pt-0"
    />

    <!-- 材料选择器弹窗 -->
    <CaseAnalysisMaterialSelector
      v-model:open="showMaterialSelector"
      :disabled-file-ids="disabledOssFileIds"
      @files-selected="handleFilesSelected"
    />
  </div>
</template>
