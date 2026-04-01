<template>
  <div class="p-4 space-y-3">
    <h3 v-if="!hideHeader" class="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider flex items-center gap-2">
      <FileTextIcon class="size-4" />
      案件材料
      <Badge v-if="materials.length > 0" variant="secondary" class="font-normal px-1.5 py-0 h-4 text-[10px]">{{ materials.length }}</Badge>
    </h3>

    <!-- 加载状态 -->
    <div v-if="loading" class="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
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
    <div v-else class="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
      <button
        v-for="material in materials"
        :key="material.id"
        class="group relative flex flex-col items-center p-2.5 rounded-xl bg-muted/40 hover:bg-muted/60 transition-all border border-transparent hover:border-primary cursor-pointer text-center"
        @click="emit('preview', material)"
      >
        <!-- 状态标签 (绝对定位以节省空间) -->
        <div v-if="material.status !== 3 || material.isEncrypted" class="absolute top-2 right-2 flex flex-col items-end gap-1">
          <Badge
            v-if="material.status !== 3"
            :variant="getStatusVariant(material.status)"
            class="px-1 py-0 h-3.5 text-[9px] font-medium"
          >
            {{ getStatusText(material.status) }}
          </Badge>
          <LockIcon v-if="material.isEncrypted" class="size-3 text-muted-foreground/60" />
        </div>

        <!-- 文件类型图标 -->
        <div :class="['flex items-center justify-center size-11 rounded-xl shrink-0 transition-transform group-hover:scale-105 mb-1.5', getMaterialBgColor(material.type)]">
          <component
            :is="getMaterialIcon(material.type)"
            :class="['size-6', getMaterialIconColor(material.type)]"
          />
        </div>

        <!-- 文件信息 -->
        <div class="flex-1 min-w-0 w-full">
          <div class="text-[12px] font-medium line-clamp-1 leading-tight mb-1 group-hover:text-primary transition-colors px-1" :title="material.name">
            {{ material.name }}
          </div>
          <div class="text-[10px] text-muted-foreground/60 flex items-center justify-center gap-1">
            <span class="truncate max-w-[60px]">{{ material.typeText }}</span>
            <template v-if="material.fileSize">
              <span class="size-0.5 rounded-full bg-muted-foreground/30 shrink-0"></span>
              <span class="shrink-0">{{ formatByteSize(material.fileSize, 0) }}</span>
            </template>
          </div>
        </div>
      </button>
    </div>
  </div>
</template>

<script lang="ts" setup>
import {
  FileTextIcon,
  FileIcon,
  ImageIcon,
  FileAudioIcon,
  LockIcon,
} from 'lucide-vue-next'
import { formatByteSize } from '#shared/utils/unitConverision'
import { CaseMaterialType } from '#shared/types/case'

interface MaterialItem {
  id: number
  name: string
  type: number
  typeText: string
  ossFileId: number | null
  isEncrypted: boolean
  status: number
  summary: string | null
  fileName: string | null
  fileSize: number | null
  fileType: string | null
}

const props = withDefaults(defineProps<{
  caseId: number
  hideHeader?: boolean
}>(), {
  hideHeader: false
})

const emit = defineEmits<{
  preview: [material: MaterialItem]
}>()

const loading = ref(false)
const materials = ref<MaterialItem[]>([])

async function loadMaterials() {
  if (props.caseId <= 0) return
  loading.value = true
  try {
    const data = await useApiFetch<MaterialItem[]>(`/api/v1/case/${props.caseId}/materials`)
    if (data) materials.value = data
  } finally {
    loading.value = false
  }
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

function getStatusVariant(status: number) {
  switch (status) {
    case 1: return 'secondary'
    case 2: return 'default'
    case 3: return 'default'
    case 4: return 'destructive'
    default: return 'secondary'
  }
}

function getStatusText(status: number) {
  const map: Record<number, string> = {
    1: '待处理',
    2: '处理中',
    3: '已完成',
    4: '失败',
  }
  return map[status] ?? '未知'
}

watch(() => props.caseId, (id) => {
  if (id > 0) loadMaterials()
}, { immediate: true })
</script>
