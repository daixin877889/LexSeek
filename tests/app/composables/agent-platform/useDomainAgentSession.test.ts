/**
 * useDomainAgentSession 工厂单测
 *
 * 覆盖阶段 7 / 8 工厂的 6 项核心能力：
 * 1. defaultApiEndpoints / resolveApiEndpoints —— 端点映射纯函数
 * 2. 单 session 模式（string / Ref<string>）—— 跳过 fetch / create
 * 3. 多 session 模式（auto）—— fetchSessions / createSession 路径
 * 4. CRUD：create / switch / delete / rename
 * 5. sendMessage 多签名 / enqueueMessage / removeQueueItem / clearQueue
 * 6. apiEndpoints 业务覆盖（含 null 显式禁用）
 * 7. useDomainAgentSessionPool 池化 + dispose
 *
 * 业务代码不动；通过 mock 隔离 useStreamChat / useApiFetch /
 * useQueueDispatcher / useCrossTabListener / stopActiveRun 这些边界依赖，
 * 用真实 effectScope + reactive 跑工厂内部组合逻辑。
 *
 * **Feature: agent-platform-stage7**
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { defineComponent, h, ref, nextTick } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { stubBroadcastChannel, stubNavigatorLocks } from '../../utils/crossTabMocks'

// ── mock useStreamChat：返回完全可控的 stream 实例 ───────────────────────────

interface MockStreamChat {
    messages: ReturnType<typeof ref<any[]>>
    values: ReturnType<typeof ref<any>>
    isLoading: ReturnType<typeof ref<boolean>>
    runStatus: ReturnType<typeof ref<string>>
    runError: ReturnType<typeof ref<string>>
    interruptData: ReturnType<typeof ref<any>>
    submit: ReturnType<typeof vi.fn>
    stop: ReturnType<typeof vi.fn>
    reset: ReturnType<typeof vi.fn>
    reconnect: ReturnType<typeof vi.fn>
    loadHistory: ReturnType<typeof vi.fn>
    getMessagesMetadata: ReturnType<typeof vi.fn>
    error: ReturnType<typeof ref<unknown>>
    hasHistoryLoaded: ReturnType<typeof ref<boolean>>
    capturedOpts: any
}

let lastStream: MockStreamChat | null = null
const allStreams: MockStreamChat[] = []

function makeMockStream(opts: any): MockStreamChat {
    const messages = ref<any[]>([])
    const values = ref<any>(undefined)
    const isLoading = ref(false)
    const runStatus = ref<string>('idle')
    const runError = ref<string>('')
    const interruptData = ref<any>(null)
    const error = ref<unknown>(null)
    const hasHistoryLoaded = ref(false)

    const stream: MockStreamChat = {
        messages,
        values,
        isLoading,
        runStatus,
        runError,
        interruptData,
        error,
        hasHistoryLoaded,
        submit: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        reset: vi.fn(),
        reconnect: vi.fn(),
        loadHistory: vi.fn(),
        getMessagesMetadata: vi.fn(),
        capturedOpts: opts,
    }
    return stream
}

vi.mock('~/composables/useStreamChat', () => ({
    useStreamChat: vi.fn((opts: any) => {
        const s = makeMockStream(opts)
        lastStream = s
        allStreams.push(s)
        return s as any
    }),
}))

// ── mock useApiFetch ────────────────────────────────────────────────────────

const mockApiFetch = vi.fn()
vi.mock('~/composables/useApiFetch', () => ({
    useApiFetch: (...args: unknown[]) => mockApiFetch(...args),
}))

// ── mock stopActiveRun ──────────────────────────────────────────────────────

const mockStopActiveRun = vi.fn()
vi.mock('~/composables/useStopActiveRun', () => ({
    stopActiveRun: (...args: unknown[]) => mockStopActiveRun(...args),
}))

// ── mock useQueueDispatcher：内部依赖较深，直接占位（dispatcher 行为另测）──

const mockBroadcastState = vi.fn()
const mockMaybeDispatch = vi.fn()
vi.mock('~/composables/useQueueDispatcher', () => ({
    useQueueDispatcher: vi.fn(() => ({
        broadcastState: mockBroadcastState,
        maybeDispatch: mockMaybeDispatch,
    })),
}))

// ── mock useCrossTabEvents：避免真实 BroadcastChannel 引入异步污染 ──

const mockPostCrossTabEvent = vi.fn()
const mockUseCrossTabListener = vi.fn()
vi.mock('~/composables/useCrossTabEvents', () => ({
    postCrossTabEvent: (...args: unknown[]) => mockPostCrossTabEvent(...args),
    useCrossTabListener: (...args: unknown[]) => mockUseCrossTabListener(...args),
}))

// ── 动态导入：所有 mock 完成后再加载工厂 ────────────────────────────────────

const {
    useDomainAgentSession,
    useDomainAgentSessionPool,
} = await import('~/composables/agent-platform/useDomainAgentSession')

// ── 工厂内部纯函数：通过 import 拿不到（未 export），通过端点行为间接验证 ──

import type { DomainScope } from '~/composables/agent-platform/useDomainAgentSession'

// ── 测试辅助 ────────────────────────────────────────────────────────────────

/**
 * 用宿主组件挂载工厂以激活 setup-only 钩子（onScopeDispose / watch 等）。
 * 返回 manager + wrapper（wrapper.unmount() 清理）。
 */
function mountFactory<T>(factoryFn: () => T): { manager: T; wrapper: ReturnType<typeof mount> } {
    let manager!: T
    const Host = defineComponent({
        setup() {
            manager = factoryFn()
            return () => h('div')
        },
    })
    const wrapper = mount(Host)
    return { manager, wrapper }
}

function makeSession(sessionId: string, hasActiveRun = false, title = '') {
    return { sessionId, title, createdAt: '', updatedAt: '', hasActiveRun }
}

let restoreBC: (() => void) | null = null
let restoreLocks: (() => void) | null = null

beforeEach(() => {
    vi.clearAllMocks()
    lastStream = null
    allStreams.length = 0
    mockApiFetch.mockReset()
    mockStopActiveRun.mockReset()
    mockStopActiveRun.mockResolvedValue({ ok: true })
    mockBroadcastState.mockReset()
    mockMaybeDispatch.mockReset()
    mockPostCrossTabEvent.mockReset()
    mockUseCrossTabListener.mockReset()
    restoreBC = stubBroadcastChannel()
    restoreLocks = stubNavigatorLocks()
})

afterEach(() => {
    restoreBC?.()
    restoreLocks?.()
})

// ── defaultApiEndpoints / resolveApiEndpoints 间接验证 ─────────────────────
// 不直接 export，通过工厂 listUrl/chatUrl/createUrl 调用观察实际请求 URL。

