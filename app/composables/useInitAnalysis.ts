import { INIT_ANALYSIS_MODULES, DEFAULT_SELECTED_MODULES } from '#shared/types/initAnalysis'
import type { ModuleRunState, InitAnalysisStatusResponse, ModuleStatus } from '#shared/types/initAnalysis'

export function useInitAnalysis(caseId: Ref<number>) {
  const phase = ref<'select' | 'running' | 'complete'>('select')
  const selectedModules = ref<string[]>([...DEFAULT_SELECTED_MODULES])
  const moduleStates = ref<Map<string, ModuleRunState>>(new Map())
  const isStarting = ref(false)
  const interrupt = ref<{ type: string; data: Record<string, unknown> } | null>(null)
  const eventSource = ref<EventSource | null>(null)

  /** 已选模块的完整信息（按固定顺序） */
  const activeModules = computed(() =>
    INIT_ANALYSIS_MODULES.filter(m => selectedModules.value.includes(m.name)),
  )

  /** 获取模块状态 */
  function getModuleState(name: string): ModuleRunState {
    return moduleStates.value.get(name) ?? { name, status: 'idle', content: '' }
  }

  /** 更新模块状态 */
  function updateModuleState(name: string, patch: Partial<ModuleRunState>) {
    const current = getModuleState(name)
    moduleStates.value = new Map(moduleStates.value).set(name, { ...current, ...patch })
  }

  /** 加载已有状态（页面刷新恢复） */
  async function loadStatus() {
    const status = await useApiFetch<InitAnalysisStatusResponse>(
      `/api/v1/case/init-analysis/status/${caseId.value}`,
    )

    if (!status) return

    if (status.status === 'in_progress' || status.status === 'completed') {
      phase.value = status.status === 'completed' ? 'complete' : 'running'

      // 恢复模块选择
      const moduleNames = status.modules.map(m => m.name)
      if (moduleNames.length > 0) {
        selectedModules.value = moduleNames
      }

      // 恢复各模块状态
      const newStates = new Map<string, ModuleRunState>()
      for (const m of status.modules) {
        const moduleStatus: ModuleStatus = m.status === 'complete' ? 'complete'
          : m.status === 'failed' ? 'failed'
          : 'idle'
        newStates.set(m.name, {
          name: m.name,
          status: moduleStatus,
          content: m.result ?? '',
        })
      }
      moduleStates.value = newStates

      // 如果进行中，重新连接 SSE
      if (status.status === 'in_progress' && status.sessionId) {
        connectSSE()
      }
    }
  }

  /** 连接 SSE 事件流 */
  function connectSSE() {
    // 使用 fetch + ReadableStream 处理 POST SSE
    const abortController = new AbortController()

    isStarting.value = true

    fetch('/api/v1/case/init-analysis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseId: caseId.value,
        selectedModules: selectedModules.value,
      }),
      signal: abortController.signal,
    }).then(async (response) => {
      isStarting.value = false

      if (!response.ok || !response.body) {
        phase.value = 'select'
        return
      }

      phase.value = 'running'
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        let eventName = ''
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventName = line.slice(7).trim()
          } else if (line.startsWith('data: ') && eventName) {
            try {
              const data = JSON.parse(line.slice(6))
              handleSSEEvent(eventName, data)
            } catch { /* ignore parse errors */ }
            eventName = ''
          }
        }
      }
    }).catch(() => {
      isStarting.value = false
    })

    // 存储以便清理
    eventSource.value = { close: () => abortController.abort() } as unknown as EventSource
  }

  /** 处理 SSE 事件 */
  function handleSSEEvent(eventType: string, data: Record<string, unknown>) {
    const moduleName = data.module as string

    switch (eventType) {
      case 'module_start':
        updateModuleState(moduleName, { status: 'streaming', content: '' })
        break

      case 'module_streaming':
        updateModuleState(moduleName, {
          status: 'streaming',
          content: (getModuleState(moduleName).content || '') + (data.content as string || ''),
        })
        break

      case 'module_complete':
        updateModuleState(moduleName, {
          status: 'complete',
          content: data.result as string || getModuleState(moduleName).content,
        })
        break

      case 'module_failed':
        updateModuleState(moduleName, {
          status: 'failed',
          error: data.error as string || '模块执行失败',
        })
        break

      case 'analysis_complete':
        phase.value = 'complete'
        break

      case 'interrupt':
        interrupt.value = {
          type: (data.interruptType as string) || 'unknown',
          data: data as Record<string, unknown>,
        }
        break

      case 'resume':
        interrupt.value = null
        break
    }
  }

  /** 启动分析 */
  async function startAnalysis() {
    if (isStarting.value) return

    // 初始化模块状态
    const newStates = new Map<string, ModuleRunState>()
    for (const name of selectedModules.value) {
      newStates.set(name, { name, status: 'idle', content: '' })
    }
    moduleStates.value = newStates
    interrupt.value = null

    connectSSE()
  }

  /** 恢复工作流（积分不足购买后） */
  async function resumeWorkflow() {
    interrupt.value = null
    connectSSE()
  }

  /** 重试失败的模块 */
  async function retryModule(moduleName: string) {
    updateModuleState(moduleName, { status: 'idle', content: '', error: undefined })

    // 用仅包含失败模块的请求重新触发
    const originalSelected = [...selectedModules.value]
    selectedModules.value = [moduleName]
    await connectSSE()
    selectedModules.value = originalSelected
  }

  /** 清理 */
  onUnmounted(() => {
    eventSource.value?.close()
  })

  return {
    phase,
    selectedModules,
    moduleStates,
    activeModules,
    isStarting,
    interrupt,
    getModuleState,
    loadStatus,
    startAnalysis,
    resumeWorkflow,
    retryModule,
  }
}
