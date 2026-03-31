/**
 * 初始化分析 composable
 *
 * 使用 useStream 消费 LangGraph StateGraph 的 SSE 流
 * 通过 values.lastExecutedModule 追踪当前模块
 * 通过 values.messages 数组长度变化按模块分组消息
 * 每个模块有独立的消息列表供 ModuleResult 渲染
 */

import { useStream, FetchStreamTransport } from '@langchain/vue'
import { INIT_ANALYSIS_MODULES, DEFAULT_SELECTED_MODULES } from '#shared/types/initAnalysis'
import type { ModuleRunState, InitAnalysisStatusResponse, ModuleStatus } from '#shared/types/initAnalysis'
import { coerceRawMessages } from '~/components/ai/composables/useMessageParser'

export function useInitAnalysis(sessionId: Ref<string>) {
  const phase = ref<'select' | 'running' | 'complete'>('select')
  const caseId = ref<number>(0)
  const selectedModules = ref<string[]>([...DEFAULT_SELECTED_MODULES])
  const moduleStates = ref<Record<string, ModuleRunState>>({})
  // 每个模块的消息分组：{ moduleName: BaseMessage[] }
  const moduleMessagesMap = ref<Record<string, any[]>>({})
  // 上次 values.messages 长度，用于检测新增消息
  let prevMessagesLength = 0
  // 上次 stream.messages 长度，用于检测新增消息（实时流）
  let prevStreamLength = 0
  // 上次 lastExecutedModule 值，用于检测模块切换（避免误判正在执行的模块）
  let prevLastExecutedModule = ''
  // 是否已从 checkpoint 恢复过消息（避免重复添加）
  let restoredFromCheckpoint = false
  // stream 是否已开始收到有效状态（避免 stream.submit 后第一次空状态覆盖 loadStatus 设置的状态）
  let streamStarted = false
  // 从数据库加载的已完成结果（页面刷新后恢复）
  const resultFromDB = ref<Record<string, string>>({})
  // 右侧面板当前选中的 tab 索引
  const activeIndex = ref(0)

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
  const isLoading = computed(() => stream.isLoading)

  // stream.interrupt 存在 Vue 响应式 bug：getter 只依赖 isLoading（stream 期间不变），
  // 导致 values 更新后 interrupt 不重新求值。直接从 values.__interrupt__ 读取。
  const interrupt = computed(() => {
    const v = values.value
    if (!v?.__interrupt__?.length) return undefined
    return v.__interrupt__.length === 1 ? v.__interrupt__[0] : v.__interrupt__
  })

  // ==================== 模块状态 + 消息分组追踪 ====================

  // 流式结果合并 DB 结果（DB 结果优先，流式结果覆盖）
  const mergedResult = computed(() => ({
    ...resultFromDB.value,
    ...(values.value?.result ?? {}),
  }))

  // 合并 stream.messages（实时流）和 values.messages（重连时从 checkpoint 恢复）
  // 确保页面刷新后左侧消息列表能显示历史消息
  const streamMessages = computed(() => {
    const realtime = stream.messages ?? []
    const checkpoint = values.value?.messages ?? []
    // 如果有实时消息（长度 > 0），优先使用实时消息
    if (realtime.length > 0) return realtime
    // 否则使用从 checkpoint 恢复的消息
    if (checkpoint.length > 0) {
      return coerceRawMessages(checkpoint)
    }
    return []
  })

  // 追踪模块状态 + 消息分组
  watch(values, (v: any) => {
    if (!v) return

    const { lastExecutedModule, result, failedModules, selectedModules: mods } = v

    if (mods?.length) {
      selectedModules.value = mods
    }

    // 追踪模块切换（用于消息分组）
    prevLastExecutedModule = lastExecutedModule ?? ''

    const hasResultContent = result && Object.keys(result).length > 0
    const hasFailedContent = failedModules && Object.keys(failedModules).length > 0

    // 如果 stream 还没开始收到有效内容，不覆盖 loadStatus 设置的状态
    // 但如果 SSE 返回了 selectedModules（checkpoint 数据），表示流已建立，需要更新 streaming 状态
    if (!streamStarted && !hasResultContent && !hasFailedContent && !mods?.length) {
      return
    }
    streamStarted = true

    // 统一计算所有模块状态（基于 result/failedModules 的实际内容判断）
    const updated = { ...moduleStates.value }
    for (const m of selectedModules.value) {
      if (result?.[m]) {
        // 有结果 → complete
        updated[m] = { name: m, status: 'complete', content: result[m] as string }
      } else if (failedModules?.[m]) {
        // 失败 → failed
        updated[m] = { name: m, status: 'failed', content: '', error: failedModules[m] as string }
      } else if (updated[m]?.status === 'complete' || updated[m]?.status === 'failed') {
        // 之前已完成/失败了，但 result 变了？回归 idle 让下一轮更新修正
        updated[m] = { name: m, status: 'idle', content: '' }
      }
      // else: 保持原状态（idle 或 streaming）
    }

    // 推断当前正在执行的模块（基于 selectedModules 顺序，串行条件边保证执行顺序）
    // values 事件在节点完成后才发，所以第一个没有 result/failed 的模块就是当前正在执行的
    const currentStreaming = selectedModules.value.find(m =>
      updated[m]?.status !== 'complete' && updated[m]?.status !== 'failed',
    )
    if (currentStreaming && updated[currentStreaming]?.status !== 'streaming') {
      updated[currentStreaming] = { name: currentStreaming, status: 'streaming', content: '' }
    }

    moduleStates.value = updated

    // 按模块分组消息
    const allMessages = v.messages
    const currentStreamLength = stream.messages?.length ?? 0

    if (Array.isArray(allMessages) && allMessages.length > 0) {
      // 判断是重连恢复（stream.messages 为空但 values.messages 有内容）还是实时流
      const isReconnecting = currentStreamLength === 0 && allMessages.length > 0 && !restoredFromCheckpoint

      if (isReconnecting) {
        // 重连恢复：一次性加载所有消息到最后一个执行的模块
        restoredFromCheckpoint = true
        if (lastExecutedModule) {
          const coerced = coerceRawMessages(allMessages)
          moduleMessagesMap.value = {
            ...moduleMessagesMap.value,
            [lastExecutedModule]: coerced,
          }
        }
        prevMessagesLength = allMessages.length
      } else if (lastExecutedModule && currentStreamLength > prevStreamLength) {
        // 实时流：增量添加新消息
        const newMessages = allMessages.slice(prevMessagesLength)
        if (newMessages.length > 0) {
          const existing = moduleMessagesMap.value[lastExecutedModule] ?? []
          const coerced = coerceRawMessages(newMessages)
          moduleMessagesMap.value = {
            ...moduleMessagesMap.value,
            [lastExecutedModule]: [...existing, ...coerced],
          }
        }
        prevMessagesLength = allMessages.length
        prevStreamLength = currentStreamLength
      }
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

    // 从 DB 加载已完成模块的结果（用于右侧面板刷新后恢复）
    if (status.result && Object.keys(status.result).length > 0) {
      resultFromDB.value = status.result
    }

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
        // 有待处理的 interrupt（如积分扣减失败）→ 重连以获取 interrupt 数据
        if (status.hasPendingInterrupt) {
          stream.submit({
            caseId: caseId.value,
            selectedModules: selectedModules.value,
          } as any)
          return
        }

        // 始终重连 SSE（获取完整状态快照，包含 selectedModules 和 messages）
        // 不提前设 phase='complete'，让 watch(values) 在 SSE 数据到达后统一判断
        stream.submit({
          caseId: caseId.value,
          selectedModules: selectedModules.value,
        } as any)
      }
    }
  }

  function startAnalysis() {
    const firstModule = selectedModules.value[0]
    const initial: Record<string, ModuleRunState> = {}
    for (const name of selectedModules.value) {
      // 第一个模块立即标记为 streaming，其余 idle
      initial[name] = { name, status: name === firstModule ? 'streaming' : 'idle', content: '' }
    }
    moduleStates.value = initial
    moduleMessagesMap.value = {}
    prevMessagesLength = 0
    prevStreamLength = 0
    prevLastExecutedModule = ''
    restoredFromCheckpoint = false
    streamStarted = false
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

  return {
    phase,
    caseId,
    selectedModules,
    moduleStates,
    activeModules,
    isLoading,
    interrupt,
    values,
    mergedResult,
    streamMessages,
    getModuleState,
    getModuleMessages,
    activeIndex,
    loadStatus,
    startAnalysis,
    resumeWorkflow,
    retryModule,
  }
}
