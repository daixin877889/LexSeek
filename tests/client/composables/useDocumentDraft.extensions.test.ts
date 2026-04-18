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
import { shallowRef } from 'vue'

// ── mock @langchain/vue：避免真实 useStream 在测试环境下报错 ─────────────────

const mockStreamSubmit = vi.fn()
vi.mock('@langchain/vue', () => ({
    FetchStreamTransport: vi.fn().mockImplementation(function () { return {} }),
    useStream: vi.fn(() => {
        const obj: Record<string, any> = {
            isLoading: shallowRef(false),
            error: shallowRef(null),
            submit: mockStreamSubmit,
            stop: vi.fn(),
            getMessagesMetadata: vi.fn(),
        }
        Object.defineProperty(obj, 'values', { get() { return undefined }, enumerable: true })
        Object.defineProperty(obj, 'messages', { get() { return [] }, enumerable: true })
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
    })

    it('成功挂载：加载 draft、template 并将 runStatus 设为 ready', async () => {
        const draftResp = {
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
            .mockResolvedValueOnce(draftResp)
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
                id: 1, sessionId: 's', values: {}, templateId: 7, status: 'failed',
            })
            .mockResolvedValueOnce({ id: 7, name: 't', placeholders: [] })

        const c = useDocumentDraft()
        await c.mountDraft(1)

        expect(c.runStatus.value).toBe('failed')
    })

    it('draft.status=exported 时 runStatus=exported', async () => {
        mockFetch
            .mockResolvedValueOnce({
                id: 1, sessionId: 's', values: {}, templateId: 7, status: 'exported',
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
                id: 10, sessionId: 's-10', values: {}, templateId: 3, status: 'drafting',
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
