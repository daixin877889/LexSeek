<script lang="ts" setup>
import type { CaseDetailMaterialItem } from '~/composables/useCaseDetail'
import type { OssFileItem } from '~/store/file'
import type { RecognitionStatus } from '~/composables/useFileRecognition'
import { CaseMaterialType } from '#shared/types/case'
import { formatByteSize } from '#shared/utils/unitConverision'
import {
  FileTextIcon,
  FileIcon,
  ImageIcon,
  FileAudioIcon,
  LayoutGridIcon,
  ListIcon,
  PlusIcon,
  Loader2Icon,
  RefreshCwIcon,
  Trash2Icon,
  CheckSquareIcon,
  XIcon,
} from 'lucide-vue-next'

const props = defineProps<{
  materials: CaseDetailMaterialItem[]
  disabledOssFileIds?: number[]
  isAdding?: boolean
  isDeleting?: boolean
  isSelectMode?: boolean
  selectedMaterialIds?: number[]
  fileRecognitionStatus?: Map<number, RecognitionStatus>
  getRecognitionStatus?: (ossFileId?: number) => RecognitionStatus | null
}>()

const emit = defineEmits<{
  preview: [material: CaseDetailMaterialItem]
  addMaterials: [files: OssFileItem[]]
  retryMaterial: [materialId: number, ossFileId: number]
  deleteMaterials: [materialIds: number[]]
  toggleSelectMode: []
  toggleSelection: [materialId: number]
}>()

const viewMode = ref<'grid' | 'list'>('grid')
const materialSelectorRef = ref<{ openDialog: () => void } | null>(null)
const showDeleteConfirm = ref(false)
const pendingDeleteIds = ref<number[]>([])

function openMaterialSelector() {
  materialSelectorRef.value?.openDialog()
}

function handleFilesSelected(files: OssFileItem[]) {
  emit('addMaterials', files)
}

function isSelected(materialId: number): boolean {
  return props.selectedMaterialIds?.includes(materialId) ?? false
}

function handleMaterialClick(material: CaseDetailMaterialItem) {
  if (props.isSelectMode) {
    emit('toggleSelection', material.id)
  } else {
    emit('preview', material)
  }
}

/** 单个删除：弹确认框 */
function confirmDeleteSingle(materialId: number) {
  pendingDeleteIds.value = [materialId]
  showDeleteConfirm.value = true
}

/** 批量删除：弹确认框 */
function confirmDeleteSelected() {
  if (!props.selectedMaterialIds?.length) return
  pendingDeleteIds.value = [...props.selectedMaterialIds]
  showDeleteConfirm.value = true
}

/** 确认删除 */
function executeDelete() {
  emit('deleteMaterials', pendingDeleteIds.value)
  showDeleteConfirm.value = false
  pendingDeleteIds.value = []
}

/** 获取材料的识别状态 */
function getMaterialRecognitionStatus(material: CaseDetailMaterialItem): RecognitionStatus | null {
  if (!props.getRecognitionStatus || !material.ossFileId) return null
  return props.getRecognitionStatus(material.ossFileId)
}

