export const AGENT_RUN_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  INTERRUPTED: 'interrupted',
} as const

export type AgentRunStatus = typeof AGENT_RUN_STATUS[keyof typeof AGENT_RUN_STATUS]

export interface AgentRunInput {
  message?: string
  command?: unknown
  selectedModules?: string[]
  completedResults?: Record<string, string>
  thinking?: boolean
}

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
