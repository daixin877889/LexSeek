<template>
  <div class="p-4 space-y-3">
    <h3 class="text-sm font-medium text-muted-foreground flex items-center gap-2">
      <FileTextIcon class="size-4" />
      案件材料
      <Badge v-if="materials.length > 0" variant="secondary" class="ml-auto">{{ materials.length }}</Badge>
    </h3>

    <!-- 加载状态 -->
    <div v-if="loading" class="grid grid-cols-2 gap-3">
      <div v-for="i in 4" :key="i" class="p-3 rounded-xl bg-muted/40 space-y-3">
        <Skeleton class="size-9 rounded-lg" />
        <div class="space-y-1.5">
          <Skeleton class="h-3 w-full" />
          <Skeleton class="h-2.5 w-2/3" />
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-else-if="materials.length === 0" class="text-center py-6 text-sm text-muted-foreground">
      <FileTextIcon class="size-8 mx-auto mb-2 opacity-50" />
      暂无材料
    </div>

    <!-- 材料列表 -->
    <div v-else class="grid grid-cols-2 gap-3">
      <button
        v-for="material in materials"
        :key="material.id"
        class="group relative flex flex-col p-3 rounded-xl bg-muted/40 hover:bg-muted/60 transition-all border border-transparent hover:border-primary/10 text-left"
        @click="emit('preview', material)"
      >
        <!-- 文件类型图标和状态 -->
        <div class="flex items-start justify-between mb-3">
          <div :class="['flex items-center justify-center size-9 rounded-lg shrink-0 transition-transform group-hover:scale-110', getMaterialBgColor(material.type)]">
            <component
              :is="getMaterialIcon(material.type)"
              :class="['size-5', getMaterialIconColor(material.type)]"
            />
          </div>
          
          <div v-if="material.status !== 3 || material.isEncrypted" class="flex flex-col items-end gap-1">
            <Badge
              v-if="material.status !== 3"
              :variant="getStatusVariant(material.status)"
              class="px-1.5 py-0 h-4 text-[10px] font-medium"
            >
              {{ getStatusText(material.status) }}
            </Badge>
            <LockIcon v-if="material.isEncrypted" class="size-3 text-muted-foreground/60" />
          </div>
        </div>

        <!-- 文件信息 -->
        <div class="flex-1 min-w-0">
          <div class="text-[13px] font-medium line-clamp-2 leading-snug mb-1 group-hover:text-primary transition-colors" :title="material.name">
            {{ material.name }}
          </div>
          <div class="text-[11px] text-muted-foreground/70 flex items-center gap-1.5">
            <span class="truncate">{{ material.typeText }}</span>
            <template v-if="material.fileSize">
              <span class="size-1 rounded-full bg-muted-foreground/30 shrink-0"></span>
              <span class="shrink-0">{{ formatByteSize(material.fileSize, 1) }}</span>
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

const props = defineProps<{
  caseId: number
}>()

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
