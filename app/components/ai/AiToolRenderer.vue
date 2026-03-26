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
  <!-- 用户自定义工具优先 -->
  <component
    v-if="toolMap?.[toolCall.name]"
    :is="toolMap[toolCall.name]"
    v-bind="adaptedProps"
    @confirm="handleConfirm"
    @reject="handleReject"
  />
  <AiToolsMaterialProcessTool v-else-if="toolCall.name === 'process_materials'" v-bind="adaptedProps" @confirm="handleConfirm" @reject="handleReject" />
  <AiToolsPointsReserveTool v-else-if="toolCall.name === 'reserve_points'" v-bind="adaptedProps" @confirm="handleConfirm" @reject="handleReject" />
  <AiToolsConfirmPointsTool v-else-if="toolCall.name === 'confirm_points'" v-bind="adaptedProps" @confirm="handleConfirm" @reject="handleReject" />
  <AiToolsRollbackPointsTool v-else-if="toolCall.name === 'rollback_points'" v-bind="adaptedProps" @confirm="handleConfirm" @reject="handleReject" />
  <AiToolsWriteTodosTool v-else-if="toolCall.name === 'write_todos'" v-bind="adaptedProps" @confirm="handleConfirm" @reject="handleReject" />
  <AiToolsMaterialSearchTool v-else-if="toolCall.name === 'search_case_materials'" v-bind="adaptedProps" @confirm="handleConfirm" @reject="handleReject" />
  <AiToolsLawSearchTool v-else-if="toolCall.name === 'search_law'" v-bind="adaptedProps" @confirm="handleConfirm" @reject="handleReject" />
  <AiToolsExtractInfoTool v-else-if="toolCall.name === 'extract_case_info'" v-bind="adaptedProps" @confirm="handleConfirm" @reject="handleReject" />
  <AiToolsDefaultTool v-else v-bind="adaptedProps" @confirm="handleConfirm" @reject="handleReject" />
</template>
