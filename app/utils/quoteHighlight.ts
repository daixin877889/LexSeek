/**
 * 风险卡 problematicQuote 字符级高亮工具（PR 5 / spec § 7）
 *
 * 主路径：CSS Custom Highlight API（baseline 2025/06，Chrome 105+ / Safari 17.2+ / Firefox 140）
 * 降级：浏览器不支持 CSS.highlights → 直接 return，不渲染字符级高亮
 *      （段落级浅色底由 ContractDocxPreview 段落级流程负责，仍生效）
 *
 * 按风险等级命名 Highlight：quote-high / quote-medium / quote-low，
 * 下划线颜色按等级染色（高=红 / 中=琥珀 / 低=天蓝），见全局 tailwind.css 的 ::highlight 规则。
 */

import { findByParagraphIndex } from '#shared/utils/clauseLocator'
import type { RiskDisplayPhaseB } from '#shared/types/contract'

const HIGHLIGHT_NAMES = ['quote-high', 'quote-medium', 'quote-low'] as const
type QuoteHighlightName = typeof HIGHLIGHT_NAMES[number]

function supportsCssHighlight(): boolean {
    return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof globalThis.Highlight === 'function'
}

/**
 * 在 paragraph 元素内 walk text node，按字符 offset 找到对应 (textNode, innerOffset)。
 *
 * 字符等价性：直接累加 `node.data.length`，不做 tab/<br> 映射；spec § 7.3.2 简化策略。
 * 防御兜底：缓存 lastTextNode，避免依赖 walker.previousNode 在 happy-dom 实现细节。
 */
function walkToTextNode(p: HTMLElement, charOffset: number): { node: Text; offset: number } | null {
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
    let consumed = 0
    let lastTextNode: Text | null = null
    let node = walker.nextNode() as Text | null
    while (node) {
        const len = node.data.length
        if (consumed + len >= charOffset) {
            return { node, offset: charOffset - consumed }
        }
        consumed += len
        lastTextNode = node
        node = walker.nextNode() as Text | null
    }
    // charOffset 大于段落总字符数：返回最后一个 text node 的末尾（边角防御）
    if (lastTextNode) return { node: lastTextNode, offset: lastTextNode.data.length }
    return null
}

/**
 * 从 risk 的双锚点字段构建一个跨 <p> / 跨 text node 的 DOM Range。
 *
 * 算法：
 *  1. 缺 quoteCharStart/End → null（§ 6.4 quote=null 降级路径）
 *  2. risk.clauseText 按 `\r?\n` 拆行（CRLF 安全），过滤空行得 `nonEmptyLines`
 *  3. 累加每行长度（含换行 1 字符）得 line 在 clauseText 内的 [start, end)
 *  4. quoteCharStart / End 落在哪个非空 line → startLineIdx + lineOffset
 *  5. 用 clauseLocator.findByParagraphIndex 找连续 N 个非空 <p>
 *  6. startLine 段落内 walkToTextNode → startAnchor；endLine 同理 → endAnchor
 *  7. document.createRange + setStart/setEnd 构建跨节点 Range
 *
 * 任一步 null/越界 → 返回 null（调用方跳过该 risk 的字符级渲染）
 */
export function computeQuoteRange(risk: RiskDisplayPhaseB, container: HTMLElement): Range | null {
    if (risk.quoteCharStart == null || risk.quoteCharEnd == null) return null
    if (risk.quoteCharStart >= risk.quoteCharEnd) return null
    if (risk.clauseParagraphIndex == null || risk.clauseParagraphIndex < 0) return null

    const allLines = risk.clauseText.split(/\r?\n/)
    type LinePos = { idx: number; start: number; end: number; text: string }
    const linePositions: LinePos[] = []
    let cursor = 0
    for (let i = 0; i < allLines.length; i++) {
        const text = allLines[i] ?? ''
        const start = cursor
        const end = cursor + text.length
        linePositions.push({ idx: i, start, end, text })
        cursor = end + 1
    }
    const nonEmptyLines = linePositions.filter(l => l.text.trim().length > 0)
    if (nonEmptyLines.length === 0) return null

    function locate(offset: number): { lineNo: number; lineOffset: number } | null {
        for (let i = 0; i < nonEmptyLines.length; i++) {
            const l = nonEmptyLines[i]!
            if (offset >= l.start && offset <= l.end) {
                return { lineNo: i, lineOffset: offset - l.start }
            }
        }
        return null
    }
    const startHit = locate(risk.quoteCharStart)
    const endHit = locate(risk.quoteCharEnd)
    if (!startHit || !endHit) return null

    const paragraphs: HTMLElement[] = []
    for (let i = 0; i < nonEmptyLines.length; i++) {
        const p = findByParagraphIndex(container, risk.clauseParagraphIndex + i)
        if (!p || !(p instanceof HTMLElement)) return null
        paragraphs.push(p)
    }

    const startAnchor = walkToTextNode(paragraphs[startHit.lineNo]!, startHit.lineOffset)
    const endAnchor = walkToTextNode(paragraphs[endHit.lineNo]!, endHit.lineOffset)
    if (!startAnchor || !endAnchor) return null

    try {
        const range = document.createRange()
        range.setStart(startAnchor.node, startAnchor.offset)
        range.setEnd(endAnchor.node, endAnchor.offset)
        return range
    } catch {
        return null
    }
}

/**
 * 把所有 risks 的 quote Range 按风险等级注册到命名 Highlight。
 *
 * 调用时机：renderAsync 完成 + 段落级 decorateRisks 完成之后；以及 risks 变化后由 watch 重画。
 * 浏览器不支持 CSS.highlights → 静默早出（与 spec § 6.4 quote=null 降级视觉一致）。
 */
export function decorateQuoteRanges(
    risks: RiskDisplayPhaseB[],
    container: HTMLElement,
): void {
    if (!supportsCssHighlight()) return

    clearAllQuoteHighlights()

    const buckets: Record<QuoteHighlightName, Highlight> = {
        'quote-high': new Highlight(),
        'quote-medium': new Highlight(),
        'quote-low': new Highlight(),
    }

    for (const risk of risks) {
        const range = computeQuoteRange(risk, container)
        if (!range) continue
        buckets[`quote-${risk.level}`].add(range)
    }

    for (const name of HIGHLIGHT_NAMES) {
        CSS.highlights.set(name, buckets[name])
    }
}

/**
 * 清空全部三个命名 Highlight。
 *
 * 调用时机：每次 docx-preview `target.innerHTML = ''` 之前 —— 浏览器替换容器 DOM 后，
 * Highlight 内部持有的 Range 引用旧 text node 失效（spec § 7.4 重渲染保护）。
 */
export function clearAllQuoteHighlights(): void {
    if (!supportsCssHighlight()) return
    CSS.highlights.clear()
}
