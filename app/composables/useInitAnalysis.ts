/**
 * 初始化分析 composable
 *
 * 直接复用 analysis/[sessionId].vue 的 useStream + 消息处理模式
 * LangGraph subgraph 的 SSE 流通过 _langchain_path 标注子图路径
 * 前端通过 stream.values 中的 currentModule/completedResults 追踪模块进度
 */

import { useStream, FetchStreamTransport } from '@langchain/vue'
import { AIMessage, ToolMessage } from '@langchain/core/messages'
import { INIT_ANALYSIS_MODULES, DEFAULT_SELECTED_MODULES } from '#shared/types/initAnalysis'
import type { ModuleRunState, InitAnalysisStatusResponse, ModuleStatus } from '#shared/types/initAnalysis'

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

  // ==================== useStream（与 analysis 页面完全一致的模式） ====================

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

  // computed 包装 getter（参考 useCaseChat.ts）
  const messages = computed(() => stream.messages as any[])
  const values = computed(() => stream.values as any)
  const interrupt = computed(() => stream.interrupt)
  const isLoading = computed(() => stream.isLoading)

  // ==================== 消息处理（复用 analysis 页面模式） ====================

  /** 将原始字典格式消息转为 BaseMessage 实例 */
  function coerceRawMessages(rawMessages: any[]): any[] {
    return rawMessages.map((m: any) => {
      if (m.type === 'human') return new HumanMessage({ content: m.content, id: m.id })
      if (m.type === 'ai') return new AIMessage({ content: m.content, id: m.id, tool_calls: m.tool_calls })
      if (m.type === 'tool') return new ToolMessage({ content: m.content, tool_call_id: m.tool_call_id, id: m.id })
      return m
    })
  }

  /** 流式消息列表（补充 ToolMessage） */
  const displayMessages = computed(() => {
    const lcMessages = messages.value
    const rawMessages = values.value?.messages

    if (!Array.isArray(lcMessages) || lcMessages.length === 0) {
      if (!Array.isArray(rawMessages) || rawMessages.length === 0) return []
      return coerceRawMessages(rawMessages)
    }

    // 从 values.messages 补充被 ensureMessageInstances 丢弃的 ToolMessage
    if (!Array.isArray(rawMessages)) return lcMessages

    const result = [...lcMessages]
    const existingIds = new Set(result.map((m: any) => m.id).filter(Boolean))

    for (const raw of rawMessages) {
      if (raw.type === 'tool' && !existingIds.has(raw.id)) {
        const aiIdx = result.findLastIndex((m: any) =>
          AIMessage.isInstance(m) && (m as any).tool_calls?.some((tc: any) => tc.id === raw.tool_call_id),
        )
        const insertAt = aiIdx >= 0 ? aiIdx + 1 : result.length
        const toolMsg = new ToolMessage({ content: raw.content, tool_call_id: raw.tool_call_id, id: raw.id })
        result.splice(insertAt, 0, toolMsg)
        if (raw.id) existingIds.add(raw.id)
      }
    }

    return result
  })

  // ==================== 模块状态追踪（从 values 中读取 LangGraph state） ====================

  watch(values, (v: any) => {
    if (!v) return

    const { currentModule, completedResults, failedModules, isComplete, selectedModules: mods } = v

    if (mods?.length) {
      selectedModules.value = mods
    }

    const updated = { ...moduleStates.value }

    // 已完成模块
    for (const [name, result] of Object.entries(completedResults ?? {})) {
      updated[name] = { name, status: 'complete', content: result as string }
    }

    // 失败模块
    for (const [name, error] of Object.entries(failedModules ?? {})) {
      updated[name] = { name, status: 'failed', content: '', error: error as string }
    }

    // 当前执行中的模块
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
  }, { deep: true })

  // ==================== 操作 ====================

  async function loadStatus() {
    const sessionInfo = await useApiFetch<{
      case: { id: number }
      session: { id: number; sessionId: string; status: number }
    }>(`/api/v1/case/session/${sessionId.value}`)

    if (!sessionInfo?.case) return
    caseId.value = sessionInfo.case.id

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
        restored[m.name] = { name: m.name, status: moduleStatus, content: m.result ?? '' }
      }
      moduleStates.value = restored

      if (status.status === 'in_progress') {
        // 空提交触发重连
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
    displayMessages,
    getModuleState,
    loadStatus,
    startAnalysis,
    resumeWorkflow,
    retryModule,
  }
}