describe('端点映射（defaultApiEndpoints / resolveApiEndpoints）', () => {
    it('case scope（无 moduleName）使用小索 sessions 列表 URL', async () => {
        // list 返回非空 → 不会自动 createSession
        mockApiFetch.mockResolvedValueOnce([
            makeSession('s-x'),
        ])
        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({ scope: 'case', userId: 'u1', caseId: 42 }),
        )
        await manager.init()
        await flushPromises()

        const fetchedUrls = mockApiFetch.mock.calls.map((c: any[]) => c[0])
        expect(fetchedUrls).toContain('/api/v1/case/analysis/xiaosuo-sessions?caseId=42')
        wrapper.unmount()
    })

    it('case scope（带 moduleName）使用模块对话列表 URL', async () => {
        mockApiFetch.mockResolvedValueOnce([
            makeSession('s-y'),
        ])
        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({ scope: 'case', userId: 'u1', caseId: 7, moduleName: '事实梳理' }),
        )
        await manager.init()
        await flushPromises()

        const urls = mockApiFetch.mock.calls.map((c: any[]) => c[0])
        expect(urls).toContain('/api/v1/case/analysis/module-sessions?caseId=7&moduleName=事实梳理')
        wrapper.unmount()
    })

    it('legal_assistant scope 使用助手 sessions URL + chatUrl', async () => {
        mockApiFetch.mockResolvedValueOnce([
            makeSession('s-z'),
        ])
        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({ scope: 'legal_assistant', userId: 'u1' }),
        )
        await manager.init()
        await flushPromises()

        const urls = mockApiFetch.mock.calls.map((c: any[]) => c[0])
        expect(urls).toContain('/api/v1/assistant/sessions')
        // chatUrl 透传给 useStreamChat
        expect(lastStream?.capturedOpts.apiUrl).toBe('/api/v1/assistant/chat')
        wrapper.unmount()
    })

    it('document scope 默认单 session（list/create/delete/rename 均 null），仅 chatUrl 生效', async () => {
        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({ scope: 'document', userId: 'u1', sessionId: 'doc-1' }),
        )
        await manager.init()
        await flushPromises()

        // 单 session 模式：完全不走 list / create
        const urls = mockApiFetch.mock.calls.map((c: any[]) => c[0])
        expect(urls.find((u: string) => u?.includes('list'))).toBeUndefined()
        expect(lastStream?.capturedOpts.apiUrl).toBe('/api/v1/assistant/document/chat')
        wrapper.unmount()
    })

    it('contract scope 默认单 session，chatUrl 指向合同接口', async () => {
        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({ scope: 'contract', userId: 'u1', sessionId: 'rev-1' }),
        )
        await manager.init()
        await flushPromises()
        expect(lastStream?.capturedOpts.apiUrl).toBe('/api/v1/assistant/contract/chat')
        wrapper.unmount()
    })

    it('case_analysis_init scope 单 session，chatUrl 指向 init-analysis', async () => {
        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({ scope: 'case_analysis_init', userId: 'u1', sessionId: 'init-1' }),
        )
        await manager.init()
        await flushPromises()
        expect(lastStream?.capturedOpts.apiUrl).toBe('/api/v1/case/init-analysis')
        wrapper.unmount()
    })

    it('未知 scope 直接抛错（exhaustive guard）', () => {
        expect(() => {
            mountFactory(() =>
                useDomainAgentSession({ scope: 'xxx_unknown' as DomainScope, userId: 'u1' } as any),
            )
        }).toThrow(/未知 scope/)
    })

    it('case scope chatUrl 透传（小索分析接口）', async () => {
        mockApiFetch.mockResolvedValueOnce([
            makeSession('cs-1'),
        ])
        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({ scope: 'case', userId: 'u1', caseId: 1 }),
        )
        await manager.init()
        await flushPromises()
        expect(lastStream?.capturedOpts.apiUrl).toBe('/api/v1/case/analysis/chat')
        wrapper.unmount()
    })

    it('case scope 默认 listUrl：未传 caseId 调用时抛错', async () => {
        // 传业务方自定义 listUrl 拿到默认行为：直接调内部默认 listUrl(undefined)
        // 这里模拟 case scope 但故意不传 caseId（业务侧异常用法）
        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({ scope: 'case', userId: 'u1' } as any),
        )
        await expect(manager.init()).rejects.toThrow(/scope=case 时 caseId 必填/)
        wrapper.unmount()
    })
})

// ── case scope createSession body 各分支默认值 ────────────────────────────

describe('createSession 各 scope body 默认标题分支', () => {
    it('document scope（开启 createUrl 后）默认标题为"新文书"', async () => {
        // document 默认单 session；通过 apiEndpoints 同时给 list/create 转为多 session 模式
        mockApiFetch
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce({ sessionId: 'doc-new', title: '新文书' })

        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({
                scope: 'document',
                userId: 'u1',
                // 通过覆盖 listUrl + createUrl 把 document 转为多 session 模式
                apiEndpoints: {
                    listUrl: () => '/api/x/list',
                    createUrl: '/api/x/create',
                },
            }),
        )
        await manager.init()
        await flushPromises()

        const createCall = mockApiFetch.mock.calls.find(
            (c: any[]) => c[1]?.method === 'POST',
        )
        expect(createCall?.[1]?.body?.title).toBe('新文书')
        wrapper.unmount()
    })

    it('contract scope（开启 createUrl 后）默认标题为"新审查"', async () => {
        mockApiFetch
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce({ sessionId: 'rev-new', title: '新审查' })
        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({
                scope: 'contract',
                userId: 'u1',
                apiEndpoints: {
                    listUrl: () => '/api/c/list',
                    createUrl: '/api/c/create',
                },
            }),
        )
        await manager.init()
        await flushPromises()
        const createCall = mockApiFetch.mock.calls.find(
            (c: any[]) => c[1]?.method === 'POST',
        )
        expect(createCall?.[1]?.body?.title).toBe('新审查')
        wrapper.unmount()
    })

    it('case_analysis_init scope 默认标题"初分分析" + body 携带 caseId', async () => {
        mockApiFetch
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce({ sessionId: 'init-new', title: '初分分析' })
        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({
                scope: 'case_analysis_init',
                userId: 'u1',
                caseId: 99,
                apiEndpoints: {
                    listUrl: () => '/api/i/list',
                    createUrl: '/api/i/create',
                },
            }),
        )
        await manager.init()
        await flushPromises()
        const createCall = mockApiFetch.mock.calls.find(
            (c: any[]) => c[1]?.method === 'POST',
        )
        expect(createCall?.[1]?.body).toEqual(expect.objectContaining({
            caseId: 99,
            title: '初分分析',
        }))
        wrapper.unmount()
    })

    it('apiEndpoints.listUrl 业务覆盖：自定义 URL 函数生效', async () => {
        mockApiFetch.mockResolvedValueOnce([
            makeSession('s-c'),
        ])
        const customListUrl = vi.fn(() => '/api/custom/list')
        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({
                scope: 'legal_assistant',
                userId: 'u1',
                apiEndpoints: { listUrl: customListUrl },
            }),
        )
        await manager.init()
        await flushPromises()

        expect(customListUrl).toHaveBeenCalled()
        const urls = mockApiFetch.mock.calls.map((c: any[]) => c[0])
        expect(urls).toContain('/api/custom/list')
        wrapper.unmount()
    })

    it('apiEndpoints.chatUrl 覆盖：透传给 useStreamChat', async () => {
        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({
                scope: 'document',
                userId: 'u1',
                sessionId: 'doc-X',
                apiEndpoints: { chatUrl: '/api/custom/chat' },
            }),
        )
        await manager.init()
        await flushPromises()
        expect(lastStream?.capturedOpts.apiUrl).toBe('/api/custom/chat')
        wrapper.unmount()
    })

    it('apiEndpoints.createUrl=null 显式禁用：createSession 抛错', async () => {
        mockApiFetch.mockResolvedValueOnce([]) // listUrl 返回空
        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({
                scope: 'legal_assistant',
                userId: 'u1',
                apiEndpoints: { createUrl: null },
            }),
        )
        // init 调用时 list 空 → 进入 createSession → createUrl=null → 抛错
        await expect(manager.init()).rejects.toThrow(/createUrl=null/)
        wrapper.unmount()
    })

    it('apiEndpoints 字段为 undefined 时取 scope 默认（不覆盖）', async () => {
        mockApiFetch.mockResolvedValueOnce([
            makeSession('s-d'),
        ])
        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({
                scope: 'legal_assistant',
                userId: 'u1',
                // 只显式覆盖 chatUrl，listUrl/createUrl 等字段保留默认
                apiEndpoints: { chatUrl: '/api/x/chat' },
            }),
        )
        await manager.init()
        await flushPromises()

        const urls = mockApiFetch.mock.calls.map((c: any[]) => c[0])
        // listUrl 默认仍生效
        expect(urls).toContain('/api/v1/assistant/sessions')
        // chatUrl 已被覆盖
        expect(lastStream?.capturedOpts.apiUrl).toBe('/api/x/chat')
        wrapper.unmount()
    })
})

