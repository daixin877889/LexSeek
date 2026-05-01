<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { Component } from 'vue'
import type { BaseMessage } from '@langchain/core/messages'
import { useThrottleFn } from '@vueuse/core'
import {
  ChainOfThought,
  ChainOfThoughtHeader,
  ChainOfThoughtContent,
  ChainOfThoughtStep,
} from '~/components/ai-elements/chain-of-thought'
import { Lightbulb, FileText, Wrench, CheckCircle2, Loader2 } from 'lucide-vue-next'
import { mapMessagesToSteps } from './composables/mapMessagesToSteps'
import type { StepKind, StepVM } from './composables/mapMessagesToSteps'

interface Props {
  /** 子 Agent 显示名（NodeConfig.title 或 name），如"风险评估专家" */
  agentTitle: string
  /** 子 thread 的完整 messages（已过滤 injectedBy=SubAgentContext） */
  subMessages: Array<BaseMessage | any>
  /** 子 Agent 是否正在运行 */
  isRunning: boolean
  /** 子 Agent 失败标志 */
  isFailed?: boolean
  /** 失败原因，显示到 Header 红徽章 */
  failureReason?: string
  /** 运行时长（秒），结束后显示 */
  durationSec?: number
}

const props = withDefaults(defineProps<Props>(), {
  isFailed: false,
  failureReason: '',
  durationSec: 0,
})

// 折叠状态：初值跟随 isRunning（跑中默认展开实时看进度，跑完后默认折叠节省空间）。
// 用户后续可点击 header 自由切换。
const isOpen = ref<boolean>(props.isRunning || props.isFailed)
watch(() => props.isRunning, (running, prev) => {
  // 跑完瞬间（true → false）自动折叠 — 失败保持展开让用户看到错误
  if (prev && !running && !props.isFailed) {
    isOpen.value = false
  }
})

const steps = computed<StepVM[]>(() => mapMessagesToSteps(props.subMessages, props.isRunning))

// active step description throttle（避免高频流式更新导致 UI 抖动）
const activeStep = computed(() => steps.value.find(s => s.isActive) ?? null)
const activeRaw = computed(() => activeStep.value?.fullContent ?? '')
const throttledActiveDescription = ref('')
const updateThrottled = useThrottleFn(
  (text: string) => {
    // 固定 80 字摘要：active Step 折叠视图使用
    throttledActiveDescription.value = text.length > 80 ? text.slice(0, 80) + '...' : text
  },
  30,
  /* trailing */ true,
)
watch(activeRaw, (t) => updateThrottled(t), { immediate: true })

// active step 读 throttled 值，否则读静态 description
function displayDescription(step: StepVM): string {
  return step.isActive ? throttledActiveDescription.value : step.description
}

// 单个 step 的展开状态（thinking / analysis / conclusion 用）
// 流式输出中的 active step 默认展开（让用户看到正在写入的内容）；
// 输出完成（!isActive）后默认收起，仅显示摘要，点击展开后显示全文、隐藏摘要。
const expandedSteps = reactive<Record<string, boolean>>({})
function isStepExpanded(step: StepVM): boolean {
  return expandedSteps[step.key] ?? step.isActive
}
function toggleStepExpand(step: StepVM) {
  expandedSteps[step.key] = !isStepExpanded(step)
}

const iconMap: Record<StepKind, Component> = {
  thinking: Lightbulb,
  analysis: FileText,
  tool_call: Wrench,
  conclusion: CheckCircle2,
}

function iconFor(kind: StepKind): Component {
  return iconMap[kind]
}

/** Step 语义色 class（固定色系 + dark 变体） */
const stepColorClass: Record<StepKind, string> = {
  thinking: 'bg-violet-500/10 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  analysis: 'bg-blue-500/10 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  tool_call: 'bg-amber-500/10 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  conclusion: 'bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
}

function isCollapsibleTextStep(step: StepVM): boolean {
  return (step.kind === 'thinking' || step.kind === 'analysis' || step.kind === 'conclusion') && step.hasMore
}

/** tool_call step 是否可展开看 args + 完整 result（始终允许，用户点击查看详情） */
function isExpandableToolCall(step: StepVM): boolean {
  return step.kind === 'tool_call' && (step.toolArgs !== undefined || step.toolResult !== undefined)
}

