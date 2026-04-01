<script lang="ts" setup>
import type { MaterialItem } from '~/composables/useCaseDetail'
import { CaseMaterialType } from '#shared/types/case'
import { formatByteSize } from '#shared/utils/unitConverision'
import {
  FileTextIcon,
  FileIcon,
  ImageIcon,
  FileAudioIcon,
  LayoutGridIcon,
  ListIcon,
} from 'lucide-vue-next'

const props = defineProps<{
  materials: MaterialItem[]
}>()

const emit = defineEmits<{
  preview: [material: MaterialItem]
}>()

const viewMode = ref<'grid' | 'list'>('grid')

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
    </div>

    <!-- 视图切换区域 -->
    <Transition name="view-fade" mode="out-in">
      <!-- 网格视图 -->
      <div v-if="viewMode === 'grid'" key="grid" class="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
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

      <!-- 列表视图 -->
      <div v-else key="list" class="space-y-1">
        <button
          v-for="material in materials"
          :key="material.id"
          class="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors group border border-transparent hover:border-border/50"
          @click="emit('preview', material)"
        >
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
            </div>
          </div>
        </button>
      </div>
    </Transition>
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
