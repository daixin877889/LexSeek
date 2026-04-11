<script lang="ts" setup>
import type { AnalysisResult } from '#shared/types/case'
import type { AnalysisModuleCard } from '#shared/types/case'
import type { ActiveView, CaseDetailMaterialItem } from '~/composables/useCaseDetail'
import type { OssFileItem } from '~/store/file'
import type { RecognitionStatus } from '~/composables/useFileRecognition'
import { CaseMaterialType } from '#shared/types/case'
import { formatByteSize } from '#shared/utils/unitConverision'
import {
  EyeIcon,
  FileTextIcon,
  FileIcon,
  ImageIcon,
  FileAudioIcon,
  SparklesIcon,
  PencilIcon,
  CheckIcon,
  XIcon,
  Loader2Icon,
  PlusIcon,
  Trash2Icon,
  RefreshCwIcon,
  CheckSquareIcon,
} from 'lucide-vue-next'

const props = defineProps<{
  caseId: number
  analysisResults: AnalysisResult[]
  moduleCards?: AnalysisModuleCard[]
  showBatchButton?: boolean
  hasPendingInterrupt?: boolean
  materials: CaseDetailMaterialItem[]
  disabledOssFileIds?: number[]
  isAddingMaterials?: boolean
  fileRecognitionStatus?: Map<number, RecognitionStatus>
  getRecognitionStatus?: (ossFileId?: number) => RecognitionStatus | null
}>()

