<script setup lang="ts">
import type { Component } from 'vue'
import type { ToolCallWithResult } from './composables/useMessageParser'

interface Props {
  toolCall: ToolCallWithResult
  toolMap?: Record<string, Component>
}

const props = defineProps<Props>()

const emit = defineEmits<{
  (e: 'confirm', data: any): void
  (e: 'reject'): void
}>()
</script>

<template>
  <!-- 用户自定义工具优先 -->
  <component
    v-if="toolMap?.[toolCall.name]"
    :is="toolMap[toolCall.name]"
    :tool-name="toolCall.name"
    :input="toolCall.args"
    :output="toolCall.result"
    :state="toolCall.state"
    @confirm="emit('confirm', $event)"
    @reject="emit('reject')"
  />
  <AiToolsMaterialProcessTool v-else-if="toolCall.name === 'process_materials'" :tool-name="toolCall.name" :input="toolCall.args" :output="toolCall.result" :state="toolCall.state" @confirm="emit('confirm', $event)" @reject="emit('reject')" />
  <AiToolsPointsReserveTool v-else-if="toolCall.name === 'reserve_points'" :tool-name="toolCall.name" :input="toolCall.args" :output="toolCall.result" :state="toolCall.state" @confirm="emit('confirm', $event)" @reject="emit('reject')" />
  <AiToolsConfirmPointsTool v-else-if="toolCall.name === 'confirm_points'" :tool-name="toolCall.name" :input="toolCall.args" :output="toolCall.result" :state="toolCall.state" @confirm="emit('confirm', $event)" @reject="emit('reject')" />
  <AiToolsRollbackPointsTool v-else-if="toolCall.name === 'rollback_points'" :tool-name="toolCall.name" :input="toolCall.args" :output="toolCall.result" :state="toolCall.state" @confirm="emit('confirm', $event)" @reject="emit('reject')" />
  <AiToolsWriteTodosTool v-else-if="toolCall.name === 'write_todos'" :tool-name="toolCall.name" :input="toolCall.args" :output="toolCall.result" :state="toolCall.state" @confirm="emit('confirm', $event)" @reject="emit('reject')" />
  <AiToolsMaterialSearchTool v-else-if="toolCall.name === 'search_case_materials'" :tool-name="toolCall.name" :input="toolCall.args" :output="toolCall.result" :state="toolCall.state" @confirm="emit('confirm', $event)" @reject="emit('reject')" />
  <AiToolsLawSearchTool v-else-if="toolCall.name === 'search_law'" :tool-name="toolCall.name" :input="toolCall.args" :output="toolCall.result" :state="toolCall.state" @confirm="emit('confirm', $event)" @reject="emit('reject')" />
  <AiToolsExtractInfoTool v-else-if="toolCall.name === 'extract_case_info'" :tool-name="toolCall.name" :input="toolCall.args" :output="toolCall.result" :state="toolCall.state" @confirm="emit('confirm', $event)" @reject="emit('reject')" />
  <AiToolsUploadWorkspaceFileTool v-else-if="toolCall.name === 'upload_workspace_file'" :tool-name="toolCall.name" :input="toolCall.args" :output="toolCall.result" :state="toolCall.state" @confirm="emit('confirm', $event)" @reject="emit('reject')" />
  <AiToolsDefaultTool v-else :tool-name="toolCall.name" :input="toolCall.args" :output="toolCall.result" :state="toolCall.state" @confirm="emit('confirm', $event)" @reject="emit('reject')" />
</template>
