<script setup lang="ts">
import { inject } from 'vue'
import type { Component } from 'vue'
import type { ToolCallWithResult } from './composables/useMessageParser'
import SubAgentChainOfThought from './SubAgentChainOfThought.vue'
import AiToolsConfirmPointsTool from '~/components/ai/tools/ConfirmPointsTool.vue'
import AiToolsDefaultTool from '~/components/ai/tools/DefaultTool.vue'
import AiToolsExtractInfoTool from '~/components/ai/tools/ExtractInfoTool.vue'
import AiToolsLawSearchTool from '~/components/ai/tools/LawSearchTool.vue'
import AiToolsMaterialProcessTool from '~/components/ai/tools/MaterialProcessTool.vue'
import AiToolsMaterialSearchTool from '~/components/ai/tools/MaterialSearchTool.vue'
import AiToolsMemorySearchTool from '~/components/ai/tools/MemorySearchTool.vue'
import AiToolsMemoryUpdateTool from '~/components/ai/tools/MemoryUpdateTool.vue'
import AiToolsMemoryWriteTool from '~/components/ai/tools/MemoryWriteTool.vue'
import AiToolsPointsReserveTool from '~/components/ai/tools/PointsReserveTool.vue'
import AiToolsReadSkillFileTool from '~/components/ai/tools/ReadSkillFileTool.vue'
import AiToolsRollbackPointsTool from '~/components/ai/tools/RollbackPointsTool.vue'
import AiToolsRunSkillScriptTool from '~/components/ai/tools/RunSkillScriptTool.vue'
import AiToolsSaveAnalysisResultTool from '~/components/ai/tools/SaveAnalysisResultTool.vue'
import AiToolsUploadWorkspaceFileTool from '~/components/ai/tools/UploadWorkspaceFileTool.vue'
import AiToolsWriteSkillFileTool from '~/components/ai/tools/WriteSkillFileTool.vue'
import AiToolsWriteTodosTool from '~/components/ai/tools/WriteTodosTool.vue'

interface Props {
  toolCall: ToolCallWithResult
  toolMap?: Record<string, Component>
}

const props = defineProps<Props>()

const emit = defineEmits<{
  (e: 'confirm', data: any): void
  (e: 'reject'): void
}>()

function isSubAgentTool(name: string): boolean {
  return name.startsWith('ask_') && name.endsWith('_expert')
}

function subAgentTitleFromName(name: string): string {
  return name.replace(/^ask_/, '').replace(/_expert$/, '').replace(/_/g, ' ')
}

interface SubAgentAccess {
  subThreadsMap: Record<string, any>
}
const subAgentAccess = inject<SubAgentAccess | null>('subAgentAccess', null)

