/**
 * ContractDocxPreview 单元测试
 *
 * **Feature: contract-review-m4**
 *
 * 组件职责（M4 版本）：
 * - 优先加载 reviewedFileId，空则 fallback 到 originalFileId
 * - 两个 fileId 都为 null → 显示"等待合同上传..."
 * - 通过 POST /api/v1/files/oss/download-url 拿签名 URL，再 fetch 拉 ArrayBuffer
 * - 使用 renderAsync 渲染到 containerRef
 * - fetchSeq 机制：快速连续变化 props 时只有最新一次生效
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

// ── mock docx-preview ───────────────────────────────────────────────────────

const mockRenderAsync = vi.fn()
vi.mock('docx-preview', () => ({
    renderAsync: (...args: unknown[]) => mockRenderAsync(...args),
}))

// ── mock useApiFetch ────────────────────────────────────────────────────────

const mockUseApiFetch = vi.fn()
vi.mock('~/composables/useApiFetch', () => ({
    useApiFetch: (...args: unknown[]) => mockUseApiFetch(...args),
}))

// ── mock global.fetch ───────────────────────────────────────────────────────

const mockGlobalFetch = vi.fn()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).fetch = mockGlobalFetch

// ── 动态导入（确保 mock 先完成）─────────────────────────────────────────────

const ContractDocxPreview = (await import('~/components/assistant/contract/ContractDocxPreview.vue'))
    .default

function mountPreview(props: { reviewedFileId: number | null; originalFileId: number | null }) {
    return mount(ContractDocxPreview, { props })
}

function makeBuffer(tag = 'buf'): ArrayBuffer {
    return new TextEncoder().encode(tag).buffer
}

beforeEach(() => {
    mockRenderAsync.mockReset()
    mockRenderAsync.mockResolvedValue(undefined)
    mockUseApiFetch.mockReset()
    mockGlobalFetch.mockReset()
})

describe('ContractDocxPreview', () => {
    it('两个 fileId 都是 null 时显示"等待合同上传..."且不调用 renderAsync', async () => {
        const w = mountPreview({ reviewedFileId: null, originalFileId: null })
        await flushPromises()
        expect(w.text()).toContain('等待合同上传...')
        expect(mockUseApiFetch).not.toHaveBeenCalled()
        expect(mockRenderAsync).not.toHaveBeenCalled()
    })

    it('reviewedFileId 存在时优先加载并渲染批注合同', async () => {
        const buf = makeBuffer('reviewed')
        mockUseApiFetch.mockResolvedValueOnce([{ ossFileId: 111, downloadUrl: 'https://oss/reviewed' }])
        mockGlobalFetch.mockResolvedValueOnce({ ok: true, arrayBuffer: async () => buf })

        mountPreview({ reviewedFileId: 111, originalFileId: 222 })
        await flushPromises()

        expect(mockUseApiFetch).toHaveBeenCalledWith(
            '/api/v1/files/oss/download-url',
            expect.objectContaining({ method: 'POST', body: { ossFileIds: [111] } }),
        )
        expect(mockGlobalFetch).toHaveBeenCalledWith('https://oss/reviewed')
        expect(mockRenderAsync).toHaveBeenCalledTimes(1)
        expect(mockRenderAsync.mock.calls[0]![0]).toBe(buf)
    })

    it('仅 originalFileId 时 fallback 加载原始合同', async () => {
        mockUseApiFetch.mockResolvedValueOnce([{ ossFileId: 222, downloadUrl: 'https://oss/original' }])
        mockGlobalFetch.mockResolvedValueOnce({ ok: true, arrayBuffer: async () => makeBuffer('orig') })

        mountPreview({ reviewedFileId: null, originalFileId: 222 })
        await flushPromises()

        expect(mockUseApiFetch).toHaveBeenCalledWith(
            '/api/v1/files/oss/download-url',
            expect.objectContaining({ method: 'POST', body: { ossFileIds: [222] } }),
        )
        expect(mockGlobalFetch).toHaveBeenCalledWith('https://oss/original')
        expect(mockRenderAsync).toHaveBeenCalledTimes(1)
    })

    it('fetch 返回 !ok 时打印警告且不调用 renderAsync', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
        mockUseApiFetch.mockResolvedValueOnce([{ ossFileId: 1, downloadUrl: 'https://oss/broken' }])
        mockGlobalFetch.mockResolvedValueOnce({ ok: false, status: 500, arrayBuffer: async () => new ArrayBuffer(0) })

        mountPreview({ reviewedFileId: 1, originalFileId: null })
        await flushPromises()

        expect(warnSpy).toHaveBeenCalled()
        expect(mockRenderAsync).not.toHaveBeenCalled()
        warnSpy.mockRestore()
    })

    it('useApiFetch 返回空数组时不渲染且不触发 warn（URL 缺失视为静默跳过）', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
        mockUseApiFetch.mockResolvedValueOnce([])

        mountPreview({ reviewedFileId: 1, originalFileId: null })
        await flushPromises()

        expect(mockGlobalFetch).not.toHaveBeenCalled()
        expect(mockRenderAsync).not.toHaveBeenCalled()
        expect(warnSpy).not.toHaveBeenCalled()
        warnSpy.mockRestore()
    })

    it('fetchSeq 机制：props 连续变化时只有最新一次完成渲染', async () => {
        // 首次触发（reviewedFileId=1）：useApiFetch 返回后我们手动 pending，等下一次触发后才 resolve
        let resolveFirst!: (val: Array<{ ossFileId: number; downloadUrl: string }>) => void
        const firstUrlPromise = new Promise<Array<{ ossFileId: number; downloadUrl: string }>>((r) => {
            resolveFirst = r
        })
        mockUseApiFetch.mockImplementationOnce(() => firstUrlPromise)

        // 第二次（reviewedFileId=2）：立即 resolve
        mockUseApiFetch.mockResolvedValueOnce([{ ossFileId: 2, downloadUrl: 'https://oss/b' }])
        mockGlobalFetch.mockResolvedValueOnce({ ok: true, arrayBuffer: async () => makeBuffer('latest') })

        const w = mountPreview({ reviewedFileId: 1, originalFileId: null })
        await w.setProps({ reviewedFileId: 2, originalFileId: null })

        // 现在让第一次的 useApiFetch 才返回（已过期）
        resolveFirst([{ ossFileId: 1, downloadUrl: 'https://oss/a' }])
        await flushPromises()

        // 过期请求不应触发 fetch 或 renderAsync
        expect(mockGlobalFetch).toHaveBeenCalledTimes(1)
        expect(mockGlobalFetch).toHaveBeenCalledWith('https://oss/b')
        expect(mockRenderAsync).toHaveBeenCalledTimes(1)
        expect(mockRenderAsync.mock.calls[0]![0]).toStrictEqual(makeBuffer('latest'))
    })
})
