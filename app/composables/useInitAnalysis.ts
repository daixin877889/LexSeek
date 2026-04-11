/**
 * 初始化分析 composable
 *
 * 使用 useStreamChat 消费 LangGraph StateGraph 的 SSE 流
 * 通过 values.lastExecutedModule 追踪当前模块
 * 通过 values.messages 数组长度变化按模块分组消息
 * 每个模块有独立的消息列表供 ModuleResult 渲染
 */

import { INIT_ANALYSIS_MODULES, DEFAULT_SELECTED_MODULES } from '#shared/types/initAnalysis'
import type { ModuleRunState, InitAnalysisStatusResponse, ModuleStatus } from '#shared/types/initAnalysis'
import type { AnalysisModuleCard } from '#shared/types/case'
import { coerceRawMessages } from '~/components/ai/composables/useMessageParser'

// InitAnalysis LangGraph 状态类型
interface InitAnalysisState extends Record<string, unknown> {
  lastExecutedModule?: string
  result?: Record<string, string>
  failedModules?: Record<string, string>
  selectedModules?: string[]
  messages?: any[]
  __interrupt__?: any[]
}

export function useInitAnalysis(sessionId: Ref<string>) {
  const phase = ref<'select' | 'running' | 'complete'>('select')
  const caseId = ref<number>(0)
  const selectedModules = ref<string[]>([...DEFAULT_SELECTED_MODULES])
  const moduleStates = ref<Record<string, ModuleRunState>>({})
  // 该案件已完成的模块列表（跨 session 累积，用于补充分析场景下禁用模块选择）
  const completedModules = ref<string[]>([])
  // 是否已初始化完成（loadStatus 是否已完成）
  const isInitialized = ref(false)
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
  // 跨标签页广播去重签名（避免 reconnect 触发的空广播）
  let lastBroadcastSignature = ''
  // 从数据库加载的已完成结果（页面刷新后恢复）
  const resultFromDB = ref<Record<string, string>>({})
  // 右侧面板当前选中的 tab 索引
  const activeIndex = ref(0)
  // 从 loadStatus 加载的全局模块状态（跨 session 的 7 个模块，用于右侧面板全局视图）
  const statusModules = ref<InitAnalysisStatusResponse['modules']>([])

  const activeModules = computed(() =>
    INIT_ANALYSIS_MODULES.filter(m => selectedModules.value.includes(m.name)),
  )

  // 跨标签页模块对话生成状态（案件详情页的 moduleChatManager 广播过来的）
  const externalGenerating = ref<string[]>([])

  // 右侧面板 7 个模块的全局卡片（跨 session 聚合 + 实时流覆盖 + 跨标签模块对话状态）
  const allModuleCards = computed<AnalysisModuleCard[]>(() => {
    const globalModules = statusModules.value
    const streamResult = stream.values.value?.result ?? {}
    const streamFailed = stream.values.value?.failedModules ?? {}
    const localStates = moduleStates.value
    const extGenerating = new Set(externalGenerating.value)

    return INIT_ANALYSIS_MODULES.map(def => {
      // 实时流中的状态优先（本 session 正在跑的模块）
      const local = localStates[def.name]
      if (local) {
        if (local.status === 'complete' || streamResult[def.name]) {
          return {
            moduleName: def.name,
            moduleTitle: def.title,
            status: 'complete' as const,
            content: streamResult[def.name] ?? local.content,
          }
        }
        if (local.status === 'failed' || streamFailed[def.name]) {
          return { moduleName: def.name, moduleTitle: def.title, status: 'failed' as const }
        }
        if (local.status === 'streaming') {
          return { moduleName: def.name, moduleTitle: def.title, status: 'in_progress' as const }
        }
      }

      // fallback 到全局状态
      const g = globalModules.find(m => m.name === def.name)
      if (g?.status === 'complete' && g.result) {
        return {
          moduleName: def.name,
          moduleTitle: def.title,
          status: 'complete' as const,
          content: g.result,
          analyzedAt: g.analyzedAt,
          version: g.version,
        }
      }
      if (g?.status === 'failed') {
        return { moduleName: def.name, moduleTitle: def.title, status: 'failed' as const }
      }
      if (g?.status === 'in_progress' || extGenerating.has(def.name)) {
        return { moduleName: def.name, moduleTitle: def.title, status: 'in_progress' as const }
      }
      return { moduleName: def.name, moduleTitle: def.title, status: 'idle' as const }
    })
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

  // 跨标签页监听：案件详情页的模块对话生成状态
  useCrossTabListener('module:generating', (data) => {
    if (data.caseId === caseId.value) {
      externalGenerating.value = data.modules
    }
  })

  // 跨标签页监听：模块对话保存结果后刷新右侧面板全局状态
  let crossTabFetchSeq = 0
  useCrossTabListener('analysis:updated', async (data) => {
    if (data.caseId === caseId.value) {
      const seq = ++crossTabFetchSeq
      const status = await useApiFetch<InitAnalysisStatusResponse>(
        `/api/v1/case/init-analysis-status/${caseId.value}`,
        { query: { sessionId: sessionId.value } },
      )
      if (status && seq === crossTabFetchSeq) {
        statusModules.value = status.modules ?? []
        resultFromDB.value = status.result ?? {}
        completedModules.value = (status.modules ?? [])
          .filter(m => m.status === 'complete')
          .map(m => m.name)
      }
    }
  })

  /** 重置所有内部状态变量（用于 startAnalysis / loadStatus 前置清理） */
  function resetInternalState() {
    prevMessagesLength = 0
    prevStreamLength = 0
    prevLastExecutedModule = ''
    restoredFromCheckpoint = false
    streamStarted = false
    lastBroadcastSignature = ''
  }

  // ==================== useStreamChat ====================

  const stream = useStreamChat<InitAnalysisState>({
    apiUrl: '/api/v1/case/init-analysis',
    threadId: sessionId.value,
    messagesKey: 'messages',
  })

  // stream.interruptData 已在 useStreamChat 内部正确解包（绕过 Vue 响应式 bug）
  const { interruptData } = stream

  // ==================== 模块状态 + 消息分组追踪 ====================

  // 流式结果合并 DB 结果（DB 结果优先，流式结果覆盖）
  const mergedResult = computed(() => ({
    ...resultFromDB.value,
    ...(stream.values.value?.result ?? {}),
  }))

  // 合并 stream.messages（实时流）和 values.messages（重连时从 checkpoint 恢复）
  // 确保页面刷新后左侧消息列表能显示历史消息
  const streamMessages = computed(() => {
    const realtime = stream.messages.value ?? []
    const checkpoint = stream.values.value?.messages ?? []
    // 如果有实时消息（长度 > 0），优先使用实时消息
    if (realtime.length > 0) return realtime
    // 否则使用从 checkpoint 恢复的消息
    if (checkpoint.length > 0) {
      return coerceRawMessages(checkpoint)
    }
    return []
  })

  // 追踪模块状态 + 消息分组
  watch(() => stream.values.value, (v: InitAnalysisState | undefined) => {
    if (!v) return

    const { lastExecutedModule, result, failedModules, selectedModules: mods } = v

    // 只在非 select phase 下接受来自 checkpoint 的 selectedModules
    // 避免补充分析 select 阶段时被 checkpoint 数据污染
    if (mods?.length && phase.value !== 'select') {
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

    // 跨标签页通知：基于签名去重，避免 reconnect 造成的无意义广播循环
    if (caseId.value > 0) {
      const signature = JSON.stringify({
        resultKeys: Object.keys(result ?? {}).sort(),
        failedKeys: Object.keys(failedModules ?? {}).sort(),
        hasInterrupt: Array.isArray(v.__interrupt__) && v.__interrupt__.length > 0,
        selected: [...selectedModules.value].sort(),
      })
      if (signature !== lastBroadcastSignature) {
        lastBroadcastSignature = signature
        postCrossTabEvent('analysis:updated', { caseId: caseId.value })
      }
    }

    // 按模块分组消息
    const allMessages = v.messages
    const currentStreamLength = stream.messages.value?.length ?? 0

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

  // SSE 流关闭时发送最终广播
  // 解决：最后一个模块完成时 values watch 广播，但此时 run 还是 running。
  // SSE 流关闭代表 run 已到达终态（completed/failed），此时再广播一次确保案件详情页拿到正确的 session status。
  watch(() => stream.isLoading.value, (loading, wasLoading) => {
    if (wasLoading && !loading && caseId.value > 0) {
      lastBroadcastSignature = ''
      postCrossTabEvent('analysis:updated', { caseId: caseId.value })
    }
  })

  // ==================== 操作 ====================

  async function loadStatus() {
    // 重置所有内部状态变量，避免上次会话的残留
    resetInternalState()

    const sessionInfo = await useApiFetch<{
      case: { id: number }
      session: { id: number; sessionId: string; status: number }
    }>(`/api/v1/case/session/${sessionId.value}`)

    if (!sessionInfo?.case) {
      isInitialized.value = true
      return
    }
    caseId.value = sessionInfo.case.id

    // 从 session 自身状态推断 phase 兜底值（防止 status API 失败时回退到 select 导致重复分析）
    const sessionStatus = sessionInfo.session?.status
    if (sessionStatus === 2) {
      phase.value = 'complete'
    } else if (sessionStatus === 1) {
      // status=1 可能是 not_started（无 run）或 in_progress，先设为 running 防止误显示 ModuleSelector
      // 后续 status API 成功后会修正为准确值
      phase.value = 'running'
    }

    const status = await useApiFetch<InitAnalysisStatusResponse>(
      `/api/v1/case/init-analysis-status/${caseId.value}`,
      { query: { sessionId: sessionId.value } },
    )

    if (!status) {
      // status API 失败：用 session 状态兜底，尝试 SSE 重连恢复
      if (sessionStatus === 1 || sessionStatus === 2) {
        stream.submit(undefined)
      }
      isInitialized.value = true
      return
    }

    // 保存全局模块状态（跨 session 聚合的 7 个模块，供右侧面板使用）
    statusModules.value = status.modules ?? []

    // 计算已完成模块（整个案件的累积状态，跨 session）
    completedModules.value = (status.modules ?? [])
      .filter(m => m.status === 'complete')
      .map(m => m.name)

    // 从 DB 加载已完成模块的结果（用于右侧面板刷新后恢复）
    if (status.result && Object.keys(status.result).length > 0) {
      resultFromDB.value = status.result
    }

    // not_started: 当前 session 尚未开始（补充分析新 session / 刚创建的 session）
    if (status.status === 'not_started') {
      phase.value = 'select'
      // 默认选中所有未完成的模块
      selectedModules.value = DEFAULT_SELECTED_MODULES.filter(
        name => !completedModules.value.includes(name),
      )
      isInitialized.value = true
      return
    }

    if (status.status === 'in_progress' || status.status === 'completed') {
      phase.value = status.status === 'completed' ? 'complete' : 'running'

      // 从 API 恢复用户原始选中的模块（优先使用 run input 中的记录）
      if (status.selectedModules?.length) {
        selectedModules.value = status.selectedModules
      }

      const restored: Record<string, ModuleRunState> = {}
      for (const m of status.modules) {
        // 只恢复用户选中的模块（避免未选中模块污染状态）
        if (!selectedModules.value.includes(m.name)) continue

        const moduleStatus: ModuleStatus = m.status === 'complete' ? 'complete'
          : m.status === 'failed' ? 'failed'
          : m.status === 'in_progress' ? 'streaming'
          : 'idle'
        restored[m.name] = { name: m.name, status: moduleStatus, content: m.result ?? '' }
      }

      // 分析进行中时，确保有且仅有一个模块是 streaming
      // 串行执行下，第一个非 complete/非 failed 的模块就是当前正在执行的
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

      // 始终重连 SSE（获取完整状态快照，包含 selectedModules 和 messages）
      // 已完成状态也需要重连以加载历史消息（页面刷新后恢复）
      // 使用 undefined 触发纯重连，从 checkpoint 加载历史
      stream.submit(undefined)
    }

    isInitialized.value = true
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
    resetInternalState()
    phase.value = 'running'

    // 重置签名确保后续 values watch 首次触发时一定广播
    // 不在此处同步广播——此时后端还没创建 run，案件详情页查 API 会拿到旧数据
    lastBroadcastSignature = ''

    stream.submit({
      caseId: caseId.value,
      selectedModules: selectedModules.value,
    } as any)
  }

  function resumeWorkflow() {
    // 重置签名确保后续 values watch 首次触发时一定广播
    lastBroadcastSignature = ''

    stream.submit(
      { caseId: caseId.value } as any,
      { command: { resume: { action: 'continue' } } },
    )
  }

  function retryModule(moduleName: string) {
    updateModuleState(moduleName, { status: 'idle', content: '', error: undefined })
    // 重置签名确保后续 values watch 首次触发时一定广播
    lastBroadcastSignature = ''
    stream.submit({
      caseId: caseId.value,
      selectedModules: [moduleName],
    } as any)
  }

  return {
    phase,
    caseId,
    selectedModules,
    completedModules,
    isInitialized,
    moduleStates,
    activeModules,
    allModuleCards,
    isLoading: stream.isLoading,
    interruptData,
    values: stream.values,
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
