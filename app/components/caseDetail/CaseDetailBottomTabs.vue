<script lang="ts" setup>
import { computed, ref } from 'vue'
import type { Component } from 'vue'
import type { ActiveView } from '~/composables/useCaseDetail'
import {
  LayoutDashboardIcon,
  FolderIcon,
  SparklesIcon,
  FileEditIcon,
  FileSearchIcon,
  MoreHorizontalIcon,
  NotebookPenIcon,
} from 'lucide-vue-next'

interface TabItem {
  id: ActiveView
  label: string
  icon: Component
}

const modelValue = defineModel<ActiveView>({ required: true })

const mainTabs: TabItem[] = [
  { id: 'overview', label: '概览', icon: LayoutDashboardIcon },
  { id: 'materials', label: '材料', icon: FolderIcon },
  { id: 'analysis', label: '分析', icon: SparklesIcon },
  { id: 'documents', label: '文书', icon: FileEditIcon },
  { id: 'contracts', label: '合同', icon: FileSearchIcon },
]

const moreTabs: TabItem[] = [
  { id: 'memory', label: '案件记忆', icon: NotebookPenIcon },
]

const moreActive = computed(() => moreTabs.some(t => t.id === modelValue.value))
const moreOpen = ref(false)

function selectMore(id: ActiveView) {
  modelValue.value = id
  moreOpen.value = false
}
</script>

<template>
  <nav class="h-14 flex items-center justify-around bg-background border-t pb-[env(safe-area-inset-bottom)]">
    <button
      v-for="tab in mainTabs"
      :key="tab.id"
      class="flex flex-col items-center gap-0.5 py-2 px-3 text-xs transition-colors"
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

    <Sheet v-model:open="moreOpen">
      <SheetTrigger as-child>
        <button
          class="flex flex-col items-center gap-0.5 py-2 px-3 text-xs transition-colors"
          :class="moreActive ? 'text-primary' : 'text-muted-foreground'"
        >
          <MoreHorizontalIcon class="size-5" />
          <span>更多</span>
        </button>
      </SheetTrigger>
      <SheetContent side="bottom" class="pb-[env(safe-area-inset-bottom)]">
        <SheetHeader class="text-left">
          <SheetTitle>更多功能</SheetTitle>
        </SheetHeader>
        <div class="grid gap-1 py-2">
          <button
            v-for="tab in moreTabs"
            :key="tab.id"
            class="flex items-center gap-3 px-3 py-3 rounded-md text-sm transition-colors"
            :class="modelValue === tab.id
              ? 'bg-primary/10 text-primary'
              : 'text-foreground hover:bg-accent'"
            @click="selectMore(tab.id)"
          >
            <component :is="tab.icon" class="size-5" />
            <span>{{ tab.label }}</span>
          </button>
        </div>
      </SheetContent>
    </Sheet>
  </nav>
</template>