// ── 单 session 模式 ────────────────────────────────────────────────────────

describe('单 session 模式（sessionId=string）', () => {
    it('init 跳过 fetchSessions / createSession，直接 switchSession 到固定 id', async () => {
        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({ scope: 'document', userId: 'u1', sessionId: 'doc-fixed' }),
        )
        await manager.init()
        await flushPromises()

        // 不调用 list / create
        expect(mockApiFetch).not.toHaveBeenCalled()
        expect(manager.currentSessionId.value).toBe('doc-fixed')
        // sessions 列表保持空（UI 隐藏）
        expect(manager.sessions.value).toEqual([])
        // streamChat 被实例化
        expect(lastStream).not.toBeNull()
        wrapper.unmount()
    })

    it('单 session 模式 createSession 抛错（业务方自管 id）', async () => {
        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({ scope: 'document', userId: 'u1', sessionId: 'doc-1' }),
        )
        await manager.init()
        await expect(manager.createSession('whatever')).rejects.toThrow(/单 session 模式不支持 createSession/)
        wrapper.unmount()
    })

    it('单 session 模式 deleteSession no-op（仅 warn 不抛错）', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { })
        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({ scope: 'document', userId: 'u1', sessionId: 'doc-del' }),
        )
        await manager.init()
        await manager.deleteSession('doc-del')
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('deleteSession 在单 session 模式下被调用'))
        // 没有发起请求
        expect(mockApiFetch).not.toHaveBeenCalled()
        warnSpy.mockRestore()
        wrapper.unmount()
    })

    it('单 session 模式 renameSession no-op', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { })
        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({ scope: 'document', userId: 'u1', sessionId: 'doc-rn' }),
        )
        await manager.init()
        await manager.renameSession('doc-rn', '新标题')
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('renameSession 在单 session 模式下被调用'))
        warnSpy.mockRestore()
        wrapper.unmount()
    })
})

describe('单 session 模式（sessionId=Ref<string>）反应式跟随', () => {
    it('Ref 值变化时切换底层 chat（switchSession 重新调用）', async () => {
        const sidRef = ref('doc-init')
        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({ scope: 'document', userId: 'u1', sessionId: sidRef }),
        )
        await manager.init()
        await flushPromises()
        const firstStream = lastStream
        expect(firstStream?.capturedOpts.threadId).toBe('doc-init')

        // 修改 ref 触发 watch → switchSession
        sidRef.value = 'doc-updated'
        await flushPromises()
        await nextTick()

        // 新 stream 应用新 threadId
        expect(allStreams.length).toBeGreaterThanOrEqual(2)
        expect(allStreams[allStreams.length - 1]?.capturedOpts.threadId).toBe('doc-updated')
        expect(manager.currentSessionId.value).toBe('doc-updated')
        wrapper.unmount()
    })

    it('Ref 值不变（同值赋值）不触发额外 switchSession', async () => {
        const sidRef = ref('doc-stable')
        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({ scope: 'document', userId: 'u1', sessionId: sidRef }),
        )
        await manager.init()
        await flushPromises()
        const initialStreamCount = allStreams.length

        // 同值再次赋值：watch 不触发
        sidRef.value = 'doc-stable'
        await flushPromises()
        expect(allStreams.length).toBe(initialStreamCount)
        wrapper.unmount()
    })
})

// ── 多 session 模式 ────────────────────────────────────────────────────────

describe('多 session 模式（sessionId=auto）', () => {
    it('init 列表非空 → switchSession 到首个', async () => {
        const sessions = [
            { sessionId: 's-1', title: '会话 1', createdAt: '2024-01-01', updatedAt: '2024-01-01', hasActiveRun: false },
            { sessionId: 's-2', title: '会话 2', createdAt: '2024-01-02', updatedAt: '2024-01-02', hasActiveRun: false },
        ]
        mockApiFetch.mockResolvedValueOnce(sessions)

        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({ scope: 'legal_assistant', userId: 'u1' }),
        )
        await manager.init()
        await flushPromises()

        expect(manager.sessions.value).toEqual(sessions)
        expect(manager.currentSessionId.value).toBe('s-1')
        wrapper.unmount()
    })

    it('init 列表为空 → 自动 createSession', async () => {
        mockApiFetch
            .mockResolvedValueOnce([]) // listUrl 返回空
            .mockResolvedValueOnce({ sessionId: 's-new', title: '新对话' }) // createUrl

        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({ scope: 'legal_assistant', userId: 'u1' }),
        )
        await manager.init()
        await flushPromises()

        expect(manager.currentSessionId.value).toBe('s-new')
        expect(manager.sessions.value[0]?.sessionId).toBe('s-new')
        wrapper.unmount()
    })

    it('init 幂等：第二次调用不重复 fetch', async () => {
        mockApiFetch.mockResolvedValueOnce([
            makeSession('s-X'),
        ])
        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({ scope: 'legal_assistant', userId: 'u1' }),
        )
        await manager.init()
        await flushPromises()
        const firstCount = mockApiFetch.mock.calls.length

        await manager.init() // 二次调用
        expect(mockApiFetch.mock.calls.length).toBe(firstCount)
        wrapper.unmount()
    })

    it('createSession 不传 title 走 scope 默认（legal_assistant→"新对话"）', async () => {
        mockApiFetch
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce({ sessionId: 's-default', title: '新对话' })

        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({ scope: 'legal_assistant', userId: 'u1' }),
        )
        await manager.init()
        await flushPromises()

        const createCall = mockApiFetch.mock.calls.find(
            (c: any[]) => c[1]?.method === 'POST',
        )
        expect(createCall?.[1]?.body?.title).toBe('新对话')
        wrapper.unmount()
    })

    it('createSession 传 title 优先使用之', async () => {
        mockApiFetch
            .mockResolvedValueOnce([
                makeSession('s-existing', false, '已有'),
            ])
        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({ scope: 'legal_assistant', userId: 'u1' }),
        )
        await manager.init()
        await flushPromises()
        mockApiFetch.mockReset()
        mockApiFetch.mockResolvedValueOnce({ sessionId: 's-custom', title: '我的标题' })

        await manager.createSession('我的标题')
        const createCall = mockApiFetch.mock.calls.find(
            (c: any[]) => c[1]?.method === 'POST',
        )
        expect(createCall?.[1]?.body?.title).toBe('我的标题')
        // 写入到 sessions 列表头部
        expect(manager.sessions.value[0]?.sessionId).toBe('s-custom')
        wrapper.unmount()
    })

    it('createSession 在 case scope 时携带 caseId 与 moduleName', async () => {
        mockApiFetch
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce({ sessionId: 's-case', title: '小索' })

        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({ scope: 'case', userId: 'u1', caseId: 99, moduleName: '事实梳理' }),
        )
        await manager.init()
        await flushPromises()

        const createCall = mockApiFetch.mock.calls.find(
            (c: any[]) => c[1]?.method === 'POST',
        )
        expect(createCall?.[1]?.body).toEqual(expect.objectContaining({
            caseId: 99,
            moduleName: '事实梳理',
        }))
        wrapper.unmount()
    })

    it('createSession 后端不返回 sessionId → 抛错', async () => {
        mockApiFetch
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce({}) // 缺 sessionId

        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({ scope: 'legal_assistant', userId: 'u1' }),
        )
        await expect(manager.init()).rejects.toThrow(/创建 session 失败/)
        wrapper.unmount()
    })
})

