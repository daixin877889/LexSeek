import { INIT_ANALYSIS_MODULES, DEFAULT_SELECTED_MODULES } from '#shared/types/initAnalysis'
import type { ModuleRunState, InitAnalysisStatusResponse, ModuleStatus } from '#shared/types/initAnalysis'

export function useInitAnalysis(caseId: Ref<number>) {
  const phase = ref<'select' | 'running' | 'complete'>('select')
  const selectedModules = ref<string[]>([...DEFAULT_SELECTED_MODULES])
  const moduleStates = ref<Record<string, ModuleRunState>>({})
  const isStarting = ref(false)
  const interrupt = ref<{ type: string; data: Record<string, unknown> } | null>(null)

  let abortController: AbortController | null = null

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

      if (status.status === 'in_progress' && status.sessionId) {
        connectSSE()
      }
    }
  }

  function cleanupConnection() {
    if (abortController) {
      abortController.abort()
      abortController = null
    }
  }

  function connectSSE() {
    cleanupConnection()

    abortController = new AbortController()
    const signal = abortController.signal

    isStarting.value = true

    fetch('/api/v1/case/init-analysis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseId: caseId.value,
        selectedModules: selectedModules.value,
      }),
      signal,
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
          }
          else if (line.startsWith('data: ') && eventName) {
            try {
              const data = JSON.parse(line.slice(6))
              handleSSEEvent(eventName, data)
            }
            catch { /* ignore parse errors */ }
            eventName = ''
          }
        }
      }
    }).catch(() => {
      isStarting.value = false
    })
  }

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

  async function startAnalysis() {
    if (isStarting.value) return

    const initial: Record<string, ModuleRunState> = {}
    for (const name of selectedModules.value) {
      initial[name] = { name, status: 'idle', content: '' }
    }
    moduleStates.value = initial
    interrupt.value = null

    connectSSE()
  }

  async function resumeWorkflow() {
    interrupt.value = null
    connectSSE()
  }

  async function retryModule(moduleName: string) {
    updateModuleState(moduleName, { status: 'idle', content: '', error: undefined })

    const originalSelected = [...selectedModules.value]
    selectedModules.value = [moduleName]
    connectSSE()
    selectedModules.value = originalSelected
  }

  onUnmounted(() => {
    cleanupConnection()
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
