/**
 * ContractDocxPreview 单元测试
 *
 * **Feature: contract-review-m4 + m6.1**
 *
 * 组件职责：
 * - 优先加载 reviewedFileId，空则 fallback 到 originalFileId
 * - 两个 fileId 都为 null → 显示"等待合同上传..."
 * - 通过 POST /api/v1/files/oss/download-url 拿签名 URL，再 fetch 拉 ArrayBuffer
 * - 使用 renderAsync 渲染到 containerRef
 * - fetchSeq 机制：快速连续变化 props 时只有最新一次生效
 * - M6.1：renderAsync 完成后注入 data-risk-ids；支持聚焦/钉/悬停态样式联动
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import type { Risk } from '#shared/types/contract'

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

// ── mock clauseLocator ──────────────────────────────────────────────────────

const mockLocateClauseElement = vi.fn()
vi.mock('#shared/utils/clauseLocator', () => ({
    locateClauseElement: (...args: unknown[]) => mockLocateClauseElement(...args),
    paragraphIndexOfElement: vi.fn(() => 0),
    isBodyParagraph: (el: Element | null) => !!el && el instanceof HTMLElement && el.tagName === 'P',
}))

// ── 动态导入（确保 mock 先完成）─────────────────────────────────────────────

const ContractDocxPreview = (await import('~/components/assistant/contract/ContractDocxPreview.vue'))
    .default

/** 基础挂载，risks 等新 props 使用默认空值 */
function mountPreview(props: {
    reviewedFileId: number | null
    originalFileId: number | null
    risks?: Risk[]
    focusedRiskId?: string | null
    hoveredRiskId?: string | null
    highlightedRiskIds?: Set<string>
}) {
    return mount(ContractDocxPreview, {
        props: {
            risks: [],
            focusedRiskId: null,
            hoveredRiskId: null,
            highlightedRiskIds: new Set<string>(),
            ...props,
        },
    })
}

/** 构造一条最小 Risk 用于测试 */
function makeRisk(id: string, clauseText: string, level: Risk['level'] = 'high'): Risk {
    return {
        id,
        clauseIndex: 1,
        clauseText,
        level,
        category: '责任条款',
        problem: '问题描述',
        analysis: '分析',
        risk: '风险',
        suggestion: '建议',
    }
}

/** 构造带 clauseText 内容的 DOM 段落，并追加到 container，返回该元素 */
function appendParagraph(container: HTMLElement, text: string): HTMLElement {
    const p = document.createElement('p')
    p.textContent = text
    container.appendChild(p)
    return p
}

function makeBuffer(tag = 'buf'): ArrayBuffer {
    return new TextEncoder().encode(tag).buffer
}