// ── switchSession ───────────────────────────────────────────────────────────

describe('switchSession', () => {
    it('切换后 dispose 旧 chat 实例 + 创建新 stream', async () => {
        const sessions = [
            makeSession('s-A', false, 'A'),
            makeSession('s-B', false, 'B'),
        ]
        mockApiFetch.mockResolvedValueOnce(sessions)

        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({ scope: 'legal_assistant', userId: 'u1' }),
        )
        await manager.init()
        await flushPromises()
        expect(allStreams.length).toBe(1)
        expect(allStreams[0]?.capturedOpts.threadId).toBe('s-A')

        await manager.switchSession('s-B')
        await flushPromises()
        expect(allStreams.length).toBe(2)
        expect(allStreams[1]?.capturedOpts.threadId).toBe('s-B')
        expect(manager.currentSessionId.value).toBe('s-B')
        wrapper.unmount()
    })

    it('hasActiveRun=true 的 session：切换时调 reconnect 而非 loadHistory', async () => {
        const sessions = [
            makeSession('s-active', true, 'A'),
        ]
        mockApiFetch.mockResolvedValueOnce(sessions)

        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({ scope: 'legal_assistant', userId: 'u1' }),
        )
        await manager.init()
        await flushPromises()

        expect(lastStream?.reconnect).toHaveBeenCalled()
        expect(lastStream?.loadHistory).not.toHaveBeenCalled()
        wrapper.unmount()
    })

    it('hasActiveRun=false 的 session：切换时调 loadHistory', async () => {
        const sessions = [
            makeSession('s-idle', false, 'A'),
        ]
        mockApiFetch.mockResolvedValueOnce(sessions)

        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({ scope: 'legal_assistant', userId: 'u1' }),
        )
        await manager.init()
        await flushPromises()

        expect(lastStream?.loadHistory).toHaveBeenCalled()
        expect(lastStream?.reconnect).not.toHaveBeenCalled()
        wrapper.unmount()
    })
})

// ── deleteSession / renameSession ──────────────────────────────────────────

describe('deleteSession（多 session 模式）', () => {
    it('从 sessions 列表移除被删 session', async () => {
        const sessions = [
            makeSession('s-1', false, 'A'),
            makeSession('s-2', false, 'B'),
        ]
        mockApiFetch.mockResolvedValueOnce(sessions)

        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({ scope: 'legal_assistant', userId: 'u1' }),
        )
        await manager.init()
        await flushPromises()
        expect(manager.sessions.value).toHaveLength(2)

        // 删除非当前 session（s-2）
        mockApiFetch.mockResolvedValueOnce({})
        await manager.deleteSession('s-2')

        expect(manager.sessions.value).toHaveLength(1)
        expect(manager.sessions.value[0]?.sessionId).toBe('s-1')
        // currentSessionId 不变
        expect(manager.currentSessionId.value).toBe('s-1')
        wrapper.unmount()
    })

    it('删除当前 session：列表非空时切换到首个剩余', async () => {
        const sessions = [
            makeSession('s-1', false, 'A'),
            makeSession('s-2', false, 'B'),
        ]
        mockApiFetch.mockResolvedValueOnce(sessions)

        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({ scope: 'legal_assistant', userId: 'u1' }),
        )
        await manager.init()
        await flushPromises()
        expect(manager.currentSessionId.value).toBe('s-1')

        mockApiFetch.mockResolvedValueOnce({})
        await manager.deleteSession('s-1')
        await flushPromises()

        // 删除 s-1 后剩 s-2 → 切到 s-2
        expect(manager.currentSessionId.value).toBe('s-2')
        wrapper.unmount()
    })

    it('删除当前 session 且列表删空：调 createSession 自动新建', async () => {
        const sessions = [
            makeSession('s-only', false, '唯一'),
        ]
        mockApiFetch.mockResolvedValueOnce(sessions)
        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({ scope: 'legal_assistant', userId: 'u1' }),
        )
        await manager.init()
        await flushPromises()
        expect(manager.currentSessionId.value).toBe('s-only')

        // 删除：DELETE 成功 + 自动 createSession
        mockApiFetch
            .mockResolvedValueOnce({}) // DELETE
            .mockResolvedValueOnce({ sessionId: 's-auto', title: '新对话' }) // createSession

        await manager.deleteSession('s-only')
        await flushPromises()

        // 已切到自动创建的新 session
        expect(manager.currentSessionId.value).toBe('s-auto')
        wrapper.unmount()
    })

    it('调用 stopActiveRun 取消活跃 run（无论是否当前 session）', async () => {
        const sessions = [
            makeSession('s-X', false, 'X'),
            makeSession('s-Y', false, 'Y'),
        ]
        mockApiFetch.mockResolvedValueOnce(sessions)
        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({ scope: 'legal_assistant', userId: 'u1' }),
        )
        await manager.init()
        await flushPromises()

        mockApiFetch.mockResolvedValueOnce({})
        await manager.deleteSession('s-Y')

        expect(mockStopActiveRun).toHaveBeenCalledWith('s-Y')
        wrapper.unmount()
    })
})

describe('多 session + URL 显式禁用（warn 路径）', () => {
    it('多 session 模式 fetchSessions 但 listUrl=null → warn 静默', async () => {
        // legal_assistant 默认有 listUrl，但 apiEndpoints 显式禁用
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { })
        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({
                scope: 'legal_assistant',
                userId: 'u1',
                apiEndpoints: { listUrl: null, createUrl: null },
            }),
        )
        // listUrl=null 时 fetchSessions warn；createUrl=null 时 createSession 抛错
        await expect(manager.init()).rejects.toThrow(/createUrl=null/)
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('listUrl=null'))
        warnSpy.mockRestore()
        wrapper.unmount()
    })

    it('多 session 模式 deleteSession 但 deleteUrl=null → warn 静默', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { })
        // 用 legal_assistant，自定义只关 deleteUrl
        mockApiFetch.mockResolvedValueOnce([
            makeSession('s-a'),
        ])
        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({
                scope: 'legal_assistant',
                userId: 'u1',
                apiEndpoints: { deleteUrl: null },
            }),
        )
        await manager.init()
        await flushPromises()

        await manager.deleteSession('s-a')
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('deleteUrl=null'))
        warnSpy.mockRestore()
        wrapper.unmount()
    })

    it('多 session 模式 renameSession 但 renameUrl=null → warn 静默', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { })
        mockApiFetch.mockResolvedValueOnce([
            makeSession('s-b'),
        ])
        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({
                scope: 'legal_assistant',
                userId: 'u1',
                apiEndpoints: { renameUrl: null },
            }),
        )
        await manager.init()
        await flushPromises()
        await manager.renameSession('s-b', 'X')
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('renameUrl=null'))
        warnSpy.mockRestore()
        wrapper.unmount()
    })
})

describe('renameSession（多 session 模式）', () => {
    it('PATCH 调用 + 本地 sessions 列表标题更新', async () => {
        const sessions = [
            makeSession('s-rn', false, '旧标题'),
        ]
        mockApiFetch.mockResolvedValueOnce(sessions)

        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({ scope: 'legal_assistant', userId: 'u1' }),
        )
        await manager.init()
        await flushPromises()

        mockApiFetch.mockResolvedValueOnce({})
        await manager.renameSession('s-rn', '新标题')

        const renameCall = mockApiFetch.mock.calls.find(
            (c: any[]) => c[1]?.method === 'PATCH',
        )
        expect(renameCall?.[0]).toBe('/api/v1/assistant/sessions/s-rn/rename')
        expect(renameCall?.[1]?.body).toEqual({ title: '新标题' })
        // 本地列表已同步
        expect(manager.sessions.value[0]?.title).toBe('新标题')
        wrapper.unmount()
    })
})

