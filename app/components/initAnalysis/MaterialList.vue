<template>
  <div class="p-4 space-y-3">
    <h3 class="text-sm font-medium text-muted-foreground flex items-center gap-2">
      <FileTextIcon class="size-4" />
      案件材料
      <Badge v-if="materials.length > 0" variant="secondary" class="ml-auto">{{ materials.length }}</Badge>
    </h3>

    <!-- 加载状态 -->
    <div v-if="loading" class="space-y-2">
      <div v-for="i in 3" :key="i" class="flex items-center gap-3 p-2 rounded-md">
        <Skeleton class="size-8 rounded-md shrink-0" />
        <div class="flex-1 space-y-1.5">
          <Skeleton class="h-3 w-[70%]" />
          <Skeleton class="h-2.5 w-[40%]" />
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-else-if="materials.length === 0" class="text-center py-6 text-sm text-muted-foreground">
      <FileTextIcon class="size-8 mx-auto mb-2 opacity-50" />
      暂无材料
    </div>

    <!-- 材料列表 -->
    <div v-else class="space-y-1">
      <button
        v-for="material in materials"
        :key="material.id"
        class="w-full flex items-center gap-3 p-2 rounded-md hover:bg-accent/50 transition-colors text-left"
        @click="emit('preview', material)"
      >
        <!-- 文件类型图标 -->
        <div class="flex items-center justify-center size-8 rounded-md bg-muted shrink-0">
          <component
            :is="getMaterialIcon(material.type)"
            :class="['size-4', getMaterialIconColor(material.type)]"
          />
        </div>

        <!-- 文件名和类型 -->
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium truncate" :title="material.name">
            {{ material.name }}
          </div>
          <div class="text-xs text-muted-foreground flex items-center gap-1.5">
            <span>{{ material.typeText }}</span>
            <span v-if="material.fileSize">{{ formatByteSize(material.fileSize, 1) }}</span>
          </div>
        </div>

        <!-- 状态标识 -->
        <Badge
          v-if="material.status !== 3"
          :variant="getStatusVariant(material.status)"
          class="shrink-0 text-xs"
        >
          {{ getStatusText(material.status) }}
        </Badge>

        <!-- 加密标识 -->
        <LockIcon v-if="material.isEncrypted" class="size-3 text-muted-foreground shrink-0" />
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

function getMaterialIconColor(type: number) {
  switch (type) {
    case CaseMaterialType.DOCUMENT: return 'text-blue-500'
    case CaseMaterialType.IMAGE: return 'text-green-500'
    case CaseMaterialType.AUDIO: return 'text-purple-500'
    case CaseMaterialType.CASE_CONTENT: return 'text-orange-500'
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
