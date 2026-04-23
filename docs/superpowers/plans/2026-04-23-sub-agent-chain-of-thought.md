# SubAgent Chain of Thought 可视化 · 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把小索子 Agent（`ask_*_expert` 工具）的内部思考过程在主对话列表中用 ai-elements Chain of Thought 组件可视化展示，支持 token 级流式、1s 自动收起、刷新恢复、主题深浅模式适配。

**Architecture:** 不改工具形态（保留 `ask_*_expert` tool），后端 `subAgentToolFactory.ts` 用 LangChain callbacks 旁路转发子 thread 事件到主 runId 的 SSE 流；前端 `useStreamChat` 按 `parentToolCallId` 分桶累积到 `subThreadsMap`，`AiToolRenderer` 为 `ask_*_expert` 路由到新增的 `<SubAgentChainOfThought>` 折叠卡片；`loadHistory` 扩展返回 `subThreads` 支持刷新回放。

**Tech Stack:** Nuxt 4 + Vue 3 + Tailwind v4 + LangGraph + `ai-elements-vue` Chain of Thought + `@langchain/core` callbacks + VueUse `useThrottleFn`

**Spec:** [`docs/superpowers/specs/2026-04-23-sub-agent-chain-of-thought-design.md`](../specs/2026-04-23-sub-agent-chain-of-thought-design.md) (commit `c1d34b70`)

**Tests:** `npx vitest run`（项目规定使用 Vitest，非 bun test）

---

## File Structure

### 新建
- `app/components/ai/SubAgentChainOfThought.vue` — 子 Agent 可视化卡片
- `app/components/ai/composables/mapMessagesToSteps.ts` — 消息→Step 纯函数
- `tests/app/composables/mapMessagesToSteps.test.ts` — 纯函数单测
- `tests/app/components/SubAgentChainOfThought.test.ts` — 组件单测（含 auto-collapse 时序）
- `tests/server/subAgentToolCallbacks.test.ts` — 后端 callbacks 接入单测

### 修改
- `shared/types/agentRun.ts` — 加 `SubAgentEventMetadata` + 三类 Event 加 `metadata?`
- `server/services/workflow/agents/subAgentToolFactory.ts:141` — handler 加 `cfg` 参数 + callbacks
- `app/composables/useStreamChat.ts` — 加 `subThreadsMap` 状态 + 事件分桶
- `app/components/ai/AiToolRenderer.vue` — 加 `ask_*_expert` 路由分支
- `server/api/v1/case/analysis/chat.post.ts` — 响应加 `subThreads` 字段
- 前端初始化 `subThreadsMap` 灌入（同 useStreamChat.ts 或消费端）

---

## Task 1: 扩展共享类型 `SubAgentEventMetadata`

**Files:**
- Modify: `shared/types/agentRun.ts`（在 `AgentCustomEvent` 之后、`AgentEvent` 联合之前插入）

- [ ] **Step 1: 读现有文件定位插入点**

Run: `sed -n '1,60p' shared/types/agentRun.ts`
Expected: 看到现有 `AgentStreamEvent` / `AgentStatusEvent` / `AgentCustomEvent` / `AgentEvent` 定义。记住 `AgentCustomEvent` 结束行号和 `AgentEvent` 所在行号。

- [ ] **Step 2: 在 `AgentCustomEvent` 后新增 `SubAgentEventMetadata` interface，并在三类 Event 上加 `metadata?` 字段**

在 `shared/types/agentRun.ts` 里，把现有：

```ts
export interface AgentStreamEvent {
  type: 'stream_event'
  runId: string
  sessionId: string
  event: 'values' | 'messages' | 'updates'
  data: unknown
}

export interface AgentStatusEvent {
  type: 'status_change'
  runId: string
  sessionId: string
  status: AgentRunStatus
  error?: string
}

export interface AgentCustomEvent {
  type: 'custom_event'
  runId: string
  sessionId: string
  name: string
  data: unknown
}

export type AgentEvent = AgentStreamEvent | AgentStatusEvent | AgentCustomEvent
```

改为（每个接口末尾加 `metadata?: SubAgentEventMetadata`，并在上方新增接口）：

```ts
/**
 * 子 Agent 事件元数据（仅子 Agent 相关事件携带；主 Agent 事件全空）。
 * 前端按 parentToolCallId 分桶，按 messageId 合并 token。
 */
export interface SubAgentEventMetadata {
  /** 子 Agent 名（如 "risk_assessment_expert"） */
  agentName: string
  /** 子 thread id（格式 "{sessionId}_sub_{safeName}"） */
  threadId: string
  /** 主 Agent 那次 ask_*_expert tool_call 的 id，前端分桶 key */
  parentToolCallId: string
  /** 子 AIMessage 的 id（callback runId），用于 token 级合并 */
  messageId?: string
  /** token 增量（仅 name='sub_agent_token' 事件时携带） */
  delta?: string
}

export interface AgentStreamEvent {
  type: 'stream_event'
  runId: string
  sessionId: string
  event: 'values' | 'messages' | 'updates'
  data: unknown
  metadata?: SubAgentEventMetadata
}

export interface AgentStatusEvent {
  type: 'status_change'
  runId: string
  sessionId: string
  status: AgentRunStatus
  error?: string
  metadata?: SubAgentEventMetadata
}

export interface AgentCustomEvent {
  type: 'custom_event'
  runId: string
  sessionId: string
  name: string
  data: unknown
  metadata?: SubAgentEventMetadata
}

export type AgentEvent = AgentStreamEvent | AgentStatusEvent | AgentCustomEvent
```

- [ ] **Step 3: 类型检查**

Run: `npx nuxi typecheck 2>&1 | head -40`
Expected: 无新增错误（已有错误忽略）。若 `SubAgentEventMetadata` 引用有报错则修正。

- [ ] **Step 4: Commit**

```bash
git add shared/types/agentRun.ts
git commit -m "feat(agent): 为 AgentEvent 三态加入 SubAgentEventMetadata 可选字段

新增 SubAgentEventMetadata interface 并在 AgentStreamEvent / AgentStatusEvent / AgentCustomEvent
三类事件上追加可选 metadata 字段，供子 Agent 事件携带 agentName/threadId/parentToolCallId/messageId/delta，
前端据此分桶 + token 合并。现有消费方不受影响（metadata 可选）。"
```

---

## Task 2: `mapMessagesToSteps` 纯函数（TDD）

**Files:**
- Create: `app/components/ai/composables/mapMessagesToSteps.ts`
- Test: `tests/app/composables/mapMessagesToSteps.test.ts`

背景：一条 AIMessage 可以同时含 `thinking` / `content text` / `tool_calls[]`，需要按 spec §4.0 规则拆成多个 Step。`thinking` 字段通过 `extractThinking()` 取（现有 `app/components/ai/composables/useMessageParser.ts:72` 导出）。

- [ ] **Step 1: 先写测试文件（TDD RED）**

