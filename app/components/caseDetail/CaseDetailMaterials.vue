<script lang="ts" setup>
import type { CaseDetailMaterialItem } from '~/composables/useCaseDetail'
import type { OssFileItem } from '~/store/file'
import type { RecognitionStatus } from '~/composables/useFileRecognition'
import {
  FileTextIcon,
  PlusIcon,
  Loader2Icon,
  Trash2Icon,
  CheckSquareIcon,
  XIcon,
} from 'lucide-vue-next'
import ViewModeToggle from '~/components/ViewModeToggle.vue'
import CaseAnalysisMaterialSelector from '~/components/caseAnalysis/materialSelector.vue'

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

          <ViewModeToggle v-model="viewMode" />
        </template>
      </div>
    </div>

    <CaseMaterialList
      :materials="materials"
      :view-mode="viewMode"
      :is-select-mode="isSelectMode"
      :selected-ids="selectedMaterialIds"
      :get-recognition-status="getRecognitionStatus"
      @preview-material="(m: CaseDetailMaterialItem) => emit('preview', m)"
      @toggle-select="(id: number) => emit('toggleSelection', id)"
      @delete-material="confirmDeleteSingle"
      @retry-material="(id: number, ossId: number) => emit('retryMaterial', id, ossId)"
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
