export const AGENT_RUN_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const

export type AgentRunStatus = typeof AGENT_RUN_STATUS[keyof typeof AGENT_RUN_STATUS]

export interface AgentRunInput {
  message?: string
  command?: unknown
  selectedModules?: string[]
  completedResults?: Record<string, string>
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

export type AgentEvent = AgentStreamEvent | AgentStatusEvent