function subAgentMessages(toolCallId: string): any[] {
  return subAgentAccess?.subThreadsMap?.[toolCallId]?.messages ?? []
}
function subAgentIsRunning(toolCallId: string): boolean {
  return subAgentAccess?.subThreadsMap?.[toolCallId]?.status === 'running'
}
function subAgentIsFailed(toolCallId: string): boolean {
  return subAgentAccess?.subThreadsMap?.[toolCallId]?.status === 'failed'
}
function subAgentError(toolCallId: string): string | undefined {
  return subAgentAccess?.subThreadsMap?.[toolCallId]?.error
}
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
  <!-- 子 Agent 工具：用 Chain of Thought 展示内部思考过程 -->
  <SubAgentChainOfThought
    v-else-if="isSubAgentTool(toolCall.name)"
    :agent-title="subAgentTitleFromName(toolCall.name)"
    :sub-messages="subAgentMessages(toolCall.id)"
    :is-running="subAgentIsRunning(toolCall.id)"
    :is-failed="subAgentIsFailed(toolCall.id)"
    :failure-reason="subAgentError(toolCall.id)"
  />
  <AiToolsMaterialProcessTool v-else-if="toolCall.name === 'process_materials'" :tool-name="toolCall.name" :input="toolCall.args" :output="toolCall.result" :state="toolCall.state" @confirm="emit('confirm', $event)" @reject="emit('reject')" />
  <AiToolsPointsReserveTool v-else-if="toolCall.name === 'reserve_points'" :tool-name="toolCall.name" :input="toolCall.args" :output="toolCall.result" :state="toolCall.state" @confirm="emit('confirm', $event)" @reject="emit('reject')" />
  <AiToolsConfirmPointsTool v-else-if="toolCall.name === 'confirm_points'" :tool-name="toolCall.name" :input="toolCall.args" :output="toolCall.result" :state="toolCall.state" @confirm="emit('confirm', $event)" @reject="emit('reject')" />
  <AiToolsRollbackPointsTool v-else-if="toolCall.name === 'rollback_points'" :tool-name="toolCall.name" :input="toolCall.args" :output="toolCall.result" :state="toolCall.state" @confirm="emit('confirm', $event)" @reject="emit('reject')" />
  <AiToolsWriteTodosTool v-else-if="toolCall.name === 'write_todos'" :tool-name="toolCall.name" :input="toolCall.args" :output="toolCall.result" :state="toolCall.state" @confirm="emit('confirm', $event)" @reject="emit('reject')" />
  <AiToolsMaterialSearchTool v-else-if="toolCall.name === 'search_case_materials'" :tool-name="toolCall.name" :input="toolCall.args" :output="toolCall.result" :state="toolCall.state" @confirm="emit('confirm', $event)" @reject="emit('reject')" />
  <AiToolsLawSearchTool v-else-if="toolCall.name === 'search_law'" :tool-name="toolCall.name" :input="toolCall.args" :output="toolCall.result" :state="toolCall.state" @confirm="emit('confirm', $event)" @reject="emit('reject')" />
  <AiToolsMemorySearchTool v-else-if="toolCall.name === 'search_case_memory'" :tool-name="toolCall.name" :input="toolCall.args" :output="toolCall.result" :state="toolCall.state" />
  <AiToolsMemoryWriteTool v-else-if="toolCall.name === 'write_case_memory'" :tool-name="toolCall.name" :input="toolCall.args" :output="toolCall.result" :state="toolCall.state" />
  <AiToolsMemoryUpdateTool v-else-if="toolCall.name === 'update_case_memory'" :tool-name="toolCall.name" :input="toolCall.args" :output="toolCall.result" :state="toolCall.state" />
  <AiToolsExtractInfoTool v-else-if="toolCall.name === 'extract_case_info'" :tool-name="toolCall.name" :input="toolCall.args" :output="toolCall.result" :state="toolCall.state" @confirm="emit('confirm', $event)" @reject="emit('reject')" />
  <AiToolsUploadWorkspaceFileTool v-else-if="toolCall.name === 'upload_workspace_file'" :tool-name="toolCall.name" :input="toolCall.args" :output="toolCall.result" :state="toolCall.state" @confirm="emit('confirm', $event)" @reject="emit('reject')" />
  <AiToolsReadSkillFileTool v-else-if="toolCall.name === 'read_skill_file'" :tool-name="toolCall.name" :input="toolCall.args" :output="toolCall.result" :state="toolCall.state" @confirm="emit('confirm', $event)" @reject="emit('reject')" />
  <AiToolsWriteSkillFileTool v-else-if="toolCall.name === 'write_skill_file'" :tool-name="toolCall.name" :input="toolCall.args" :output="toolCall.result" :state="toolCall.state" @confirm="emit('confirm', $event)" @reject="emit('reject')" />
  <AiToolsRunSkillScriptTool v-else-if="toolCall.name === 'run_skill_script'" :tool-name="toolCall.name" :input="toolCall.args" :output="toolCall.result" :state="toolCall.state" @confirm="emit('confirm', $event)" @reject="emit('reject')" />
  <AiToolsSaveAnalysisResultTool v-else-if="toolCall.name === 'save_analysis_result'" :tool-name="toolCall.name" :input="toolCall.args" :output="toolCall.result" :state="toolCall.state" @confirm="emit('confirm', $event)" @reject="emit('reject')" />
  <AiToolsDefaultTool v-else :tool-name="toolCall.name" :input="toolCall.args" :output="toolCall.result" :state="toolCall.state" @confirm="emit('confirm', $event)" @reject="emit('reject')" />
</template>
