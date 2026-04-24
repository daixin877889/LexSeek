<script setup lang="ts">
import { computed } from 'vue'
import type { Component } from 'vue'
import type { BaseMessage } from '@langchain/core/messages'
import {
  ChainOfThought,
  ChainOfThoughtHeader,
  ChainOfThoughtStep,
  ChainOfThoughtContent,
  ChainOfThoughtSearchResults,
  ChainOfThoughtSearchResult,
} from '~/components/ai-elements/chain-of-thought'
import { Brain, FileText, Wrench, CheckCircle2, Loader2 } from 'lucide-vue-next'
import { mapMessagesToSteps } from './composables/mapMessagesToSteps'
import type { StepKind, StepVM } from './composables/mapMessagesToSteps'
import AiToolRenderer from './AiToolRenderer.vue'

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

// 临时用 defineModel：Task 4 会把这行替换为 ref + watch + defineEmits 的完整 auto-collapse 逻辑
const isOpen = defineModel<boolean>('open', { default: false })

const steps = computed<StepVM[]>(() => mapMessagesToSteps(props.subMessages, props.isRunning))

const iconMap: Record<StepKind, Component> = {
  thinking: Brain,
  analysis: FileText,
  tool_call: Wrench,
  conclusion: CheckCircle2,
}

function iconFor(kind: StepKind): Component {
  return iconMap[kind]
}

/** 结构识别：不维护工具白名单 */
function looksLikeSearchResult(r: unknown): r is Array<{ title?: string; text?: string; id?: string }> {
  return Array.isArray(r)
    && r.length > 0
    && typeof r[0] === 'object'
    && r[0] !== null
    && ('title' in r[0] || 'text' in r[0])
}

/** 非 search 结构的 tool_result 走 AiToolRenderer，构造 ToolCallWithResult 形状 */
function toToolPart(step: StepVM) {
  return {
    toolCall: {
      id: step.toolCallId ?? '',
      name: step.toolName ?? '',
      args: step.toolArgs ?? {},
      result: step.toolResult,
      state: step.toolResult !== undefined ? 'output-available' : 'input-available',
    },
  }
}

/** Step 语义色 class（固定色系 + dark 变体） */
const stepColorClass: Record<StepKind, string> = {
  thinking: 'bg-violet-500/10 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  analysis: 'bg-blue-500/10 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  tool_call: 'bg-amber-500/10 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  conclusion: 'bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
}
</script>

<template>
  <ChainOfThought v-model="isOpen" class="my-2">
    <ChainOfThoughtHeader>
      <span class="font-semibold">{{ agentTitle }}</span>
      <Loader2 v-if="isRunning" class="ml-2 size-3 animate-spin text-muted-foreground" />
      <span v-if="isRunning" class="ml-1 text-xs text-muted-foreground">思考中…</span>
      <span v-else-if="isFailed" class="ml-2 text-xs text-destructive">失败{{ failureReason ? `：${failureReason}` : '' }}</span>
      <span v-else-if="durationSec" class="ml-2 text-xs text-muted-foreground">思考 {{ durationSec }}s</span>
    </ChainOfThoughtHeader>

    <ChainOfThoughtStep
      v-for="step in steps"
      :key="step.key"
      :label="step.label"
      :description="step.description"
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

      <ChainOfThoughtContent v-if="step.kind === 'tool_call'">
        <ChainOfThoughtSearchResults v-if="looksLikeSearchResult(step.toolResult)">
          <ChainOfThoughtSearchResult
            v-for="(hit, i) in step.toolResult"
            :key="hit.id ?? hit.title ?? i"
          >
            {{ hit.title || hit.text }}
          </ChainOfThoughtSearchResult>
        </ChainOfThoughtSearchResults>
        <AiToolRenderer v-else-if="step.toolResult !== undefined" v-bind="toToolPart(step)" />
      </ChainOfThoughtContent>

      <ChainOfThoughtContent
        v-else-if="step.hasMore && (step.kind === 'conclusion' || step.kind === 'thinking' || step.kind === 'analysis')"
      >
        <AiElementsMessageResponse :content="step.fullContent" mode="static" />
      </ChainOfThoughtContent>
    </ChainOfThoughtStep>
  </ChainOfThought>
</template>