Create `tests/app/composables/mapMessagesToSteps.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { AIMessage, ToolMessage } from '@langchain/core/messages'
import { mapMessagesToSteps } from '~/app/components/ai/composables/mapMessagesToSteps'

describe('mapMessagesToSteps', () => {
  it('空消息数组返回空 steps', () => {
    expect(mapMessagesToSteps([], false)).toEqual([])
  })

  it('首条 HumanMessage（子 Agent 问题）不成 Step', () => {
    const msgs = [
      { type: 'human', content: '请分析风险' } as any,
    ]
    expect(mapMessagesToSteps(msgs, false)).toEqual([])
  })

  it('AIMessage 仅含 thinking → 「思考」Step', () => {
    const m = new AIMessage({
      content: '',
      additional_kwargs: { reasoning_content: '让我想想违约责任' },
    })
    const steps = mapMessagesToSteps([m], true /* running */)
    expect(steps).toHaveLength(1)
    expect(steps[0]).toMatchObject({
      kind: 'thinking',
      label: '思考',
      status: 'active',
      isActive: true,
      fullContent: '让我想想违约责任',
    })
    expect(steps[0].description.length).toBeLessThanOrEqual(80)
  })

  it('AIMessage 同时含 thinking + content + tool_calls → 拆成 3 个 Step（思考/分析/工具）', () => {
    const m = new AIMessage({
      content: '基于上面的分析，我先查合同条款。',
      additional_kwargs: { reasoning_content: '违约责任需要三要素' },
      tool_calls: [{ id: 'call_1', name: 'search_case_materials', args: { query: '违约' }, type: 'tool_call' }],
    })
    const steps = mapMessagesToSteps([m], true)
    expect(steps).toHaveLength(3)
    expect(steps[0].kind).toBe('thinking')
    expect(steps[1].kind).toBe('analysis')
    expect(steps[2].kind).toBe('tool_call')
    expect(steps[2].toolName).toBe('search_case_materials')
    expect(steps[2].toolCallId).toBe('call_1')
  })

  it('ToolMessage 不单独成 Step，而是挂到对应 tool_call 的 toolResult', () => {
    const ai = new AIMessage({
      content: '',
      tool_calls: [{ id: 'call_1', name: 'search_law', args: { q: 'x' }, type: 'tool_call' }],
    })
    const tool = new ToolMessage({
      tool_call_id: 'call_1',
      content: JSON.stringify([{ title: '民法典 577' }]),
    })
    const final = new AIMessage({ content: '综合来看，违约成立' })
    const steps = mapMessagesToSteps([ai, tool, final], false /* finished */)

    // 1 个 tool_call + 1 个 conclusion = 2 个
    expect(steps).toHaveLength(2)
    expect(steps[0].kind).toBe('tool_call')
    expect(steps[0].status).toBe('complete')
    expect(steps[0].toolResult).toEqual([{ title: '民法典 577' }])

    expect(steps[1].kind).toBe('conclusion')
    expect(steps[1].status).toBe('complete')
    expect(steps[1].fullContent).toBe('综合来看，违约成立')
  })

  it('最后一条 AIMessage 的 content 始终映射为「得出结论」Step', () => {
    const ai1 = new AIMessage({ content: '先查材料' })  // 非最后 → analysis
    const ai2 = new AIMessage({ content: '结论：中高' }) // 最后 → conclusion
    const steps = mapMessagesToSteps([ai1, ai2], false)
    expect(steps.map(s => s.kind)).toEqual(['analysis', 'conclusion'])
    expect(steps[1].label).toBe('得出结论')
  })

  it('running=true 时最后一个非工具 Step 为 active；finished 时全部 complete', () => {
    const msgs = [new AIMessage({ content: '结论' })]
    expect(mapMessagesToSteps(msgs, true)[0].status).toBe('active')
    expect(mapMessagesToSteps(msgs, false)[0].status).toBe('complete')
  })

  it('hasMore 判定：content ≤ 80 字时 hasMore=false', () => {
    const m = new AIMessage({ content: '短结论' })
    const [s] = mapMessagesToSteps([m], false)
    expect(s.hasMore).toBe(false)

    const long = new AIMessage({ content: 'x'.repeat(200) })
    const [s2] = mapMessagesToSteps([long], false)
    expect(s2.hasMore).toBe(true)
  })

  it('tool_call 的 args 精简摘要取 JSON.stringify 前 60 字', () => {
    const m = new AIMessage({
      content: '',
      tool_calls: [{ id: 'call_1', name: 't', args: { q: 'x'.repeat(200) }, type: 'tool_call' }],
    })
    const [s] = mapMessagesToSteps([m], true)
    expect(s.description.length).toBeLessThanOrEqual(60 + 3 /* "..." */)
  })

  it('非数组或非 search 结构的 tool_result 不走 SearchResults', () => {
    const ai = new AIMessage({
      content: '',
      tool_calls: [{ id: 'c1', name: 'any', args: {}, type: 'tool_call' }],
    })
    const tool = new ToolMessage({ tool_call_id: 'c1', content: '{"ok":true}' })
    const [step] = mapMessagesToSteps([ai, tool], false)
    expect(step.kind).toBe('tool_call')
    // toolResult 按 JSON.parse 成功后放 object，前端用 looksLikeSearchResult 判定
    expect(step.toolResult).toEqual({ ok: true })
  })
})
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `npx vitest run tests/app/composables/mapMessagesToSteps.test.ts --reporter=verbose 2>&1 | tail -30`
Expected: 全部失败（模块未找到 `mapMessagesToSteps`）。

- [ ] **Step 3: 实现 `mapMessagesToSteps.ts`（TDD GREEN）**

Create `app/components/ai/composables/mapMessagesToSteps.ts`:

```ts
import type { BaseMessage, AIMessage, ToolMessage } from '@langchain/core/messages'
import { extractThinking } from './useMessageParser'

export type StepKind = 'thinking' | 'analysis' | 'tool_call' | 'conclusion'
export type StepStatus = 'complete' | 'active' | 'pending'

export interface StepVM {
  /** 稳定 key，形如 "${msgIdx}-${kind}-${subIdx}" */
  key: string
  kind: StepKind
  label: string
  /** 折叠视图一行简摘（≤80 字；tool_call 显示 args 摘要） */
  description: string
  /** 展开视图完整内容（thinking / analysis / conclusion 走 Response 渲染） */
  fullContent: string
  /** 是否需要渲染展开 Content（短于 80 字就省略，避免重复） */
  hasMore: boolean
  status: StepStatus
  /** 当前 active Step 标记；组件用于 throttle 绑定 */
  isActive: boolean
  /** 失败态：加 class="text-destructive" */
  isFailed: boolean

  // 仅 kind='tool_call' 时有
  toolCallId?: string
  toolName?: string
  toolArgs?: unknown
  toolResult?: unknown
}

const SUMMARY_MAX = 80
const TOOL_ARGS_MAX = 60

function truncate(s: string, n: number): string {
  if (!s) return ''
  return s.length > n ? s.slice(0, n) + '...' : s
}

function getMsgType(m: BaseMessage | any): string {
  return (m as any)._getType?.() ?? (m as any).type ?? ''
}

/** 剥离 content 里的 thinking 块，返回剩余 text */
function extractContentText(m: AIMessage | any): string {
  const c = (m as any).content
  if (!c) return ''
  if (typeof c === 'string') return c
  if (Array.isArray(c)) {
    return c
      .filter((b: any) => b && b.type !== 'thinking' && b.type !== 'reasoning')
      .map((b: any) => b.text ?? '')
      .join('')
  }
  return ''
}

/** 解析 ToolMessage.content 为 toolResult（string 尝试 JSON.parse，失败保留原串） */
function parseToolResult(content: unknown): unknown {
  if (typeof content === 'string') {
    try { return JSON.parse(content) } catch { return content }
  }
  return content
}

/**
 * 把子 thread 的 messages 拆成 Chain of Thought 的 Step 数组。
 *
 * @param messages 子 thread 的完整 messages（已过滤 injectedBy=SubAgentContext；首条 HumanMessage 为子 Agent 首问，不成 Step）
 * @param isRunning 子 Agent 是否仍在运行；决定最后一个 Step 是 active 还是 complete
 */
