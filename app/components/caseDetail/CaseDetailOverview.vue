<script lang="ts" setup>
import type { AnalysisResult } from '#shared/types/case'
import type { AnalysisModuleCard } from '#shared/types/case'
import type { DraftRow } from '#shared/types/document'
import type { ActiveView, CaseDetailMaterialItem } from '~/composables/useCaseDetail'
import type { OssFileItem } from '~/store/file'
import type { RecognitionStatus } from '~/composables/useFileRecognition'
import { formatByteSize } from '#shared/utils/unitConverision'
import { getMaterialIcon, getMaterialBgColor, getMaterialIconColor } from '~/utils/caseMaterial'
import {
  EyeIcon,
  FileTextIcon,
  FileEditIcon,
  PencilIcon,
  CheckIcon,
  XIcon,
  Loader2Icon,
  PlusIcon,
  Trash2Icon,
  RefreshCwIcon,
  CheckSquareIcon,
  LayoutGridIcon,
  ListIcon,
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
  readonly?: boolean
  materialsLoading?: boolean
  drafts?: DraftRow[]
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
  goToInterrupt: []
  createDocument: []
}>()

const infoCardRef = ref<{
  startEditing: () => void
  saveChanges: () => void
  cancelEditing: () => void
} | null>(null)
const isEditingCaseInfo = ref(false)
const isSavingCaseInfo = ref(false)

// 材料视图模式
const hasDrafts = computed(() => (props.drafts?.length ?? 0) > 0)
const materialViewMode = ref<'grid' | 'list'>('grid')

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

</script>

