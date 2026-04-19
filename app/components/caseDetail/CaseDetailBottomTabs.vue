<script lang="ts" setup>
import type { Component } from 'vue'
import type { ActiveView } from '~/composables/useCaseDetail'
import {
  LayoutDashboardIcon,
  FolderIcon,
  SparklesIcon,
  FileEditIcon,
  FileSearchIcon,
} from 'lucide-vue-next'

interface TabItem {
  id: ActiveView
  label: string
  icon: Component
}

const modelValue = defineModel<ActiveView>({ required: true })

const tabs: TabItem[] = [
  { id: 'overview', label: '概览', icon: LayoutDashboardIcon },
  { id: 'materials', label: '材料', icon: FolderIcon },
  { id: 'analysis', label: '分析', icon: SparklesIcon },
  { id: 'documents', label: '文书', icon: FileEditIcon },
  { id: 'contracts', label: '合同', icon: FileSearchIcon },
]
</script>

<template>
  <nav class="h-14 flex items-center justify-around bg-background border-t pb-[env(safe-area-inset-bottom)]">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      class="flex flex-col items-center gap-0.5 py-2 px-4 text-xs transition-colors"
      :class="[
        modelValue === tab.id
          ? 'text-primary'
          : 'text-muted-foreground'
      ]"
      @click="modelValue = tab.id"
    >
      <component :is="tab.icon" class="size-5" />
      <span>{{ tab.label }}</span>
    </button>
  </nav>
</template>