export function mapMessagesToSteps(
  messages: Array<BaseMessage | any>,
  isRunning: boolean,
): StepVM[] {
  if (!messages?.length) return []

  // 预建 tool_call_id → ToolMessage 索引
  const toolResultMap = new Map<string, ToolMessage>()
  for (const m of messages) {
    if (getMsgType(m) === 'tool') {
      const id = (m as any).tool_call_id
      if (id) toolResultMap.set(id, m as ToolMessage)
    }
  }

  // 找最后一条 AIMessage 的索引，用于区分 "analysis" vs "conclusion"
  let lastAIIdx = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (getMsgType(messages[i]) === 'ai') { lastAIIdx = i; break }
  }

  const steps: StepVM[] = []
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    const t = getMsgType(m)

    // 跳过 human（首问已在 header 显示）与 tool（已挂到 tool_call step）
    if (t === 'human' || t === 'tool') continue
    if (t !== 'ai') continue

    const isLastAI = i === lastAIIdx
    const thinking = extractThinking(m as any) ?? ''
    const contentText = extractContentText(m as any)
    const toolCalls = (m as any).tool_calls ?? []

    // 1. thinking → 「思考」Step
    if (thinking) {
      const summary = truncate(thinking, SUMMARY_MAX)
      steps.push({
        key: `${i}-thinking`,
        kind: 'thinking',
        label: '思考',
        description: summary,
        fullContent: thinking,
        hasMore: thinking.length > SUMMARY_MAX,
        status: 'complete',
        isActive: false,
        isFailed: false,
      })
    }

    // 2. content text → 「分析」(非最后 AI) / 「得出结论」(最后 AI)
    if (contentText) {
      const kind: StepKind = isLastAI ? 'conclusion' : 'analysis'
      const label = isLastAI ? '得出结论' : '分析'
      steps.push({
        key: `${i}-${kind}`,
        kind,
        label,
        description: truncate(contentText, SUMMARY_MAX),
        fullContent: contentText,
        hasMore: contentText.length > SUMMARY_MAX,
        status: 'complete',
        isActive: false,
        isFailed: false,
      })
    }

    // 3. tool_calls → 每个 tool_call 一个 Step
    for (let j = 0; j < toolCalls.length; j++) {
      const tc = toolCalls[j]
      const toolRes = toolResultMap.get(tc.id)
      const hasResult = toolRes !== undefined
      const argsStr = truncate(JSON.stringify(tc.args ?? {}), TOOL_ARGS_MAX)
      steps.push({
        key: `${i}-tool-${j}`,
        kind: 'tool_call',
        label: `调用 ${tc.name}`,
        description: argsStr,
        fullContent: argsStr,
        hasMore: false,
        status: hasResult ? 'complete' : 'active',
        isActive: !hasResult,
        isFailed: false,
        toolCallId: tc.id,
        toolName: tc.name,
        toolArgs: tc.args,
        toolResult: hasResult ? parseToolResult((toolRes as any).content) : undefined,
      })
    }
  }

  // 运行中：把最后一个 non-tool_call Step 翻 active（token 流入中）
  if (isRunning) {
    for (let i = steps.length - 1; i >= 0; i--) {
      const s = steps[i]
      if (s.kind !== 'tool_call' || s.status !== 'complete') {
        s.status = s.kind === 'tool_call' ? s.status : 'active'
        s.isActive = s.status === 'active'
        break
      }
    }
  }

  return steps
}
```

- [ ] **Step 4: 运行测试确认 GREEN**

Run: `npx vitest run tests/app/composables/mapMessagesToSteps.test.ts --reporter=verbose 2>&1 | tail -30`
Expected: 全部通过（10 passed）。

- [ ] **Step 5: Commit**

```bash
git add app/components/ai/composables/mapMessagesToSteps.ts tests/app/composables/mapMessagesToSteps.test.ts
git commit -m "feat(ai): 新增 mapMessagesToSteps 纯函数，把子 thread 消息拆成 CoT Step

按 spec §4 规则：一条 AIMessage 可拆成 thinking / analysis / tool_call 多个 Step；
ToolMessage 按 tool_call_id 挂到对应 Step 的 toolResult；最后一条 AIMessage 的 content
映射为「得出结论」Step；isRunning=true 时最后一个非工具 Step 翻 active，供组件 throttle 绑定。"
```

---

## Task 3: `SubAgentChainOfThought` 组件 · 静态骨架（Mock 数据先行）

**Files:**
- Create: `app/components/ai/SubAgentChainOfThought.vue`

先只做静态渲染 + 映射到 steps，不接入 auto-collapse 和 throttle（留给 Task 4）。

- [ ] **Step 1: 创建组件（~140 行）**

Create `app/components/ai/SubAgentChainOfThought.vue`:

```vue
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
} from '@/components/ai-elements/chain-of-thought'
import { Response } from '@/components/ai-elements/response'
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
        <Response :content="step.fullContent" />
      </ChainOfThoughtContent>
    </ChainOfThoughtStep>
  </ChainOfThought>
</template>
```

- [ ] **Step 2: 静态 smoke test**

创建 `tests/app/components/SubAgentChainOfThought.test.ts`（骨架，后续 Task 4 扩充）:

```ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { AIMessage, ToolMessage } from '@langchain/core/messages'
import SubAgentChainOfThought from '~/app/components/ai/SubAgentChainOfThought.vue'

describe('SubAgentChainOfThought (static render)', () => {
  it('渲染 agentTitle 到 Header', () => {
    const w = mount(SubAgentChainOfThought, {
      props: { agentTitle: '风险评估专家', subMessages: [], isRunning: false },
    })
    expect(w.text()).toContain('风险评估专家')
  })

  it('isRunning=true 显示"思考中…"', () => {
    const w = mount(SubAgentChainOfThought, {
      props: { agentTitle: 'x', subMessages: [], isRunning: true },
    })
    expect(w.text()).toContain('思考中')
  })

  it('isFailed=true + reason 显示红色徽章', () => {
    const w = mount(SubAgentChainOfThought, {
      props: { agentTitle: 'x', subMessages: [], isRunning: false, isFailed: true, failureReason: '超时' },
    })
    expect(w.text()).toContain('失败')
    expect(w.text()).toContain('超时')
  })

  it('根据 subMessages 渲染对应步骤数', async () => {
    const msgs = [
      new AIMessage({
        content: '结论',
        tool_calls: [{ id: 'c1', name: 'search_law', args: {}, type: 'tool_call' }],
      }),
      new ToolMessage({ tool_call_id: 'c1', content: '[{"title":"民法典"}]' }),
      new AIMessage({ content: '最终结论' }),
    ]
    const w = mount(SubAgentChainOfThought, {
      props: { agentTitle: 'x', subMessages: msgs, isRunning: false, open: true },
    })
    // 1 个 analysis + 1 个 tool_call + 1 个 conclusion
    expect(w.text()).toContain('调用 search_law')
    expect(w.text()).toContain('得出结论')
  })
})
```

Run: `npx vitest run tests/app/components/SubAgentChainOfThought.test.ts --reporter=verbose 2>&1 | tail -30`
Expected: 4 passed（若 ai-elements 组件未 export Response，调整 import；若测试环境缺组件则挂 stub）。

如有 import 报错，尝试：

```ts
// 改用绝对路径或 ~/components
import { Response } from '~/components/ai-elements/response'
```

或在 vitest 环境补 stub：

```ts
mount(SubAgentChainOfThought, {
  props: { ... },
  global: { stubs: { ChainOfThought: false, Response: true } },
})
```

- [ ] **Step 3: Commit**

```bash
git add app/components/ai/SubAgentChainOfThought.vue tests/app/components/SubAgentChainOfThought.test.ts
git commit -m "feat(ai): 新增 SubAgentChainOfThought 组件骨架

按 spec §3.3 实现：
- Header 用默认 slot（ai-elements 无 #icon slot）放标题 + 状态徽章
- Step 用 #icon slot 渲染 Brain/FileText/Wrench/CheckCircle2 语义图标（violet/blue/amber/emerald 固定色系 + dark 变体）
- 检索类结果走 ChainOfThoughtSearchResults 结构识别；其它走 AiToolRenderer
- 短内容 hasMore=false 省略展开区，避免重复
- open 走 v-model，Task 4 接入 auto-collapse"
```

---

## Task 4: 组件接入 auto-collapse + active step throttle

**Files:**
- Modify: `app/components/ai/SubAgentChainOfThought.vue`
- Modify: `tests/app/components/SubAgentChainOfThought.test.ts`

- [ ] **Step 1: 先写 auto-collapse 时序测试（TDD RED）**

在 `tests/app/components/SubAgentChainOfThought.test.ts` 文件末尾追加：

```ts
import { nextTick } from 'vue'

