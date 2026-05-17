/**
 * quoteHighlight 工具函数单测
 *
 * **Feature: contract-review-precise-anchoring (PR 5)**
 * **Validates: spec § 7.3.1 / 7.3.3 / 7.6 / 6.4 + § 10.1 测试矩阵 ① ② ③ ④ ⑤**
 *
 * 核心场景：
 *  1. computeQuoteRange · 单段 quote 命中
 *  2. computeQuoteRange · 跨多 <p> 的 quote（含 \n 多行 clauseText）
 *  3. computeQuoteRange · 跨多 <span> 的 quote（quote 起止落在 run 内部）
 *  4. computeQuoteRange · quoteCharStart=null 降级返回 null（spec § 6.4）
 *  5. clearAllQuoteHighlights · 清空全部命名 Highlight
 *  6. decorateQuoteRanges · CSS.highlights 不可用时早出
 *  7. decorateQuoteRanges · 按风险等级分桶到 quote-high/medium/low
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
    computeQuoteRange,
    decorateQuoteRanges,
    clearAllQuoteHighlights,
} from '~/utils/quoteHighlight'
import type { RiskDisplayPhaseB } from '#shared/types/contract'

function makeRisk(over: Partial<RiskDisplayPhaseB> = {}): RiskDisplayPhaseB {
    return {
        id: 'risk-1',
        clauseIndex: 0,
        clauseText: '工资按月支付。逾期支付的，每日按 0.05% 加收滞纳金。',
        clauseParagraphIndex: 0,
        level: 'medium',
        category: '违约金',
        problem: '违约金过低',
        analysis: '分析',
        risk: '风险',
        suggestion: '建议',
        problematicQuote: '每日按 0.05% 加收滞纳金',
        quoteCharStart: 13,
        quoteCharEnd: 28,
        ...over,
    } as RiskDisplayPhaseB
}

function buildContainer(html: string): HTMLElement {
    const container = document.createElement('div')
    container.innerHTML = html
    document.body.appendChild(container)
    return container
}

class MockHighlight {
    private ranges: Range[] = []
    add(r: Range) { this.ranges.push(r) }
    clear() { this.ranges = [] }
    get size() { return this.ranges.length }
    values(): IterableIterator<Range> { return this.ranges[Symbol.iterator]() }
}

const mockHighlightRegistry = new Map<string, MockHighlight>()

function installCssHighlightMock() {
    mockHighlightRegistry.clear()
    vi.stubGlobal('CSS', {
        highlights: {
            set(name: string, h: MockHighlight) { mockHighlightRegistry.set(name, h) },
            get(name: string) { return mockHighlightRegistry.get(name) ?? null },
            delete(name: string) { return mockHighlightRegistry.delete(name) },
            has(name: string) { return mockHighlightRegistry.has(name) },
            clear() { mockHighlightRegistry.clear() },
        },
    })
    // @ts-expect-error 全局 Highlight 在 happy-dom 不存在；测试注入
    globalThis.Highlight = MockHighlight
}

function uninstallCssHighlightMock() {
    vi.unstubAllGlobals()
    // @ts-expect-error 清理
    delete globalThis.Highlight
    mockHighlightRegistry.clear()
}

describe('quoteHighlight 工具函数', () => {
    afterEach(() => {
        document.body.innerHTML = ''
        uninstallCssHighlightMock()
    })

    it('computeQuoteRange · 单段 quote 命中（最常见路径）', () => {
        const container = buildContainer(
            '<p>工资按月支付。逾期支付的，每日按 0.05% 加收滞纳金。</p>',
        )
        const range = computeQuoteRange(makeRisk(), container)
        expect(range).not.toBeNull()
        expect(range!.toString()).toBe('每日按 0.05% 加收滞纳金')
    })

    it('computeQuoteRange · 跨多 <p> 的 quote（spec § 10.1 ①）', () => {
        // clauseText 含 \n 拆 2 行 → 对应 docx 渲染 2 个 <p>
        // 行 1 "工资按月支付。" 长度 7；加 \n = 8。行 2 起点 = 8
        const container = buildContainer(
            '<p>工资按月支付。</p><p>逾期支付的，每日按 0.05% 加收滞纳金。</p>',
        )
        const risk = makeRisk({
            clauseText: '工资按月支付。\n逾期支付的，每日按 0.05% 加收滞纳金。',
            problematicQuote: '工资按月支付。\n逾期支付的',
            quoteCharStart: 0,
            quoteCharEnd: 8 + 5, // 行 1 全部 + \n + 行 2 前 5 字"逾期支付的"
        })
        const range = computeQuoteRange(risk, container)
        expect(range).not.toBeNull()
        expect(range!.startContainer).not.toBe(range!.endContainer)
        const text = range!.toString()
        expect(text.includes('工资按月支付')).toBe(true)
        expect(text.includes('逾期支付的')).toBe(true)
    })

    it('computeQuoteRange · 跨多 <span> 的 quote（spec § 10.1 ②跨 run）', () => {
        // 同一 <p> 内 4 个 <span>，quote 跨 span 2-3
        const container = buildContainer(
            '<p>'
            + '<span>工资按月支付。</span>'
            + '<span>逾期支付的，</span>'
            + '<span>每日按 0.05% 加收滞纳金</span>'
            + '<span>。</span>'
            + '</p>',
        )
        const range = computeQuoteRange(makeRisk(), container)
        expect(range).not.toBeNull()
        // 起止应落在不同 text node（跨 span）
        expect(range!.startContainer).not.toBe(range!.endContainer)
        expect(range!.toString()).toBe('每日按 0.05% 加收滞纳金')
    })

    it('computeQuoteRange · quoteCharStart=null 降级返回 null（spec § 6.4）', () => {
        const container = buildContainer('<p>任意段落文本</p>')
        const range = computeQuoteRange(
            makeRisk({ quoteCharStart: null, quoteCharEnd: null, problematicQuote: null }),
            container,
        )
        expect(range).toBeNull()
    })

    it('clearAllQuoteHighlights · 清空全部命名 Highlight', () => {
        installCssHighlightMock()
        const cssAny = (globalThis.CSS as any)
        cssAny.highlights.set('quote-high', new MockHighlight())
        cssAny.highlights.set('quote-medium', new MockHighlight())
        cssAny.highlights.set('quote-low', new MockHighlight())
        expect(cssAny.highlights.has('quote-high')).toBe(true)

        clearAllQuoteHighlights()

        expect(cssAny.highlights.has('quote-high')).toBe(false)
        expect(cssAny.highlights.has('quote-medium')).toBe(false)
        expect(cssAny.highlights.has('quote-low')).toBe(false)
    })

    it('decorateQuoteRanges · CSS.highlights 不可用时早出（spec § 7.3.3）', () => {
        // 不安装 mock；CSS.highlights / Highlight 全局不存在 → 不应抛错
        const container = buildContainer(
            '<p>工资按月支付。逾期支付的，每日按 0.05% 加收滞纳金。</p>',
        )
        expect(() => decorateQuoteRanges([makeRisk()], container)).not.toThrow()
    })

    it('decorateQuoteRanges · 按风险等级分桶到 quote-high/medium/low', () => {
        installCssHighlightMock()
        const container = buildContainer(
            '<p>工资按月支付。逾期支付的，每日按 0.05% 加收滞纳金。</p>',
        )
        decorateQuoteRanges([makeRisk({ id: 'r1', level: 'high' })], container)
        const cssAny = (globalThis.CSS as any)
        expect((cssAny.highlights.get('quote-high') as MockHighlight).size).toBe(1)
        expect((cssAny.highlights.get('quote-medium') as MockHighlight).size).toBe(0)
        expect((cssAny.highlights.get('quote-low') as MockHighlight).size).toBe(0)
    })
})
