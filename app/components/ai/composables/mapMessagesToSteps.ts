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

    // 2. content text → 「分析」(非最后 AI 或 有 tool_calls) / 「得出结论」(最后 AI 且无 tool_calls)
    if (contentText) {
      const isConclusion = isLastAI && toolCalls.length === 0
      const kind: StepKind = isConclusion ? 'conclusion' : 'analysis'
      const label = isConclusion ? '得出结论' : '分析'
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
