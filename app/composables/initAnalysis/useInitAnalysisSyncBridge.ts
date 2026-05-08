import type { InitAnalysisStatusResponse } from '#shared/types/initAnalysis'
import type { SyncSummary } from './types'
import { useApiFetch } from '~/composables/useApiFetch'
import { postCrossTabEvent, useCrossTabListener } from '~/composables/useCrossTabEvents'

export interface SyncBridgeDeps {
  caseId: Ref<number>
  sessionId: Ref<string>
  syncSummary: ComputedRef<SyncSummary>
  isLoading: Ref<boolean>
  refreshGlobalStatus: (status: InitAnalysisStatusResponse) => void
  onExternalGenerating: (modules: string[]) => void
}

export function useInitAnalysisSyncBridge(deps: SyncBridgeDeps) {
  const {
    caseId,
    sessionId,
    syncSummary,
    isLoading,
    refreshGlobalStatus,
    onExternalGenerating,
  } = deps

  let lastBroadcastSignature = ''

  function buildSignature(summary: SyncSummary): string {
    return JSON.stringify({
      resultKeys: summary.resultKeys,
      failedKeys: summary.failedKeys,
      hasInterrupt: summary.hasInterrupt,
      selected: summary.selectedModules,
    })
  }

  function resetSignature() {
    lastBroadcastSignature = ''
  }

  function maybeBroadcast() {
    if (caseId.value <= 0) return
    const signature = buildSignature(syncSummary.value)
    if (signature !== lastBroadcastSignature) {
      lastBroadcastSignature = signature
      postCrossTabEvent('analysis:updated', { caseId: caseId.value })
    }
  }

  watch(syncSummary, () => {
    maybeBroadcast()
  })

  // isLoading 任意方向变化都立即广播 analysis:updated：
  // - false → true（startAnalysis / retryModule / resumeWorkflow / 重连）：让其他 tab 立刻进入"分析中"状态，
  //   不必等 stream 第一帧到达 syncSummary 变化才广播
  // - true → false（分析结束 / 失败）：让其他 tab 立刻拉最新 status
  watch(() => isLoading.value, () => {
    if (caseId.value <= 0) return
    lastBroadcastSignature = ''
    postCrossTabEvent('analysis:updated', { caseId: caseId.value })
  })

  useCrossTabListener('module:generating', (data) => {
    if (data.caseId === caseId.value) {
      onExternalGenerating(data.modules)
    }
  })

  let crossTabFetchSeq = 0
  useCrossTabListener('analysis:updated', async (data) => {
    if (data.caseId === caseId.value) {
      const seq = ++crossTabFetchSeq
      const status = await useApiFetch<InitAnalysisStatusResponse>(
        `/api/v1/cases/init-analysis-status/${caseId.value}`,
        { query: { sessionId: sessionId.value } },
      )
      if (status && seq === crossTabFetchSeq) {
        refreshGlobalStatus(status)
      }
    }
  })

  return {
    resetSignature,
    maybeBroadcast,
  }
}
