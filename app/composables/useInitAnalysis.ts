import { INIT_ANALYSIS_MODULES } from '#shared/types/initAnalysis'
import type { ModuleRunState } from '#shared/types/initAnalysis'
import { useInitAnalysisRuntime } from './initAnalysis/useInitAnalysisRuntime'
import { useInitAnalysisProjection } from './initAnalysis/useInitAnalysisProjection'
import { useInitAnalysisSyncBridge } from './initAnalysis/useInitAnalysisSyncBridge'
import type { InitAnalysisState } from './initAnalysis/types'
import type { InitAnalysisStatusResponse } from '#shared/types/initAnalysis'

export type { InitAnalysisState }

export function pickFirstSelectedModule(
  selectedModules: string[],
): string | undefined {
  return INIT_ANALYSIS_MODULES
    .map(m => m.name)
    .find(name => selectedModules.includes(name))
}

export function computeModuleStatesFromSnapshot(
  selectedModules: string[],
  result: Record<string, string | undefined> | undefined,
  failedModules: Record<string, string | undefined> | undefined,
  prev: Record<string, ModuleRunState>,
): Record<string, ModuleRunState> {
  const next: Record<string, ModuleRunState> = {}
  for (const m of selectedModules) {
    if (result?.[m]) {
      next[m] = { name: m, status: 'complete', content: result[m] as string }
    } else if (failedModules?.[m]) {
      next[m] = { name: m, status: 'failed', content: '', error: failedModules[m] as string }
    } else if (prev[m]?.status === 'complete' || prev[m]?.status === 'failed') {
      next[m] = prev[m]!
    } else {
      next[m] = { name: m, status: 'idle', content: '' }
    }
  }
  const currentStreaming = selectedModules.find(m =>
    next[m]!.status !== 'complete' && next[m]!.status !== 'failed',
  )
  if (currentStreaming) {
    next[currentStreaming] = { name: currentStreaming, status: 'streaming', content: '' }
  }
  return next
}

export function useInitAnalysis(sessionId: Ref<string>) {
  const runtime = useInitAnalysisRuntime(sessionId)

  const resultFromDB = ref<Record<string, string>>({})
  const statusModules = ref<import('#shared/types/initAnalysis').InitAnalysisStatusResponse['modules']>([])
  const externalGenerating = ref<string[]>([])

  const projection = useInitAnalysisProjection({
    moduleStates: runtime.moduleStates,
    values: runtime.values,
    streamMessages: runtime.stream.messages,
    statusModules,
    resultFromDB,
    externalGenerating,
  })

  const syncBridge = useInitAnalysisSyncBridge({
    caseId: runtime.caseId,
    sessionId,
    syncSummary: runtime.syncSummary,
    isLoading: runtime.isLoading,
    refreshGlobalStatus(status) {
      runtime.refreshGlobalStatus(status)
      statusModules.value = status.modules ?? []
    },
    refreshGlobalResult(result) {
      resultFromDB.value = result
    },
    onExternalGenerating(modules) {
      externalGenerating.value = modules
    },
  })

  const originalStartAnalysis = runtime.startAnalysis
  const originalRetryModule = runtime.retryModule
  const originalResumeWorkflow = runtime.resumeWorkflow

  function startAnalysis() {
    syncBridge.resetSignature()
    originalStartAnalysis()
  }

  function retryModule(moduleName: string) {
    syncBridge.resetSignature()
    originalRetryModule(moduleName)
  }

  function resumeWorkflow() {
    syncBridge.resetSignature()
    originalResumeWorkflow()
  }

  return {
    phase: runtime.phase,
    caseId: runtime.caseId,
    selectedModules: runtime.selectedModules,
    completedModules: runtime.completedModules,
    isInitialized: runtime.isInitialized,
    moduleStates: runtime.moduleStates,
    activeModules: runtime.activeModules,
    allModuleCards: projection.allModuleCards,
    isLoading: runtime.isLoading,
    runStatus: runtime.runStatus,
    runError: runtime.runError,
    interruptData: runtime.interruptData,
    values: runtime.values,
    mergedResult: projection.mergedResult,
    streamMessages: projection.streamMessages,
    getModuleState: runtime.getModuleState,
    getModuleMessages: runtime.getModuleMessages,
    activeIndex: runtime.activeIndex,
    loadStatus: runtime.loadStatus,
    startAnalysis,
    resumeWorkflow,
    retryModule,
  }
}