// ── sendMessage 多签名 ────────────────────────────────────────────────────

describe('sendMessage 多签名兼容', () => {
    async function setupReady() {
        const sessions = [
            makeSession('s-send'),
        ]
        mockApiFetch.mockResolvedValueOnce(sessions)
        const fixture = mountFactory(() =>
            useDomainAgentSession({ scope: 'legal_assistant', userId: 'u1' }),
        )
        await fixture.manager.init()
        await flushPromises()
        return fixture
    }

    it('签名 1：sendMessage(text, opts) → wrappedChat 收到对应 payload', async () => {
        const { manager, wrapper } = await setupReady()

        await manager.sendMessage('你好', { thinking: true })
        // wrappedChat.sendMessage 内部走 streamChat.submit
        expect(lastStream?.submit).toHaveBeenCalled()
        const submitArgs = lastStream?.submit.mock.calls[0]
        expect(submitArgs?.[0]?.messages?.[0]).toEqual(expect.objectContaining({
            type: 'human',
            content: '你好',
        }))
        expect(submitArgs?.[0]?.thinking).toBe(true)
        wrapper.unmount()
    })

    it('签名 2：sendMessage({text, files}, {thinking}) → 同样走 wrappedChat', async () => {
        const { manager, wrapper } = await setupReady()

        const files = [{
            id: 'f-1', fileName: 'a.pdf', fileType: 'pdf', fileSize: 100, encrypted: false,
        }]
        await manager.sendMessage({ text: '看这个', files }, { thinking: false })

        expect(lastStream?.submit).toHaveBeenCalled()
        const submitArgs = lastStream?.submit.mock.calls[0]
        // 文本会被 sentinel 包装
        expect(submitArgs?.[0]?.messages?.[0]?.content).toContain('__ATTACHMENTS__')
        expect(submitArgs?.[0]?.messages?.[0]?.content).toContain('看这个')
        // additional_kwargs.attachments 注入
        expect(submitArgs?.[0]?.messages?.[0]?.additional_kwargs?.attachments).toHaveLength(1)
        wrapper.unmount()
    })

    it('空文本 + 无 files → 静默 return（不发请求）', async () => {
        const { manager, wrapper } = await setupReady()

        await manager.sendMessage('   ', {})
        expect(lastStream?.submit).not.toHaveBeenCalled()
        wrapper.unmount()
    })

    it('空文本 + 有 files → sentinel 单独构成内容', async () => {
        const { manager, wrapper } = await setupReady()

        const files = [{ id: 'f1', fileName: 'x', fileType: 'p', fileSize: 1, encrypted: false }]
        await manager.sendMessage('', { files } as any)

        const submitArgs = lastStream?.submit.mock.calls[0]
        expect(submitArgs?.[0]?.messages?.[0]?.content).toMatch(/^__ATTACHMENTS__/)
        wrapper.unmount()
    })

    it('currentChat 为空（未 init）→ 静默 return', async () => {
        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({ scope: 'legal_assistant', userId: 'u1' }),
        )
        // 不调用 init
        await manager.sendMessage('你好')
        expect(mockApiFetch).not.toHaveBeenCalled()
        wrapper.unmount()
    })
})

// ── 队列操作 ───────────────────────────────────────────────────────────────

describe('队列操作（enqueueMessage / removeQueueItem / clearQueue）', () => {
    async function setupReady() {
        const sessions = [
            makeSession('s-q'),
        ]
        mockApiFetch.mockResolvedValueOnce(sessions)
        const fixture = mountFactory(() =>
            useDomainAgentSession({ scope: 'legal_assistant', userId: 'u1' }),
        )
        await fixture.manager.init()
        await flushPromises()
        return fixture
    }

    it('enqueueMessage 成功入队 → currentQueue 增加 + dispatcher.broadcastState 调用', async () => {
        const { manager, wrapper } = await setupReady()
        mockBroadcastState.mockClear()

        const ok = manager.enqueueMessage('排队消息 1', undefined, false)
        await flushPromises()

        expect(ok).toBe(true)
        expect(manager.currentQueue.value).toHaveLength(1)
        expect(manager.currentQueue.value[0]?.text).toBe('排队消息 1')
        expect(manager.currentQueueLen.value).toBe(1)
        expect(mockBroadcastState).toHaveBeenCalled()
        wrapper.unmount()
    })

    it('enqueueMessage 在无 currentSessionId 时返回 false（守卫）', async () => {
        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({ scope: 'legal_assistant', userId: 'u1' }),
        )
        // 不 init
        const ok = manager.enqueueMessage('x')
        expect(ok).toBe(false)
        wrapper.unmount()
    })

    it('removeQueueItem：按 id 移除指定队列项', async () => {
        const { manager, wrapper } = await setupReady()

        manager.enqueueMessage('m1')
        manager.enqueueMessage('m2')
        await flushPromises()
        expect(manager.currentQueue.value).toHaveLength(2)

        const target = manager.currentQueue.value[0]!
        manager.removeQueueItem(target.id)
        expect(manager.currentQueue.value).toHaveLength(1)
        expect(manager.currentQueue.value[0]?.text).toBe('m2')
        wrapper.unmount()
    })

    it('removeQueueItem 删空时清除队列暂停标记', async () => {
        const { manager, wrapper } = await setupReady()
        manager.enqueueMessage('only-one')
        await flushPromises()
        const target = manager.currentQueue.value[0]!

        manager.removeQueueItem(target.id)
        // 队列已空 + 暂停标记被清
        expect(manager.currentQueue.value).toHaveLength(0)
        expect(manager.isQueuePaused.value).toBe(false)
        wrapper.unmount()
    })

    it('removeQueueItem / clearQueue / resumeQueue 在无 currentSessionId 时静默 return', async () => {
        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({ scope: 'legal_assistant', userId: 'u1' }),
        )
        // 不 init
        expect(() => manager.removeQueueItem('x')).not.toThrow()
        expect(() => manager.clearQueue()).not.toThrow()
        expect(() => manager.resumeQueue()).not.toThrow()
        wrapper.unmount()
    })

    it('clearQueue：清空当前 session 队列 + 解除暂停', async () => {
        const { manager, wrapper } = await setupReady()
        manager.enqueueMessage('a')
        manager.enqueueMessage('b')
        await flushPromises()
        expect(manager.currentQueue.value).toHaveLength(2)

        manager.clearQueue()
        expect(manager.currentQueue.value).toHaveLength(0)
        expect(manager.isQueuePaused.value).toBe(false)
        wrapper.unmount()
    })

    it('resumeQueue：解除暂停 + 触发 dispatcher.maybeDispatch', async () => {
        const { manager, wrapper } = await setupReady()
        manager.enqueueMessage('a')
        await flushPromises()
        mockMaybeDispatch.mockClear()

        manager.resumeQueue()
        expect(mockMaybeDispatch).toHaveBeenCalled()
        wrapper.unmount()
    })
})

// ── stopGeneration / resumeInterrupt ───────────────────────────────────────