/** 获取材料的综合显示状态（优先前端轮询状态，其次 API 返回的 status） */
function getMaterialDisplayStatus(material: CaseDetailMaterialItem): { text: string; color: string; spinning?: boolean; showRetry?: boolean } | null {
  // 优先前端轮询状态
  const recognitionStatus = getMaterialRecognitionStatus(material)
  if (recognitionStatus === 'recognizing') return { text: '识别中', color: 'text-amber-500', spinning: true }
  if (recognitionStatus === 'success') return { text: '已识别', color: 'text-green-500' }
  if (recognitionStatus === 'error') return { text: '识别失败', color: 'text-destructive', showRetry: true }

  // 其次 API 返回的 status（1=待处理, 2=处理中, 3=已完成, 4=失败）
  if (material.status === 1) return { text: '待识别', color: 'text-muted-foreground' }
  if (material.status === 2) return { text: '识别中', color: 'text-amber-500', spinning: true }
  if (material.status === 4) return { text: '识别失败', color: 'text-destructive', showRetry: true }
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
  <div class="h-full overflow-y-auto p-4">
    <div class="flex items-center justify-between mb-4">
      <h3 class="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider flex items-center gap-2">
        <FileTextIcon class="size-4" />
        案件材料
        <Badge v-if="materials.length > 0" variant="secondary" class="font-normal px-1.5 py-0 h-4 text-[10px]">
          {{ materials.length }}
        </Badge>
      </h3>

      <div class="flex items-center gap-2">
        <!-- 多选模式：已选数量 + 删除按钮 + 取消 -->
        <template v-if="isSelectMode">
          <span v-if="selectedMaterialIds?.length" class="text-xs text-muted-foreground">
            已选 {{ selectedMaterialIds.length }} 项
          </span>
          <button
            class="flex items-center gap-1 text-xs text-destructive hover:text-destructive/80 transition-colors"
            :disabled="!selectedMaterialIds?.length || isDeleting"
            @click="confirmDeleteSelected"
          >
            <Loader2Icon v-if="isDeleting" class="size-3 animate-spin" />
            <Trash2Icon v-else class="size-3" />
            删除所选
          </button>
          <div class="w-px h-3 bg-border"></div>
          <button
            class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            @click="emit('toggleSelectMode')"
          >
            <XIcon class="size-3" />
            取消
          </button>
        </template>

        <!-- 正常模式 -->
        <template v-else>
          <!-- 添加材料按钮 -->
          <button
            class="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
            :disabled="isAdding"
            @click="openMaterialSelector"
          >
            <Loader2Icon v-if="isAdding" class="size-3 animate-spin" />
            <PlusIcon v-else class="size-3" />
            添加材料
          </button>

          <div class="w-px h-3 bg-border"></div>

          <!-- 选择按钮 -->
          <button
            v-if="materials.length > 0"
            class="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
            @click="emit('toggleSelectMode')"
          >
            <CheckSquareIcon class="size-3" />
            选择
          </button>

          <div v-if="materials.length > 0" class="w-px h-3 bg-border"></div>

          <!-- 视图切换 -->
          <div class="flex items-center bg-muted/50 rounded-lg p-0.5">
            <button
              class="size-7 flex items-center justify-center rounded-md transition-all"
              :class="viewMode === 'grid' ? 'bg-background shadow-sm text-primary' : 'text-muted-foreground hover:text-foreground'"
              @click="viewMode = 'grid'"
            >
              <LayoutGridIcon class="size-3.5" />
            </button>
            <button
              class="size-7 flex items-center justify-center rounded-md transition-all"
              :class="viewMode === 'list' ? 'bg-background shadow-sm text-primary' : 'text-muted-foreground hover:text-foreground'"
              @click="viewMode = 'list'"
            >
              <ListIcon class="size-3.5" />
            </button>
          </div>
        </template>
      </div>
    </div>

    <!-- 视图切换区域 -->
    <Transition name="view-fade" mode="out-in">
      <!-- 网格视图 -->
      <div v-if="viewMode === 'grid'" key="grid" class="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
        <div
          v-for="material in materials"
          :key="material.id"
          class="group relative flex flex-col items-center p-2.5 rounded-xl bg-muted/40 hover:bg-muted/60 transition-all border text-center cursor-pointer"
          :class="[
            isSelectMode && isSelected(material.id) ? 'border-primary bg-primary/5' : 'border-transparent hover:border-primary/10',
          ]"
          @click="handleMaterialClick(material)"
        >
          <!-- 多选 checkbox -->
          <div v-if="isSelectMode" class="absolute top-1.5 left-1.5">
            <Checkbox :checked="isSelected(material.id)" class="size-4" />
          </div>

          <!-- 单个删除按钮（非多选模式下 hover 显示） -->
          <button
            v-if="!isSelectMode"
            class="absolute top-1 right-1 size-6 flex items-center justify-center rounded-lg opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            title="删除"
            @click.stop="confirmDeleteSingle(material.id)"
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
              <!-- 识别状态徽章 -->
              <template v-if="getMaterialDisplayStatus(material)">
                <span class="size-0.5 rounded-full bg-muted-foreground/30"></span>
                <span :class="getMaterialDisplayStatus(material)!.color" class="flex items-center gap-0.5">
                  <Loader2Icon v-if="getMaterialDisplayStatus(material)!.spinning" class="size-2.5 animate-spin" />
                  {{ getMaterialDisplayStatus(material)!.text }}
                  <button
                    v-if="getMaterialDisplayStatus(material)!.showRetry && material.ossFileId"
                    class="ml-0.5 hover:text-primary transition-colors"
                    title="重试"
                    @click.stop="emit('retryMaterial', material.id, material.ossFileId!)"
                  >
                    <RefreshCwIcon class="size-2.5" />
                  </button>
                </span>
              </template>
            </div>
          </div>
        </div>
      </div>

      <!-- 列表视图 -->
      <div v-else key="list" class="space-y-1">
        <div
          v-for="material in materials"
          :key="material.id"
          class="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors group border cursor-pointer"
          :class="[
            isSelectMode && isSelected(material.id) ? 'border-primary bg-primary/5' : 'border-transparent hover:border-border/50',
          ]"
          @click="handleMaterialClick(material)"
        >
          <!-- 多选 checkbox -->
          <Checkbox v-if="isSelectMode" :checked="isSelected(material.id)" class="size-4 shrink-0" />

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
              <!-- 识别状态徽章 -->
              <template v-if="getMaterialDisplayStatus(material)">
                <span class="size-0.5 rounded-full bg-muted-foreground/30"></span>
                <span :class="getMaterialDisplayStatus(material)!.color" class="flex items-center gap-0.5">
                  <Loader2Icon v-if="getMaterialDisplayStatus(material)!.spinning" class="size-2.5 animate-spin" />
                  {{ getMaterialDisplayStatus(material)!.text }}
                  <button
                    v-if="getMaterialDisplayStatus(material)!.showRetry && material.ossFileId"
                    class="ml-0.5 hover:text-primary transition-colors"
                    title="重试"
                    @click.stop="emit('retryMaterial', material.id, material.ossFileId!)"
                  >
                    <RefreshCwIcon class="size-2.5" />
                  </button>
                </span>
              </template>
            </div>
          </div>

          <!-- 单个删除按钮（非多选模式） -->
          <button
            v-if="!isSelectMode"
            class="size-8 flex items-center justify-center rounded-lg opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
            title="删除"
            @click.stop="confirmDeleteSingle(material.id)"
          >
            <Trash2Icon class="size-3.5" />
          </button>
        </div>
      </div>
    </Transition>

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
          <AlertDialogDescription>
            确定要删除{{ pendingDeleteIds.length > 1 ? ` ${pendingDeleteIds.length} 个` : '该' }}材料吗？删除后将无法恢复。
          </AlertDialogDescription>
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
