<script lang="ts" setup>
import type { MaterialItem } from '~/composables/useCaseDetail'
import { CaseMaterialType } from '#shared/types/case'
import { formatByteSize } from '#shared/utils/unitConverision'
import {
  FileTextIcon,
  FileIcon,
  ImageIcon,
  FileAudioIcon,
} from 'lucide-vue-next'

const props = defineProps<{
  materials: MaterialItem[]
}>()

const emit = defineEmits<{
  preview: [material: MaterialItem]
}>()

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
    <h3 class="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider mb-3 flex items-center gap-2">
      <FileTextIcon class="size-4" />
      案件材料
      <Badge v-if="materials.length > 0" variant="secondary" class="font-normal px-1.5 py-0 h-4 text-[10px]">
        {{ materials.length }}
      </Badge>
    </h3>
    <div class="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
      <button
        v-for="material in materials"
        :key="material.id"
        class="group relative flex flex-col items-center p-2.5 rounded-xl bg-muted/40 hover:bg-muted/60 transition-all border border-transparent hover:border-primary/10 text-center"
        @click="emit('preview', material)"
      >
        <div :class="['flex items-center justify-center size-11 rounded-xl shrink-0 transition-transform group-hover:scale-105 mb-1.5', getMaterialBgColor(material.type)]">
          <component :is="getMaterialIcon(material.type)" :class="['size-6', getMaterialIconColor(material.type)]" />
        </div>
        <div class="flex-1 min-w-0 w-full">
          <div class="text-[12px] font-medium line-clamp-1 leading-tight mb-1 group-hover:text-primary transition-colors px-1">
            {{ material.name }}
          </div>
          <div class="text-[10px] text-muted-foreground/60 flex items-center justify-center gap-1">
            <span v-if="material.fileSize" class="shrink-0">{{ formatByteSize(material.fileSize, 0) }}</span>
          </div>
        </div>
      </button>
    </div>
  </div>
</template>
