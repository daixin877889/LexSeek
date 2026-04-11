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
}

export interface AgentCustomEvent {
  type: 'custom_event'
  runId: string
  sessionId: string
  name: string
  data: unknown
}

export type AgentEvent = AgentStreamEvent | AgentStatusEvent | AgentCustomEvent
