<script setup lang="ts">
import { computed, defineAsyncComponent, reactive, ref, watch } from 'vue'
import type { Component } from 'vue'
import type { BaseMessage } from '@langchain/core/messages'
import { useThrottleFn } from '@vueuse/core'
import { ChainOfThoughtStep } from '~/components/ai-elements/chain-of-thought'
import {
  Lightbulb,
  FileText,
  Wrench,
  CheckCircle2,
  Loader2,
  Sparkles,
  XCircle,
  ChevronDown,
} from 'lucide-vue-next'
import { mapMessagesToSteps } from './composables/mapMessagesToSteps'
import type { StepKind, StepVM } from './composables/mapMessagesToSteps'
import type { ExtendedToolState } from '~/components/ai-elements/types'

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

// 折叠状态：跑中/失败默认展开，跑完默认折叠节省空间，用户手动操作后以用户偏好为准。
// 用 computed 派生而不是 watch+ref，避免 mount 时机/v-model 同步错位导致流式跑中没展开。
const userToggled = ref<boolean | null>(null)
const isOpen = computed<boolean>({
  get: () => userToggled.value ?? (props.isRunning || props.isFailed),
  set: (v) => { userToggled.value = v },
})
// isRunning 翻 false 时（跑完）清除用户偏好，下次跑时重新跟随状态
watch(() => props.isRunning, (running, prev) => {
  if (prev && !running) userToggled.value = null
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

const wrapperClass = computed(() => {
  if (props.isFailed) return 'border-destructive/40 border-l-[3px] border-l-destructive bg-muted/30'
  if (props.isRunning) return 'border-border border-l-[3px] border-l-primary bg-muted/30 shadow-sm'
  return 'border-border/60 border-l-[3px] border-l-primary/60 bg-muted/30'
})

const statusText = computed(() => {
  if (props.isRunning) return '思考中…'
  if (props.isFailed) return `失败${props.failureReason ? `：${props.failureReason}` : ''}`
  if (props.durationSec) return `已完成 · ${props.durationSec}s`
  return '已完成'
})

const statusClass = computed(() => {
  if (props.isRunning) return 'text-primary font-medium'
  if (props.isFailed) return 'text-destructive font-medium'
  return 'text-muted-foreground'
})

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
    state: (step.toolResult !== undefined ? 'output-available' : 'input-available') as ExtendedToolState,
  }
}

</script>

<template>
  <div
    class="not-prose mt-2 max-w-prose rounded-md border"
    :class="wrapperClass"
  >
    <Collapsible v-model:open="isOpen">
      <CollapsibleTrigger
        class="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
      >
        <Sparkles class="size-4 shrink-0 text-primary" />
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm font-semibold text-foreground">
            {{ agentTitle }}
          </div>
          <div class="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px]">
            <span class="shrink-0 text-muted-foreground">专家调用</span>
            <span class="shrink-0 text-muted-foreground/40">·</span>
            <span class="inline-flex min-w-0 items-center gap-1" :class="statusClass">
              <Loader2 v-if="isRunning" class="size-3 shrink-0 animate-spin" />
              <CheckCircle2 v-else-if="!isFailed" class="size-3 shrink-0" />
              <XCircle v-else class="size-3 shrink-0" />
              <span class="truncate">{{ statusText }}</span>
            </span>
          </div>
        </div>
        <ChevronDown
          class="size-4 shrink-0 text-muted-foreground/60 transition-transform"
          :class="{ 'rotate-180': isOpen }"
        />
      </CollapsibleTrigger>

      <CollapsibleContent
        class="border-t border-border/60 bg-background/40"
      >
        <div class="space-y-3 px-4 py-3">
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

            <template v-if="step.kind === 'tool_call'">
              <template v-if="step.status === 'active'">
                <span class="text-muted-foreground text-xs">
                  <Loader2 class="inline size-3 animate-spin" />
                </span>
              </template>
              <AiToolRenderer v-else :tool-call="toolCallVMFromStep(step)" />
            </template>

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
        </div>
      </CollapsibleContent>
    </Collapsible>
  </div>
</template>
