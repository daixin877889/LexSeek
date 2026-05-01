<script setup lang="ts">
import { computed, defineAsyncComponent, reactive, ref, watch } from 'vue'
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

// 异步加载避免 AiToolRenderer ↔ SubAgentChainOfThought 循环引用
const AiToolRenderer = defineAsyncComponent(() => import('./AiToolRenderer.vue'))

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
  // false → true：开始跑时主动展开（场景：tool_call 出现时 bucket 还没建，
  // 首个 SSE 事件到达后 status='running'，用户应立即看到流式内容）
  if (!prev && running) {
    isOpen.value = true
  }
  // true → false：跑完瞬间自动折叠节省空间——失败保持展开让用户看到错误
  else if (prev && !running && !props.isFailed) {
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

/** 把 tool_call step 转成 AiToolRenderer 接受的 ToolCallWithResult 形态 */
function toolCallVMFromStep(step: StepVM) {
  return {
    id: step.toolCallId ?? step.key,
    name: step.toolName ?? '',
    args: step.toolArgs ?? {},
    result: step.toolResult,
    state: step.toolResult !== undefined ? 'output-available' : 'input-available',
  }
}

</script>

<template>
  <ChainOfThought v-model="isOpen" class="my-2">
    <ChainOfThoughtHeader>
      <span class="flex flex-1 items-baseline gap-3 text-left">
        <span class="text-foreground font-semibold">{{ agentTitle }}</span>
        <span class="inline-flex items-center gap-1 text-xs text-muted-foreground/80">
          <Loader2 v-if="isRunning" class="size-3 animate-spin" />
          <span v-if="isRunning">思考中…</span>
          <span v-else-if="isFailed" class="text-destructive">失败{{ failureReason ? `：${failureReason}` : '' }}</span>
          <span v-else-if="durationSec">思考 {{ durationSec }}s</span>
          <span v-else>已完成</span>
        </span>
      </span>
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
          <!-- 跑完：直接渲染工具卡片（工具卡自带展开/收起，无需再外包一层 toggle） -->
          <AiToolRenderer v-else :tool-call="toolCallVMFromStep(step)" />
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
