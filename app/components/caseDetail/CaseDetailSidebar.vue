<script lang="ts" setup>
import type { Component } from 'vue'
import type { ActiveView } from '~/composables/useCaseDetail'
import {
  LayoutDashboardIcon,
  FolderIcon,
  SparklesIcon,
  ListTodoIcon,
  FileEditIcon,
  FileSearchIcon,
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
  { id: 'documents', label: '文书生成', icon: FileEditIcon },
  { id: 'contracts', label: '合同审查', icon: FileSearchIcon },
]

const futureItems: Array<{ label: string; icon: Component }> = [
  { label: '待办事项', icon: ListTodoIcon },
]
</script>

<template>
  <TooltipProvider :delay-duration="300">
    <nav class="flex flex-col h-full p-2 lg:p-3 space-y-1">
      <Tooltip v-for="item in menuItems" :key="item.id">
        <TooltipTrigger as-child>
          <button
            class="w-full flex items-center justify-center lg:justify-start gap-3 px-2 lg:px-3 py-2 rounded-lg text-sm transition-colors"
            :class="[
              modelValue === item.id
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            ]"
            @click="modelValue = item.id"
          >
            <component :is="item.icon" class="size-4 shrink-0" />
            <span class="hidden lg:inline">{{ item.label }}</span>
            <Badge v-if="item.badge" variant="secondary" class="ml-auto px-1.5 py-0 h-4 text-[10px] hidden lg:inline-flex">
              {{ item.badge }}
            </Badge>
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" class="lg:hidden">
          {{ item.label }}
        </TooltipContent>
      </Tooltip>

      <Separator class="my-2" />

      <Tooltip v-for="item in futureItems" :key="item.label">
        <TooltipTrigger as-child>
          <button
            class="w-full flex items-center justify-center lg:justify-start gap-3 px-2 lg:px-3 py-2 rounded-lg text-sm text-muted-foreground/50 cursor-not-allowed"
            disabled
          >
            <component :is="item.icon" class="size-4 shrink-0" />
            <span class="hidden lg:inline">{{ item.label }}</span>
            <span class="ml-auto text-[9px] bg-muted rounded px-1 hidden lg:inline">即将推出</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" class="lg:hidden">
          {{ item.label }}（即将推出）
        </TooltipContent>
      </Tooltip>
    </nav>
  </TooltipProvider>
</template>
