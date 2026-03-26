/**
 * 初始化分析 composable
 *
 * 以 sessionId 为核心，直接作为 useStream 的 threadId
 * 页面路由为 /dashboard/cases/init-analysis/[sessionId]
 * sessionId 由案件创建后后端生成，前端跳转时携带
 */

import { useStream, FetchStreamTransport } from '@langchain/vue'
import { INIT_ANALYSIS_MODULES, DEFAULT_SELECTED_MODULES } from '#shared/types/initAnalysis'
import type { ModuleRunState, InitAnalysisStatusResponse, ModuleStatus } from '#shared/types/initAnalysis'

interface InitAnalysisState {
  messages: any[]
  selectedModules: string[]
  currentModuleIndex: number
  currentModule: string
  completedResults: Record<string, string>
  failedModules: Record<string, string>
  isComplete: boolean
}

export function useInitAnalysis(sessionId: Ref<string>) {
  const phase = ref<'select' | 'running' | 'complete'>('select')
  const caseId = ref<number>(0)
  const selectedModules = ref<string[]>([...DEFAULT_SELECTED_MODULES])
  const moduleStates = ref<Record<string, ModuleRunState>>({})

  const activeModules = computed(() =>
    INIT_ANALYSIS_MODULES.filter(m => selectedModules.value.includes(m.name)),
  )

  function getModuleState(name: string): ModuleRunState {
    return moduleStates.value[name] ?? { name, status: 'idle', content: '' }
  }

  function updateModuleState(name: string, patch: Partial<ModuleRunState>) {
    const current = getModuleState(name)
    moduleStates.value = { ...moduleStates.value, [name]: { ...current, ...patch } }
  }

  // useStream 直接用 sessionId 作为 threadId
  const transport = new FetchStreamTransport({
    apiUrl: '/api/v1/case/init-analysis',
  })

  const stream = useStream<InitAnalysisState>({
    transport,
    threadId: sessionId.value,
    messagesKey: 'messages',
    onError: (error) => {
      console.error('[useInitAnalysis] 流错误:', error)
    },
  })

  // computed 包装 getter
  const values = computed(() => stream.values as InitAnalysisState | undefined)
  const interrupt = computed(() => stream.interrupt)
  const isLoading = computed(() => stream.isLoading?.value ?? false)

  // 监听 values 变化更新模块状态
  watch(values, (v) => {
    if (!v) return
    syncModuleStates(v)
  }, { deep: true })

  function syncModuleStates(vals: InitAnalysisState) {
    const { currentModule, completedResults, failedModules, isComplete } = vals
    const updated = { ...moduleStates.value }

    for (const [name, result] of Object.entries(completedResults ?? {})) {
      updated[name] = { name, status: 'complete', content: result }
    }

    for (const [name, error] of Object.entries(failedModules ?? {})) {
      updated[name] = { name, status: 'failed', content: '', error }
    }

    if (currentModule && !completedResults?.[currentModule] && !failedModules?.[currentModule]) {
      updated[currentModule] = {
        ...updated[currentModule],
        name: currentModule,
        status: 'streaming',
        content: updated[currentModule]?.content ?? '',
      }
    }

    moduleStates.value = updated

    if (isComplete) {
      phase.value = 'complete'
    }
  }

  // 加载已有状态（页面刷新恢复）
  async function loadStatus() {
    // 通过 sessionId 获取 session 对应的案件信息
    const sessionInfo = await useApiFetch<{
      case: { id: number }
      session: { id: number; sessionId: string; status: number }
    }>(`/api/v1/case/session/${sessionId.value}`)

    if (!sessionInfo?.case) return
    caseId.value = sessionInfo.case.id

    // 获取该案件的初始化分析状态
    const status = await useApiFetch<InitAnalysisStatusResponse>(
      `/api/v1/case/init-analysis/status/${caseId.value}`,
    )

    if (!status) return

    if (status.status === 'in_progress' || status.status === 'completed') {
      phase.value = status.status === 'completed' ? 'complete' : 'running'

      const moduleNames = status.modules.filter(m => m.status !== 'idle').map(m => m.name)
      if (moduleNames.length > 0) {
        selectedModules.value = moduleNames
      }

      const restored: Record<string, ModuleRunState> = {}
      for (const m of status.modules) {
        const moduleStatus: ModuleStatus = m.status === 'complete' ? 'complete'
          : m.status === 'failed' ? 'failed'
          : 'idle'
        restored[m.name] = {
          name: m.name,
          status: moduleStatus,
          content: m.result ?? '',
        }
      }
      moduleStates.value = restored

      // 进行中则重连 SSE（空提交触发重连模式）
      if (status.status === 'in_progress') {
        stream.submit({ messages: [] } as any)
      }
    }
  }

  // 启动分析
  function startAnalysis() {
    const initial: Record<string, ModuleRunState> = {}
    for (const name of selectedModules.value) {
      initial[name] = { name, status: 'idle', content: '' }
    }
    moduleStates.value = initial
    phase.value = 'running'

    // sessionId 已经是真实的 thread_id，直接 submit
    stream.submit({
      caseId: caseId.value,
      selectedModules: selectedModules.value,
    } as any)
  }

  // 恢复工作流（积分不足购买后）
  function resumeWorkflow() {
    stream.submit(
      { caseId: caseId.value } as any,
      { command: { resume: { action: 'continue' } } },
    )
  }

  // 重试失败模块
  function retryModule(moduleName: string) {
    updateModuleState(moduleName, { status: 'idle', content: '', error: undefined })
    stream.submit({
      caseId: caseId.value,
      selectedModules: [moduleName],
    } as any)
  }

  onUnmounted(() => {
    stream.stop()
  })

  return {
    phase,
    caseId,
    selectedModules,
    moduleStates,
    activeModules,
    isLoading,
    interrupt,
    getModuleState,
    loadStatus,
    startAnalysis,
    resumeWorkflow,
    retryModule,
  }
}