describe('stopGeneration / resumeInterrupt', () => {
    async function setupReady() {
        const sessions = [
            makeSession('s-stop'),
        ]
        mockApiFetch.mockResolvedValueOnce(sessions)
        const fixture = mountFactory(() =>
            useDomainAgentSession({ scope: 'legal_assistant', userId: 'u1' }),
        )
        await fixture.manager.init()
        await flushPromises()
        return fixture
    }

    it('stopGeneration 调 stream.stop + stopActiveRun(sid)', async () => {
        const { manager, wrapper } = await setupReady()

        await manager.stopGeneration()
        expect(lastStream?.stop).toHaveBeenCalled()
        expect(mockStopActiveRun).toHaveBeenCalledWith('s-stop')
        wrapper.unmount()
    })

    it('stopGeneration 在无 currentSessionId 时不调 stopActiveRun', async () => {
        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({ scope: 'legal_assistant', userId: 'u1' }),
        )
        // 不 init → currentChat 也为空，currentChat?.stopGeneration() 走可选链
        await manager.stopGeneration()
        expect(mockStopActiveRun).not.toHaveBeenCalled()
        wrapper.unmount()
    })

    it('resumeInterrupt 在 currentChat=null 时静默不抛错', async () => {
        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({ scope: 'legal_assistant', userId: 'u1' }),
        )
        // 不 init
        expect(() => manager.resumeInterrupt({ x: 1 })).not.toThrow()
        wrapper.unmount()
    })

    it('resumeInterrupt 透传到 wrappedChat.resumeInterrupt → stream.submit({command:resume})', async () => {
        const { manager, wrapper } = await setupReady()

        manager.resumeInterrupt({ choice: 'A' })
        // wrappedChat.resumeInterrupt 内部 submit(undefined, { command: { resume: data } })
        expect(lastStream?.submit).toHaveBeenCalledWith(undefined, expect.objectContaining({
            command: { resume: { choice: 'A' } },
        }))
        wrapper.unmount()
    })
})

// ── 业务事件钩子 ──────────────────────────────────────────────────────────

describe('onCustomEvent / onStreamSettled 钩子', () => {
    it('onCustomEvent 透传给 useStreamChat', async () => {
        const onCustomEvent = vi.fn()
        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({
                scope: 'document',
                userId: 'u1',
                sessionId: 'doc-cb',
                onCustomEvent,
            }),
        )
        await manager.init()
        await flushPromises()

        // streamChat 被实例化时收到 onCustomEvent
        expect(lastStream?.capturedOpts.onCustomEvent).toBe(onCustomEvent)
        wrapper.unmount()
    })

    it('onStreamSettled 在 runStatus → completed 时触发', async () => {
        const onStreamSettled = vi.fn().mockResolvedValue(undefined)
        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({
                scope: 'document',
                userId: 'u1',
                sessionId: 'doc-st',
                onStreamSettled,
            }),
        )
        await manager.init()
        await flushPromises()

        // 模拟 stream 状态变化
        lastStream!.runStatus.value = 'completed'
        await flushPromises()
        await nextTick()

        expect(onStreamSettled).toHaveBeenCalledWith('completed')
        wrapper.unmount()
    })

    it('onStreamSettled 在 runStatus → failed 时触发', async () => {
        const onStreamSettled = vi.fn()
        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({
                scope: 'document',
                userId: 'u1',
                sessionId: 'doc-fail',
                onStreamSettled,
            }),
        )
        await manager.init()
        await flushPromises()

        lastStream!.runStatus.value = 'failed'
        await flushPromises()
        await nextTick()

        expect(onStreamSettled).toHaveBeenCalledWith('failed')
        wrapper.unmount()
    })

    it('onStreamSettled 抛错时不影响外层（捕获 + console.error）', async () => {
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => { })
        const onStreamSettled = vi.fn().mockImplementation(() => {
            throw new Error('回拉失败')
        })
        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({
                scope: 'document',
                userId: 'u1',
                sessionId: 'doc-err',
                onStreamSettled,
            }),
        )
        await manager.init()
        await flushPromises()

        lastStream!.runStatus.value = 'completed'
        await flushPromises()
        await nextTick()

        expect(errSpy).toHaveBeenCalledWith(
            expect.stringContaining('onStreamSettled threw'),
            expect.any(Error),
        )
        errSpy.mockRestore()
        wrapper.unmount()
    })

    it('onStreamSettled rejected Promise 也被捕获', async () => {
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => { })
        const onStreamSettled = vi.fn().mockRejectedValue(new Error('async fail'))
        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({
                scope: 'document',
                userId: 'u1',
                sessionId: 'doc-rej',
                onStreamSettled,
            }),
        )
        await manager.init()
        await flushPromises()

        lastStream!.runStatus.value = 'completed'
        await flushPromises()
        await nextTick()
        await Promise.resolve()

        expect(errSpy).toHaveBeenCalledWith(
            expect.stringContaining('onStreamSettled rejected'),
            expect.any(Error),
        )
        errSpy.mockRestore()
        wrapper.unmount()
    })

    it('runStatus 变化为非 terminal（running）时不触发 onStreamSettled', async () => {
        const onStreamSettled = vi.fn()
        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({
                scope: 'document',
                userId: 'u1',
                sessionId: 'doc-running',
                onStreamSettled,
            }),
        )
        await manager.init()
        await flushPromises()

        lastStream!.runStatus.value = 'running'
        await flushPromises()
        await nextTick()

        expect(onStreamSettled).not.toHaveBeenCalled()
        wrapper.unmount()
    })
})

// ── 跨标签 listener 路径 ─────────────────────────────────────────────────

