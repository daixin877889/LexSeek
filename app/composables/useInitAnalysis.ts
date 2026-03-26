/**
 * 初始化分析 composable
 *
 * 使用 useStream 消费 LangGraph StateGraph 的 SSE 流
 * 通过 values.lastExecutedModule 追踪当前模块
 * 通过 values.messages 数组长度变化按模块分组消息
 * 每个模块有独立的消息列表供 ModuleResult 渲染
 */

import { useStream, FetchStreamTransport } from '@langchain/vue'
import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages'
import { INIT_ANALYSIS_MODULES, DEFAULT_SELECTED_MODULES } from '#shared/types/initAnalysis'
import type { ModuleRunState, InitAnalysisStatusResponse, ModuleStatus } from '#shared/types/initAnalysis'

export function useInitAnalysis(sessionId: Ref<string>) {
  const phase = ref<'select' | 'running' | 'complete'>('select')
  const caseId = ref<number>(0)
  const selectedModules = ref<string[]>([...DEFAULT_SELECTED_MODULES])
  const moduleStates = ref<Record<string, ModuleRunState>>({})
  // 每个模块的消息分组：{ moduleName: BaseMessage[] }
  const moduleMessagesMap = ref<Record<string, any[]>>({})
  // 上次 values.messages 长度，用于检测新增消息
  let prevMessagesLength = 0

  const activeModules = computed(() =>
    INIT_ANALYSIS_MODULES.filter(m => selectedModules.value.includes(m.name)),
  )

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

  // ==================== useStream ====================

  const stream = reactive(useStream({
    transport: new FetchStreamTransport({
      apiUrl: '/api/v1/case/init-analysis',
    }),
    threadId: sessionId.value,
    messagesKey: 'messages',
    onError: (error: any) => {
      console.error('[useInitAnalysis] 流错误:', error)
    },
  }))

  const values = computed(() => stream.values as any)
  const interrupt = computed(() => stream.interrupt)
  const isLoading = computed(() => stream.isLoading)

  // ==================== 模块状态 + 消息分组追踪 ====================

  watch(values, (v: any) => {
    if (!v) return

    // 后端 state 字段名：lastExecutedModule, result, failedModules
    const { lastExecutedModule, result, failedModules, selectedModules: mods } = v

    if (mods?.length) {
      selectedModules.value = mods
    }

    const updated = { ...moduleStates.value }

    // 已完成模块（result 是 Record<string, string>）
    for (const [name, content] of Object.entries(result ?? {})) {
      if (content) {
        updated[name] = { name, status: 'complete', content: content as string }
      }
    }

    // 失败模块
    for (const [name, error] of Object.entries(failedModules ?? {})) {
      updated[name] = { name, status: 'failed', content: '', error: error as string }
    }

    // 当前执行中的模块
    if (lastExecutedModule && !result?.[lastExecutedModule] && !failedModules?.[lastExecutedModule]) {
      updated[lastExecutedModule] = {
        ...updated[lastExecutedModule],
        name: lastExecutedModule,
        status: 'streaming',
        content: '',
      }
    }

    moduleStates.value = updated

    // 按模块分组消息：检测 values.messages 新增的消息归属到 lastExecutedModule
    const allMessages = v.messages
    if (Array.isArray(allMessages) && lastExecutedModule) {
      const newMessages = allMessages.slice(prevMessagesLength)
      if (newMessages.length > 0) {
        const existing = moduleMessagesMap.value[lastExecutedModule] ?? []
        // 用 coerceRawMessages 将字典转 BaseMessage 实例
        const coerced = coerceRawMessages(newMessages)
        moduleMessagesMap.value = {
          ...moduleMessagesMap.value,
          [lastExecutedModule]: [...existing, ...coerced],
        }
      }
      prevMessagesLength = allMessages.length
    }

    // 检查是否全部完成
    if (mods?.length && result) {
      const completedCount = mods.filter((m: string) => result[m]).length
      const failedCount = Object.keys(failedModules ?? {}).length
      if (completedCount + failedCount >= mods.length) {
        phase.value = 'complete'
      }
    }
  }, { deep: true })

  // 同时监听 stream.messages 获取流式消息（比 values.messages 更实时）
  watch(() => stream.messages as any[], (msgs: any[]) => {
    if (!Array.isArray(msgs) || msgs.length === 0) return
    const v = values.value
    if (!v?.lastExecutedModule) return

    const moduleName = v.lastExecutedModule
    // 将 stream.messages 中超出 prevMessagesLength 的部分作为当前模块的流式消息
    // 注意：stream.messages 是实时的，可能比 values.messages 更新更快
    if (msgs.length > prevMessagesLength) {
      const newMsgs = msgs.slice(prevMessagesLength)
      moduleMessagesMap.value = {
        ...moduleMessagesMap.value,
        [moduleName]: newMsgs,
      }
    }
  }, { deep: true })

  // ==================== 工具函数 ====================

  function coerceRawMessages(rawMessages: any[]): any[] {
    return rawMessages.map((m: any) => {
      if (m.type === 'human') return new HumanMessage({ content: m.content, id: m.id })
      if (m.type === 'ai') return new AIMessage({ content: m.content, id: m.id, tool_calls: m.tool_calls })
      if (m.type === 'tool') return new ToolMessage({ content: m.content, tool_call_id: m.tool_call_id, id: m.id })
      return m
    })
  }

  // ==================== 操作 ====================

  async function loadStatus() {
    const sessionInfo = await useApiFetch<{
      case: { id: number }
      session: { id: number; sessionId: string; status: number }
    }>(`/api/v1/case/session/${sessionId.value}`)

    if (!sessionInfo?.case) return
    caseId.value = sessionInfo.case.id

    const status = await useApiFetch<InitAnalysisStatusResponse>(
      `/api/v1/case/init-analysis-status/${caseId.value}`,
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
        restored[m.name] = { name: m.name, status: moduleStatus, content: m.result ?? '' }
      }
      moduleStates.value = restored

      if (status.status === 'in_progress') {
        stream.submit({ messages: [] } as any)
      }
    }
  }

  function startAnalysis() {
    const initial: Record<string, ModuleRunState> = {}
    for (const name of selectedModules.value) {
      initial[name] = { name, status: 'idle', content: '' }
    }
    moduleStates.value = initial
    moduleMessagesMap.value = {}
    prevMessagesLength = 0
    phase.value = 'running'

    stream.submit({
      caseId: caseId.value,
      selectedModules: selectedModules.value,
    } as any)
  }

  function resumeWorkflow() {
    stream.submit(
      { caseId: caseId.value, selectedModules: selectedModules.value } as any,
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

  return {
    phase,
    caseId,
    selectedModules,
    moduleStates,
    activeModules,
    isLoading,
    interrupt,
    getModuleState,
    getModuleMessages,
    loadStatus,
    startAnalysis,
    resumeWorkflow,
    retryModule,
  }
}
