import { INIT_ANALYSIS_MODULES, DEFAULT_SELECTED_MODULES } from '#shared/types/initAnalysis'
import type { ModuleRunState, InitAnalysisStatusResponse, ModuleStatus } from '#shared/types/initAnalysis'
import { coerceRawMessages } from '~/components/ai/composables/useMessageParser'
import { useStreamChat } from '../useStreamChat'
import {
  pickFirstSelectedModule,
  computeModuleStatesFromSnapshot,
  extractGlobalStatusSnapshot,
} from './useInitAnalysisModules'
import type { InitAnalysisState, AnalysisPhase, SyncCursor, SyncSummary, RuntimeExposed } from './types'
import { useApiFetch } from '~/composables/useApiFetch'

export function useInitAnalysisRuntime(sessionId: Ref<string>) {
  const phase = ref<AnalysisPhase>('select')
  const caseId = ref<number>(0)
  const selectedModules = ref<string[]>([...DEFAULT_SELECTED_MODULES])
  const moduleStates = ref<Record<string, ModuleRunState>>({})
  const completedModules = ref<string[]>([])
  // projection 依赖：DB 已生成结果 / status.modules 全量列表
  // 之前由 [sessionId].vue 自己持有 → 但 runtime.loadStatus 拉到 status 后没回填，
  // 导致首次进入页面时 projection 看不到 DB 已 complete 的模块，错显"未生成"。
  const statusModules = ref<InitAnalysisStatusResponse['modules']>([])
  const resultFromDB = ref<Record<string, string>>({})
  const isInitialized = ref(false)
  const moduleMessagesMap = ref<Record<string, any[]>>({})
  const activeIndex = ref(0)

  const cursor: SyncCursor = {
    prevMessagesLength: 0,
    prevStreamLength: 0,
    restoredFromCheckpoint: false,
    streamStarted: false,
  }

  function resetCursor() {
    cursor.prevMessagesLength = 0
    cursor.prevStreamLength = 0
    cursor.restoredFromCheckpoint = false
    cursor.streamStarted = false
  }

  const activeModules = computed(() =>
    INIT_ANALYSIS_MODULES.filter(m => selectedModules.value.includes(m.name)),
  )

  const stream = useStreamChat<InitAnalysisState>({
    apiUrl: '/api/v1/cases/init-analysis',
    threadId: sessionId.value,
    messagesKey: 'messages',
  })

  const { interruptData } = stream

  const syncSummary = computed<SyncSummary>(() => {
    const v = stream.values.value
    return {
      resultKeys: Object.keys(v?.result ?? {}).sort(),
      failedKeys: Object.keys(v?.failedModules ?? {}).sort(),
      hasInterrupt: Array.isArray(v?.__interrupt__) && (v?.__interrupt__?.length ?? 0) > 0,
      selectedModules: [...selectedModules.value].sort(),
    }
  })

  function getModuleState(name: string): ModuleRunState {
    return moduleStates.value[name] ?? { name, status: 'idle', content: '' }
  }

  function getModuleMessages(name: string): any[] {
    return moduleMessagesMap.value[name] ?? []
  }

  function updateModuleState(name: string, patch: Partial<ModuleRunState>) {
    const current = getModuleState(name)
    moduleStates.value = { ...moduleStates.value, [name]: { ...current, ...patch } }
  }

  watch(() => stream.values.value, (v: InitAnalysisState | undefined) => {
    if (!v) return

    const { lastExecutedModule, result, failedModules, selectedModules: mods } = v

    if (mods?.length && phase.value !== 'select') {
      selectedModules.value = mods
    }

    const hasResultContent = result && Object.keys(result).length > 0
    const hasFailedContent = failedModules && Object.keys(failedModules).length > 0

    if (!cursor.streamStarted && !hasResultContent && !hasFailedContent && !mods?.length) {
      return
    }
    cursor.streamStarted = true

    moduleStates.value = computeModuleStatesFromSnapshot(
      selectedModules.value,
      result,
      failedModules,
      moduleStates.value,
    )

    const allMessages = v.messages
    const currentStreamLength = stream.messages.value?.length ?? 0

    if (Array.isArray(allMessages) && allMessages.length > 0) {
      const isReconnecting = currentStreamLength === 0 && allMessages.length > 0 && !cursor.restoredFromCheckpoint

      if (isReconnecting) {
        cursor.restoredFromCheckpoint = true
        if (lastExecutedModule) {
          const coerced = coerceRawMessages(allMessages)
          moduleMessagesMap.value = {
            ...moduleMessagesMap.value,
            [lastExecutedModule]: coerced,
          }
        }
        cursor.prevMessagesLength = allMessages.length
      } else if (lastExecutedModule && currentStreamLength > cursor.prevStreamLength) {
        const newMessages = allMessages.slice(cursor.prevMessagesLength)
        if (newMessages.length > 0) {
          const existing = moduleMessagesMap.value[lastExecutedModule] ?? []
          const coerced = coerceRawMessages(newMessages)
          moduleMessagesMap.value = {
            ...moduleMessagesMap.value,
            [lastExecutedModule]: [...existing, ...coerced],
          }
        }
        cursor.prevMessagesLength = allMessages.length
        cursor.prevStreamLength = currentStreamLength
      }
    }

    if (mods?.length && result) {
      const completedCount = mods.filter((m: string) => result[m]).length
      const failedCount = Object.keys(failedModules ?? {}).length
      if (completedCount + failedCount >= mods.length) {
        phase.value = 'complete'
      }
    }
  }, { deep: true })

  async function loadStatus() {
    resetCursor()

    const sessionInfo = await useApiFetch<{
      case: { id: number }
      session: { id: number; sessionId: string; status: number }
    }>(`/api/v1/cases/session/${sessionId.value}`)

    if (!sessionInfo?.case) {
      isInitialized.value = true
      return
    }
    caseId.value = sessionInfo.case.id

    const sessionStatus = sessionInfo.session?.status
    if (sessionStatus === 2) {
      phase.value = 'complete'
    } else if (sessionStatus === 1) {
      phase.value = 'running'
    }

    const status = await useApiFetch<InitAnalysisStatusResponse>(
      `/api/v1/cases/init-analysis-status/${caseId.value}`,
      { query: { sessionId: sessionId.value } },
    )

    if (!status) {
      if (sessionStatus === 1 || sessionStatus === 2) {
        stream.submit(undefined)
      }
      isInitialized.value = true
      return
    }

    applyGlobalStatus(status)

    if (status.status === 'not_started') {
      phase.value = 'select'
      selectedModules.value = DEFAULT_SELECTED_MODULES.filter(
        name => !completedModules.value.includes(name),
      )
      isInitialized.value = true
      return
    }

    if (status.status === 'in_progress' || status.status === 'completed') {
      phase.value = status.status === 'completed' ? 'complete' : 'running'

      if (status.selectedModules?.length) {
        selectedModules.value = status.selectedModules
      }

      const restored: Record<string, ModuleRunState> = {}
      for (const m of status.modules) {
        if (!selectedModules.value.includes(m.name)) continue

        const moduleStatus: ModuleStatus = m.status === 'complete' ? 'complete'
          : m.status === 'failed' ? 'failed'
          : m.status === 'in_progress' ? 'streaming'
          : 'idle'
        restored[m.name] = { name: m.name, status: moduleStatus, content: m.result ?? '' }
      }

      if (status.status === 'in_progress') {
        const hasStreaming = Object.values(restored).some(s => s.status === 'streaming')
        if (!hasStreaming) {
          const firstRunning = selectedModules.value.find(name =>
            restored[name]?.status !== 'complete' && restored[name]?.status !== 'failed',
          )
          if (firstRunning) {
            restored[firstRunning] = { name: firstRunning, status: 'streaming', content: '' }
          }
        }
      }

      moduleStates.value = restored
      stream.submit(undefined)
    }

    isInitialized.value = true
  }

  function startAnalysis() {
    const firstModule = pickFirstSelectedModule(selectedModules.value)
    const initial: Record<string, ModuleRunState> = {}
    for (const name of selectedModules.value) {
      initial[name] = { name, status: name === firstModule ? 'streaming' : 'idle', content: '' }
    }
    moduleStates.value = initial
    moduleMessagesMap.value = {}
    resetCursor()
    phase.value = 'running'

    stream.submit({
      caseId: caseId.value,
      selectedModules: selectedModules.value,
    } as any)
  }

  function resumeWorkflow() {
    stream.submit(
      { caseId: caseId.value } as any,
      { command: { resume: { action: 'continue' } } },
    )
  }

  function retryModule(moduleName: string) {
    updateModuleState(moduleName, { status: 'idle', content: '', error: undefined })
    stream.submit({
      caseId: caseId.value,
      selectedModules: [moduleName],
    } as any)
  }

  function applyGlobalStatus(status: InitAnalysisStatusResponse) {
    const snap = extractGlobalStatusSnapshot(status)
    completedModules.value = snap.completedModules
    statusModules.value = snap.statusModules
    resultFromDB.value = snap.resultFromDB
  }

  function refreshGlobalStatus(status: InitAnalysisStatusResponse) {
    applyGlobalStatus(status)
  }

  return {
    phase,
    caseId,
    selectedModules,
    completedModules,
    statusModules,
    resultFromDB,
    isInitialized,
    moduleStates,
    moduleMessagesMap,
    activeModules,
    isLoading: stream.isLoading,
    runStatus: stream.runStatus,
    runError: stream.runError,
    interruptData,
    values: stream.values,
    stream,
    activeIndex,
    syncSummary,
    getModuleState,
    getModuleMessages,
    loadStatus,
    startAnalysis,
    resumeWorkflow,
    retryModule,
    refreshGlobalStatus,
  } satisfies RuntimeExposed & { stream: typeof stream }
}
