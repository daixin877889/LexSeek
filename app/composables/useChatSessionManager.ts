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
 * - 消息队列（per-session FIFO）与跨标签同步
 */

import { effectScope } from 'vue'
import type { EffectScope, MaybeRef } from 'vue'
import { nanoid } from 'nanoid'
import {
    // 只 import 纯函数层需要在 manager 中直接使用的 enqueueAction；
    // removeAction / clearAction 不在 manager 层使用——它们返回完整新 Map，
    // 而 manager 的 reactive(Map) 只需 .set(sid, filteredArr) 触发响应式。
    // Phase 1 的两个函数保留作为纯逻辑单元测试用途，manager 层的
    // removeQueueItem / clearQueue 直接用 filter/set 已满足 spec §8.3 的
    // immutable 更新规则（spread 新数组 + reactive Map.set 而非 push mutate）。
    enqueueAction,
    type QueueItem,
    type QueuePauseReason,
} from './chatQueueActions'
import { postCrossTabEvent, useCrossTabListener } from './useCrossTabEvents'
import { useQueueDispatcher } from './useQueueDispatcher'

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
    // ⚠️ 使用双重可选链 `?.x?.value` 防御 mock chat 实例字段缺失场景
    const messages = computed(() => currentChat.value?.messages?.value ?? [])
    const values = computed(() => currentChat.value?.values?.value)
    const isLoading = computed(() => currentChat.value?.isLoading?.value ?? false)
    const interruptData = computed(() => currentChat.value?.interruptData?.value)
    const runStatus = computed(() => currentChat.value?.runStatus?.value ?? 'idle')
    const runError = computed(() => currentChat.value?.runError?.value ?? '')

    // ── 队列状态（per-session 隔离） ──
    // 使用 reactive(Map) 走 Vue 3 CollectionHandlers，.set / .delete 自动触发响应（spec §8.3）
    const queuesBySession = reactive(new Map<string, QueueItem[]>())
    const queuePausedBy = reactive(new Map<string, Exclude<QueuePauseReason, null>>())
    // 本 tab 本地发送过的累计次数，每次 sendMessage 前 ++
    // 供 dispatcher 的溯源守卫识别"本 tab 主动发起" vs "reconnect 重放"
    const lastLocalSendSeq = ref(0)
    // 跨 tab 过期广播过滤：记录每个 session 最近一次应用的 version
    const lastAppliedVersion = new Map<string, number>()

    // tabId 仅在客户端同步生成：用普通闭包而非 useState 天然每次调用独占一份，不存在
    // spec §5.7 担心的跨 tab 共享问题；不能走 onMounted —— 本 composable 也会被
    // useModuleChatManager 通过 scope.run 在异步回调中调用，此时无 component instance，
    // onMounted 会报警且回调不会触发，导致 tabId 永远为空、跨 tab 回声过滤失效。
    let tabId = ''
    if (import.meta.client) {
        tabId = nanoid()
    }

    // ── 派生 computed ──
    const currentQueue = computed<QueueItem[]>(() => {
        const sid = currentSessionId.value
        if (!sid) return []
        return queuesBySession.get(sid) ?? []
    })

    const currentQueueLen = computed(() => currentQueue.value.length)

    const isQueuePaused = computed(() => {
        const sid = currentSessionId.value
        if (!sid) return false
        // 宽松比较：null 或 undefined 都视为非暂停（spec §5.1）
        return queuePausedBy.get(sid) != null
    })

    const queuePauseReason = computed<QueuePauseReason>(() => {
        const sid = currentSessionId.value
        if (!sid) return null
        return queuePausedBy.get(sid) ?? null
    })

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
        // 删除前先取消 session 里可能正在跑的 run，避免后端出现孤儿 agentRun
        // 幂等：若无活跃 run 或 run 已 terminal，stopActiveRun 直接成功
        // 失败也不阻塞删除流程（用户意图是"删掉这个 session"）
        await stopActiveRun(sessionId).catch(() => { /* 忽略 */ })

        await useApiFetch(options.deleteUrl(sessionId), { method: 'DELETE' })

        // 顺序（spec §5.5 表格 + §8.1 场景 #4）：
        // ①delete API → ②清理队列 Map → ③广播空队列 → ④移除 sessions 数组 → ⑤switchSession
        // ②+③ 必须在 ⑤ switchSession 之前，避免切走后其他 tab 仍看到旧队列
        queuesBySession.delete(sessionId)
        queuePausedBy.delete(sessionId)
        lastAppliedVersion.delete(sessionId)
        // 通知其他 tab 清理（payload 为空队列 + 非暂停）
        postCrossTabEvent('chat-queue:sync', {
            sessionId,
            tabId,
            queue: [],
            pauseReason: null,
            version: performance.now() + Math.random(),
        })

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

    function sendMessage(text: string, opts?: { thinking?: boolean }): Promise<void> | undefined {
        // 用户直接发送路径：自增 seq，供 dispatcher 的溯源守卫识别
        // （dispatcher 的 doDispatch 内也要 ++，因其直接调 currentChat.sendMessage 绕过本 wrapper）
        lastLocalSendSeq.value++
        // 透传 sendMessage 的 Promise，UI 层可按需 await（通常不需要）；
        // dispatcher 走 currentChat.sendMessage 直接拿 Promise，不经过本 wrapper
        return currentChat.value?.sendMessage(text, opts)
    }

    // ── 队列操作 API ──

    /**
     * 入队一条消息；返回 false 表示队列已满
     */
    function enqueueMessage(text: string, files?: any[], thinking = false): boolean {
        const sid = currentSessionId.value
        if (!sid) return false
        const item: QueueItem = {
            id: nanoid(),
            text,
            files,
            thinking,
            enqueuedAt: Date.now(),
        }
        const snapshot = new Map(queuesBySession) as Map<string, QueueItem[]>
        const { next, ok } = enqueueAction(snapshot, sid, item)
        if (ok) {
            // reactive Map 的 set 触发响应式
            queuesBySession.set(sid, next.get(sid)!)
            dispatcher.broadcastState(sid)
        }
        return ok
    }

    /**
     * 按 id 删除队列条目；删除后若队列变空自动清除暂停标记（死锁防护）
     */
    function removeQueueItem(itemId: string) {
        const sid = currentSessionId.value
        if (!sid) return
        const current = queuesBySession.get(sid) ?? []
        const nextList = current.filter(i => i.id !== itemId)
        queuesBySession.set(sid, nextList)
        // 死锁防护：队列变空时自动清除暂停标记（spec §5.3 / §8.1 #17）
        if (nextList.length === 0) queuePausedBy.delete(sid)
        dispatcher.broadcastState(sid)
    }

    /**
     * 清空当前 session 队列 + 清除暂停标记
     */
    function clearQueue() {
        const sid = currentSessionId.value
        if (!sid) return
        queuesBySession.set(sid, [])
        queuePausedBy.delete(sid)
        dispatcher.broadcastState(sid)
    }

    /**
     * 恢复队列：清除暂停标记 + 主动触发一次派发尝试
     *
     * 关于"绕过 seq 守卫"的精确语义（spec §5.4）：
     * - seq 守卫仅存在于 watch(runStatus) 回调内，maybeDispatch 入口本身不读 seq。
     * - 手动调 maybeDispatch 在结构上就不经过 seq 守卫，无需特殊设计。
     * - 这条路径仍受 maybeDispatch 的 6 个常规守卫保护。
     * - 支持"tab B 继承 tab A 暂停队列后手动恢复"的跨 tab 接管场景。
     * - 跨 tab 同时 resume 的双发风险由 Web Lock 防御。
     */
    function resumeQueue() {
        const sid = currentSessionId.value
        if (!sid) return
        queuePausedBy.delete(sid)
        dispatcher.broadcastState(sid)
        dispatcher.maybeDispatch()
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

    // ── 派发器实例化（必须在 setup 顶层，不进 switchSession 的 inner scope） ──
    // 理由：dispatcher 内部 watch(runStatus) 必须与 manager 的 setup scope 同生命周期，
    // 若挂在 switchSession 的 inner effectScope 内，session 切换时会 dispose watcher，
    // 导致切到新 session 后 dispatcher 不再工作（spec §5.2 要点）
    const dispatcher = useQueueDispatcher({
        currentSessionId,
        currentChat,
        runStatus,
        isLoading,
        interruptData,
        queuesBySession: queuesBySession as unknown as Map<string, QueueItem[]>,
        queuePausedBy: queuePausedBy as unknown as Map<string, Exclude<QueuePauseReason, null>>,
        get tabId() { return tabId },  // getter：SSR 环境下 tabId 为空，getter 便于统一读取
        lastLocalSendSeq,
    })

    // ── 跨标签 listener（接收方严格遵守"只写本地 Map，绝不二次广播"约束） ──
    useCrossTabListener('chat-queue:sync', (payload) => {
        // 守卫 1：忽略自己广播的 echo
        if (payload.tabId === tabId) return
        // 守卫 2：忽略过期广播（version 小于等于已应用的）
        const sid = payload.sessionId
        const lastV = lastAppliedVersion.get(sid) ?? 0
        if (payload.version <= lastV) return
        lastAppliedVersion.set(sid, payload.version)

        // 应用到本地 Map（⚠️ 绝对不能调用 broadcastState，避免广播风暴）
        queuesBySession.set(sid, payload.queue)
        if (payload.pauseReason === null) queuePausedBy.delete(sid)
        else queuePausedBy.set(sid, payload.pauseReason)
    })

    useCrossTabListener('chat-queue:hello', (payload) => {
        if (payload.tabId === tabId) return
        const sid = payload.sessionId
        // 仅当本 tab 持有该 session 的队列状态时回应
        if (queuesBySession.has(sid) || queuePausedBy.has(sid)) {
            postCrossTabEvent('chat-queue:sync', {
                sessionId: sid,
                tabId,
                queue: queuesBySession.get(sid) ?? [],
                pauseReason: queuePausedBy.get(sid) ?? null,
                version: performance.now() + Math.random(),
            })
        }
    })

    // ── hello 广播：等 session 首次就绪后再发 ──
    // 客户端下 tabId 已在 setup 顶层同步生成，SSR 下保持空串；用 watch 响应式触发：
    // 首次 currentSessionId 从 null/undefined → 有值时发一次 hello。
    // 后续 switchSession 不重发（hello 语义是"本 tab 新加入该 session 集合"，而非"session 切换"）。
    const helloSent = new Set<string>()
    watch(
        currentSessionId,
        (sid) => {
            if (!sid || !tabId) return
            if (helloSent.has(sid)) return
            helloSent.add(sid)
            postCrossTabEvent('chat-queue:hello', { sessionId: sid, tabId })
        },
        { immediate: false },
    )

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
        // 队列相关 API（spec §4.4）
        currentQueue,
        currentQueueLen,
        isQueuePaused,
        queuePauseReason,
        enqueueMessage,
        removeQueueItem,
        clearQueue,
        resumeQueue,
    }
}
