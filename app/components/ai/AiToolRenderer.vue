<script setup lang="ts">
import type { Component } from 'vue'
import type { ToolCallWithResult } from './composables/useMessageParser'

interface Props {
  toolCall: ToolCallWithResult
  toolMap?: Record<string, Component>
  showInterrupt?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  showInterrupt: true,
})

const emit = defineEmits<{
  (e: 'confirm', data: any): void
  (e: 'reject'): void
}>()

// 内置工具映射表（使用 Nuxt 自动导入的组件名字符串，在 computed 中懒解析）
const builtInToolNames: Record<string, string> = {
  process_materials: 'AiToolsMaterialProcessTool',
  reserve_points: 'AiToolsPointsReserveTool',
  confirm_points: 'AiToolsConfirmPointsTool',
  rollback_points: 'AiToolsRollbackPointsTool',
  write_todos: 'AiToolsWriteTodosTool',
  search_case_materials: 'AiToolsMaterialSearchTool',
  search_law: 'AiToolsLawSearchTool',
  extract_case_info: 'AiToolsExtractInfoTool',
}

// 解析组件：用户 toolMap 优先 > 内置映射 > DefaultTool
const ToolComponent = computed(() => {
  // 1. 用户自定义映射（直接是组件引用）
  if (props.toolMap?.[props.toolCall.name]) {
    return props.toolMap[props.toolCall.name]
  }
  // 2. 内置映射（通过 resolveComponent 懒解析）
  const builtInName = builtInToolNames[props.toolCall.name]
  if (builtInName) {
    return resolveComponent(builtInName)
  }
  // 3. DefaultTool fallback
  return resolveComponent('AiToolsDefaultTool')
})

// 适配层：统一为现有工具组件的 props 格式
const adaptedProps = computed(() => ({
  toolName: props.toolCall.name,
  input: props.toolCall.args,
  output: props.toolCall.result,
  state: props.toolCall.state,
}))

function handleConfirm(data: any) {
  emit('confirm', data)
}

function handleReject() {
  emit('reject')
}
</script>

<template>
  <component
    :is="ToolComponent"
    v-bind="adaptedProps"
    @confirm="handleConfirm"
    @reject="handleReject"
  />
</template>
