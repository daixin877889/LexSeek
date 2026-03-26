/**
 * 初始化分析 composable
 *
 * 以 sessionId 为核心，直接作为 useStream 的 threadId
 * 通过 stream.messages 获取流式消息，_module 字段区分模块归属
 * 自定义事件（module_start/complete/failed/interrupt）通过 custom event 传递
 *
 * 重要：useStream 返回的 messages/values/interrupt 是 getter（非 Ref），
 * 必须用 computed() 包装才能在模板中响应式更新。
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
  // 每个模块的消息列表（从 stream.messages 中按 _module 分组）
  const moduleMessages = ref<Record<string, any[]>>({})
  // 当前活跃的模块名
  const currentModule = ref<string>('')
  // 中断数据
  const interruptInfo = ref<any>(null)

  const activeModules = computed(() =>
    INIT_ANALYSIS_MODULES.filter(m => selectedModules.value.includes(m.name)),
  )

  function getModuleState(name: string): ModuleRunState {
    return moduleStates.value[name] ?? { name, status: 'idle', content: '' }
  }

  function getModuleMessageList(name: string): any[] {
    return moduleMessages.value[name] ?? []
  }

  function updateModuleState(name: string, patch: Partial<ModuleRunState>) {
    const current = getModuleState(name)
    moduleStates.value = { ...moduleStates.value, [name]: { ...current, ...patch } }
  }

  // useStream 直接用 sessionId 作为 threadId
  const transport = new FetchStreamTransport({
    apiUrl: '/api/v1/case/init-analysis',
  })

  const stream = useStream<any>({
    transport,
    threadId: sessionId.value,
    messagesKey: 'messages',
    onError: (error) => {
      console.error('[useInitAnalysis] 流错误:', error)
    },
  })

  // computed 包装 getter
  const messages = computed(() => stream.messages)
  const values = computed(() => stream.values)
  const interrupt = computed(() => stream.interrupt)
  const isLoading = computed(() => stream.isLoading?.value ?? false)

  // 监听 messages 变化，按 _module 字段分组消息
  watch(messages, (msgs: any) => {
    if (!Array.isArray(msgs) || msgs.length === 0) return

    const grouped: Record<string, any[]> = {}

    for (const msg of msgs) {
      // 从消息的附加数据中提取 _module 标记
      const mod = (msg as any)?._module
        ?? (msg as any)?.additional_kwargs?._module
        ?? (msg as any)?.response_metadata?._module
      if (!mod) continue

      if (!grouped[mod]) grouped[mod] = []
      grouped[mod].push(msg)
    }

    // 合并到已有的 moduleMessages 中
    moduleMessages.value = { ...moduleMessages.value, ...grouped }

    // 更新 streaming 状态的模块内容（从最后一条 AI 消息提取文本）
    for (const [modName, modMsgs] of Object.entries(grouped)) {
      const lastAI = [...modMsgs].reverse().find((m: any) =>
        AIMessage.isInstance(m) || m.type === 'ai' || m.role === 'assistant',
      )
      if (lastAI) {
        const content = typeof lastAI.content === 'string'
          ? lastAI.content
          : Array.isArray(lastAI.content)
            ? lastAI.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('')
            : lastAI.text ?? ''

        if (content && getModuleState(modName).status === 'streaming') {
          updateModuleState(modName, { content })
        }
      }
    }
  }, { deep: true })

  // 监听 values 中的自定义事件（_custom 标记的事件）
  watch(values, (v: any) => {
    if (!v) return

    // 检查是否有自定义事件数据
    if (v._custom && v._type) {
      handleCustomEvent(v._type, v)
    }
  }, { deep: true })

  function handleCustomEvent(type: string, data: any) {
    switch (type) {
      case 'module_start':
        currentModule.value = data.module
        updateModuleState(data.module, { status: 'streaming', content: '' })
        break

      case 'module_complete':
        updateModuleState(data.module, { status: 'complete' })
        break

      case 'module_failed':
        updateModuleState(data.module, {
          status: 'failed',
          error: data.error ?? '模块执行失败',
        })
        break

      case 'interrupt':
        interruptInfo.value = data
        if (data.module) {
          updateModuleState(data.module, { status: 'idle' })
        }
        break

      case 'analysis_complete':
        phase.value = 'complete'
        break
    }
  }

  // 加载已有状态（页面刷新恢复）
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
        restored[m.name] = {
          name: m.name,
          status: moduleStatus,
          content: m.result ?? '',
        }
      }
      moduleStates.value = restored

      // 进行中则重连
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
    moduleMessages.value = {}
    interruptInfo.value = null
    phase.value = 'running'

    stream.submit({
      caseId: caseId.value,
      selectedModules: selectedModules.value,
    } as any)
  }

  // 恢复工作流（积分不足购买后）
  function resumeWorkflow() {
    interruptInfo.value = null
    stream.submit(
      { caseId: caseId.value, selectedModules: selectedModules.value } as any,
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
    interrupt: interruptInfo,
    currentModule,
    getModuleState,
    getModuleMessageList,
    loadStatus,
    startAnalysis,
    resumeWorkflow,
    retryModule,
  }
}
