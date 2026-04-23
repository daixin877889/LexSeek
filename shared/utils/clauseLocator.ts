/**
 * 合同条款在 DOM 中的定位三级兜底
 *
 * clauseText 实际存储的是条款完整内容（常含 \n 分隔的多段落），
 * 但 docx-preview 的段落 DOM 每段独立，一次 `includes(fullClauseText)` 永远不中。
 * 因此按 \n 拆行、取前 3 行非空，任一命中即视为定位成功。
 *
 * 1. 精确子串匹配（按块级元素，归一化空白；逐行尝试前 3 行）
 * 2. 模糊匹配：取首行前 20 字 + 去标点空白，作子串/前缀匹配
 * 3. 返回 null，由调用方显示"未定位"
 */
export function locateClauseElement(container: Element | null, clauseText: string): Element | null {
    if (!container || !clauseText) return null

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

/** docx-preview 渲染后的常见块级元素（段落、列表项、标题、表格单元格） */
const BLOCK_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6, td'

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
