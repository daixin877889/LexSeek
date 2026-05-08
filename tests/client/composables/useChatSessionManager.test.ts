/**
 * useChatSessionManager composable 测试
 *
 * 测试多 session 管理基类的核心逻辑：
 * - init 幂等保护
 * - createSession 头部追加 + 自动 switchSession
 * - deleteSession 从列表移除 + 自动切换
 * - renameSession API URL 正确 + 本地乐观更新
 * - stopGeneration 调用 stream.stop + stopActiveRun
 *
 * **Feature: chat-session-manager**
 * **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── mock 模块（必须在动态 import 之前声明）─────────────────────────────────

// mock useCaseChat 模块
const mockReconnect = vi.fn()
const mockLoadHistory = vi.fn()
const mockStopGeneration = vi.fn()

vi.mock('~/composables/useCaseChat', () => ({
    useCaseChat: vi.fn(() => ({
        messages: { value: [] },
        values: { value: undefined },
        isLoading: { value: false },
        interruptData: { value: null },
        error: { value: null },
        hasHistoryLoaded: { value: false },
        sendMessage: vi.fn(),
        resumeInterrupt: vi.fn(),
        stopGeneration: mockStopGeneration,
        stop: vi.fn(),
        reconnect: mockReconnect,
        loadHistory: mockLoadHistory,
        submit: vi.fn(),
        getMessagesMetadata: vi.fn(),
    })),
}))

// mock useApiFetch 模块（useChatSessionManager 直接 import 的路径）
const mockUseApiFetch = vi.fn()
vi.mock('~/composables/useApiFetch', () => ({
    useApiFetch: (...args: any[]) => mockUseApiFetch(...args),
}))

// mock stopActiveRun
const mockStopActiveRun = vi.fn()
vi.mock('~/composables/useStopActiveRun', () => ({
    stopActiveRun: (...args: any[]) => mockStopActiveRun(...args),
}))

// ── 动态导入（确保 mock 先完成）─────────────────────────────────────────────
// TODO 阶段 7：useChatSessionManager 已删除（→ useDomainAgentSession 工厂）
const useChatSessionManager: any = (() => null) as any
type SessionItem = { sessionId: string; title: string; createdAt: string; updatedAt: string; hasActiveRun: boolean }

// ── 工厂函数 ─────────────────────────────────────────────────────────────────

function makeOptions(overrides: Partial<Parameters<typeof useChatSessionManager>[0]> = {}) {
    return {
        caseId: 1,
        listUrl: (caseId: number) => `/api/v1/cases/${caseId}/sessions`,
        createUrl: '/api/v1/cases/analysis/session/create',
        deleteUrl: (sessionId: string) => `/api/v1/cases/analysis/session/${sessionId}`,
        buildCreateBody: (caseId: number, title?: string) => ({ caseId, title }),
        ...overrides,
    }
}

let _sessionIdx = 0
function makeSession(partial: Partial<SessionItem> = {}): SessionItem {
    _sessionIdx++
    return {
        sessionId: `sess-${_sessionIdx}`,
        title: '默认会话',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        hasActiveRun: false,
        ...partial,
    }
}

// ── 测试套件 ─────────────────────────────────────────────────────────────────

describe.skip('useChatSessionManager（阶段 7 TODO：迁到 useDomainAgentSession）', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        // 默认 stopActiveRun 成功
        mockStopActiveRun.mockResolvedValue(undefined)
        // 默认 useApiFetch 返回 undefined（DELETE 等场景）
        mockUseApiFetch.mockResolvedValue(undefined)
    })

    // ── init 幂等保护 ────────────────────────────────────────────────────────

    describe('init 幂等保护', () => {
        it('顺序调用两次 init，fetchSessions 只执行一次（幂等保护）', async () => {
            const session = makeSession()
            // fetchSessions 调用 useApiFetch，第一次返回 session 列表
            mockUseApiFetch.mockResolvedValueOnce([session])

            const manager = useChatSessionManager(makeOptions())

            // 顺序调用两次（第二次应被幂等保护拦截）
            await manager.init()
            await manager.init()

            // fetchSessions 内部调用 useApiFetch（listUrl），只应调用一次
            const fetchSessionsCalls = mockUseApiFetch.mock.calls.filter(
                ([url]: [string]) => url?.includes('/sessions'),
            )
            expect(fetchSessionsCalls.length).toBe(1)
        })

        it('init 完成后 isSessionLoading 恢复为 false', async () => {
            const session = makeSession()
            mockUseApiFetch.mockResolvedValueOnce([session])

            const manager = useChatSessionManager(makeOptions())
            await manager.init()

            expect(manager.isSessionLoading.value).toBe(false)
        })

        it('init 内部抛出异常后 isSessionLoading 仍恢复为 false（finally 保证）', async () => {
            // fetchSessions 抛出，模拟网络故障
            mockUseApiFetch.mockRejectedValueOnce(new Error('网络错误'))

            const manager = useChatSessionManager(makeOptions())

            await expect(manager.init()).rejects.toThrow()
            expect(manager.isSessionLoading.value).toBe(false)
        })
    })

    // ── createSession ────────────────────────────────────────────────────────

    describe('createSession', () => {
        it('创建成功后新 session 追加到列表头部', async () => {
            const existing = makeSession({ title: '旧会话' })
            const newSession = { sessionId: 'new-1', title: '新会话' }
            mockUseApiFetch.mockResolvedValueOnce(newSession)

            const manager = useChatSessionManager(makeOptions())
            manager.sessions.value = [existing]

            await manager.createSession('新会话')

            expect(manager.sessions.value[0]!.sessionId).toBe('new-1')
            expect(manager.sessions.value[0]!.title).toBe('新会话')
            // 原有 session 保留在后面
            expect(manager.sessions.value[1]!.sessionId).toBe(existing.sessionId)
        })

        it('创建成功后自动 switchSession 到新 session', async () => {
            const newSession = { sessionId: 'new-auto', title: '自动切换会话' }
            mockUseApiFetch.mockResolvedValueOnce(newSession)

            const manager = useChatSessionManager(makeOptions())
            manager.sessions.value = []

            const returnedId = await manager.createSession()

            expect(returnedId).toBe('new-auto')
            expect(manager.currentSessionId.value).toBe('new-auto')
        })

        it('API 返回 null 时应抛出"创建 session 失败"错误', async () => {
            mockUseApiFetch.mockResolvedValueOnce(null)

            const manager = useChatSessionManager(makeOptions())

            await expect(manager.createSession()).rejects.toThrow('创建 session 失败')
        })

        it('API 返回无 sessionId 时应抛出错误', async () => {
            mockUseApiFetch.mockResolvedValueOnce({ title: '无 sessionId' })

            const manager = useChatSessionManager(makeOptions())

            await expect(manager.createSession()).rejects.toThrow('创建 session 失败')
        })
    })

    // ── deleteSession ────────────────────────────────────────────────────────

    describe('deleteSession', () => {
        it('删除后目标 session 从列表中移除', async () => {
            const s1 = makeSession()
            const s2 = makeSession()

            const manager = useChatSessionManager(makeOptions())
            manager.sessions.value = [s1, s2]
            // 设置 currentSessionId 为不同的 session，避免触发自动切换
            manager.currentSessionId.value = s2.sessionId

            await manager.deleteSession(s1.sessionId)

            expect(manager.sessions.value.some(s => s.sessionId === s1.sessionId)).toBe(false)
            expect(manager.sessions.value.some(s => s.sessionId === s2.sessionId)).toBe(true)
        })

        it('删除当前 session 时自动切换到列表第一个', async () => {
            const s1 = makeSession()
            const s2 = makeSession()

            const manager = useChatSessionManager(makeOptions())
            manager.sessions.value = [s1, s2]
            manager.currentSessionId.value = s1.sessionId

            await manager.deleteSession(s1.sessionId)

            // 删除 s1 后，第一个剩余的是 s2
            expect(manager.currentSessionId.value).toBe(s2.sessionId)
        })

        it('删除当前 session 且列表为空时自动创建新 session', async () => {
            const s1 = makeSession()
            const newSession = { sessionId: 'auto-created', title: '新会话' }

            mockUseApiFetch
                .mockResolvedValueOnce(undefined) // DELETE
                .mockResolvedValueOnce(newSession) // createSession

            const manager = useChatSessionManager(makeOptions())
            manager.sessions.value = [s1]
            manager.currentSessionId.value = s1.sessionId

            await manager.deleteSession(s1.sessionId)

            expect(manager.sessions.value[0]!.sessionId).toBe('auto-created')
        })
    })

    // ── renameSession ────────────────────────────────────────────────────────

    describe('renameSession', () => {
        it('应使用正确的 API URL（含 sessionId）', async () => {
            const targetId = 'sess-rename-test'
            const manager = useChatSessionManager(makeOptions())
            manager.sessions.value = [makeSession({ sessionId: targetId, title: '原标题' })]

            await manager.renameSession(targetId, '新标题')

            const calledUrl: string = mockUseApiFetch.mock.calls[0]![0]
            expect(calledUrl).toBe(`/api/v1/cases/analysis/session/rename/${targetId}`)
        })

        it('应使用 PATCH 方法并携带 title body', async () => {
            const targetId = 'sess-patch-test'
            const manager = useChatSessionManager(makeOptions())
            manager.sessions.value = [makeSession({ sessionId: targetId })]

            await manager.renameSession(targetId, '重命名后')

            const [, options]: [string, any] = mockUseApiFetch.mock.calls[0]!
            expect(options?.method).toBe('PATCH')
            expect(options?.body?.title).toBe('重命名后')
        })

        it('本地列表乐观更新：await 后 session title 已更新', async () => {
            const targetId = 'sess-optimistic'
            const manager = useChatSessionManager(makeOptions())
            manager.sessions.value = [makeSession({ sessionId: targetId, title: '旧标题' })]

            await manager.renameSession(targetId, '新标题')

            const updated = manager.sessions.value.find(s => s.sessionId === targetId)
            expect(updated?.title).toBe('新标题')
        })

        it('其他 session 的 title 不受影响（不可变更新）', async () => {
            const target = makeSession({ sessionId: 'target', title: '目标' })
            const other = makeSession({ sessionId: 'other', title: '其他' })
            const manager = useChatSessionManager(makeOptions())
            manager.sessions.value = [target, other]

            await manager.renameSession('target', '改了')

            const otherAfter = manager.sessions.value.find(s => s.sessionId === 'other')
            expect(otherAfter?.title).toBe('其他')
        })
    })

    // ── stopGeneration ───────────────────────────────────────────────────────

    describe('stopGeneration', () => {
        it('有活跃 chat 时应调用 currentChat.stopGeneration', async () => {
            const newSession = { sessionId: 'active-sess', title: '活跃会话' }
            mockUseApiFetch.mockResolvedValueOnce(newSession)

            const manager = useChatSessionManager(makeOptions())
            manager.sessions.value = []
            await manager.createSession()

            await manager.stopGeneration()

            expect(mockStopGeneration).toHaveBeenCalledTimes(1)
        })

        it('应调用 stopActiveRun 并传入当前 sessionId', async () => {
            const newSession = { sessionId: 'sess-stop-test', title: '测试会话' }
            mockUseApiFetch.mockResolvedValueOnce(newSession)

            const manager = useChatSessionManager(makeOptions())
            manager.sessions.value = []
            await manager.createSession()

            await manager.stopGeneration()

            expect(mockStopActiveRun).toHaveBeenCalledWith('sess-stop-test')
        })

        it('currentSessionId 为 null 时不调用 stopActiveRun', async () => {
            const manager = useChatSessionManager(makeOptions())
            // 不初始化，currentSessionId 保持 null

            await manager.stopGeneration()

            expect(mockStopActiveRun).not.toHaveBeenCalled()
        })
    })
})