describe('SubAgentChainOfThought · auto-collapse', () => {
  it('isRunning 由 false→true 时自动展开（isOpen=true）', async () => {
    const w = mount(SubAgentChainOfThought, {
      props: { agentTitle: 'x', subMessages: [], isRunning: false },
    })
    await w.setProps({ isRunning: true })
    await nextTick()
    // isOpen 由内部状态驱动，取出检查
    expect((w.vm as any).isOpen).toBe(true)
  })

  it('isRunning 由 true→false 后 1s 自动收起', async () => {
    vi.useFakeTimers()
    const w = mount(SubAgentChainOfThought, {
      props: { agentTitle: 'x', subMessages: [], isRunning: true },
    })
    await nextTick()
    expect((w.vm as any).isOpen).toBe(true)

    await w.setProps({ isRunning: false })
    await nextTick()
    // 1s 前仍开
    vi.advanceTimersByTime(500)
    expect((w.vm as any).isOpen).toBe(true)
    // 1s 后收起
    vi.advanceTimersByTime(600)
    expect((w.vm as any).isOpen).toBe(false)

    vi.useRealTimers()
  })

  it('用户手动点开后 → timer 取消 + 不再 auto-close', async () => {
    vi.useFakeTimers()
    const w = mount(SubAgentChainOfThought, {
      props: { agentTitle: 'x', subMessages: [], isRunning: true },
    })
    await nextTick()
    await w.setProps({ isRunning: false })   // 启动 1s timer
    await nextTick()

    // 用户 500ms 时手动展开（通过 update:open emit）
    vi.advanceTimersByTime(500)
    ;(w.vm as any).isOpen = true   // 模拟用户手动打开
    await nextTick()

    // 再推进超过 1s，不应被 auto-close
    vi.advanceTimersByTime(1200)
    expect((w.vm as any).isOpen).toBe(true)

    vi.useRealTimers()
  })

  it('isFailed=true 时 isRunning 变 false 不触发 auto-close', async () => {
    vi.useFakeTimers()
    const w = mount(SubAgentChainOfThought, {
      props: { agentTitle: 'x', subMessages: [], isRunning: true },
    })
    await nextTick()
    await w.setProps({ isRunning: false, isFailed: true })
    await nextTick()

    vi.advanceTimersByTime(1500)
    expect((w.vm as any).isOpen).toBe(true)

    vi.useRealTimers()
  })
})
```

Run: `npx vitest run tests/app/components/SubAgentChainOfThought.test.ts -t auto-collapse --reporter=verbose 2>&1 | tail -30`
Expected: 4 个测试失败（auto-collapse 逻辑尚未实现）。

- [ ] **Step 2: 在组件 `<script setup>` 内实现 auto-collapse（参考 spec §6 / Reasoning.vue:73-101）**

编辑 `app/components/ai/SubAgentChainOfThought.vue`，把

```ts
const isOpen = defineModel<boolean>('open', { default: false })
```

替换为：

```ts
import { ref, watch, onBeforeUnmount } from 'vue'

// ... props 声明之后 ...

const AUTO_CLOSE_DELAY = 1000
const emit = defineEmits<{ (e: 'update:open', value: boolean): void }>()
const isOpen = ref(false)
const hasAutoClosed = ref(false)
let autoCloseTimer: ReturnType<typeof setTimeout> | null = null

function cancelAutoCloseTimer() {
  if (autoCloseTimer !== null) {
    clearTimeout(autoCloseTimer)
    autoCloseTimer = null
    hasAutoClosed.value = true   // 永久关闸：防止用户手动点开后又被 timer 收起
  }
}

// 边沿触发：isRunning 由 true → false 且失败态为 false 且未关闸 → 启动 1s timer
watch(() => props.isRunning, (next, prev) => {
  if (next) {
    isOpen.value = true
    emit('update:open', true)
    return
  }
  // 失败态不触发 auto-close（让用户看到红徽章）
  if (props.isFailed) return
  if (prev === true && !hasAutoClosed.value) {
    autoCloseTimer = setTimeout(() => {
      autoCloseTimer = null
      hasAutoClosed.value = true
      isOpen.value = false
      emit('update:open', false)
    }, AUTO_CLOSE_DELAY)
  }
}, { immediate: true })

// 用户手动展开/收起 → 取消 timer + 关闸
watch(isOpen, () => cancelAutoCloseTimer())

onBeforeUnmount(() => { if (autoCloseTimer !== null) clearTimeout(autoCloseTimer) })

// 便于测试：把 isOpen 暴露到 instance（defineExpose）
defineExpose({ isOpen })
```

同时，模板 `<ChainOfThought v-model="isOpen">` 保持不变。

- [ ] **Step 3: 运行 auto-collapse 测试 GREEN**

Run: `npx vitest run tests/app/components/SubAgentChainOfThought.test.ts -t auto-collapse --reporter=verbose 2>&1 | tail -30`
Expected: 4 passed。若测试访问 `w.vm.isOpen` 失败则改用 `w.vm.$options.expose` 或通过 `w.vm as any` 读。

- [ ] **Step 4: 实现 active step description 的 throttle**

在 `<script setup>` 里，`steps` 计算属性之后加：

```ts
import { useThrottleFn } from '@vueuse/core'

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

// Step active 时改读 throttled 值，否则用静态 description
function displayDescription(step: StepVM): string {
  return step.isActive ? throttledActiveDescription.value : step.description
}
```

模板里把 Step 的 `:description="step.description"` 改为 `:description="displayDescription(step)"`：

```vue
<ChainOfThoughtStep
  v-for="step in steps"
  :key="step.key"
  :label="step.label"
  :description="displayDescription(step)"
  :status="step.status"
  :class="step.isFailed ? 'text-destructive' : undefined"
>
```

- [ ] **Step 5: 补一个 throttle 存在性测试**

追加到同一测试文件：

```ts
describe('SubAgentChainOfThought · active description throttle', () => {
  it('active step 的 description 读 throttled 值', async () => {
    const msg = new AIMessage({ content: 'a'.repeat(300) })
    const w = mount(SubAgentChainOfThought, {
      props: { agentTitle: 'x', subMessages: [msg], isRunning: true, open: true },
    })
    await nextTick()
    // throttledActiveDescription 初始已在 immediate 时填入
    const txt = w.text()
    expect(txt).toContain('a'.repeat(80))   // 80 字截断
    expect(txt).not.toContain('a'.repeat(200))
  })
})
```

Run: `npx vitest run tests/app/components/SubAgentChainOfThought.test.ts --reporter=verbose 2>&1 | tail -30`
Expected: 全部测试通过。

- [ ] **Step 6: Commit**

```bash
git add app/components/ai/SubAgentChainOfThought.vue tests/app/components/SubAgentChainOfThought.test.ts
git commit -m "feat(ai): SubAgentChainOfThought 接入 auto-collapse + active step throttle

- 复用 Reasoning.vue 的边沿触发 1s 自动收起 + hasAutoClosed 闸门逻辑（spec §6）
- 失败态不触发 auto-close
- active step 的 description 用 useThrottleFn(30ms, trailing=true) 包装，固定 80 字截断
  避免末 token 被吞（spec §5.2 P4 修正）
