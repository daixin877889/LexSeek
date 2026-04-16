<!-- StatusBadge.vue -->
<script setup lang="ts">
import type { DynamicToolUIPart, ToolUIPart } from 'ai'
import type { Component } from 'vue'
import { Badge } from '@repo/shadcn-vue/components/ui/badge'
import {
  CheckCircleIcon,
  CircleIcon,
  ClockIcon,
  PauseCircleIcon,
  XCircleIcon,
} from 'lucide-vue-next'
import { computed } from 'vue'
import type { ExtendedToolState } from '../types'

export type ToolPart = ToolUIPart | DynamicToolUIPart

const props = defineProps<{
  state: ExtendedToolState
}>()

const label = computed(() => {
  const labels: Record<ExtendedToolState, string> = {
    'input-streaming': '待处理',
    'input-available': '运行中',
    'input-paused': '已暂停',
    'approval-requested': '待批准',
    'approval-responded': '已回复',
    'output-available': '完成',
    'output-error': '错误',
    'output-denied': '拒绝',
  }
  return labels[props.state]
})

const icon = computed<Component>(() => {
  const icons: Record<ExtendedToolState, Component> = {
    'input-streaming': CircleIcon,
    'input-available': ClockIcon,
    'input-paused': PauseCircleIcon,
    'approval-requested': ClockIcon,
    'approval-responded': CheckCircleIcon,
    'output-available': CheckCircleIcon,
    'output-error': XCircleIcon,
    'output-denied': XCircleIcon,
  }
  return icons[props.state]
})

const iconClass = computed(() => {
  const classes: Record<ExtendedToolState, string> = {
    'input-streaming': 'size-4',
    'input-available': 'size-4 animate-pulse',
    'input-paused': 'size-4 text-yellow-600',
    'approval-requested': 'size-4 text-yellow-600',
    'approval-responded': 'size-4 text-blue-600',
    'output-available': 'size-4 text-green-600',
    'output-error': 'size-4 text-red-600',
    'output-denied': 'size-4 text-orange-600',
  }
  return classes[props.state]
})
</script>

<template>
  <Badge class="gap-1.5 rounded-full text-xs" variant="secondary">
    <component :is="icon" :class="iconClass" />
    <span>{{ label }}</span>
  </Badge>
</template>
