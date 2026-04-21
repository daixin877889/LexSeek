/**
 * 合同条款在 DOM 中的定位三级兜底
 *
 * 1. 精确子串匹配 clauseText 全文
 * 2. 模糊匹配：取前 20 字 + 去标点空白，作子串匹配
 * 3. 返回 null，由调用方显示"未定位"
 */
export function locateClauseElement(container: Element | null, clauseText: string): Element | null {
    if (!container || !clauseText) return null

    // 第 1 级：精确
    const exact = findTextMatch(container, clauseText)
    if (exact) return exact

    // 第 2 级：模糊（前 20 字 + 去标点空白）
    const fuzzy = clauseText
        .slice(0, 20)
        .replace(/[\s，。、；：（）()【】""'']+/g, '')
    if (fuzzy.length < 3) return null  // 太短的关键词不做模糊，容易误命中
    return findFuzzyMatch(container, fuzzy)
}

function findTextMatch(container: Element, text: string): Element | null {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
        if (walker.currentNode.textContent?.includes(text)) {
            return (walker.currentNode.parentElement ?? null)
        }
    }
    return null
}

function findFuzzyMatch(container: Element, keyword: string): Element | null {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
        const norm = (walker.currentNode.textContent ?? '').replace(/[\s，。、；：（）()【】""'']+/g, '')
        if (norm.length < 3) continue  // norm 太短跳过，避免单字符误命中
        // 双向命中：DOM 文本包含 keyword，或 keyword 以 DOM 文本开头（DOM 文本是输入的前缀段落）
        if (norm.includes(keyword) || keyword.startsWith(norm)) {
            return (walker.currentNode.parentElement ?? null)
        }
    }
    return null
}