/** JSON pretty 渲染（args / result 展开视图）；失败保留原值 */
function prettyJson(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

/** 工具结果一行摘要：提取最有价值的信息 */
function toolResultSummary(step: StepVM): string {
  const r = step.toolResult
  if (r === undefined) return ''
  // 搜索结果类：显示命中数量
  if (Array.isArray(r)) {
    if (r.length === 0) return '未找到相关结果'
    if (r.length > 0 && typeof r[0] === 'object' && r[0] !== null && ('title' in r[0] || 'text' in r[0])) {
      return `找到 ${r.length} 条结果`
    }
    return `返回 ${r.length} 项`
  }
  if (typeof r === 'object' && r !== null) {
    // { success: true, ... }
    if ('success' in r && r.success === false) return '执行失败'
    if ('error' in r && r.error) return `失败：${String(r.error).slice(0, 40)}`
    if ('summary' in r && typeof r.summary === 'string') return r.summary.slice(0, 60)
    if ('message' in r && typeof r.message === 'string') return r.message.slice(0, 60)
    if ('count' in r && typeof r.count === 'number') return `共 ${r.count} 条`
  }
  if (typeof r === 'string') return r.length > 60 ? r.slice(0, 60) + '...' : r
  return ''
}

</script>

<template>
  <ChainOfThought v-model="isOpen" class="my-2">
    <ChainOfThoughtHeader>
      <span class="font-semibold">{{ agentTitle }}</span>
      <Loader2 v-if="isRunning" class="ml-1 size-3 animate-spin shrink-0" />
      <span v-if="isRunning" class="text-xs">思考中…</span>
      <span v-else-if="isFailed" class="text-xs text-destructive">失败{{ failureReason ? `：${failureReason}` : '' }}</span>
      <span v-else-if="durationSec" class="text-xs">思考 {{ durationSec }}s</span>
      <span v-else class="text-xs">已完成</span>
    </ChainOfThoughtHeader>

    <ChainOfThoughtContent>
      <ChainOfThoughtStep
        v-for="step in steps"
        :key="step.key"
        :label="step.label"
        :description="''"
        :status="step.status"
        :class="step.isFailed ? 'text-destructive' : undefined"
      >
        <template #icon>
          <component
            :is="iconFor(step.kind)"
            class="size-3.5 rounded-full p-0.5"
            :class="stepColorClass[step.kind]"
          />
        </template>

        <!-- 工具步骤：可展开看完整 args + result -->
        <template v-if="step.kind === 'tool_call'">
          <!-- 跑中：仅 spinner -->
          <template v-if="step.status === 'active'">
            <span class="text-muted-foreground text-xs">
              <Loader2 class="inline size-3 animate-spin" />
            </span>
          </template>
          <!-- 跑完：可点击展开看详情 -->
          <template v-else-if="isExpandableToolCall(step)">
            <div
              v-if="!isStepExpanded(step)"
              class="text-muted-foreground text-xs cursor-pointer hover:text-foreground transition-colors"
              @click="toggleStepExpand(step)"
            >
              {{ toolResultSummary(step) || '点击展开查看' }}
            </div>
            <div
              v-else
              class="cursor-pointer space-y-2"
              @click="toggleStepExpand(step)"
            >
              <div v-if="step.toolArgs !== undefined">
                <div class="text-[11px] font-medium text-muted-foreground mb-1">参数</div>
                <pre class="text-[11px] bg-muted/40 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words">{{ prettyJson(step.toolArgs) }}</pre>
              </div>
              <div v-if="step.toolResult !== undefined">
                <div class="text-[11px] font-medium text-muted-foreground mb-1">结果</div>
                <pre class="text-[11px] bg-muted/40 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words">{{ prettyJson(step.toolResult) }}</pre>
              </div>
            </div>
          </template>
          <template v-else-if="toolResultSummary(step)">
            <span class="text-muted-foreground text-xs">{{ toolResultSummary(step) }}</span>
          </template>
        </template>

        <!-- 思考 / 分析 / 结论：内容长时支持点击展开/收起 -->
        <template v-else>
          <template v-if="isCollapsibleTextStep(step)">
            <div
              v-if="!isStepExpanded(step)"
              class="text-muted-foreground text-xs cursor-pointer hover:text-foreground transition-colors"
              @click="toggleStepExpand(step)"
            >
              {{ displayDescription(step) }}
            </div>
            <div
              v-else
              class="cursor-pointer"
              @click="toggleStepExpand(step)"
            >
              <MessageResponse :content="step.fullContent" mode="static" />
            </div>
          </template>
          <div v-else-if="displayDescription(step)" class="text-muted-foreground text-xs">
            {{ displayDescription(step) }}
          </div>
        </template>
      </ChainOfThoughtStep>
    </ChainOfThoughtContent>
  </ChainOfThought>
</template>
