<script lang="ts" setup>
import type { Component } from 'vue'
import type { ActiveView } from '~/composables/useCaseDetail'
import {
  LayoutDashboardIcon,
  FolderIcon,
  SparklesIcon,
  ListTodoIcon,
  FileEditIcon,
} from 'lucide-vue-next'

interface SidebarMenuItem {
  id: ActiveView
  label: string
  icon: Component
  disabled?: boolean
  badge?: string
}

const modelValue = defineModel<ActiveView>({ required: true })

const menuItems: SidebarMenuItem[] = [
  { id: 'overview', label: '概览', icon: LayoutDashboardIcon },
  { id: 'materials', label: '案件材料', icon: FolderIcon },
  { id: 'analysis', label: '分析结果', icon: SparklesIcon },
]

const futureItems: Array<{ label: string; icon: Component }> = [
  { label: '待办事项', icon: ListTodoIcon },
  { label: '文书生成', icon: FileEditIcon },
]
</script>

<template>
  <nav class="flex flex-col h-full p-3 space-y-1">
    <button
      v-for="item in menuItems"
      :key="item.id"
      class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors"
      :class="[
        modelValue === item.id
          ? 'bg-primary/10 text-primary font-medium'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      ]"
      @click="modelValue = item.id"
    >
      <component :is="item.icon" class="size-4 shrink-0" />
      <span>{{ item.label }}</span>
      <Badge v-if="item.badge" variant="secondary" class="ml-auto px-1.5 py-0 h-4 text-[10px]">
        {{ item.badge }}
      </Badge>
    </button>

    <Separator class="my-2" />
    <button
      v-for="item in futureItems"
      :key="item.label"
      class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground/50 cursor-not-allowed"
      disabled
    >
      <component :is="item.icon" class="size-4 shrink-0" />
      <span>{{ item.label }}</span>
      <span class="ml-auto text-[9px] bg-muted rounded px-1">即将推出</span>
    </button>
  </nav>
</template>