beforeEach(() => {
    mockRenderAsync.mockReset()
    mockRenderAsync.mockResolvedValue(undefined)
    mockUseApiFetch.mockReset()
    mockGlobalFetch.mockReset()
    mockLocateClauseElement.mockReset()
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

describe('ContractDocxPreview M6.1 风险标记联动', () => {
    /** 通用渲染+加载辅助：mock renderAsync 把 clauseText 段落写入 container */
    async function setupWithRisk(risk: Risk) {
        // renderAsync mock：把 clause 段落注入 container（模拟 docx-preview 渲染结果）
        mockRenderAsync.mockImplementation((_buf: unknown, container: HTMLElement) => {
            appendParagraph(container, risk.clauseText)
        })
        // locateClauseElement mock：返回 container 中包含 clauseText 的第一个段落
        mockLocateClauseElement.mockImplementation((container: HTMLElement, text: string) => {
            return container.querySelector('p') ?? null
        })
        mockUseApiFetch.mockResolvedValueOnce([{ ossFileId: 1, downloadUrl: 'https://oss/doc' }])
        mockGlobalFetch.mockResolvedValueOnce({ ok: true, arrayBuffer: async () => makeBuffer('doc') })

        const w = mountPreview({ reviewedFileId: 1, originalFileId: null, risks: [risk] })
        await flushPromises()
        return w
    }

    it('renderAsync 完成后对应段落被注入 data-risk-ids', async () => {
        const risk = makeRisk('r1', '乙方应在 30 天内支付款项')
        const w = await setupWithRisk(risk)

        const el = w.element.querySelector('[data-risk-ids~="r1"]')
        expect(el).not.toBeNull()
        expect((el as HTMLElement).dataset.riskLevel).toBe('high')
    })

    it('renderAsync 完成后段落被注入对应等级的底色 class', async () => {
        const risk = makeRisk('r2', '违约方承担全部损失', 'medium')
        const w = await setupWithRisk(risk)

        const el = w.element.querySelector('[data-risk-ids~="r2"]')
        expect(el).not.toBeNull()
        expect(el!.classList.contains('bg-amber-600/[0.05]')).toBe(true)
    })

    it('点击段落触发 focusRisk emit', async () => {
        const risk = makeRisk('r3', '合同一旦签署不得撤销')
        const w = await setupWithRisk(risk)

        const el = w.element.querySelector('[data-risk-ids~="r3"]') as HTMLElement
        expect(el).not.toBeNull()
        el.click()
        await flushPromises()

        expect(w.emitted('focusRisk')).toEqual([['r3']])
    })

    it('mouseenter 段落触发 hoverClause emit，mouseleave 触发 null', async () => {
        const risk = makeRisk('r4', '任何争议提交仲裁解决')
        const w = await setupWithRisk(risk)

        const el = w.element.querySelector('[data-risk-ids~="r4"]') as HTMLElement
        expect(el).not.toBeNull()

        el.dispatchEvent(new MouseEvent('mouseenter'))
        await flushPromises()
        expect(w.emitted('hoverClause')).toEqual([['r4']])

        el.dispatchEvent(new MouseEvent('mouseleave'))
        await flushPromises()
        expect(w.emitted('hoverClause')).toEqual([['r4'], [null]])
    })

    it('focusedRiskId 切换后对应段落获得聚焦高亮 class', async () => {
        const risk = makeRisk('r5', '甲方对乙方的损失不承担任何责任')
        const w = await setupWithRisk(risk)

        // 初始无聚焦（high 风险基线为 bg-red-600/[0.045]，无聚焦加深底色）
        const el = w.element.querySelector('[data-risk-ids~="r5"]')
        expect(el!.classList.contains('bg-red-600/[0.1]!')).toBe(false)

        // 设置 focusedRiskId
        await w.setProps({ focusedRiskId: 'r5' })
        await flushPromises()

        expect(el!.classList.contains('bg-red-600/[0.1]!')).toBe(true)
        expect(el!.classList.contains('ring-1')).toBe(true)
    })

    it('hoveredRiskId 切换后对应段落获得悬停高亮 class', async () => {
        const risk = makeRisk('r6', '本合同自双方签字盖章后生效')
        const w = await setupWithRisk(risk)

        const el = w.element.querySelector('[data-risk-ids~="r6"]')
        expect(el!.classList.contains('bg-red-600/[0.08]!')).toBe(false)

        await w.setProps({ hoveredRiskId: 'r6' })
        await flushPromises()

        expect(el!.classList.contains('bg-red-600/[0.08]!')).toBe(true)
        // hovered 不加聚焦 ring
        expect(el!.classList.contains('ring-1')).toBe(false)
    })

    it('focusedRiskId 清除后聚焦高亮 class 被移除', async () => {
        const risk = makeRisk('r7', '乙方须按时完成交付')
        const w = await setupWithRisk(risk)

        await w.setProps({ focusedRiskId: 'r7' })
        await flushPromises()

        const el = w.element.querySelector('[data-risk-ids~="r7"]')
        expect(el!.classList.contains('bg-red-600/[0.1]!')).toBe(true)

        await w.setProps({ focusedRiskId: null })
        await flushPromises()

        expect(el!.classList.contains('bg-red-600/[0.1]!')).toBe(false)
    })

    it('risks 连续触发 decorateRisks 不重复叠加 LEVEL_BG class', async () => {
        const risk = makeRisk('rx', '连续触发 decorate 不叠加', 'high')
        const w = await setupWithRisk(risk)

        const el = w.element.querySelector('[data-risk-ids~="rx"]') as HTMLElement
        expect(el).not.toBeNull()
        const classNameBefore = el.className

        // 触发 watch(() => props.risks, decorateRisks)：传入等价数组（新引用）
        await w.setProps({ risks: [risk] })
        await flushPromises()

        // 同一段已装饰，class 不应被再次追加（守卫跳过）
        expect(el.className).toBe(classNameBefore)
    })

    it('locateClauseElement 返回 null 时跳过该 risk，不报错', async () => {
        const risk = makeRisk('r8', '找不到的条款文本')
        mockRenderAsync.mockImplementation((_buf: unknown, container: HTMLElement) => {
            appendParagraph(container, '这是其他段落，不包含目标条款')
        })
        // 明确返回 null，模拟未找到
        mockLocateClauseElement.mockReturnValue(null)
        mockUseApiFetch.mockResolvedValueOnce([{ ossFileId: 1, downloadUrl: 'https://oss/doc' }])
        mockGlobalFetch.mockResolvedValueOnce({ ok: true, arrayBuffer: async () => makeBuffer('doc') })

        const w = mountPreview({ reviewedFileId: 1, originalFileId: null, risks: [risk] })
        await flushPromises()

        // 未找到时不注入任何 data-risk-id
        expect(w.element.querySelector('[data-risk-ids]')).toBeNull()
        // 也不应有报错（renderAsync 成功调用）
        expect(mockRenderAsync).toHaveBeenCalledTimes(1)
    })
})
