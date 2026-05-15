/**
 * 合同条款在 DOM 中的定位四级兜底
 *
 * clauseText 实际存储的是条款完整内容（常含 \n 分隔的多段落），
 * 但 docx-preview 的段落 DOM 每段独立，一次 `includes(fullClauseText)` 永远不中。
 * 因此按 \n 拆行、取前 3 行非空，任一命中即视为定位成功。
 *
 * 0. paragraphIndex 直定位（"非空段落序号"空间，与后端
 *    server/agents/contract/utils/clauseToParagraph.ts 同口径）
 *    —— 解决 reviewed docx 注入批注后段落 textContent 与原 clause_text 因
 *    全角/半角/特殊空格等微差异致文本匹配失败的问题
 * 1. 精确子串匹配（按块级元素，归一化空白；逐行尝试前 3 行）
 * 2. 模糊匹配：取首行前 20 字 + 去标点空白，作子串/前缀匹配
 * 3. 返回 null，由调用方显示"未定位"
 */
export function locateClauseElement(
    container: Element | null,
    clauseText: string,
    paragraphIndex?: number | null,
): Element | null {
    if (!container) return null

    // 优先级 0：按"非空段落序号"直接定位
    if (typeof paragraphIndex === 'number' && paragraphIndex >= 0) {
        const el = findByParagraphIndex(container, paragraphIndex)
        if (el) return el
        // 越界 → 落入文本匹配兜底
    }

    if (!clauseText) return null

    const lines = splitClauseLines(clauseText)
    if (lines.length === 0) return null

    for (const line of lines) {
        const el = findParagraphByText(container, line)
        if (el) return el
    }

    const fuzzy = lines[0]!
        .slice(0, 20)
        .replace(/[\s，。、；：（）()【】""'']+/g, '')
    if (fuzzy.length < 3) return null
    return findFuzzyMatch(container, fuzzy)
}

/** 拆行 + 归一化空白 + 过滤噪音短行，取前 3 行作为候选锚点 */
function splitClauseLines(clauseText: string): string[] {
    return clauseText
        .split(/\r?\n/)
        .map(l => l.replace(/\s+/g, ' ').trim())
        .filter(l => l.length >= 2)
        .slice(0, 3)
}

/**
 * docx-preview 渲染后的常见块级元素（段落、列表项、标题、表格单元格）。
 *
 * 注意：findByParagraphIndex 不使用 td，因为 td 内通常已含 p（会与后端
 * "非空段落序号"空间双重计数），用 PARA_BLOCK_SELECTOR 与 docx 原生 w:p 对齐。
 */
const BLOCK_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6, td'
/** 与后端 `clauseToParagraph.ts` 同口径的"非空段落"块级元素选择器（PR 5 复用） */
export const PARA_BLOCK_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6'

/**
 * 取容器内第 N 个非空块级元素（PARA_BLOCK_SELECTOR 范围）。
 * 与后端 `server/agents/contract/utils/clauseToParagraph.ts` 的"非空段落序号"同算法。
 *
 * PR 5 `app/utils/quoteHighlight.ts` 复用本函数。
 */
export function findByParagraphIndex(container: Element, paragraphIndex: number): Element | null {
    const blocks = container.querySelectorAll(PARA_BLOCK_SELECTOR)
    let count = 0
    for (const el of blocks) {
        const text = (el.textContent ?? '').trim()
        if (text.length === 0) continue
        if (count === paragraphIndex) return el
        count++
    }
    return null
}

/**
 * 取元素在「合同正文段落」序列中的 0-based 序号，供手动新增风险落库 clauseParagraphIndex。
 *
 * 口径对齐后端 buildClauseToParagraphMap（w:body 直接子级段落）——只统计
 * docx-preview 渲染出的 section.docx 的直接子级 <p>（非空）；表格 td 内、
 * 脚注内的段落不在该序号体系内，返回 -1。
 */
export function paragraphIndexOfElement(container: Element, target: Element): number {
    const section = container.querySelector('section.docx') ?? container
    let count = 0
    for (const el of Array.from(section.children)) {
        if (el.tagName !== 'P') continue
        if ((el.textContent ?? '').trim().length === 0) continue
        if (el === target) return count
        count++
    }
    return -1
}

function findParagraphByText(container: Element, text: string): Element | null {
    const blocks = container.querySelectorAll(BLOCK_SELECTOR)
    for (const el of blocks) {
        const content = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
        if (content && content.includes(text)) return el
    }
    return null
}

function findFuzzyMatch(container: Element, keyword: string): Element | null {
    const blocks = container.querySelectorAll(BLOCK_SELECTOR)
    for (const el of blocks) {
        const norm = (el.textContent ?? '').replace(/[\s，。、；：（）()【】""'']+/g, '')
        if (norm.length < 3) continue
        // 双向命中：DOM 文本包含 keyword，或 keyword 以 DOM 文本开头（DOM 文本是输入的前缀段落）
        if (norm.includes(keyword) || keyword.startsWith(norm)) return el
    }
    return null
}
