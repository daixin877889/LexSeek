<script setup lang="ts">
import { computed, inject } from 'vue'
import type { Component } from 'vue'
import { SYNTHETIC_TOOL_GENERATE_SUMMARY } from '#shared/types/agentEvent'
import { toolDisplayName } from '~/utils/toolDisplayName'
import type { ToolCallWithResult } from './composables/useMessageParser'
import SubAgentChainOfThought from './SubAgentChainOfThought.vue'
import InterruptDispatcher from '~/components/InterruptDispatcher.vue'
import { globalInterruptRegistry } from '~/composables/agent-platform/interruptRegistry'
import AiToolsAnalysisSearchTool from '~/components/ai/tools/AnalysisSearchTool.vue'
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

const SUB_AGENT_LIKE_TOOLS = new Set(['draft_document', 'review_contract'])

const INTERNAL_TOOL_MAP: Record<string, Component> = {
  process_materials: AiToolsMaterialProcessTool,
  reserve_points: AiToolsPointsReserveTool,
  confirm_points: AiToolsConfirmPointsTool,
  rollback_points: AiToolsRollbackPointsTool,
  write_todos: AiToolsWriteTodosTool,
  search_case_materials: AiToolsMaterialSearchTool,
  search_case_analysis: AiToolsAnalysisSearchTool,
  search_law: AiToolsLawSearchTool,
  search_case_memory: AiToolsMemorySearchTool,
  write_case_memory: AiToolsMemoryWriteTool,
  update_case_memory: AiToolsMemoryUpdateTool,
  extract_case_info: AiToolsExtractInfoTool,
  upload_workspace_file: AiToolsUploadWorkspaceFileTool,
  read_skill_file: AiToolsReadSkillFileTool,
  write_skill_file: AiToolsWriteSkillFileTool,
  run_skill_script: AiToolsRunSkillScriptTool,
  save_analysis_result: AiToolsSaveAnalysisResultTool,
  // 合成卡片：由 saveAnalysisResult 工具的 ANALYSIS_SUMMARY 事件触发，非真实 LLM 工具
  [SYNTHETIC_TOOL_GENERATE_SUMMARY]: AiToolsGenerateSummaryTool,
}

interface Props {
  toolCall: ToolCallWithResult
  toolMap?: Record<string, Component>
}

const props = defineProps<Props>()

const emit = defineEmits<{
  (e: 'confirm', data: any): void
  (e: 'reject'): void
}>()

function isLegacySubAgentTool(name: string): boolean {
  // ask_*_expert（caseAnalysis 7 个分析子代理）
  return name.startsWith('ask_') && name.endsWith('_expert')
}

// 守卫：仅在有数据 / 正在跑 / 失败时显示 CoT，避免 cancelled tool 显示空白卡
const shouldShowSubAgentCoT = computed(() => {
  if (!SUB_AGENT_LIKE_TOOLS.has(props.toolCall.name)) return false
  return subAgentMessages(props.toolCall.id).length > 0
    || subAgentIsRunning(props.toolCall.id)
    || subAgentIsFailed(props.toolCall.id)
})

interface SubAgentAccess {
  subThreadsMap: Record<string, any>
}
const subAgentAccess = inject<SubAgentAccess | null>('subAgentAccess', null)

