/**
 * 小索对话管理 composable
 *
 * 管理小索的多 session 生命周期和对话状态。
 * 在父页面 [id].vue 中调用，通过 props 传递给 CaseDetailXiaosuo 组件。
 *
 * 参考：useModuleChatManager（effectScope 管理、双重取消）
 *       useCaseChat（底层 SSE 流管理）
 */
import type { MaybeRef } from 'vue'

export interface XiaosuoSession {
  sessionId: string
  title: string
  createdAt: string
  updatedAt: string
  hasActiveRun: boolean
}

export function useXiaosuoChat(caseId: MaybeRef<number>) {
  const resolvedCaseId = toRef(caseId)

  // Session 管理状态
  const sessions = ref<XiaosuoSession[]>([])
  const currentSessionId = ref<string | null>(null)
  const isSessionLoading = ref(false)
  const initialized = ref(false)

  // effectScope 管理（参照 useModuleChatManager）
  let currentScope: EffectScope | null = null
  // ⚠️ 必须用 shallowRef，否则 computed 无法追踪 currentChat 的重新赋值
  const currentChat = shallowRef<ReturnType<typeof useCaseChat> | null>(null)

  // 快速切换竞态防护
  let switchCounter = 0

  function disposeCurrentChat() {
    if (currentScope) {
      currentScope.stop()
      currentScope = null
      currentChat.value = null
    }
  }

  // 对话状态代理（通过 shallowRef 追踪 currentChat 变化）
  const messages = computed(() => currentChat.value?.messages.value ?? [])
  const values = computed(() => currentChat.value?.values.value)
  const isLoading = computed(() => currentChat.value?.isLoading.value ?? false)
  const interrupt = computed(() => currentChat.value?.interrupt.value)

  // ── Session CRUD ──

  async function fetchSessions() {
    const result = await useApiFetch<XiaosuoSession[]>(
      `/api/v1/case/analysis/xiaosuo-sessions?caseId=${resolvedCaseId.value}`,
    )
    if (result) {
      sessions.value = result
    }
  }

  async function createSession(title?: string): Promise<string> {
    const result = await useApiFetch<{ sessionId: string; title: string }>(
      '/api/v1/case/analysis/xiaosuo-session',
      { method: 'POST', body: { caseId: resolvedCaseId.value, title } },
    )

    if (!result?.sessionId) {
      throw new Error('创建 session 失败')
    }

    // 加入列表头部
    sessions.value = [
      {
        sessionId: result.sessionId,
        title: result.title,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        hasActiveRun: false,
      },
      ...sessions.value,
    ]

    await switchSession(result.sessionId)
    return result.sessionId
  }

  async function switchSession(sessionId: string) {
    const currentSwitch = ++switchCounter

    disposeCurrentChat()
    currentSessionId.value = sessionId

    // 在新 effectScope 中创建 useCaseChat 实例
    const newScope = effectScope()
    const newChat = newScope.run(() => useCaseChat({ sessionId }))!

    // 竞态检查：如果已被更新的切换取代，清理刚创建的 scope
    if (currentSwitch !== switchCounter) {
      newScope.stop()
      return
    }

    currentScope = newScope
    currentChat.value = newChat

    // 检查是否有活跃 run
    const session = sessions.value.find(s => s.sessionId === sessionId)
    if (session?.hasActiveRun) {
      currentChat.value.reconnect()
    }
    else {
      currentChat.value.loadHistory()
    }
  }

  async function deleteSession(sessionId: string) {
    await useApiFetch(
      `/api/v1/case/analysis/xiaosuo-session/${sessionId}`,
      { method: 'DELETE' },
    )

    // 从列表移除
    sessions.value = sessions.value.filter(s => s.sessionId !== sessionId)

    // 如果删的是当前 session，切换到下一个或创建新的
    if (currentSessionId.value === sessionId) {
      if (sessions.value.length > 0) {
        await switchSession(sessions.value[0].sessionId)
      }
      else {
        await createSession()
      }
    }
  }

  // ── 消息操作 ──

  function sendMessage(text: string, options?: { thinking?: boolean }) {
    currentChat.value?.sendMessage(text, options)
  }

  function resumeInterrupt(data: any) {
    currentChat.value?.resumeInterrupt(data)
  }

  async function stopGeneration() {
    try {
      currentChat.value?.stopGeneration()

      const sid = currentSessionId.value
      if (!sid) return
      const runData = await useApiFetch<{ run: { id: string } | null }>(
        `/api/v1/case/analysis/runs/current/${sid}`,
      )
      if (runData?.run?.id) {
        await useApiFetch(
          `/api/v1/case/analysis/runs/cancel/${runData.run.id}`,
          { method: 'POST' },
        )
      }
    }
    catch (error) {
      console.error('[useXiaosuoChat] 停止生成失败:', error)
    }
  }

  // ── 初始化 ──

  async function init() {
    if (initialized.value) return
    isSessionLoading.value = true

    try {
      await fetchSessions()

      if (sessions.value.length === 0) {
        await createSession()
      }
      else {
        await switchSession(sessions.value[0].sessionId)
      }

      initialized.value = true
    }
    finally {
      isSessionLoading.value = false
    }
  }

  // 页面卸载时清理
  onUnmounted(() => disposeCurrentChat())

  return {
    sessions,
    currentSessionId,
    isSessionLoading,
    messages,
    values,
    isLoading,
    interrupt,
    createSession,
    switchSession,
    deleteSession,
    sendMessage,
    resumeInterrupt,
    stopGeneration,
    init,
  }
}
