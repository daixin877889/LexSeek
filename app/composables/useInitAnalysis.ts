/**
 * 初始化分析 composable
 *
 * 使用 @langchain/vue useStream 连接初始化分析 SSE 端点
 * 通过 values 中的 currentModule/completedResults/failedModules 追踪进度
 * 通过 interrupt 处理积分不足中断
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

export function useInitAnalysis(caseId: Ref<number>) {
  const phase = ref<'select' | 'running' | 'complete'>('select')
  const selectedModules = ref<string[]>([...DEFAULT_SELECTED_MODULES])
  const moduleStates = ref<Record<string, ModuleRunState>>({})
  const sessionId = ref<string>('')

  const activeModules = computed(() =>
    INIT_ANALYSIS_MODULES.filter(m => selectedModules.value.includes(m.name)),
  )

  function getModuleState(name: string): ModuleRunState {
    return moduleStates.value[name] ?? { name, status: 'idle', content: '' }
  }

  // useStream 连接（懒初始化）
  let stream: ReturnType<typeof useStream<InitAnalysisState>> | null = null

  function getOrCreateStream(threadId: string) {
    if (stream && sessionId.value === threadId) return stream

    sessionId.value = threadId
    const transport = new FetchStreamTransport({
      apiUrl: '/api/v1/case/init-analysis',
    })

    stream = useStream<InitAnalysisState>({
      transport,
      threadId,
      messagesKey: 'messages',
      onError: (error) => {
        console.error('[useInitAnalysis] 流错误:', error)
      },
    })

    // 监听 values 变化更新模块状态
    watch(
      () => stream!.values,
      (values: any) => {
        if (!values) return
        syncModuleStates(values)
      },
      { deep: true },
    )

    // 监听 interrupt 变化
    watch(
      () => stream!.interrupt,
      (interruptData: any) => {
        if (interruptData) {
          // interrupt 发生时，当前模块标记为 interrupted
          const currentMod = values.value?.currentModule
          if (currentMod) {
            updateModuleState(currentMod, { status: 'interrupted' })
          }
        }
      },
    )

    return stream
  }

  // 从 values 同步模块状态
  function syncModuleStates(values: InitAnalysisState) {
    const { currentModule, completedResults, failedModules, isComplete, currentModuleIndex, selectedModules: mods } = values

    const updated = { ...moduleStates.value }

    // 标记已完成的模块
    for (const [name, result] of Object.entries(completedResults ?? {})) {
      updated[name] = { name, status: 'complete', content: result }
    }

    // 标记失败的模块
    for (const [name, error] of Object.entries(failedModules ?? {})) {
      updated[name] = { name, status: 'failed', content: '', error }
    }

    // 标记当前执行中的模块
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

  function updateModuleState(name: string, patch: Partial<ModuleRunState>) {
    const current = getModuleState(name)
    moduleStates.value = { ...moduleStates.value, [name]: { ...current, ...patch } }
  }

  const values = computed(() => stream?.values as InitAnalysisState | undefined)
  const interrupt = computed(() => stream?.interrupt)
  const isLoading = computed(() => stream?.isLoading?.value ?? false)

  // 加载已有状态（页面刷新恢复）
  async function loadStatus() {
    const status = await useApiFetch<InitAnalysisStatusResponse>(
      `/api/v1/case/init-analysis/status/${caseId.value}`,
    )

    if (!status) return

    if (status.status === 'in_progress' || status.status === 'completed') {
      phase.value = status.status === 'completed' ? 'complete' : 'running'

      const moduleNames = status.modules.map(m => m.name)
      if (moduleNames.length > 0) {
        selectedModules.value = moduleNames
      }

      // 恢复模块状态
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

      // 进行中则重连 SSE
      if (status.status === 'in_progress' && status.sessionId) {
        const s = getOrCreateStream(status.sessionId)
        // 空提交触发重连（无新消息 → 重连模式）
        s.submit({ messages: [] } as any)
      }
    }
  }

  // 启动分析
  async function startAnalysis() {
    // 初始化模块状态
    const initial: Record<string, ModuleRunState> = {}
    for (const name of selectedModules.value) {
      initial[name] = { name, status: 'idle', content: '' }
    }
    moduleStates.value = initial
    phase.value = 'running'

    // 通过 useStream 提交（触发 POST /api/v1/case/init-analysis）
    // SSE 端点会创建 session 和 run
    const s = getOrCreateStream(`init-${caseId.value}-${Date.now()}`)
    s.submit({
      caseId: caseId.value,
      selectedModules: selectedModules.value,
    } as any)
  }

  // 恢复工作流（积分不足购买后）
  function resumeWorkflow() {
    if (!stream) return
    stream.submit(undefined, {
      command: { resume: { action: 'continue' } },
    })
  }

  // 重试失败模块
  async function retryModule(moduleName: string) {
    updateModuleState(moduleName, { status: 'idle', content: '', error: undefined })
    // 重试走新的 run，只包含失败模块
    const s = getOrCreateStream(`retry-${caseId.value}-${Date.now()}`)
    s.submit({
      caseId: caseId.value,
      selectedModules: [moduleName],
    } as any)
  }

  return {
    phase,
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