// messageStreamContext：interrupt 内联化用，由 panel 层 provide
interface MessageStreamContext {
  interruptData: { value: { type?: string; toolCallId?: string;[key: string]: unknown } | null | undefined }
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
 * 当前 toolCall 是否命中"活跃 interrupt"——
 *
 * 微妙的优先级：active 通常优先于 resolved（避免 agent 重试触发同 toolCallId
 * 的新 interrupt 时 UI 仍显示 stale 选择，例如用户要起诉状但卡片默认选中
 * 上次失败时选过的答辩状，commit a2c70077 已修）。
 *
 * 但用户**刚 resume** 后存在过渡态：stream.values.__interrupt__ 还没被新
 * SSE 帧覆盖，active 仍指向同一个 interrupt——此时切回 active 会让"使用此
 * 模板"按钮重新可点，用户以为没生效（线上 bug：点完模板卡片状态没变）。
 *
 * 用 LangGraph 顶层 `_interruptId` 区分两种场景：
 *   - active._interruptId === resolvedEntry 保存的 _interruptId → 同一个
 *     interrupt 的过渡态 → 走 resolved 视图（卡片显示"已选 X"）
 *   - id 不同（含任一为空）→ agent 重新触发的新 interrupt → 走 active
 */
const isActiveInterruptForThisCall = computed(() => {
  const active = messageStreamContext?.interruptData.value
  if (!active || active.toolCallId !== props.toolCall.id || !active.type
    || !globalInterruptRegistry.isToolCard(active.type)) {
    return false
  }
  const resolved = resolvedEntry.value
  if (resolved) {
    const resolvedId = (resolved.interrupt as { _interruptId?: unknown })?._interruptId
    const activeId = (active as { _interruptId?: unknown })?._interruptId
    if (resolvedId != null && activeId != null && resolvedId === activeId) {
      return false  // 同一个 interrupt 的 resume 过渡态，让 resolved 接管
    }
  }
  return true
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

const internalToolComponent = computed<Component>(() => INTERNAL_TOOL_MAP[props.toolCall.name] ?? AiToolsDefaultTool)
</script>

<template>
  <!-- SUB_AGENT_LIKE 工具的 CoT / 结果卡嵌在 interrupt 分支内部，避免 v-if 互斥 -->
  <template v-if="isInterruptToolCardCall">
    <InterruptDispatcher
      :interrupt="isActiveInterruptForThisCall
        ? (messageStreamContext?.interruptData.value ?? null)
        : (resolvedEntry?.interrupt ?? null)"
      :resume-value="isActiveInterruptForThisCall ? undefined : resolvedEntry?.resumeValue"
      @submit="(v) => messageStreamContext?.resolveInterrupt(v)"
      @cancel="() => messageStreamContext?.resolveInterrupt(null)"
    />
    <SubAgentChainOfThought
      v-if="shouldShowSubAgentCoT"
      :agent-title="toolDisplayName(toolCall.name)"
      :sub-messages="subAgentMessages(toolCall.id)"
      :is-running="subAgentIsRunning(toolCall.id)"
      :is-failed="subAgentIsFailed(toolCall.id)"
      :failure-reason="subAgentError(toolCall.id)"
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
  <template v-else-if="shouldShowSubAgentCoT">
    <SubAgentChainOfThought
      :agent-title="toolDisplayName(toolCall.name)"
      :sub-messages="subAgentMessages(toolCall.id)"
      :is-running="subAgentIsRunning(toolCall.id)"
      :is-failed="subAgentIsFailed(toolCall.id)"
      :failure-reason="subAgentError(toolCall.id)"
    />
    <component
      v-if="toolCall.state === 'output-available' && toolMap?.[toolCall.name]"
      :is="toolMap[toolCall.name]"
      :tool-name="toolCall.name"
      :input="toolCall.args"
      :output="toolCall.result"
      :state="toolCall.state"
      @confirm="emit('confirm', $event)"
      @reject="emit('reject')"
    />
  </template>
  <!-- SUB_AGENT_LIKE 工具结果卡（无 CoT 数据时直接渲染结果卡，如 cancelled 路径） -->
  <component
    v-else-if="SUB_AGENT_LIKE_TOOLS.has(toolCall.name) && toolCall.state === 'output-available' && toolMap?.[toolCall.name]"
    :is="toolMap[toolCall.name]"
    :tool-name="toolCall.name"
    :input="toolCall.args"
    :output="toolCall.result"
    :state="toolCall.state"
    @confirm="emit('confirm', $event)"
    @reject="emit('reject')"
  />
  <component
    v-else-if="!SUB_AGENT_LIKE_TOOLS.has(toolCall.name) && toolMap?.[toolCall.name]"
    :is="toolMap[toolCall.name]"
    :tool-name="toolCall.name"
    :input="toolCall.args"
    :output="toolCall.result"
    :state="toolCall.state"
    @confirm="emit('confirm', $event)"
    @reject="emit('reject')"
  />
  <!-- legacy ask_*_expert：caseAnalysis 7 个分析子代理，仍走老 CoT 路径 -->
  <SubAgentChainOfThought
    v-else-if="isLegacySubAgentTool(toolCall.name)"
    :agent-title="subAgentTitleFromName(toolCall.name)"
    :sub-messages="subAgentMessages(toolCall.id)"
    :is-running="subAgentIsRunning(toolCall.id)"
    :is-failed="subAgentIsFailed(toolCall.id)"
    :failure-reason="subAgentError(toolCall.id)"
  />
  <component
    v-else
    :is="internalToolComponent"
    :tool-name="toolCall.name"
    :input="toolCall.args"
    :output="toolCall.result"
    :state="toolCall.state"
    @confirm="emit('confirm', $event)"
    @reject="emit('reject')"
  />
</template>
