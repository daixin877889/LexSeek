// app/composables/useChatSessionManager.ts

/**
 * 多 session 管理基类
 *
 * 封装小索和模块对话共同的多 session 生命周期管理：
 * - effectScope 管理（每 session 独立 scope）
 * - 竞态防护（switchCounter）
 * - hasActiveRun 自动 reconnect / loadHistory
 * - stopGeneration 双重取消（SSE + Worker）
 * - init 幂等保护
 */

import { effectScope } from 'vue'
import type { EffectScope, MaybeRef } from 'vue'

export interface SessionItem {
    sessionId: string
    title: string
    createdAt: string
    updatedAt: string
    hasActiveRun: boolean
}

export interface ChatSessionManagerOptions {
    caseId: MaybeRef<number>
    /** 查询 session 列表 URL */
    listUrl: (caseId: number) => string
    /** 创建 session URL */
    createUrl: string
    /** 删除 session URL */
    deleteUrl: (sessionId: string) => string
    /** 创建 session 时的请求体构造器 */
    buildCreateBody: (caseId: number, title?: string) => Record<string, any>
    /** 自定义事件回调 */
    onCustomEvent?: (data: any) => void
}

export function useChatSessionManager(options: ChatSessionManagerOptions) {
    const resolvedCaseId = toRef(options.caseId)

    const sessions = ref<SessionItem[]>([])
    const currentSessionId = ref<string | null>(null)
    const isSessionLoading = ref(false)
    const initialized = ref(false)

    // effectScope 管理（参照 useXiaosuoChat:31-45）
    let currentScope: EffectScope | null = null
    const currentChat = shallowRef<ReturnType<typeof useCaseChat> | null>(null)
    let switchCounter = 0

    function disposeCurrentChat() {
        if (currentScope) {
            currentScope.stop()
            currentScope = null
            currentChat.value = null
        }
    }

    // 代理当前对话状态
    const messages = computed(() => currentChat.value?.messages.value ?? [])
    const values = computed(() => currentChat.value?.values.value)
    const isLoading = computed(() => currentChat.value?.isLoading.value ?? false)
    const interruptData = computed(() => currentChat.value?.interruptData.value)
    const runStatus = computed(() => currentChat.value?.runStatus.value ?? 'idle')
    const runError = computed(() => currentChat.value?.runError.value ?? '')

    // ── Session CRUD ──

    async function fetchSessions() {
        const result = await useApiFetch<SessionItem[]>(
            options.listUrl(resolvedCaseId.value),
        )
        if (result) {
            sessions.value = result
        }
    }

    async function createSession(title?: string): Promise<string> {
        const result = await useApiFetch<{ sessionId: string; title: string }>(
            options.createUrl,
            {
                method: 'POST',
                body: options.buildCreateBody(resolvedCaseId.value, title),
            },
        )
        if (!result?.sessionId) throw new Error('创建 session 失败')

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

        const newScope = effectScope()
        const newChat = newScope.run(() =>
            useCaseChat({ sessionId, onCustomEvent: options.onCustomEvent }),
        )!

        if (currentSwitch !== switchCounter) {
            newScope.stop()
            return
        }

        currentScope = newScope
        currentChat.value = newChat

        const session = sessions.value.find(s => s.sessionId === sessionId)
        if (session?.hasActiveRun) {
            currentChat.value.reconnect()
        }
        else {
            currentChat.value.loadHistory()
        }
    }

    async function deleteSession(sessionId: string) {
        await useApiFetch(options.deleteUrl(sessionId), { method: 'DELETE' })
        sessions.value = sessions.value.filter(s => s.sessionId !== sessionId)

        if (currentSessionId.value === sessionId) {
            if (sessions.value.length > 0) {
                await switchSession(sessions.value[0]!.sessionId)
            }
            else {
                await createSession()
            }
        }
    }

    async function renameSession(sessionId: string, newTitle: string) {
        await useApiFetch(
            `/api/v1/case/analysis/session/rename/${sessionId}`,
            { method: 'PATCH', body: { title: newTitle } },
        )
        sessions.value = sessions.value.map(s =>
            s.sessionId === sessionId ? { ...s, title: newTitle } : s,
        )
    }

    // ── 消息操作 ──

    function sendMessage(text: string, opts?: { thinking?: boolean }) {
        currentChat.value?.sendMessage(text, opts)
    }

    function resumeInterrupt(data: any) {
        currentChat.value?.resumeInterrupt(data)
    }

    async function stopGeneration() {
        currentChat.value?.stopGeneration()
        const sid = currentSessionId.value
        if (sid) await stopActiveRun(sid)
    }

    // ── 初始化（幂等） ──

    async function init() {
        if (initialized.value) return
        isSessionLoading.value = true

        try {
            await fetchSessions()
            if (sessions.value.length === 0) {
                await createSession()
            }
            else {
                await switchSession(sessions.value[0]!.sessionId)
            }
            initialized.value = true
        }
        finally {
            isSessionLoading.value = false
        }
    }

    onScopeDispose(() => disposeCurrentChat())

    return {
        sessions,
        currentSessionId,
        isSessionLoading,
        messages,
        values,
        isLoading,
        interruptData,
        runStatus,
        runError,
        createSession,
        switchSession,
        deleteSession,
        renameSession,
        sendMessage,
        resumeInterrupt,
        stopGeneration,
        init,
    }
}
