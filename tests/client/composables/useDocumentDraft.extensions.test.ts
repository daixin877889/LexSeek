/**
 * useDocumentDraft.mountDraft 测试
 *
 * 验证通过已有 draftId 挂载 composable 的行为：
 * - 成功路径：draft + template 拉取后设置状态，runStatus 按 draft.status 映射
 * - 失败路径：draft 拉取失败时 runStatus=idle 提前返回
 *
 * 注意：mountStream 内部依赖 useStreamChat（真实 @langchain/vue），
 * 在此通过 mock 屏蔽，仅断言 mountDraft 对 draft/template/runStatus 的处理。
 * stream 行为由 useStreamChat 单测覆盖。
 *
 * **Feature: document-assistant**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shallowRef, nextTick } from 'vue'

// ── mock @langchain/vue：避免真实 useStream 在测试环境下报错 ─────────────────

const mockStreamSubmit = vi.fn()
const mockStreamStop = vi.fn().mockResolvedValue(undefined)
// 用 shallowRef 承载 values/messages，测试通过 mockStreamValues.value = ... 驱动 interrupt
const mockStreamValues = shallowRef<any>(undefined)
const mockStreamMessages = shallowRef<any[]>([])
// isLoading 在队列测试中需要精确控制：stream 空闲 vs 正在 loading
const mockStreamIsLoading = shallowRef(false)
// 捕获 useStreamChat 传入的 onCustomEvent，测试通过它模拟 status_change 事件，
// 从而驱动 useStreamChat 内部 runStatus 变化
let capturedOnCustomEvent: ((data: unknown) => void) | null = null
vi.mock('@langchain/vue', () => ({
    FetchStreamTransport: vi.fn().mockImplementation(function () { return {} }),
    useStream: vi.fn((opts: any) => {
        capturedOnCustomEvent = opts?.onCustomEvent ?? null
        const obj: Record<string, any> = {
            isLoading: mockStreamIsLoading,
            error: shallowRef(null),
            submit: mockStreamSubmit,
            stop: mockStreamStop,
            getMessagesMetadata: vi.fn(),
        }
        // useStreamChat 通过 s.values / s.messages 读取，用 getter 把 shallowRef 暴露为原始值
        Object.defineProperty(obj, 'values', { get() { return mockStreamValues.value }, enumerable: true })
        Object.defineProperty(obj, 'messages', { get() { return mockStreamMessages.value }, enumerable: true })
        return obj
    }),
}))

// ── mock useApiFetch ────────────────────────────────────────────────────────

const mockFetch = vi.fn()
vi.mock('~/composables/useApiFetch', () => ({
    useApiFetch: (...args: unknown[]) => mockFetch(...args),
}))

// ── 动态导入（确保 mock 先完成）─────────────────────────────────────────────

const { useDocumentDraft } = await import('~/composables/useDocumentDraft')

// ── 测试套件 ────────────────────────────────────────────────────────────────

describe('useDocumentDraft.mountDraft', () => {
    beforeEach(() => {
        mockFetch.mockReset()
        mockStreamSubmit.mockReset()
        mockStreamStop.mockClear()
        mockStreamValues.value = undefined
        mockStreamMessages.value = []
    })

    it('成功挂载：加载 draft、template 并将 runStatus 设为 ready', async () => {
        const draftInner = {
            id: 42,
            sessionId: 'sess-42',
            values: { 甲方: '张三' },
            templateId: 7,
            status: 'ready',
            metadata: null,
            caseId: null,
        }
        const templateResp = { id: 7, name: '租赁合同', placeholders: [{ name: '甲方', firstContext: '' }] }
        mockFetch
            .mockResolvedValueOnce({ draft: draftInner })
            .mockResolvedValueOnce(templateResp)

        const composable = useDocumentDraft()
        await composable.mountDraft(42)

        expect(composable.draft.value?.id).toBe(42)
        expect(composable.template.value?.id).toBe(7)
        expect(composable.runStatus.value).toBe('ready')

        expect(mockFetch).toHaveBeenCalledWith('/api/v1/assistant/document/drafts/42')
        expect(mockFetch).toHaveBeenCalledWith(
            '/api/v1/assistant/document/templates/7',
            expect.objectContaining({ showError: false }),
        )
    })

    it('draft.status=failed 时 runStatus=failed', async () => {
        mockFetch
            .mockResolvedValueOnce({
                draft: { id: 1, sessionId: 's', values: {}, templateId: 7, status: 'failed' },
            })
            .mockResolvedValueOnce({ id: 7, name: 't', placeholders: [] })

        const c = useDocumentDraft()
        await c.mountDraft(1)

        expect(c.runStatus.value).toBe('failed')
    })

    it('draft.status=exported 时 runStatus=exported', async () => {
        mockFetch
            .mockResolvedValueOnce({
                draft: { id: 1, sessionId: 's', values: {}, templateId: 7, status: 'exported' },
            })
            .mockResolvedValueOnce({ id: 7, name: 't', placeholders: [] })

        const c = useDocumentDraft()
        await c.mountDraft(1)

        expect(c.runStatus.value).toBe('exported')
    })

    it('draft 拉取失败时提前返回并将 runStatus 置为 idle', async () => {
        mockFetch.mockResolvedValueOnce(null)

        const c = useDocumentDraft()
        await c.mountDraft(999)

        expect(c.draft.value).toBeNull()
        expect(c.runStatus.value).toBe('idle')
        // 模板请求不应发起
        expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('template 拉取失败不阻塞流程，draft/runStatus 仍生效', async () => {
        mockFetch
            .mockResolvedValueOnce({
                draft: { id: 10, sessionId: 's-10', values: {}, templateId: 3, status: 'drafting' },
            })
            .mockResolvedValueOnce(null)

        const c = useDocumentDraft()
        await c.mountDraft(10)

        expect(c.draft.value?.id).toBe(10)
        expect(c.template.value).toBeNull()
        // drafting 属于"其他" → ready
        expect(c.runStatus.value).toBe('ready')
    })
})

// ── agent 交互动作：sendMessage / stopGeneration / resumeInterrupt / interruptData ──

describe('useDocumentDraft agent actions', () => {
    beforeEach(() => {
        mockFetch.mockReset()
        mockStreamSubmit.mockReset()
        mockStreamStop.mockClear()
        mockStreamValues.value = undefined
        mockStreamMessages.value = []
    })

    async function mountReady() {
        mockFetch
            .mockResolvedValueOnce({
                draft: { id: 1, sessionId: 's-1', values: {}, templateId: 7, status: 'ready' },
            })
            .mockResolvedValueOnce({ id: 7, name: 't', placeholders: [] })
        const c = useDocumentDraft()
        await c.mountDraft(1)
        // mountDraft 末尾会触发一次 submit(undefined) 用于 checkpoint 回放，清理以便后续断言
        mockStreamSubmit.mockClear()
        return c
    }

    it('stream 未挂载时 sendMessage/stopGeneration/resumeInterrupt 为 no-op', async () => {
        const c = useDocumentDraft()
        c.sendMessage('hi')
        await c.stopGeneration()
        c.resumeInterrupt({ any: 'data' })
        expect(mockStreamSubmit).not.toHaveBeenCalled()
        expect(mockStreamStop).not.toHaveBeenCalled()
    })

    it('sendMessage 向 stream 提交 human 消息', async () => {
        const c = await mountReady()
        c.sendMessage('请帮我填乙方')
        expect(mockStreamSubmit).toHaveBeenCalledTimes(1)
        expect(mockStreamSubmit).toHaveBeenCalledWith(
            expect.objectContaining({
                messages: [{ type: 'human', content: '请帮我填乙方' }],
            }),
            undefined,
        )
    })

    it('stopGeneration 调用底层 stream.stop', async () => {
        const c = await mountReady()
        await c.stopGeneration()
        expect(mockStreamStop).toHaveBeenCalledTimes(1)
    })

    it('resumeInterrupt 使用 command.resume 调用 submit', async () => {
        const c = await mountReady()
        c.resumeInterrupt({ approved: true })
        expect(mockStreamSubmit).toHaveBeenCalledTimes(1)
        expect(mockStreamSubmit).toHaveBeenCalledWith(
            undefined,
            expect.objectContaining({ command: { resume: { approved: true } } }),
        )
    })

    it('无 interrupt 时 interruptData 为 null，isInterrupted 为 false', async () => {
        const c = await mountReady()
        expect(c.interruptData.value).toBeNull()
        expect(c.isInterrupted.value).toBe(false)
    })

    it('values.__interrupt__ 存在时 interruptData 解包并 isInterrupted=true', async () => {
        const c = await mountReady()
        // 模拟底层 stream 收到 interrupt
        mockStreamValues.value = {
            __interrupt__: [{ value: { field: '乙方', question: '请填写乙方' } }],
        }
        expect(c.interruptData.value).toEqual({ field: '乙方', question: '请填写乙方' })
        expect(c.isInterrupted.value).toBe(true)
    })
})

// ── patchField 响应拆包 ────────────────────────────────────────────────────

describe('useDocumentDraft.patchField response unwrap', () => {
    beforeEach(() => {
        mockFetch.mockReset()
        mockStreamSubmit.mockReset()
        mockStreamStop.mockClear()
        mockStreamValues.value = undefined
        mockStreamMessages.value = []
    })

    it('从 PATCH 响应拆包 { draft } 并正确更新 draft.value（不保留嵌套）', async () => {
        // 先 mount：mountDraft 会依次 GET draft 和 GET template
        mockFetch
            .mockResolvedValueOnce({
                draft: { id: 10, sessionId: 's', values: { 甲方: '' }, templateId: 7, status: 'ready' },
            })
            .mockResolvedValueOnce({ id: 7, name: 't', placeholders: [{ name: '甲方', firstContext: '' }] })

        const c = useDocumentDraft()
        await c.mountDraft(10)
        expect(c.draft.value?.id).toBe(10)

        // patchField 响应包了 { draft }，实现必须拆一层
        const updated = {
            id: 10,
            sessionId: 's',
            values: { 甲方: '张三' },
            templateId: 7,
            status: 'ready',
        }
        mockFetch.mockResolvedValueOnce({ draft: updated })

        c.onFieldChange('甲方', '张三')
        // useDebounceFn 500ms，等它跑完
        await new Promise(r => setTimeout(r, 600))

        // 关键断言：draft.value 不能带 draft 嵌套字段
        expect(c.draft.value).not.toHaveProperty('draft')
        expect(c.draft.value?.values).toEqual({ 甲方: '张三' })
        expect(c.draft.value?.status).toBe('ready')
    })
})

// ── 单 session 消息队列 ────────────────────────────────────────────────────

describe('useDocumentDraft queue', () => {
    beforeEach(() => {
        mockFetch.mockReset()
        mockStreamSubmit.mockReset()
        mockStreamStop.mockClear()
        mockStreamValues.value = undefined
        mockStreamMessages.value = []
        mockStreamIsLoading.value = false
        capturedOnCustomEvent = null
    })

    async function mountReady() {
        mockFetch
            .mockResolvedValueOnce({
                draft: { id: 1, sessionId: 's-1', values: {}, templateId: 7, status: 'ready' },
            })
            .mockResolvedValueOnce({ id: 7, name: 't', placeholders: [] })
        const c = useDocumentDraft()
        await c.mountDraft(1)
        mockStreamSubmit.mockClear()
        return c
    }

    it('enqueueMessage 在容量内入队并返回 true', () => {
        const c = useDocumentDraft()
        const ok = c.enqueueMessage('请把甲方填为张三')
        expect(ok).toBe(true)
        expect(c.currentQueue.value).toHaveLength(1)
        expect(c.currentQueue.value[0]!.text).toBe('请把甲方填为张三')
        expect(c.currentQueue.value[0]!.id).toBeTruthy()
        expect(c.currentQueue.value[0]!.thinking).toBe(false)
        expect(typeof c.currentQueue.value[0]!.enqueuedAt).toBe('number')
    })

    it('enqueueMessage 超过 QUEUE_MAX_SIZE 时返回 false 且不修改队列', () => {
        const c = useDocumentDraft()
        for (let i = 0; i < 5; i++) c.enqueueMessage(`msg-${i}`)
        expect(c.currentQueue.value).toHaveLength(5)
        const ok = c.enqueueMessage('overflow')
        expect(ok).toBe(false)
        expect(c.currentQueue.value).toHaveLength(5)
        expect(c.currentQueue.value.some(i => i.text === 'overflow')).toBe(false)
    })

    it('removeQueueItem 按 id 删除单条', () => {
        const c = useDocumentDraft()
        c.enqueueMessage('a')
        c.enqueueMessage('b')
        const firstId = c.currentQueue.value[0]!.id
        c.removeQueueItem(firstId)
        expect(c.currentQueue.value).toHaveLength(1)
        expect(c.currentQueue.value[0]!.text).toBe('b')
    })

    it('clearQueue 清空整个队列', () => {
        const c = useDocumentDraft()
        c.enqueueMessage('a')
        c.enqueueMessage('b')
        c.clearQueue()
        expect(c.currentQueue.value).toHaveLength(0)
    })

    it('runStatus=failed 时 isQueuePaused=true，queuePauseReason=failed', async () => {
        const c = await mountReady()
        expect(c.isQueuePaused.value).toBe(false)
        // 通过捕获的 onCustomEvent 驱动 useStreamChat 内部 runStatus 变为 failed
        capturedOnCustomEvent?.({ type: 'status_change', status: 'failed', error: 'boom' })
        await nextTick()
        expect(c.isQueuePaused.value).toBe(true)
        expect(c.queuePauseReason.value).toBe('failed')
    })

    it('runStatus=cancelled 时 queuePauseReason=stopped', async () => {
        const c = await mountReady()
        capturedOnCustomEvent?.({ type: 'status_change', status: 'cancelled' })
        await nextTick()
        expect(c.isQueuePaused.value).toBe(true)
        expect(c.queuePauseReason.value).toBe('stopped')
    })

    it('runStatus=completed 且 stream 空闲时自动派发队首消息', async () => {
        const c = await mountReady()
        c.enqueueMessage('请帮我填乙方')
        expect(c.currentQueue.value).toHaveLength(1)
        mockStreamIsLoading.value = false
        // 触发 completed：watch 应调用 sendMessage 提交队首消息
        capturedOnCustomEvent?.({ type: 'status_change', status: 'completed' })
        await nextTick()
        expect(c.currentQueue.value).toHaveLength(0)
        expect(mockStreamSubmit).toHaveBeenCalledTimes(1)
        expect(mockStreamSubmit).toHaveBeenCalledWith(
            expect.objectContaining({
                messages: [{ type: 'human', content: '请帮我填乙方' }],
            }),
            undefined,
        )
    })

    it('isQueuePaused=true 时 completed 事件不会派发队首', async () => {
        const c = await mountReady()
        // 先通过 failed 进入暂停态
        capturedOnCustomEvent?.({ type: 'status_change', status: 'failed' })
        await nextTick()
        c.enqueueMessage('msg1')
        capturedOnCustomEvent?.({ type: 'status_change', status: 'completed' })
        await nextTick()
        // 暂停中不派发
        expect(mockStreamSubmit).not.toHaveBeenCalled()
        expect(c.currentQueue.value).toHaveLength(1)
    })

    it('resumeQueue 清除暂停标记并派发就绪的队首消息', async () => {
        const c = await mountReady()
        capturedOnCustomEvent?.({ type: 'status_change', status: 'failed' })
        await nextTick()
        c.enqueueMessage('msg1')
        mockStreamIsLoading.value = false

        c.resumeQueue()
        await nextTick()

        expect(c.isQueuePaused.value).toBe(false)
        expect(c.queuePauseReason.value).toBeNull()
        expect(c.currentQueue.value).toHaveLength(0)
        expect(mockStreamSubmit).toHaveBeenCalledTimes(1)
    })

    it('stream 仍在 loading 时 completed 不派发（边界：isLoading 未落回）', async () => {
        const c = await mountReady()
        c.enqueueMessage('msg1')
        mockStreamIsLoading.value = true
        capturedOnCustomEvent?.({ type: 'status_change', status: 'completed' })
        await nextTick()
        expect(mockStreamSubmit).not.toHaveBeenCalled()
        expect(c.currentQueue.value).toHaveLength(1)
    })
})

// ── title / versions / snapshots / preview 扩展 ───────────────────────────

describe('useDocumentDraft 扩展：title / versions / snapshots / preview', () => {
    beforeEach(() => {
        mockFetch.mockReset()
        mockStreamSubmit.mockReset()
        mockStreamStop.mockClear()
        mockStreamValues.value = undefined
        mockStreamMessages.value = []
        mockStreamIsLoading.value = false
    })

    /** 挂载一个 ready 草稿，返回 composable 实例 */
    async function mountReady() {
        mockFetch
            .mockResolvedValueOnce({
                draft: { id: 5, sessionId: 's-5', values: {}, templateId: 7, status: 'ready', title: '原标题', titleOverridden: false },
            })
            .mockResolvedValueOnce({ id: 7, name: 't', placeholders: [] })
        const c = useDocumentDraft()
        await c.mountDraft(5)
        mockStreamSubmit.mockClear()
        mockFetch.mockReset()
        return c
    }

    // ── title ──────────────────────────────────────────────────────────────

    it('updateTitle 乐观更新：本地 draft.title 立即变为新值且 titleOverridden=true', async () => {
        const c = await mountReady()

        // API 正常返回
        const updatedDraft = { id: 5, sessionId: 's-5', values: {}, templateId: 7, status: 'ready', title: '新标题', titleOverridden: true }
        mockFetch.mockResolvedValueOnce({ draft: updatedDraft })

        const updatePromise = c.updateTitle('新标题')

        // 乐观更新在 await API 前就应生效
        expect((c.draft.value as any)?.title).toBe('新标题')
        expect((c.draft.value as any)?.titleOverridden).toBe(true)

        await updatePromise
        // API 返回后也保持正确
        expect((c.draft.value as any)?.title).toBe('新标题')
    })

    it('updateTitle 失败时回滚到原始 draft', async () => {
        const c = await mountReady()
        const originalDraft = c.draft.value

        // API 返回失败（null）
        mockFetch.mockResolvedValueOnce(null)

        await c.updateTitle('失败标题')

        // 应回滚到原始 draft
        expect(c.draft.value).toBe(originalDraft)
    })

    it('updateTitle 空字符串（trim 后为空）时不调用 API', async () => {
        const c = await mountReady()
        await c.updateTitle('   ')
        expect(mockFetch).not.toHaveBeenCalled()
    })

    it('title computed 返回 draft.title，draft 为 null 时返回空字符串', () => {
        const c = useDocumentDraft()
        expect(c.title.value).toBe('')
    })

    // ── versions ──────────────────────────────────────────────────────────

    it('saveVersion 成功后 versions 头部多一条', async () => {
        const c = await mountReady()

        // 先设置已有版本
        c.versions.value = [
            { id: 10, draftId: 5, versionNo: 1, name: 'v1', values: {}, titleAt: '', createdAt: '' },
        ]

        const newVersion = { id: 11, draftId: 5, versionNo: 2, name: 'v2', values: {}, titleAt: '', createdAt: '' }
        mockFetch.mockResolvedValueOnce({ version: newVersion })

        await c.saveVersion('v2')

        expect(c.versions.value).toHaveLength(2)
        expect(c.versions.value[0]!.id).toBe(11) // 头部是新的
        expect(c.versions.value[1]!.id).toBe(10)
    })

    it('saveVersion draftId 为 null 时返回 null 不调用 API', async () => {
        const c = useDocumentDraft()
        const result = await c.saveVersion('v1')
        expect(result).toBeNull()
        expect(mockFetch).not.toHaveBeenCalled()
    })

    it('nextVersionNo 在空列表时为 1，有版本时为 max+1', async () => {
        const c = await mountReady()
        expect(c.nextVersionNo.value).toBe(1)

        c.versions.value = [
            { id: 1, draftId: 5, versionNo: 3, name: 'v3', values: {}, titleAt: '', createdAt: '' },
            { id: 2, draftId: 5, versionNo: 1, name: 'v1', values: {}, titleAt: '', createdAt: '' },
        ]
        expect(c.nextVersionNo.value).toBe(4)
    })

    it('renameVersion 成功后本地列表中对应版本更新', async () => {
        const c = await mountReady()
        c.versions.value = [
            { id: 20, draftId: 5, versionNo: 1, name: '旧名', values: {}, titleAt: '', createdAt: '' },
        ]
        const renamed = { id: 20, draftId: 5, versionNo: 1, name: '新名', values: {}, titleAt: '', createdAt: '' }
        mockFetch.mockResolvedValueOnce({ version: renamed })

        await c.renameVersion(20, '新名')

        expect(c.versions.value[0]!.name).toBe('新名')
        expect(mockFetch).toHaveBeenCalledWith(
            '/api/v1/assistant/document/drafts/versions/20',
            expect.objectContaining({ method: 'PATCH', body: { name: '新名' } }),
        )
    })

    it('deleteVersion 成功后本地列表移除对应条目', async () => {
        const c = await mountReady()
        c.versions.value = [
            { id: 30, draftId: 5, versionNo: 1, name: 'v1', values: {}, titleAt: '', createdAt: '' },
            { id: 31, draftId: 5, versionNo: 2, name: 'v2', values: {}, titleAt: '', createdAt: '' },
        ]
        mockFetch.mockResolvedValueOnce({ ok: true })

        await c.deleteVersion(30)

        expect(c.versions.value).toHaveLength(1)
        expect(c.versions.value[0]!.id).toBe(31)
    })

    // ── snapshots ─────────────────────────────────────────────────────────

    it('loadSnapshots 成功后更新 snapshots 列表', async () => {
        const c = await mountReady()
        const snaps = [
            { id: 1, draftId: 5, source: 'ai-extract', values: {}, aiTitle: null, createdAt: '' },
        ]
        mockFetch.mockResolvedValueOnce({ snapshots: snaps })

        await c.loadSnapshots()

        expect(c.snapshots.value).toHaveLength(1)
        expect(c.snapshots.value[0]!.source).toBe('ai-extract')
    })

    it('applySnapshot 传 fieldNames 时 body 正确传入', async () => {
        const c = await mountReady()
        const updatedDraft = { id: 5, sessionId: 's-5', values: { 甲方: '李四' }, templateId: 7, status: 'ready' }
        // applySnapshot 后会调 loadSnapshots，共两次 mockFetch
        mockFetch
            .mockResolvedValueOnce({ draft: updatedDraft })
            .mockResolvedValueOnce({ snapshots: [] })

        await c.applySnapshot(99, ['甲方'])

        expect(mockFetch).toHaveBeenCalledWith(
            '/api/v1/assistant/document/drafts/snapshots/apply/99',
            expect.objectContaining({
                method: 'POST',
                body: { fieldNames: ['甲方'] },
            }),
        )
        expect(c.draft.value?.values).toEqual({ 甲方: '李四' })
    })

    it('applySnapshot 不传 fieldNames 时 body 为空对象', async () => {
        const c = await mountReady()
        const updatedDraft = { id: 5, sessionId: 's-5', values: {}, templateId: 7, status: 'ready' }
        mockFetch
            .mockResolvedValueOnce({ draft: updatedDraft })
            .mockResolvedValueOnce({ snapshots: [] })

        await c.applySnapshot(88)

        expect(mockFetch).toHaveBeenCalledWith(
            '/api/v1/assistant/document/drafts/snapshots/apply/88',
            expect.objectContaining({
                method: 'POST',
                body: {},
            }),
        )
    })

    // ── preview ───────────────────────────────────────────────────────────

    it('previewValues 在 previewVersionId 非空时指向版本的 values', async () => {
        const c = await mountReady()
        c.versions.value = [
            { id: 50, draftId: 5, versionNo: 1, name: 'v1', values: { 甲方: '王五' }, titleAt: '', createdAt: '' },
        ]

        expect(c.previewValues.value).toBeNull()

        c.enterPreview(50)
        expect(c.previewVersionId.value).toBe(50)
        expect(c.previewValues.value).toEqual({ 甲方: '王五' })
    })

    it('exitPreview 后 previewVersionId=null，previewValues=null', async () => {
        const c = await mountReady()
        c.versions.value = [
            { id: 60, draftId: 5, versionNo: 1, name: 'v1', values: { 甲方: '赵六' }, titleAt: '', createdAt: '' },
        ]
        c.enterPreview(60)
        expect(c.previewValues.value).not.toBeNull()

        c.exitPreview()
        expect(c.previewVersionId.value).toBeNull()
        expect(c.previewValues.value).toBeNull()
    })

    it('previewVersionId 对应版本不存在时 previewValues=null', async () => {
        const c = await mountReady()
        c.enterPreview(9999) // 不存在的 id
        expect(c.previewValues.value).toBeNull()
    })
})
