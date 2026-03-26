/**
 * 初始化分析 composable
 *
 * 使用 @langchain/vue useStream 连接初始化分析 SSE 端点
 * 通过 values 中的 currentModule/completedResults/failedModules 追踪进度
 * 通过 interrupt 处理积分不足中断
 *
 * 重要：useStream 返回的 messages/values/interrupt 是 getter（非 Ref），
 * 必须用 computed() 包装才能在模板中响应式更新。
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
  // sessionId 由后端生成（uuidv7），前端通过 status API 获取后用于 useStream
  const currentSessionId = ref<string>('')

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

  // useStream 实例（懒初始化）
  let stream: ReturnType<typeof useStream<InitAnalysisState>> | null = null

  function ensureStream(threadId: string) {
    if (stream && currentSessionId.value === threadId) return stream

    // 关闭旧连接
    if (stream) {
      stream.stop()
    }

    currentSessionId.value = threadId
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

    return stream
  }

  // computed 包装 getter（参考 useCaseChat.ts 的模式）
  const values = computed(() => stream?.values as InitAnalysisState | undefined)
  const interrupt = computed(() => stream?.interrupt)
  const isLoading = computed(() => stream?.isLoading?.value ?? false)

  // 监听 values 变化更新模块状态
  watch(values, (v) => {
    if (!v) return
    syncModuleStates(v)
  }, { deep: true })

  // 从 values 同步模块状态
  function syncModuleStates(vals: InitAnalysisState) {
    const { currentModule, completedResults, failedModules, isComplete } = vals
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

      // 进行中则用 sessionId 重连 SSE
      if (status.status === 'in_progress' && status.sessionId) {
        const s = ensureStream(status.sessionId)
        // 空提交触发重连
        s.submit({ messages: [] } as any)
      }
    }
  }

  // 启动分析
  // 注意：sessionId 由后端生成。前端先用临时 threadId 发起请求，
  // 后端会创建真正的 session 并入队 run。
  // 后续重连/resume 用 status API 返回的 sessionId。
  async function startAnalysis() {
    // 初始化模块状态
    const initial: Record<string, ModuleRunState> = {}
    for (const name of selectedModules.value) {
      initial[name] = { name, status: 'idle', content: '' }
    }
    moduleStates.value = initial
    phase.value = 'running'

    // 用临时 threadId 启动（后端会忽略此 threadId，自行生成 sessionId）
    // TODO: 更优方案是先调用 API 获取 sessionId 再连接 stream
    const tempThreadId = `init-${caseId.value}-${Date.now()}`
    const s = ensureStream(tempThreadId)
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
  function retryModule(moduleName: string) {
    updateModuleState(moduleName, { status: 'idle', content: '', error: undefined })
    const tempThreadId = `retry-${caseId.value}-${Date.now()}`
    const s = ensureStream(tempThreadId)
    s.submit({
      caseId: caseId.value,
      selectedModules: [moduleName],
    } as any)
  }

  onUnmounted(() => {
    stream?.stop()
  })

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
