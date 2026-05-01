<script setup lang="ts">
import { computed, inject } from 'vue'
import type { Component } from 'vue'
import { SYNTHETIC_TOOL_GENERATE_SUMMARY } from '#shared/types/agentEvent'
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

// 新加：SUB_AGENT_LIKE 工具集（用 CoT + 结果卡共存渲染）
const SUB_AGENT_LIKE_TOOLS = new Set(['draft_document', 'review_contract'])

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

function isSubAgentTool(name: string): boolean {
  return isLegacySubAgentTool(name) || SUB_AGENT_LIKE_TOOLS.has(name)
}

function subAgentTitleFromName(name: string): string {
  if (isLegacySubAgentTool(name)) {
    return name.replace(/^ask_/, '').replace(/_expert$/, '').replace(/_/g, ' ')
  }
  if (name === 'draft_document') return '文书生成'
  if (name === 'review_contract') return '合同审查'
  return name
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
</script>

<template>
  <!-- interrupt 工具卡（active 或 resolved）：先于 CoT 渲染。
       时序：用户选模板 (interrupt) → agent 开始跑 (CoT) → 结果卡。
       SUB_AGENT_LIKE 工具的 CoT / 结果卡都嵌在 interrupt 分支内部，避免 v-if 互斥。 -->
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
      :agent-title="subAgentTitleFromName(toolCall.name)"
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
  <!-- 无 interrupt 的 SUB_AGENT_LIKE 工具：CoT + 结果卡（跑完时） -->
  <template v-else-if="shouldShowSubAgentCoT">
    <SubAgentChainOfThought
      :agent-title="subAgentTitleFromName(toolCall.name)"
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
  <!-- 普通用户自定义工具（非 SUB_AGENT_LIKE）：走原 toolMap 路由，不限 state -->
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
  <!-- 子 Agent 工具（legacy ask_*_expert）：用 Chain of Thought 展示内部思考过程 -->
  <SubAgentChainOfThought
    v-else-if="isLegacySubAgentTool(toolCall.name)"
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
  <AiToolsAnalysisSearchTool v-else-if="toolCall.name === 'search_case_analysis'" :tool-name="toolCall.name" :input="toolCall.args" :output="toolCall.result" :state="toolCall.state" />
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
