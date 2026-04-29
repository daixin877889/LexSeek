<script setup lang="ts">
import { computed, inject } from 'vue'
import type { Component } from 'vue'
import { SYNTHETIC_TOOL_GENERATE_SUMMARY } from '#shared/types/agentEvent'
import type { ToolCallWithResult } from './composables/useMessageParser'
import SubAgentChainOfThought from './SubAgentChainOfThought.vue'
import InterruptDispatcher from '~/components/InterruptDispatcher.vue'
import { globalInterruptRegistry } from '~/composables/agent-platform/interruptRegistry'
import AiToolsConfirmPointsTool from '~/components/ai/tools/ConfirmPointsTool.vue'
import AiToolsDefaultTool from '~/components/ai/tools/DefaultTool.vue'
import AiToolsExtractInfoTool from '~/components/ai/tools/ExtractInfoTool.vue'
import AiToolsGenerateSummaryTool from '~/components/ai/tools/GenerateSummaryTool.vue'
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

// messageStreamContext：interrupt 内联化用，由 panel 层 provide
interface MessageStreamContext {
  interruptData: { value: { type?: string; toolCallId?: string;[key: string]: unknown } | null }
  resolvedInterrupts: Record<string, {
    interrupt: { type: string; toolCallId: string;[key: string]: unknown }
    resumeValue: unknown
    resolvedAt: Date
  }>
  resolveInterrupt: (value: unknown) => void
}
const messageStreamContext = inject<MessageStreamContext | null>('messageStreamContext', null)

const resolvedEntry = computed(() => {
  return messageStreamContext?.resolvedInterrupts[props.toolCall.id] ?? null
})

/**
 * 当前 toolCall 是否命中"活跃 interrupt"——active interrupt 必须优先于 resolved
 * 历史显示，否则当同一 toolCallId 因外部因素被重复触发（agent 重试 / failure resume）
 * 时，UI 会拿到 stale 的 snapshot 而非 fresh active。
 */
const isActiveInterruptForThisCall = computed(() => {
  const active = messageStreamContext?.interruptData.value
  return !!(active?.toolCallId === props.toolCall.id
    && active.type
    && globalInterruptRegistry.isToolCard(active.type))
})

const isInterruptToolCardCall = computed(() => {
  return isActiveInterruptForThisCall.value || !!resolvedEntry.value
})

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
  <!-- interrupt 工具卡（active 或 resolved）：active 优先于 resolved（避免同一 toolCallId
       重复触发时 UI 显示 stale snapshot）；resumeValue 仅在 resolved 且非 active 时传入。 -->
  <template v-if="isInterruptToolCardCall">
    <InterruptDispatcher
      :interrupt="isActiveInterruptForThisCall
        ? messageStreamContext?.interruptData.value
        : (resolvedEntry?.interrupt ?? null)"
      :resume-value="isActiveInterruptForThisCall ? undefined : resolvedEntry?.resumeValue"
      @submit="(v) => messageStreamContext?.resolveInterrupt(v)"
      @cancel="() => messageStreamContext?.resolveInterrupt(null)"
    />
    <component
      v-if="resolvedEntry && toolCall.state === 'output-available' && toolMap?.[toolCall.name]"
      :is="toolMap[toolCall.name]"
      :tool-name="toolCall.name"
      :input="toolCall.args"
      :output="toolCall.result"
      :state="toolCall.state"
    />
  </template>
  <!-- 用户自定义工具优先 -->
  <component
    v-else-if="toolMap?.[toolCall.name]"
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
  <!-- generate_summary 是合成卡片（非真实 LLM 工具）：由 saveAnalysisResult 工具发出的 ANALYSIS_SUMMARY 事件触发，紧跟在 save_analysis_result 卡片之后 -->
  <AiToolsGenerateSummaryTool v-else-if="toolCall.name === SYNTHETIC_TOOL_GENERATE_SUMMARY" :tool-name="toolCall.name" :input="toolCall.args" :output="toolCall.result" :state="toolCall.state" />
  <AiToolsDefaultTool v-else :tool-name="toolCall.name" :input="toolCall.args" :output="toolCall.result" :state="toolCall.state" @confirm="emit('confirm', $event)" @reject="emit('reject')" />
</template>