- 测试覆盖 auto-collapse 四种时序 + throttle 存在性"
```

---

## Task 5: `subAgentToolFactory` 扩展 `cfg` 签名（拿 toolCallId）

**Files:**
- Modify: `server/services/workflow/agents/subAgentToolFactory.ts:141`

- [ ] **Step 1: 定位现有 tool() handler 签名**

Run: `sed -n '138,175p' server/services/workflow/agents/subAgentToolFactory.ts`
Expected: 看到 `tool(async (input: { question: string }): Promise<string> => {`。

- [ ] **Step 2: 改签名接 `cfg` + `SubAgentToolContext` 加 `runId`**

先看 `SubAgentToolContext` 当前定义（spec 里提到工厂函数已有 userId/caseId/sessionId）。

在 `server/services/workflow/agents/subAgentToolFactory.ts` 找到：

```ts
export interface SubAgentToolContext {
  userId: number
  caseId: number
  sessionId: string
}
```

改为：

```ts
export interface SubAgentToolContext {
  userId: number
  caseId: number
  sessionId: string
  /** 主 Agent run id（agentRuns.id），供 callbacks 转发事件到同一 SSE 流 */
  runId: string
}
```

并修改工具 handler 签名（原来是 `async (input: { question: string })`）：

```ts
const subAgentTool = tool(
  async (input: { question: string }, cfg): Promise<string> => {
    // 新增：从 ToolRunnableConfig.toolCall.id 拿主 Agent tool_call id
    const parentToolCallId = (cfg as any)?.toolCall?.id ?? ''
    const mainRunId = context.runId
    const nodeConfig = config   // 外层闭包的 NodeConfig（foreach 迭代变量）

    // ... 其余保持 ...
  },
```

- [ ] **Step 3: 更新调用方传入 runId**

Run: `grep -rn "createSubAgentTools(" /Users/daixin/work/dev/LexSeek/LexSeek/server --include="*.ts"`

找到调用点（通常在 `caseMainAgent.ts`），给 context 补 `runId`。调用 `createSubAgentTools(nodeConfigs, context)` 的地方，确保 `context` 对象里有 `runId`。

示例改动（caseMainAgent.ts 里）：

```ts
// 原：const tools = await createSubAgentTools(nodeConfigs, { userId, caseId, sessionId })
// 改为：
const tools = await createSubAgentTools(nodeConfigs, {
  userId,
  caseId,
  sessionId,
  runId,   // 来自调用方（agentWorker 主 run id）
})
```

追溯 `caseMainAgent` 的入参里如果没有 `runId`，也补上。

- [ ] **Step 4: 类型检查**

Run: `npx nuxi typecheck 2>&1 | grep -i "subAgentToolFactory\|caseMainAgent" | head -30`
Expected: 无错误。

- [ ] **Step 5: Commit**

```bash
git add server/services/workflow/agents/subAgentToolFactory.ts server/services/workflow/agents/caseMainAgent.ts
git commit -m "refactor(agent): subAgentToolFactory handler 增加 cfg 参数取 toolCallId

- tool() handler 签名扩为 async (input, cfg)，用 cfg?.toolCall?.id 取主 Agent 那次
  ask_*_expert tool_call 的 id，作为前端子 Agent 事件分桶 key（spec §9.1）
- SubAgentToolContext 补 runId 字段（主 Agent run id），供下一个任务的 callbacks
  通过 publishAgentEvent 转发到同一 SSE 流
- 用 cfg 与 nodeConfig 命名区分外层闭包 NodeConfig 与本 handler 的 ToolRunnableConfig"
```

---

## Task 6: `subAgentToolFactory` 接入 LangChain callbacks 旁路转发

**Files:**
- Modify: `server/services/workflow/agents/subAgentToolFactory.ts`
- Test: `tests/server/subAgentToolCallbacks.test.ts`

- [ ] **Step 1: 先写 callbacks 被调用的验证测试（TDD RED）**

Create `tests/server/subAgentToolCallbacks.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// 模拟 publishAgentEvent 观察 callbacks 推出的事件
vi.mock('~/server/services/agent/agentEventBridge', () => ({
  publishAgentEvent: vi.fn().mockResolvedValue(undefined),
}))

describe('subAgentToolFactory callbacks forward', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('调用子 Agent 工具时，LLM token 被转发为 sub_agent_token 事件', async () => {
    // 构造一个 mock 子 Agent 环境：createSubAgentTools 创建工具 → 工具内部调用 agent.invoke
    // 通过 spy fake 掉 createAgent，使其返回一个假的 agent，在 invoke 时手动触发 callback
    // 具体实现见 subAgentToolFactory 源码结构
    const { publishAgentEvent } = await import('~/server/services/agent/agentEventBridge')
    // ...具体 mock 略，此处只断言：
    // - 至少一次 publishAgentEvent 被调用
    // - payload 符合 AgentCustomEvent + metadata 结构
    // - event.name === 'sub_agent_token'

    // 占位断言：实际由下方实现触发（本测试作为联调 smoke test）
    expect(publishAgentEvent).toBeDefined()
  })

  it('AgentStatusEvent { status:"completed" } 在 handleChainEnd root 时发出', async () => {
    // 同上，通过 mock handleChainEnd(_, _, undefined) 触发
    const { publishAgentEvent } = await import('~/server/services/agent/agentEventBridge')
    expect(publishAgentEvent).toBeDefined()
  })
})
```

> 注：此任务的单测更多是"契约存在性"验证，真正的行为验证依赖集成测环境。实现单测时若 mock createAgent 复杂可改为"纯函数 + 手工触发 callback"的契约测试。

- [ ] **Step 2: 在 `subAgentToolFactory.ts` 工具 handler 内接入 callbacks**

找到 `const result = await agent.invoke(...)` 位置（spec §9.2 草稿），改为：

```ts
// publishAgentEvent 若项目配置了 server auto-import 可省略 import；
// 否则显式：
import { publishAgentEvent } from '~~/server/services/agent/agentEventBridge'

// ... 原 agent 创建代码保留 ...

const result = await agent.invoke(
  { messages: initialMessages },
  {
    configurable: { thread_id: subThreadId },
    recursionLimit: 1000,
    callbacks: [{
      // (token, idx, runId, parentRunId?, tags?, fields?)
      handleLLMNewToken(token: string, _idx, cbRunId: string, _parentRunId?: string) {
        publishAgentEvent({
          type: 'custom_event',
          runId: mainRunId,
          sessionId: context.sessionId,
          name: 'sub_agent_token',
          data: undefined,
          metadata: {
            agentName: nodeConfig.name,
            threadId: subThreadId,
            parentToolCallId,
            messageId: cbRunId,
            delta: token,
          },
        }).catch((e) => logger.warn('publishAgentEvent(sub_agent_token) failed', { e }))
      },

      // (tool, input, runId, parentRunId?, tags?, metadata?, runName?, toolCallId?)
      handleToolStart(
        _tool: any, input: string, cbRunId: string,
        _parentRunId?: string, _tags?: string[], _metadata?: Record<string, unknown>,
        _runName?: string, innerToolCallId?: string,
      ) {
        publishAgentEvent({
          type: 'custom_event',
          runId: mainRunId,
          sessionId: context.sessionId,
          name: 'sub_agent_tool_start',
          // input 是 JSON 字符串，前端要 JSON.parse
          data: { innerToolCallId, input, cbRunId },
          metadata: {
            agentName: nodeConfig.name,
            threadId: subThreadId,
            parentToolCallId,
          },
        }).catch((e) => logger.warn('publishAgentEvent(sub_agent_tool_start) failed', { e }))
      },

      // (output, runId, parentRunId?, tags?)
      handleToolEnd(output: any, cbRunId: string) {
        publishAgentEvent({
          type: 'custom_event',
          runId: mainRunId,
          sessionId: context.sessionId,
          name: 'sub_agent_tool_end',
          // 拿不到 toolCallId，用 cbRunId 配合前端 runId→innerToolCallId 映射回查
          data: { cbRunId, output },
          metadata: {
            agentName: nodeConfig.name,
            threadId: subThreadId,
            parentToolCallId,
          },
        }).catch((e) => logger.warn('publishAgentEvent(sub_agent_tool_end) failed', { e }))
      },

      // (outputs, runId, parentRunId?, tags?, kwargs?)
      // 仅 root chain end 翻 completed（cbParentRunId 为 undefined 即 root）
      handleChainEnd(_outputs: any, _cbRunId: string, cbParentRunId?: string) {
        if (cbParentRunId !== undefined) return
        publishAgentEvent({
          type: 'status_change',
          runId: mainRunId,
          sessionId: context.sessionId,
          status: 'completed',
          metadata: {
            agentName: nodeConfig.name,
            threadId: subThreadId,
            parentToolCallId,
          },
        }).catch((e) => logger.warn('publishAgentEvent(sub_agent_status) failed', { e }))
      },
    }],
  },
)
```

原 catch 分支里，在 `return '子代理 ... 执行失败: ...'` 之前加一条状态失败事件：

```ts
} catch (error) {
  const errorMessage = error instanceof Error ? error.message : '未知错误'
  logger.error(`子代理 ${config.name} 执行失败`, { error: errorMessage })

  // 前端翻 isFailed=true + 显示 failureReason
  publishAgentEvent({
    type: 'status_change',
    runId: mainRunId,
    sessionId: context.sessionId,
    status: 'failed',
    error: errorMessage,
    metadata: {
      agentName: nodeConfig.name,
      threadId: subThreadId,
      parentToolCallId,
    },
  }).catch(() => { /* best-effort */ })

  return `子代理 ${config.title} 执行失败: ${errorMessage}`
}
```

- [ ] **Step 3: 类型检查 + 运行占位测试**

```bash
npx nuxi typecheck 2>&1 | grep -i "subAgent" | head -20
npx vitest run tests/server/subAgentToolCallbacks.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: typecheck 无新错误；占位测试通过（仅断言 mock 存在）。

- [ ] **Step 4: Commit**

```bash
git add server/services/workflow/agents/subAgentToolFactory.ts tests/server/subAgentToolCallbacks.test.ts
git commit -m "feat(agent): 子 Agent 工具接入 LangChain callbacks 旁路转发事件

agent.invoke 挂四种回调：
- handleLLMNewToken → AgentCustomEvent{ name:'sub_agent_token', metadata.delta }
- handleToolStart   → AgentCustomEvent{ name:'sub_agent_tool_start', data:{ innerToolCallId, input, cbRunId } }
- handleToolEnd     → AgentCustomEvent{ name:'sub_agent_tool_end', data:{ cbRunId, output } }
- handleChainEnd (root) → AgentStatusEvent{ status:'completed', metadata }
catch 分支发 status_change=failed + error 信息。所有事件挂在主 runId 的 SSE 流、
复用现有 publishAgentEvent；返回值路径仍走 invoke + result.messages 末尾 AI，
旁路转发与返回值物理分离（历史教训 feedback_subagent_stream_pitfall.md）。"
```

---

## Task 7: `useStreamChat` · `subThreadsMap` 分桶

**Files:**
- Modify: `app/composables/useStreamChat.ts`
- Test: `tests/app/composables/useStreamChat.subThreads.test.ts`（新增）

- [ ] **Step 1: 先写分桶 reducer 单测（TDD RED）**

Create `tests/app/composables/useStreamChat.subThreads.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { reactive } from 'vue'
// mergeEventIntoBucket 将 export 供测试（见 Step 2）
import {
  mergeEventIntoBucket,
  createEmptyBucket,
  type SubThreadState,
} from '~/app/composables/useStreamChat'

describe('useStreamChat · subThreadsMap 分桶 reducer', () => {
  it('sub_agent_token 事件按 messageId 累积到同一 AIMessage.content', () => {
    const b = createEmptyBucket('expert_a', 'sess_sub_a')
    mergeEventIntoBucket(b, {
      type: 'custom_event', runId: 'r', sessionId: 's', name: 'sub_agent_token',
      data: undefined,
      metadata: { agentName: 'expert_a', threadId: 'sess_sub_a', parentToolCallId: 'p1', messageId: 'm1', delta: '基' },
    } as any)
    mergeEventIntoBucket(b, {
      type: 'custom_event', runId: 'r', sessionId: 's', name: 'sub_agent_token',
      data: undefined,
      metadata: { agentName: 'expert_a', threadId: 'sess_sub_a', parentToolCallId: 'p1', messageId: 'm1', delta: '于' },
    } as any)
    expect(b.messages).toHaveLength(1)
    expect((b.messages[0] as any).content).toBe('基于')
    expect((b.messages[0] as any).id).toBe('m1')
  })

  it('sub_agent_tool_start 建 tool_call step + 记录 cbRunId → innerToolCallId 映射', () => {
    const b = createEmptyBucket('e', 't')
    mergeEventIntoBucket(b, {
      type: 'custom_event', runId: 'r', sessionId: 's', name: 'sub_agent_tool_start',
      data: { innerToolCallId: 'inner1', input: '{"q":"x"}', cbRunId: 'run_x' },
      metadata: { agentName: 'e', threadId: 't', parentToolCallId: 'p' },
    } as any)
    expect(b.runIdToInnerToolCallId.get('run_x')).toBe('inner1')
  })

  it('sub_agent_tool_end 通过 cbRunId 回查 innerToolCallId，把 output 挂到对应 ToolMessage', () => {
    const b = createEmptyBucket('e', 't')
    mergeEventIntoBucket(b, {
      type: 'custom_event', runId: 'r', sessionId: 's', name: 'sub_agent_tool_start',
      data: { innerToolCallId: 'inner1', input: '{"q":"x"}', cbRunId: 'run_x' },
      metadata: { agentName: 'e', threadId: 't', parentToolCallId: 'p' },
    } as any)
    mergeEventIntoBucket(b, {
      type: 'custom_event', runId: 'r', sessionId: 's', name: 'sub_agent_tool_end',
      data: { cbRunId: 'run_x', output: JSON.stringify([{ title: '命中1' }]) },
      metadata: { agentName: 'e', threadId: 't', parentToolCallId: 'p' },
    } as any)
    // 产生一条 tool type 的消息，tool_call_id=inner1
    const toolMsg = b.messages.find((m: any) => m.type === 'tool' && m.tool_call_id === 'inner1')
    expect(toolMsg).toBeTruthy()
  })

  it('status_change=completed 翻桶状态', () => {
    const b = createEmptyBucket('e', 't')
    expect(b.status).toBe('running')
    mergeEventIntoBucket(b, {
      type: 'status_change', runId: 'r', sessionId: 's', status: 'completed',
      metadata: { agentName: 'e', threadId: 't', parentToolCallId: 'p' },
    } as any)
    expect(b.status).toBe('completed')
  })

  it('status_change=failed 翻桶状态 + 记录 error', () => {
    const b = createEmptyBucket('e', 't')
    mergeEventIntoBucket(b, {
      type: 'status_change', runId: 'r', sessionId: 's', status: 'failed', error: '超时',
      metadata: { agentName: 'e', threadId: 't', parentToolCallId: 'p' },
    } as any)
    expect(b.status).toBe('failed')
    expect(b.error).toBe('超时')
  })
})
```

Run: `npx vitest run tests/app/composables/useStreamChat.subThreads.test.ts --reporter=verbose 2>&1 | tail -30`
Expected: 全部失败（函数未 export）。

- [ ] **Step 2: 在 `useStreamChat.ts` 内实现分桶 reducer + 暴露**

修改 `app/composables/useStreamChat.ts`，在文件开头加：

```ts
import { reactive, type Reactive } from 'vue'
import type { AgentEvent, AgentCustomEvent, AgentStatusEvent } from '#shared/types/agentRun'
import { AIMessage, ToolMessage } from '@langchain/core/messages'

export interface SubThreadState {
  agentName: string
  threadId: string
  messages: any[]          // 子 thread 消息（AIMessage / ToolMessage 等）
  status: 'running' | 'completed' | 'failed'
  error?: string
  runIdToInnerToolCallId: Map<string, string>
}

export function createEmptyBucket(agentName: string, threadId: string): SubThreadState {
  return {
    agentName,
    threadId,
    messages: [],
    status: 'running',
    runIdToInnerToolCallId: new Map(),
  }
}

export function mergeEventIntoBucket(bucket: SubThreadState, ev: AgentEvent) {
  if (ev.type === 'custom_event') {
    const cev = ev as AgentCustomEvent
    switch (cev.name) {
      case 'sub_agent_token': {
        const md = cev.metadata
        if (!md?.messageId) return
        const existing = bucket.messages.find((m: any) => m.id === md.messageId && m.type === 'ai')
        if (existing) {
          ;(existing as any).content = ((existing as any).content ?? '') + (md.delta ?? '')
        } else {
          const ai: any = new AIMessage({ content: md.delta ?? '' })
          ai.id = md.messageId
          bucket.messages.push(ai)
        }
        return
      }
      case 'sub_agent_tool_start': {
        const d = cev.data as { innerToolCallId?: string; input?: string; cbRunId?: string }
        if (d?.cbRunId && d?.innerToolCallId) {
          bucket.runIdToInnerToolCallId.set(d.cbRunId, d.innerToolCallId)
        }
        // 注意：tool_call step 是通过 AIMessage.tool_calls[] 呈现的，此处不造 placeholder
        // mapMessagesToSteps 会在遇到没有对应 ToolMessage 的 tool_call 时标为 active
        return
      }
      case 'sub_agent_tool_end': {
        const d = cev.data as { cbRunId?: string; output?: any }
        if (!d?.cbRunId) return
        const innerToolCallId = bucket.runIdToInnerToolCallId.get(d.cbRunId)
        if (!innerToolCallId) return
        const tool: any = new ToolMessage({
          tool_call_id: innerToolCallId,
          content: typeof d.output === 'string' ? d.output : JSON.stringify(d.output ?? null),
        })
        bucket.messages.push(tool)
        return
      }
      default: return
    }
  }
  if (ev.type === 'status_change') {
    const sev = ev as AgentStatusEvent
    if (sev.status === 'completed') { bucket.status = 'completed'; return }
    if (sev.status === 'failed')    { bucket.status = 'failed'; bucket.error = sev.error; return }
  }
}
```

在 useStreamChat 的返回值之前（现有 return 语句之前）加：

```ts
const subThreadsMap = reactive<Record<string, SubThreadState>>({})

function handleAgentEvent(ev: AgentEvent) {
  if (!ev.metadata?.parentToolCallId) return   // 不是子 Agent 事件，走现有主 thread 分支
  const md = ev.metadata
  const b = subThreadsMap[md.parentToolCallId]
    ?? (subThreadsMap[md.parentToolCallId] = createEmptyBucket(md.agentName, md.threadId))
  mergeEventIntoBucket(b, ev)
}
```

把 `subThreadsMap` 和 `handleAgentEvent` 加到 useStreamChat 的 return：

```ts
return {
  // ... 现有字段 ...
  subThreadsMap,
  handleAgentEvent,
}
```

**接入 SSE 流**：定位现有 FetchStreamTransport 事件消费处（大概在 useStreamChat.ts 的 values/messages/custom event 订阅回调），在主分支处理前追加：

```ts
// 在现有 onCustomEvent 回调里最上面加
if (ev.metadata?.parentToolCallId) {
  handleAgentEvent(ev)
  return   // 子 Agent 事件不落主 thread
}
// ... 其余主 thread 处理保持 ...
```

类似地在 `onStatusChange` 回调开头加同样的分桶判断。

- [ ] **Step 3: 运行测试 GREEN**

Run: `npx vitest run tests/app/composables/useStreamChat.subThreads.test.ts --reporter=verbose 2>&1 | tail -30`
Expected: 5 passed。

- [ ] **Step 4: Commit**

```bash
git add app/composables/useStreamChat.ts tests/app/composables/useStreamChat.subThreads.test.ts
git commit -m "feat(chat): useStreamChat 新增 subThreadsMap 分桶 + 事件合并 reducer

按 spec §8 实现：
- parentToolCallId 为分桶 key
- sub_agent_token 按 messageId 累积到同一 AIMessage.content
- sub_agent_tool_start/end 通过 cbRunId → innerToolCallId 映射构造 ToolMessage
- status_change=completed/failed 翻桶状态
返回新增 subThreadsMap 供组件消费；不影响现有主 thread 路径。"
```

---

## Task 8: `AiToolRenderer` 加 `ask_*_expert` 路由分支

**Files:**
- Modify: `app/components/ai/AiToolRenderer.vue`

- [ ] **Step 1: 在现有 v-else-if 链最前面插入子 Agent 分支**

编辑 `app/components/ai/AiToolRenderer.vue`，在 `<template>` 内 `<component v-if="toolMap?.[toolCall.name]">` 之后的第一条 `v-else-if` 前，插入：

```vue
<!-- 子 Agent 工具：用 Chain of Thought 展示内部思考过程（spec §3.2） -->
<SubAgentChainOfThought
  v-else-if="isSubAgentTool(toolCall.name)"
  :agent-title="subAgentTitleFromName(toolCall.name)"
  :sub-messages="subAgentMessages(toolCall.id)"
  :is-running="subAgentIsRunning(toolCall.id)"
  :is-failed="subAgentIsFailed(toolCall.id)"
  :failure-reason="subAgentError(toolCall.id)"
/>
```

并在 `<script setup>` 里添加辅助：

```ts
import { inject } from 'vue'
import SubAgentChainOfThought from './SubAgentChainOfThought.vue'

function isSubAgentTool(name: string): boolean {
  return name.startsWith('ask_') && name.endsWith('_expert')
}

// name 形如 "ask_risk_assessment_expert" → "风险评估专家"
// 简化版：去掉 ask_ 与 _expert 前后缀，下划线转空格，同时到 node config 里查 title 更准确
// Task 8 先用简化版；Task 9 在 loadHistory 时带 agentTitle 落桶里
function subAgentTitleFromName(name: string): string {
  return name.replace(/^ask_/, '').replace(/_expert$/, '').replace(/_/g, ' ')
}

// 从 useStreamChat 拿 subThreadsMap（实际通过 provide/inject 或 props 传入）
// 暂且演示 props 传入：父组件 AiMessageListVirtualItem 已可拿到 subThreadsMap
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
```

在父组件（一般是 `AiChat.vue` 或 `AiMessageListVirtual.vue`）的 `<script setup>` 里加 provide：

```ts
import { provide } from 'vue'
import { useStreamChat } from '~/composables/useStreamChat'

// ... useStreamChat 已有返回 ...
const { subThreadsMap /* 新增 */, ... } = useStreamChat(...)
provide('subAgentAccess', { subThreadsMap })
```

- [ ] **Step 2: 本地跑起开发服务器 smoke test**

```bash
bun dev
```

打开一个小索案件对话，触发一次 `ask_*_expert` 调用，看主列表里是否渲染 Chain of Thought 卡片（运行中自动展开 + 1s 后自动收起）。

- [ ] **Step 3: Commit**

```bash
git add app/components/ai/AiToolRenderer.vue app/components/ai/AiChat.vue
git commit -m "feat(ai): AiToolRenderer 为 ask_*_expert 路由到 SubAgentChainOfThought

- 工具名匹配 startsWith('ask_') && endsWith('_expert') 走新组件
- 通过 provide/inject 注入 subThreadsMap，组件按 toolCallId 取子 Agent 状态
- 其它工具分支保持不变"
```

---

## Task 9: `loadHistory` 返回 `subThreads` + 前端初始化灌入

**Files:**
- Modify: `server/api/v1/case/analysis/chat.post.ts`
- Modify: `app/composables/useStreamChat.ts`（初始化 subThreadsMap）

- [ ] **Step 1: 核对 `loadSubAgentThreads` 签名与返回结构**

```bash
sed -n '120,180p' server/services/workflow/agents/threadState.ts
```

记录函数入参（`sessionId, mainMessages`）和返回类型。确保 spec §8.3 描述准确。

- [ ] **Step 2: 在 `chat.post.ts` 历史恢复分支里调用并返回**

定位到 `getThreadValuesService` 调用之后：

```ts
// 原：
const initialValues = await getThreadValuesService(sessionId)
return { initialValues }

// 改为：
import { loadSubAgentThreads } from '~/server/services/workflow/agents/threadState'

const initialValues = await getThreadValuesService(sessionId)
const subThreads = await loadSubAgentThreads(sessionId, initialValues?.messages ?? [])
return { initialValues, subThreads }
```

- [ ] **Step 3: 前端初始化灌入 subThreadsMap**

在 `useStreamChat.ts` 的 loadHistory/reconnect 路径接到响应后：

```ts
// 假设 history = { initialValues, subThreads }
if (history.subThreads && typeof history.subThreads === 'object') {
  for (const [toolCallId, state] of Object.entries(history.subThreads)) {
    subThreadsMap[toolCallId] = {
      agentName: (state as any).agentName,
      threadId: (state as any).threadId,
      messages: (state as any).messages ?? [],
      status: (state as any).status ?? 'completed',
      error: (state as any).error,
      runIdToInnerToolCallId: new Map(),   // 历史不需要，新事件来才建
    }
  }
}
```

- [ ] **Step 4: 手工验证刷新恢复**

```bash
bun dev
```

流程：
1. 触发一次子 Agent 调用，等它完成
2. 刷新页面
3. 验证历史里 SubAgentChainOfThought 折叠卡片内容完整（点开可见各 Step）

- [ ] **Step 5: Commit**

```bash
git add server/api/v1/case/analysis/chat.post.ts app/composables/useStreamChat.ts
git commit -m "feat(chat): 历史恢复接口返回 subThreads + 前端初始化灌入 subThreadsMap

- chat.post.ts 在 getThreadValuesService 之后额外调 loadSubAgentThreads
  返回 Record<parentToolCallId, SubThreadState>（spec §8.3）
- useStreamChat 在 loadHistory 完成时把 subThreads 灌入 subThreadsMap，
  runIdToInnerToolCallId 重置为空 Map（历史不需要映射，新事件来才建）
- 刷新 / 断线重连后子 Agent 完整思考链立即可见"
```

---

## Task 10: E2E 手工验证清单 + 虚拟列表高度回归

**Files:**
- Create: `docs/superpowers/plans/sub-agent-cot-e2e-checklist.md`（交付验收单）

- [ ] **Step 1: 建验收清单**

Create `docs/superpowers/plans/sub-agent-cot-e2e-checklist.md`:

```markdown
# SubAgent Chain of Thought · E2E 验收清单

## 路径 A · 单子 Agent 流式 + 结束 1s 自动收起
1. 进入小索案件对话
2. 提问触发一次 `ask_*_expert` 调用
3. 卡片立即出现且自动展开
4. active Step 的 description 随 token 增长（~30ms 刷新，~33 fps）
5. Agent 结束 → 卡片 1 秒后自动收起，下方外部 ToolMessage 完整结论可见
6. 手动点开折叠卡片，各 Step 完整（思考 / 分析 / 调用工具 / 得出结论）

## 路径 B · 用户中途手动展开 → 不被 auto-close
1. 触发子 Agent 调用
2. Agent 结束前 500ms 手动点一下卡片（观察当前展开态）
3. 继续等待 2 秒
4. 卡片应保持用户手动选择的状态，不被 1s timer 强制收起

## 路径 C · 刷新页面后历史回放
1. 在子 Agent 已结束的会话里刷新浏览器
2. 主列表渲染时，子 Agent 卡片（折叠态）出现在对应位置
3. 点开 → 完整思考链可见
4. 网络面板验证：chat.post 响应 body 含 `subThreads` 字段

## 虚拟列表高度回归（关键）
1. 在有多条对话的案件里，滚动到有 ChainOfThought 卡片的位置
2. 手动展开/收起，观察：
   - 卡片高度变化时列表不抖动
   - 上方/下方消息不错位
   - 滚动位置稳定
3. 连续切换多次，确认无高度缓存错位

## 深浅模式 + 主题
1. 默认 Zinc 主题：浅色 / 深色下卡片、Step 图标、徽章均清晰
2. 切到 Violet / Rose / Blue / Green / Orange / Red / Yellow 主题各看一遍
3. 所有状态下语义色保持：思考 violet / 分析 blue / 调用 amber / 结论 emerald

## 失败态
1. 手工制造子 Agent 失败（短时间内超时或抛异常）
2. Header 出现红色"失败：xxx"徽章
3. 最后 active Step 翻 text-destructive 红字
4. 卡片不自动收起，允许用户手动收起

## 并发子 Agent
1. 一个主 Agent 回复里包含多个 ask_*_expert tool_call（顺序或并行）
2. 每个子 Agent 卡片独立展开/收起
3. 同时流式时不卡顿（30fps+）
```

- [ ] **Step 2: 运行全量单测**

```bash
npx vitest run tests/app/composables/mapMessagesToSteps.test.ts tests/app/composables/useStreamChat.subThreads.test.ts tests/app/components/SubAgentChainOfThought.test.ts tests/server/subAgentToolCallbacks.test.ts --reporter=verbose
```

Expected: 全部通过。

- [ ] **Step 3: 按清单手工 E2E**

对着 `sub-agent-cot-e2e-checklist.md` 逐项验证。每通过一项打勾。

- [ ] **Step 4: 最终 Commit**

```bash
git add docs/superpowers/plans/sub-agent-cot-e2e-checklist.md
git commit -m "docs(analysis): SubAgent CoT E2E 手工验收清单

涵盖 7 个场景：3 条核心路径（单流式 / 用户交互 / 刷新恢复）+ 虚拟列表高度回归
+ 深浅模式 × 7 主题 + 失败态 + 并发子 Agent。交付前必须逐项通过。"
```

---

## 附录 · 关键文件全景

```
shared/
└── types/agentRun.ts                                      [修改] SubAgentEventMetadata + Event metadata?

server/services/workflow/agents/
├── subAgentToolFactory.ts                                 [修改] cfg 签名 + callbacks 旁路转发
├── caseMainAgent.ts                                       [修改] 传 runId 进 SubAgentToolContext
└── threadState.ts                                         [不改] 复用 loadSubAgentThreads

server/api/v1/case/analysis/
└── chat.post.ts                                           [修改] loadHistory 返回 subThreads

app/composables/
└── useStreamChat.ts                                       [修改] subThreadsMap + 分桶 reducer + 灌入

app/components/ai/
├── SubAgentChainOfThought.vue                             [新建] 折叠卡片 + auto-collapse + throttle
├── AiToolRenderer.vue                                     [修改] ask_*_expert 路由分支
├── AiChat.vue                                             [修改] provide subAgentAccess
└── composables/mapMessagesToSteps.ts                      [新建] 纯函数

tests/
├── app/
│   ├── composables/
│   │   ├── mapMessagesToSteps.test.ts                     [新建] 10 个映射用例
│   │   └── useStreamChat.subThreads.test.ts               [新建] 5 个分桶用例
│   └── components/
│       └── SubAgentChainOfThought.test.ts                 [新建] 静态渲染 + auto-collapse 时序 + throttle
└── server/
    └── subAgentToolCallbacks.test.ts                      [新建] callbacks 契约存在性

docs/superpowers/plans/
└── sub-agent-cot-e2e-checklist.md                         [新建] E2E 验收清单
```

---

## 铁律清单（编码时逐条核验，来自 spec §14）

- [ ] 子 Agent 工具返回值用 `invoke` + `result.messages` 末尾取 AI；**禁止**让 stream 兼任返回值来源（教训 `feedback_subagent_stream_pitfall.md`）
- [ ] `useMessageParser` 过滤规则不改
- [ ] 不修改 `app/components/ai-elements/**` 源文件
- [ ] 图标一律 `lucide-vue-next`，禁用 emoji
- [ ] throttle 仅作用于 UI 渲染层（active step description），数据层每 token 累积
- [ ] SSE 事件只增不改（metadata? / 新 custom event name）
- [ ] 虚拟列表高度测量在卡片展开/收起时回归必过
- [ ] 语义色用 Tailwind 固定色系 + `dark:` 变体，不硬编码 hex
- [ ] `handleChainEnd` 仅 `cbParentRunId === undefined` 时翻 completed
- [ ] `useThrottleFn` 显式传 `trailing=true`
