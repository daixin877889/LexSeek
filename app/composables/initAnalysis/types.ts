import type { ModuleRunState, InitAnalysisStatusResponse } from '#shared/types/initAnalysis'
import type { AgentRunStatus } from '#shared/types/agentRun'
import type { InitAnalysisModule } from '#shared/types/initAnalysis'

export interface InitAnalysisState extends Record<string, unknown> {
  lastExecutedModule?: string
  result?: Record<string, string>
  failedModules?: Record<string, string>
  selectedModules?: string[]
  messages?: any[]
  __interrupt__?: any[]
}

export type AnalysisPhase = 'select' | 'running' | 'complete'

export interface SyncCursor {
  prevMessagesLength: number
  prevStreamLength: number
  restoredFromCheckpoint: boolean
  streamStarted: boolean
}

export interface SyncSummary {
  resultKeys: string[]
  failedKeys: string[]
  hasInterrupt: boolean
  selectedModules: string[]
}

export type AnalysisEvent =
  | { type: 'STREAM_SNAPSHOT'; snapshot: InitAnalysisState }
  | { type: 'STREAM_CLOSED' }
  | { type: 'STATUS_LOADED'; payload: InitAnalysisStatusResponse; sessionStatus?: number }
  | { type: 'START_ANALYSIS' }
  | { type: 'RETRY_MODULE'; moduleName: string }
  | { type: 'RESUME_WORKFLOW' }

export interface RuntimeExposed {
  phase: Ref<AnalysisPhase>
  caseId: Ref<number>
  selectedModules: Ref<string[]>
  completedModules: Ref<string[]>
  isInitialized: Ref<boolean>
  moduleStates: Ref<Record<string, ModuleRunState>>
  moduleMessagesMap: Ref<Record<string, any[]>>
  activeModules: ComputedRef<import('#shared/types/initAnalysis').InitAnalysisModule[]>
  isLoading: Ref<boolean>
  runStatus: Ref<import('#shared/types/agentRun').AgentRunStatus | 'idle'>
  runError: Ref<string>
  interruptData: ComputedRef<any>
  values: ComputedRef<InitAnalysisState | undefined>
  activeIndex: Ref<number>
  syncSummary: ComputedRef<SyncSummary>
  getModuleState: (name: string) => ModuleRunState
  getModuleMessages: (name: string) => any[]
  loadStatus: () => Promise<void>
  startAnalysis: () => void
  resumeWorkflow: () => void
  retryModule: (moduleName: string) => void
  refreshGlobalStatus: (status: InitAnalysisStatusResponse) => void
}
