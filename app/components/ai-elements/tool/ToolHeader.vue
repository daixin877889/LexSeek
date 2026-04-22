<script setup lang="ts">
import type { DynamicToolUIPart, ToolUIPart } from 'ai'
import type { HTMLAttributes } from 'vue'
import type { ExtendedToolState } from '../types'
import { CollapsibleTrigger } from '@repo/shadcn-vue/components/ui/collapsible'
import { cn } from '@repo/shadcn-vue/lib/utils'
import { ChevronDownIcon, WrenchIcon } from 'lucide-vue-next'
import { computed } from 'vue'
import StatusBadge from './ToolStatusBadge.vue'

type ToolHeaderProps = {
  title?: string
  class?: HTMLAttributes['class']
} & (
  | { type: ToolUIPart['type'], state: ExtendedToolState, toolName?: never }
  | { type: DynamicToolUIPart['type'], state: ExtendedToolState, toolName: string }
)

const props = defineProps<ToolHeaderProps>()

const derivedName = computed(() =>
  props.type === 'dynamic-tool'
    ? props.toolName
    : props.type.split('-').slice(1).join('-'),
)
</script>

<template>
  <CollapsibleTrigger
    :class="
      cn(
        'flex w-full items-center justify-between gap-4 p-3',
        props.class,
      )
    "
    v-bind="$attrs"
  >
    <div class="flex min-w-0 items-center gap-2">
      <WrenchIcon class="size-4 text-muted-foreground" />
      <span class="font-medium text-sm">{{ props.title ?? derivedName }}</span>
      <StatusBadge :state="props.state" />
    </div>
    <div class="flex items-center gap-2">
      <!-- 工具组件可通过 extra slot 在右侧追加结果数等辅助信息 -->
      <slot name="extra" />
      <ChevronDownIcon
        class="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
      />
    </div>
  </CollapsibleTrigger>
</template>