const emit = defineEmits<{
  navigateView: [view: ActiveView]
  previewMaterial: [material: CaseDetailMaterialItem]
  navigateAnalysis: [moduleName: string]
  updated: []
  addMaterials: [files: OssFileItem[]]
  deleteMaterials: [materialIds: number[]]
  retryMaterial: [materialId: number, ossFileId: number]
  navigateToSelectMode: []
  generateModule: [moduleName: string, moduleTitle: string]
  batchGenerate: []
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
const analysisActiveModule = ref<string | null>(null)

// 拦截分析结果卡片点击：complete 时切换到分析视图
watch(analysisViewMode, (mode) => {
  if (mode === 'detail' && analysisActiveModule.value) {
    nextTick(() => { analysisViewMode.value = 'dashboard' })
    emit('navigateAnalysis', analysisActiveModule.value)
  }
})

// 材料选择器
const materialSelectorRef = ref<{ openDialog: () => void } | null>(null)

function openMaterialSelector() {
  materialSelectorRef.value?.openDialog()
}

function handleFilesSelected(files: OssFileItem[]) {
  emit('addMaterials', files)
}

// 单个删除确认
const showDeleteConfirm = ref(false)
const pendingDeleteId = ref<number | null>(null)

function confirmDelete(materialId: number) {
  pendingDeleteId.value = materialId
  showDeleteConfirm.value = true
}

function executeDelete() {
  if (pendingDeleteId.value != null) {
    emit('deleteMaterials', [pendingDeleteId.value])
  }
  showDeleteConfirm.value = false
  pendingDeleteId.value = null
}

/** 获取材料的综合显示状态（优先前端轮询状态，其次 API 返回的 status） */
function getMaterialDisplayStatus(material: CaseDetailMaterialItem): { text: string; color: string; spinning?: boolean; showRetry?: boolean } | null {
  // 优先前端轮询状态
  if (props.getRecognitionStatus && material.ossFileId) {
    const recognitionStatus = props.getRecognitionStatus(material.ossFileId)
    if (recognitionStatus === 'recognizing') return { text: '识别中', color: 'text-amber-500', spinning: true }
    if (recognitionStatus === 'success') return { text: '已识别', color: 'text-green-500' }
    if (recognitionStatus === 'error') return { text: '识别失败', color: 'text-destructive', showRetry: true }
  }

  // 其次 API 返回的 status（1=待处理, 2=处理中, 3=已完成, 4=失败）
  if (material.status === 1) return { text: '待识别', color: 'text-muted-foreground' }
  if (material.status === 2) return { text: '识别中', color: 'text-amber-500', spinning: true }
  if (material.status === 4) return { text: '识别失败', color: 'text-destructive', showRetry: true }
  // status === 3 表示已完成，不显示状态
  return null
}

function getMaterialIcon(type: number) {
  switch (type) {
    case CaseMaterialType.DOCUMENT: return FileTextIcon
    case CaseMaterialType.IMAGE: return ImageIcon
    case CaseMaterialType.AUDIO: return FileAudioIcon
    case CaseMaterialType.CASE_CONTENT: return FileIcon
    default: return FileIcon
  }
}

function getMaterialBgColor(type: number) {
  switch (type) {
    case CaseMaterialType.DOCUMENT: return 'bg-blue-500/10 dark:bg-blue-500/20'
    case CaseMaterialType.IMAGE: return 'bg-green-500/10 dark:bg-green-500/20'
    case CaseMaterialType.AUDIO: return 'bg-purple-500/10 dark:bg-purple-500/20'
    case CaseMaterialType.CASE_CONTENT: return 'bg-orange-500/10 dark:bg-orange-500/20'
    default: return 'bg-muted'
  }
}

function getMaterialIconColor(type: number) {
  switch (type) {
    case CaseMaterialType.DOCUMENT: return 'text-blue-600 dark:text-blue-400'
    case CaseMaterialType.IMAGE: return 'text-green-600 dark:text-green-400'
    case CaseMaterialType.AUDIO: return 'text-purple-600 dark:text-purple-400'
    case CaseMaterialType.CASE_CONTENT: return 'text-orange-600 dark:text-orange-400'
    default: return 'text-muted-foreground'
  }
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
        <Badge v-if="materials.length > 0" variant="secondary" class="font-normal px-1.5 py-0 h-4 text-[10px]">
          {{ materials.length }}
        </Badge>
      </h3>
      <div class="flex items-center gap-4">
        <button
          class="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
          :disabled="isAddingMaterials"
          @click="openMaterialSelector"
        >
          <Loader2Icon v-if="isAddingMaterials" class="size-3 animate-spin" />
          <PlusIcon v-else class="size-3" />
          添加材料
        </button>
        <div class="w-px h-3 bg-border"></div>
        <button
          v-if="materials.length > 0"
          class="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
          @click="emit('navigateToSelectMode')"
        >
          <CheckSquareIcon class="size-3" />
          批量管理
        </button>
        <div v-if="materials.length > 0" class="w-px h-3 bg-border"></div>
        <button
          class="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
          @click="emit('navigateView', 'materials')"
        >
          <EyeIcon class="size-3" />
          查看全部
        </button>
      </div>
    </div>

    <!-- 材料网格（直接渲染，共享 useCaseDetail 数据） -->
    <div class="p-4 pt-3">
      <div v-if="materials.length === 0" class="text-center py-6 text-sm text-muted-foreground">
        <FileTextIcon class="size-8 mx-auto mb-2 opacity-50" />
        暂无材料
      </div>
      <div v-else class="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
        <div
          v-for="material in materials"
          :key="material.id"
          class="group relative flex flex-col items-center p-2.5 rounded-xl bg-muted/40 hover:bg-muted/60 transition-all border border-transparent hover:border-primary/10 text-center cursor-pointer"
          @click="emit('previewMaterial', material)"
        >
          <!-- 单个删除按钮 -->
          <button
            class="absolute top-1 right-1 size-6 flex items-center justify-center rounded-lg opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            title="删除"
            @click.stop="confirmDelete(material.id)"
          >
            <Trash2Icon class="size-3" />
          </button>

          <div :class="['flex items-center justify-center size-11 rounded-xl shrink-0 transition-transform group-hover:scale-105 mb-1.5', getMaterialBgColor(material.type)]">
            <component :is="getMaterialIcon(material.type)" :class="['size-6', getMaterialIconColor(material.type)]" />
          </div>
          <div class="flex-1 min-w-0 w-full">
            <div class="text-[12px] font-medium line-clamp-1 leading-tight mb-1 group-hover:text-primary transition-colors px-1">
              {{ material.name }}
            </div>
            <div class="text-[10px] text-muted-foreground/60 flex items-center justify-center gap-1">
              <span v-if="material.fileSize" class="shrink-0">{{ formatByteSize(material.fileSize, 0) }}</span>
              <!-- 识别状态 -->
              <template v-if="getMaterialDisplayStatus(material)">
                <span class="size-0.5 rounded-full bg-muted-foreground/30"></span>
                <span v-if="!getMaterialDisplayStatus(material)!.showRetry" :class="getMaterialDisplayStatus(material)!.color" class="flex items-center gap-0.5">
                  <Loader2Icon v-if="getMaterialDisplayStatus(material)!.spinning" class="size-2.5 animate-spin" />
                  {{ getMaterialDisplayStatus(material)!.text }}
                </span>
                <button
                  v-else
                  class="text-destructive hover:text-primary transition-colors flex items-center gap-0.5"
                  @click.stop="emit('retryMaterial', material.id, material.ossFileId!)"
                >
                  {{ getMaterialDisplayStatus(material)!.text }}
                  <RefreshCwIcon class="size-2.5" />
                </button>
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>

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
      :module-cards="moduleCards"
      v-model:view-mode="analysisViewMode"
      v-model:active-module="analysisActiveModule"
      :show-regenerate="false"
      :show-copy="false"
      :show-batch-button="showBatchButton"
      :has-pending-interrupt="hasPendingInterrupt"
      hide-header
      class="pt-0"
      @generate-module="(name, title) => emit('generateModule', name, title)"
      @batch-generate="emit('batchGenerate')"
    />

    <!-- 材料选择器弹窗 -->
    <CaseAnalysisMaterialSelector
      ref="materialSelectorRef"
      :disabled-file-ids="disabledOssFileIds"
      @files-selected="handleFilesSelected"
    />

    <!-- 删除确认对话框 -->
    <AlertDialog v-model:open="showDeleteConfirm">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认删除</AlertDialogTitle>
          <AlertDialogDescription>确定要删除该材料吗？删除后将无法恢复。</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction class="bg-destructive text-destructive-foreground hover:bg-destructive/90" @click="executeDelete">
            删除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