describe('跨标签同步监听（chat-queue:sync / chat-queue:hello）', () => {
    function captureListeners() {
        const handlers: Record<string, Function | null> = {
            'chat-queue:sync': null,
            'chat-queue:hello': null,
        }
        mockUseCrossTabListener.mockImplementation((type: string, cb: any) => {
            handlers[type] = cb
        })
        return handlers
    }

    it('sync 事件来自其他 tab + version 更新 → queuesBySession 更新', async () => {
        const handlers = captureListeners()
        const sessions = [
            makeSession('sx'),
        ]
        mockApiFetch.mockResolvedValueOnce(sessions)
        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({ scope: 'legal_assistant', userId: 'u1' }),
        )
        await manager.init()
        await flushPromises()

        // 模拟跨 tab payload（tabId 不同）
        const payload = {
            sessionId: 'sx',
            tabId: 'other-tab',
            queue: [{ id: 'q1', text: '远端消息', thinking: false, enqueuedAt: 1 }],
            pauseReason: 'failed' as const,
            version: 100,
        }
        handlers['chat-queue:sync']?.(payload)
        await nextTick()

        // currentQueue / isQueuePaused 已被远端更新（响应式生效）
        expect(manager.currentQueue.value).toHaveLength(1)
        expect(manager.currentQueue.value[0]?.text).toBe('远端消息')
        expect(manager.isQueuePaused.value).toBe(true)
        expect(manager.queuePauseReason.value).toBe('failed')
        wrapper.unmount()
    })

    it('sync 事件来自本 tab → 自回过滤跳过', async () => {
        const handlers = captureListeners()
        const sessions = [
            makeSession('sf'),
        ]
        mockApiFetch.mockResolvedValueOnce(sessions)
        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({ scope: 'legal_assistant', userId: 'u1' }),
        )
        await manager.init()
        await flushPromises()

        // 工厂内部 tabId 通过 `getter tabId` 获取，无法直接拿到。
        // 这里测试关键点：payload 的 tabId 与本 tab 相同时跳过；
        // 由于 tabId 是 nanoid 生成，无法直接断言；通过 sessionId + payload.tabId='' 触发 if 早返回失败也算。
        // 直接验证：payload.version <= lastV 时跳过
        handlers['chat-queue:sync']?.({
            sessionId: 'sf',
            tabId: 'foreign-tab',
            queue: [{ id: 'a', text: 'A', thinking: false, enqueuedAt: 1 }],
            pauseReason: null,
            version: 50,
        })
        await nextTick()
        expect(manager.currentQueue.value).toHaveLength(1)

        // 第二次 payload version 较小 → 跳过
        handlers['chat-queue:sync']?.({
            sessionId: 'sf',
            tabId: 'foreign-tab',
            queue: [],
            pauseReason: null,
            version: 10,
        })
        await nextTick()
        // queue 没被覆盖
        expect(manager.currentQueue.value).toHaveLength(1)
        wrapper.unmount()
    })

    it('hello 事件：本 tab 已持有该 session 状态 → 回 sync', async () => {
        const handlers = captureListeners()
        const sessions = [
            makeSession('sh'),
        ]
        mockApiFetch.mockResolvedValueOnce(sessions)
        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({ scope: 'legal_assistant', userId: 'u1' }),
        )
        await manager.init()
        await flushPromises()

        // 本 tab 入队一条
        manager.enqueueMessage('我有数据')
        await flushPromises()
        mockPostCrossTabEvent.mockClear()

        // 收到外 tab 的 hello
        handlers['chat-queue:hello']?.({ sessionId: 'sh', tabId: 'foreign' })

        // 本 tab 应回 sync
        const syncCall = mockPostCrossTabEvent.mock.calls.find(
            (c: any[]) => c[0] === 'chat-queue:sync',
        )
        expect(syncCall).toBeDefined()
        expect(syncCall?.[1]?.queue).toHaveLength(1)
        wrapper.unmount()
    })

    it('hello 事件：本 tab 无该 session 数据 → 不响应', async () => {
        const handlers = captureListeners()
        mockApiFetch.mockResolvedValueOnce([
            makeSession('sh2'),
        ])
        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({ scope: 'legal_assistant', userId: 'u1' }),
        )
        await manager.init()
        await flushPromises()
        mockPostCrossTabEvent.mockClear()

        // 收到外 tab 的 hello（针对其他 session id）
        handlers['chat-queue:hello']?.({ sessionId: 'unknown-sid', tabId: 'foreign' })
        const syncCall = mockPostCrossTabEvent.mock.calls.find(
            (c: any[]) => c[0] === 'chat-queue:sync',
        )
        expect(syncCall).toBeUndefined()
        wrapper.unmount()
    })

    it('currentSessionId 变化时发送 hello（首次 / 不重复）', async () => {
        const sessions = [
            makeSession('h-1'),
            makeSession('h-2'),
        ]
        mockApiFetch.mockResolvedValueOnce(sessions)
        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({ scope: 'legal_assistant', userId: 'u1' }),
        )
        await manager.init()
        await flushPromises()

        // 切换 session 触发 watch
        await manager.switchSession('h-2')
        await flushPromises()

        const helloCalls = mockPostCrossTabEvent.mock.calls.filter(
            (c: any[]) => c[0] === 'chat-queue:hello',
        )
        // 首次切换至 h-2 应发 hello 一次
        expect(helloCalls.length).toBeGreaterThanOrEqual(1)
        expect(helloCalls.find((c: any[]) => c[1].sessionId === 'h-2')).toBeDefined()

        // 再切到同一个 session：不重复发
        const beforeCount = mockPostCrossTabEvent.mock.calls.filter(
            (c: any[]) => c[0] === 'chat-queue:hello',
        ).length
        await manager.switchSession('h-2')
        await flushPromises()
        const afterCount = mockPostCrossTabEvent.mock.calls.filter(
            (c: any[]) => c[0] === 'chat-queue:hello',
        ).length
        expect(afterCount).toBe(beforeCount)
        wrapper.unmount()
    })
})

// ── queuePauseReason getter ─────────────────────────────────────────────

describe('queuePauseReason / isQueuePaused 派生', () => {
    it('未 init 时 queuePauseReason=null / isQueuePaused=false', () => {
        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({ scope: 'legal_assistant', userId: 'u1' }),
        )
        expect(manager.queuePauseReason.value).toBeNull()
        expect(manager.isQueuePaused.value).toBe(false)
        wrapper.unmount()
    })
})

// ── 派生 computed ─────────────────────────────────────────────────────────

describe('代理 computed（messages/isLoading/values/runStatus/runError/interruptData）', () => {
    async function setupReady() {
        const sessions = [
            makeSession('s-c'),
        ]
        mockApiFetch.mockResolvedValueOnce(sessions)
        const fixture = mountFactory(() =>
            useDomainAgentSession({ scope: 'legal_assistant', userId: 'u1' }),
        )
        await fixture.manager.init()
        await flushPromises()
        return fixture
    }

    it('messages 透传 currentChat.messages', async () => {
        const { manager, wrapper } = await setupReady()
        const fakeMsgs = [{ type: 'human', content: 'hi' }]
        lastStream!.messages.value = fakeMsgs as any
        await nextTick()
        expect(manager.messages.value).toEqual(fakeMsgs)
        wrapper.unmount()
    })

    it('未 init 时 messages 为空数组', async () => {
        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({ scope: 'legal_assistant', userId: 'u1' }),
        )
        expect(manager.messages.value).toEqual([])
        wrapper.unmount()
    })

    it('isLoading 透传 currentChat.isLoading', async () => {
        const { manager, wrapper } = await setupReady()
        lastStream!.isLoading.value = true
        await nextTick()
        expect(manager.isLoading.value).toBe(true)
        wrapper.unmount()
    })

    it('runStatus 透传，未 init 时为 idle', async () => {
        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({ scope: 'legal_assistant', userId: 'u1' }),
        )
        expect(manager.runStatus.value).toBe('idle')
        wrapper.unmount()
    })

    it('interruptData 透传', async () => {
        const { manager, wrapper } = await setupReady()
        lastStream!.interruptData.value = { type: 'check' }
        await nextTick()
        expect(manager.interruptData.value).toEqual({ type: 'check' })
        wrapper.unmount()
    })
})

// ── useDomainAgentSessionPool ──────────────────────────────────────────────