<template>
  <div class="overflow-y-auto h-full">
    <!-- 案件信息 -->
    <div class="p-4 flex items-center justify-between pb-2">
      <h3 class="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider flex items-center gap-2">
        <FileTextIcon class="size-4" />
        案件基本信息
      </h3>
      <div v-if="!readonly" class="flex items-center gap-2">
        <template v-if="!isEditingCaseInfo">
          <button class="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
            @click="infoCardRef?.startEditing()">
            <PencilIcon class="size-3" />
            编辑信息
          </button>
        </template>
        <template v-else>
          <button
            class="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors px-2 py-1 rounded hover:bg-destructive/10"
            @click="infoCardRef?.cancelEditing()">
            <XIcon class="size-3" />
            取消
          </button>
          <button
            class="flex items-center gap-1 text-xs font-medium text-primary hover:bg-primary/10 px-2 py-1 rounded transition-colors"
            @click="infoCardRef?.saveChanges()">
            <CheckIcon class="size-3" />
            保存生效
          </button>
        </template>
      </div>
    </div>
    <InitAnalysisCaseInfoCard ref="infoCardRef" :case-id="caseId" :editable="!readonly" hide-header
      v-model:is-editing="isEditingCaseInfo" @updated="emit('updated')" />
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
      <div class="flex items-center gap-2 lg:gap-4">
        <template v-if="!readonly">
          <button class="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
            :disabled="isAddingMaterials" @click="openMaterialSelector" title="添加材料">
            <Loader2Icon v-if="isAddingMaterials" class="size-3 animate-spin" />
            <PlusIcon v-else class="size-3" />
            <span class="hidden lg:inline">添加材料</span>
          </button>
          <div class="w-px h-3 bg-border"></div>
          <button v-if="materials.length > 0"
            class="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
            @click="emit('navigateToSelectMode')" title="批量管理">
            <CheckSquareIcon class="size-3" />
            <span class="hidden lg:inline">批量管理</span>
          </button>
          <div v-if="materials.length > 0" class="w-px h-3 bg-border"></div>
          <button class="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
            @click="emit('navigateView', 'materials')" title="查看全部">
            <EyeIcon class="size-3" />
            <span class="hidden lg:inline">查看全部</span>
          </button>
          <div class="w-px h-3 bg-border"></div>
        </template>
        <!-- 视图切换（始终显示） -->
        <div class="flex items-center bg-muted/50 rounded-lg p-0.5">
          <button class="size-7 flex items-center justify-center rounded-md transition-all"
            :class="materialViewMode === 'grid' ? 'bg-background shadow-sm text-primary' : 'text-muted-foreground hover:text-foreground'"
            @click="materialViewMode = 'grid'">
            <LayoutGridIcon class="size-3.5" />
          </button>
          <button class="size-7 flex items-center justify-center rounded-md transition-all"
            :class="materialViewMode === 'list' ? 'bg-background shadow-sm text-primary' : 'text-muted-foreground hover:text-foreground'"
            @click="materialViewMode = 'list'">
            <ListIcon class="size-3.5" />
          </button>
        </div>
      </div>
    </div>

    <!-- 材料区域 -->
    <div class="p-4 pt-3">
      <!-- 加载状态 -->
      <div v-if="materialsLoading" class="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
        <div v-for="i in 4" :key="i" class="p-3 rounded-xl bg-muted/40 flex flex-col items-center text-center space-y-2">
          <Skeleton class="size-11 rounded-lg" />
          <div class="space-y-1.5 w-full">
            <Skeleton class="h-3 w-3/4 mx-auto" />
            <Skeleton class="h-2.5 w-1/2 mx-auto" />
          </div>
        </div>
      </div>
      <!-- 空状态 -->
      <div v-else-if="materials.length === 0" class="text-center py-6 text-sm text-muted-foreground">
        <FileTextIcon class="size-8 mx-auto mb-2 opacity-50" />
        暂无材料
      </div>
      <!-- 材料列表 -->
      <Transition v-else name="view-fade" mode="out-in">
        <!-- 网格视图 -->
        <div v-if="materialViewMode === 'grid'" key="grid" class="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
          <div v-for="material in materials" :key="material.id"
            class="group relative flex flex-col items-center p-2.5 rounded-xl bg-muted/40 hover:bg-muted/60 transition-all border border-transparent hover:border-primary/10 text-center cursor-pointer"
            @click="emit('previewMaterial', material)">
            <!-- 单个删除按钮 -->
            <button v-if="!readonly"
              class="absolute top-1 right-1 size-6 flex items-center justify-center rounded-lg opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              title="删除" @click.stop="confirmDelete(material.id)">
              <Trash2Icon class="size-3" />
            </button>

            <div
              :class="['flex items-center justify-center size-11 rounded-xl shrink-0 transition-transform group-hover:scale-105 mb-1.5', getMaterialBgColor(material.type)]">
              <component :is="getMaterialIcon(material.type)" :class="['size-6', getMaterialIconColor(material.type)]" />
            </div>
            <div class="flex-1 min-w-0 w-full">
              <div
                class="text-[12px] font-medium line-clamp-1 leading-tight mb-1 group-hover:text-primary transition-colors px-1">
                {{ material.name }}
              </div>
              <div class="text-[10px] text-muted-foreground/60 flex items-center justify-center gap-1">
                <span v-if="material.fileSize" class="shrink-0">{{ formatByteSize(material.fileSize, 0) }}</span>
                <!-- 识别状态 -->
                <template v-if="getMaterialDisplayStatus(material)">
                  <span class="size-0.5 rounded-full bg-muted-foreground/30"></span>
                  <span v-if="!getMaterialDisplayStatus(material)!.showRetry || readonly"
                    :class="getMaterialDisplayStatus(material)!.color" class="flex items-center gap-0.5">
                    <Loader2Icon v-if="getMaterialDisplayStatus(material)!.spinning" class="size-2.5 animate-spin" />
                    {{ getMaterialDisplayStatus(material)!.text }}
                  </span>
                  <button v-else class="text-destructive hover:text-primary transition-colors flex items-center gap-0.5"
                    @click.stop="emit('retryMaterial', material.id, material.ossFileId!)">
                    {{ getMaterialDisplayStatus(material)!.text }}
                    <RefreshCwIcon class="size-2.5" />
                  </button>
                </template>
              </div>
            </div>
          </div>
        </div>

        <!-- 列表视图 -->
        <div v-else key="list" class="space-y-1">
          <div v-for="material in materials" :key="material.id"
            class="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors group border border-transparent hover:border-border/50 cursor-pointer"
            @click="emit('previewMaterial', material)">
            <div :class="['flex items-center justify-center size-9 rounded-lg shrink-0', getMaterialBgColor(material.type)]">
              <component :is="getMaterialIcon(material.type)" :class="['size-5', getMaterialIconColor(material.type)]" />
            </div>
            <div class="flex-1 min-w-0 text-left">
              <div class="text-sm font-medium truncate group-hover:text-primary transition-colors">
                {{ material.name }}
              </div>
              <div class="text-[11px] text-muted-foreground/60 flex items-center gap-2">
                <span>{{ material.typeText }}</span>
                <span v-if="material.fileSize" class="size-0.5 rounded-full bg-muted-foreground/30"></span>
                <span v-if="material.fileSize">{{ formatByteSize(material.fileSize, 0) }}</span>
                <template v-if="getMaterialDisplayStatus(material)">
                  <span class="size-0.5 rounded-full bg-muted-foreground/30"></span>
                  <span v-if="!getMaterialDisplayStatus(material)!.showRetry || readonly"
                    :class="getMaterialDisplayStatus(material)!.color" class="flex items-center gap-0.5">
                    <Loader2Icon v-if="getMaterialDisplayStatus(material)!.spinning" class="size-2.5 animate-spin" />
                    {{ getMaterialDisplayStatus(material)!.text }}
                  </span>
                  <button v-else class="text-destructive hover:text-primary transition-colors flex items-center gap-0.5"
                    @click.stop="emit('retryMaterial', material.id, material.ossFileId!)">
                    {{ getMaterialDisplayStatus(material)!.text }}
                    <RefreshCwIcon class="size-2.5" />
                  </button>
                </template>
              </div>
            </div>
            <button v-if="!readonly"
              class="size-8 flex items-center justify-center rounded-lg opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
              title="删除" @click.stop="confirmDelete(material.id)">
              <Trash2Icon class="size-3.5" />
            </button>
          </div>
        </div>
      </Transition>
    </div>

    <template v-if="!readonly">
      <Separator class="mx-4 opacity-50" />

      <!-- 分析结果（AnalysisResults 内部 header 统一管理按钮：批量分析 + 查看全部 + 视图切换） -->
      <!-- 传 h-auto 覆盖组件自带的 h-full，避免在 overview 纵向流式布局中撑满高度把后续板块挤出视口 -->
      <CaseAnalysisResults class="h-auto" :results="analysisResults" :module-cards="moduleCards" v-model:view-mode="analysisViewMode"
        v-model:active-module="analysisActiveModule" :show-regenerate="false" :show-copy="false"
        :show-batch-button="showBatchButton" :has-pending-interrupt="hasPendingInterrupt"
        :show-view-all="true"
        @generate-module="(name, title) => emit('generateModule', name, title)" @batch-generate="emit('batchGenerate')"
        @go-to-interrupt="emit('goToInterrupt')" @view-all="emit('navigateView', 'analysis')" />

      <Separator class="mx-4 opacity-50" />

      <!-- 案件文书 -->
      <div class="p-4 flex items-center justify-between pb-0">
        <h3 class="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider flex items-center gap-2">
          <FileEditIcon class="size-4" />
          案件文书
          <Badge v-if="hasDrafts" variant="secondary" class="font-normal px-1.5 py-0 h-4 text-[10px]">
            {{ drafts!.length }}
          </Badge>
        </h3>
        <div class="flex items-center gap-2 lg:gap-4">
          <button
            class="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
            title="新建文书"
            @click="emit('createDocument')"
          >
            <PlusIcon class="size-3" />
            <span class="hidden lg:inline">新建文书</span>
          </button>
          <div v-if="hasDrafts" class="w-px h-3 bg-border" />
          <button
            v-if="hasDrafts"
            class="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
            title="查看全部"
            @click="emit('navigateView', 'documents')"
          >
            <EyeIcon class="size-3" />
            <span class="hidden lg:inline">查看全部</span>
          </button>
        </div>
      </div>

      <div class="p-4 pt-3">
        <div
          v-if="!hasDrafts"
          class="text-center py-6 text-sm text-muted-foreground"
        >
          <FileTextIcon class="size-8 mx-auto mb-2 opacity-50" />
          暂无文书
        </div>
        <!-- 非空：复用 DraftHistory（受控模式 + 隐藏关联案件列） -->
        <AssistantDocumentDraftHistory
          v-else
          :items="drafts ?? []"
          :loading="false"
          hide-case-column
        />
      </div>

      <!-- 材料选择器弹窗 -->
      <CaseAnalysisMaterialSelector ref="materialSelectorRef" :disabled-file-ids="disabledOssFileIds"
        @files-selected="handleFilesSelected" />

      <!-- 删除确认对话框 -->
      <AlertDialog v-model:open="showDeleteConfirm">
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>确定要删除该材料吗？删除后将无法恢复。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              @click="executeDelete">
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </template>
  </div>
</template>

<style scoped>
.view-fade-enter-active,
.view-fade-leave-active {
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}
.view-fade-enter-from {
  opacity: 0;
  transform: translateY(8px) scale(0.99);
}
.view-fade-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.99);
}
</style>