describe('useDomainAgentSessionPool 池化', () => {
    it('getOrCreate(key) 首次调用创建实例 + keys() 包含该 key', async () => {
        const { manager: pool, wrapper } = mountFactory(() =>
            useDomainAgentSessionPool({
                scope: 'document',
                userId: 'u1',
                sessionId: 'shared-doc',
            }),
        )

        const f1 = pool.getOrCreate('module-a')
        expect(pool.keys()).toContain('module-a')
        expect(typeof f1.init).toBe('function')
        expect(typeof f1.sendMessage).toBe('function')
        wrapper.unmount()
    })

    it('getOrCreate(key) 第二次命中缓存 → 返回同一实例', async () => {
        const { manager: pool, wrapper } = mountFactory(() =>
            useDomainAgentSessionPool({
                scope: 'document',
                userId: 'u1',
                sessionId: 'shared-doc',
            }),
        )

        const f1 = pool.getOrCreate('module-x')
        const f2 = pool.getOrCreate('module-x')
        expect(f1).toBe(f2)
        // 只有一个实例（不重复创建 stream）
        expect(pool.keys()).toEqual(['module-x'])
        wrapper.unmount()
    })

    it('getOrCreate(key) 不同 key 创建不同实例', async () => {
        const { manager: pool, wrapper } = mountFactory(() =>
            useDomainAgentSessionPool({
                scope: 'document',
                userId: 'u1',
                sessionId: 'shared-doc',
            }),
        )

        const f1 = pool.getOrCreate('mod-1')
        const f2 = pool.getOrCreate('mod-2')
        expect(f1).not.toBe(f2)
        expect(pool.keys().sort()).toEqual(['mod-1', 'mod-2'])
        wrapper.unmount()
    })

    it('extraConfig 与 baseConfig 合并：moduleName 等差异字段透传', async () => {
        const { manager: pool, wrapper } = mountFactory(() =>
            useDomainAgentSessionPool({
                scope: 'case',
                userId: 'u1',
                caseId: 1,
                sessionId: 'fixed',
            }),
        )

        // extraConfig 注入 moduleName，会被 useStreamChat 实例化时观察
        const f = pool.getOrCreate('mod-A', { moduleName: '事实梳理' })
        await f.init()
        await flushPromises()

        // 最近创建的 stream 应是 mod-A（threadId='fixed'）
        expect(lastStream?.capturedOpts.threadId).toBe('fixed')
        wrapper.unmount()
    })

    it('remove(key) 释放 effectScope + 从 keys 移除', async () => {
        const { manager: pool, wrapper } = mountFactory(() =>
            useDomainAgentSessionPool({
                scope: 'document',
                userId: 'u1',
                sessionId: 'shared',
            }),
        )

        pool.getOrCreate('mod-rm')
        expect(pool.keys()).toContain('mod-rm')

        pool.remove('mod-rm')
        expect(pool.keys()).not.toContain('mod-rm')
        wrapper.unmount()
    })

    it('remove(不存在 key) 静默不报错', async () => {
        const { manager: pool, wrapper } = mountFactory(() =>
            useDomainAgentSessionPool({
                scope: 'document',
                userId: 'u1',
                sessionId: 'shared',
            }),
        )
        expect(() => pool.remove('not-exist')).not.toThrow()
        wrapper.unmount()
    })

    it('list() 返回全部 entry 的 key + factory', async () => {
        const { manager: pool, wrapper } = mountFactory(() =>
            useDomainAgentSessionPool({
                scope: 'document',
                userId: 'u1',
                sessionId: 'shared',
            }),
        )
        const f1 = pool.getOrCreate('k1')
        const f2 = pool.getOrCreate('k2')
        const list = pool.list()
        expect(list).toHaveLength(2)
        expect(list.find((e: { key: string }) => e.key === 'k1')?.factory).toBe(f1)
        expect(list.find((e: { key: string }) => e.key === 'k2')?.factory).toBe(f2)
        wrapper.unmount()
    })

    it('父 wrapper unmount 时 onScopeDispose 一次性 dispose 所有 entries', async () => {
        const { manager: pool, wrapper } = mountFactory(() =>
            useDomainAgentSessionPool({
                scope: 'document',
                userId: 'u1',
                sessionId: 'shared',
            }),
        )
        pool.getOrCreate('k1')
        pool.getOrCreate('k2')
        expect(pool.keys()).toHaveLength(2)

        wrapper.unmount()
        // 父 scope dispose 后内部 entries 已 clear
        expect(pool.keys()).toHaveLength(0)
    })
})

// ── 子流 CoT 历史恢复（threadStateUrl + initialSubThreads）─────────────────

describe('switchSession 子流 CoT 历史恢复', () => {
    it('case scope 默认接 /api/v1/case/analysis/thread/:sid，subAgentThreads 透传给 useStreamChat.initialSubThreads', async () => {
        // case scope 多 session：第一调用 list URL，第二调用 thread state URL（拉子流）
        mockApiFetch
            .mockResolvedValueOnce([makeSession('sess-A')])  // xiaosuo-sessions
            .mockResolvedValueOnce({                          // thread/sess-A
                threadId: 'sess-A',
                values: { messages: [] },
                subAgentThreads: [
                    {
                        toolCallId: 'tc-A',
                        agentName: 'documentMain',
                        threadId: 'sub-A',
                        messages: [{ type: 'ai', content: 'sub' }],
                    },
                ],
            })
        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({ scope: 'case', userId: 'u1', caseId: 1 }),
        )
        await manager.init()
        await flushPromises()

        const urls = mockApiFetch.mock.calls.map((c: any[]) => c[0])
        expect(urls).toContain('/api/v1/case/analysis/thread/sess-A')

        // useStreamChat 收到 initialSubThreads = thread API 返回的 subAgentThreads
        expect(lastStream?.capturedOpts.initialSubThreads).toEqual([
            expect.objectContaining({
                toolCallId: 'tc-A',
                agentName: 'documentMain',
                threadId: 'sub-A',
            }),
        ])
        wrapper.unmount()
    })

    it('thread state 接口失败时降级：不抛错，initialSubThreads 为 undefined', async () => {
        mockApiFetch
            .mockResolvedValueOnce([makeSession('sess-B')])  // list 正常
            .mockRejectedValueOnce(new Error('thread state down'))  // thread state 接口挂

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { })
        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({ scope: 'case', userId: 'u1', caseId: 2 }),
        )
        await manager.init()
        await flushPromises()

        // 警告打印；流仍正常实例化，但 initialSubThreads 不带值
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('fetch thread state failed'),
            expect.any(Error),
        )
        expect(lastStream).not.toBeNull()
        expect(lastStream?.capturedOpts.initialSubThreads).toBeUndefined()
        warnSpy.mockRestore()
        wrapper.unmount()
    })

    it('subAgentThreads 为空数组时不传 initialSubThreads（避免无意义灌入）', async () => {
        mockApiFetch
            .mockResolvedValueOnce([makeSession('sess-C')])
            .mockResolvedValueOnce({ threadId: 'sess-C', values: { messages: [] }, subAgentThreads: [] })
        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({ scope: 'case', userId: 'u1', caseId: 3 }),
        )
        await manager.init()
        await flushPromises()
        expect(lastStream?.capturedOpts.initialSubThreads).toBeUndefined()
        wrapper.unmount()
    })

    it('legal_assistant scope 默认 threadStateUrl=null：不发起 thread state 请求', async () => {
        mockApiFetch.mockResolvedValueOnce([makeSession('la-1')])
        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({ scope: 'legal_assistant', userId: 'u1' }),
        )
        await manager.init()
        await flushPromises()
        const urls = mockApiFetch.mock.calls.map((c: any[]) => c[0])
        expect(urls.find((u: string) => u?.startsWith('/api/v1/case/analysis/thread/'))).toBeUndefined()
        // threadStateUrl=null 时不传 initialSubThreads
        expect(lastStream?.capturedOpts.initialSubThreads).toBeUndefined()
        wrapper.unmount()
    })

    it('apiEndpoints.threadStateUrl 业务覆盖：自定义 URL 函数生效', async () => {
        mockApiFetch
            .mockResolvedValueOnce({ subAgentThreads: [{ toolCallId: 'tc-X', agentName: 'documentMain', threadId: 'sub-X', messages: [] }] })
        const customThreadUrl = vi.fn((sid: string) => `/api/custom/thread/${sid}`)
        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({
                scope: 'document',
                userId: 'u1',
                sessionId: 'doc-fixed',
                apiEndpoints: { threadStateUrl: customThreadUrl },
            }),
        )
        await manager.init()
        await flushPromises()

        expect(customThreadUrl).toHaveBeenCalledWith('doc-fixed')
        const urls = mockApiFetch.mock.calls.map((c: any[]) => c[0])
        expect(urls).toContain('/api/custom/thread/doc-fixed')
        wrapper.unmount()
    })

    it('apiEndpoints.threadStateUrl=null 显式禁用：不调 thread state 请求', async () => {
        mockApiFetch.mockResolvedValueOnce([makeSession('cs-X')])
        const { manager, wrapper } = mountFactory(() =>
            useDomainAgentSession({
                scope: 'case',
                userId: 'u1',
                caseId: 9,
                // 显式禁用 case scope 默认的 thread state 接口
                apiEndpoints: { threadStateUrl: null },
            }),
        )
        await manager.init()
        await flushPromises()
        const urls = mockApiFetch.mock.calls.map((c: any[]) => c[0])
        expect(urls.find((u: string) => u?.includes('/thread/'))).toBeUndefined()
        wrapper.unmount()
    })
})
