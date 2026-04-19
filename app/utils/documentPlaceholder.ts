/**
 * 文档占位符替换工具
 *
 * **Feature: assistant-document-placeholder (#7)**
 *
 * 背景：docx-preview 把 Word 模板渲染成 DOM 时，{{xxx}} 常被 Word 的 rsidR
 * 等元数据拆到多个 <w:r> → 多个 <span> → 多个 Text 节点。逐 Text 节点跑
 * 正则匹配无法命中跨节点的 {{xxx}}。
 *
 * 本模块的策略：
 * 1. 首次渲染后扫描块级容器（p / li / h1-h6），为每个容器快照其所有后代
 *    Text 节点 + 原始 nodeValue。
 * 2. 每次替换前先清理上轮注入的"额外节点"，再复原原始 nodeValue。
 * 3. 合并块内所有 Text 节点为一个字符串，按正则切片为 文本/占位符 序列。
 * 4. 把第一个 Text 节点清空，按序作为兄弟节点插入：未填的占位符用
 *    `<span class="docx-placeholder-unfilled">{{xxx}}</span>` 包裹，
 *    便于样式上做"比正文更浅"的视觉降权；其余文本作为普通 Text 节点插入。
 * 5. 其余原始 Text 节点置空，确保 textContent 仅由首节点 + 注入节点组成。
 */

/** 占位符名允许除 `{` `}` 和空白外的任意字符（中英文、数字、下划线、斜杠等） */
export const PLACEHOLDER_RE = /\{\{([^{}\s]+)\}\}/g

/** 块级容器选择器：段落 + 列表项 + 标题 */
const BLOCK_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6'

/** 未填占位符的 CSS class，DocumentPreview.vue 用它做"颜色更浅"的样式 */
export const PLACEHOLDER_UNFILLED_CLASS = 'docx-placeholder-unfilled'

interface Block {
    textNodes: Text[]
    originalValues: string[]
    /** 上一轮 writeback 注入到 DOM 的节点（占位符 span / 文本片段），下一轮先清理 */
    extraNodes: Node[]
}

export interface PlaceholderSnapshot {
    blocks: Block[]
}

/** 收集 root 下所有块级容器的 Text 节点及其原始内容 */
export function capturePlaceholderSnapshot(root: HTMLElement): PlaceholderSnapshot {
    const blocks: Block[] = []
    const blockEls = root.querySelectorAll(BLOCK_SELECTOR)
    const targets: Element[] = blockEls.length > 0 ? Array.from(blockEls) : [root]
    for (const el of targets) {
        const textNodes: Text[] = []
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
        while (walker.nextNode()) {
            textNodes.push(walker.currentNode as Text)
        }
        if (textNodes.length === 0) continue
        blocks.push({
            textNodes,
            originalValues: textNodes.map(n => n.nodeValue ?? ''),
            extraNodes: [],
        })
    }
    return { blocks }
}

type Part = { text: string; placeholder: boolean }

/** 把合并后的字符串切成 [text|placeholder] 序列；未填值仍保留原 `{{xxx}}` 文本 */
function splitMerged(merged: string, values: Record<string, string | null>): Part[] {
    const parts: Part[] = []
    let lastIndex = 0
    PLACEHOLDER_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = PLACEHOLDER_RE.exec(merged)) !== null) {
        if (m.index > lastIndex) {
            parts.push({ text: merged.slice(lastIndex, m.index), placeholder: false })
        }
        const v = values[m[1]!]
        parts.push(
            v == null
                ? { text: m[0], placeholder: true }
                : { text: String(v), placeholder: false },
        )
        lastIndex = m.index + m[0].length
    }
    if (lastIndex < merged.length) {
        parts.push({ text: merged.slice(lastIndex), placeholder: false })
    }
    return parts
}

/**
 * 按段落合并替换：
 *  - 清理上轮注入节点 → 复原原始文本 → 切片 → 写回首节点 + 兄弟节点
 *  - 未填占位符包成 `<span class="docx-placeholder-unfilled">`，由 CSS 着色
 */
export function replacePlaceholdersWithSnapshot(
    snapshot: PlaceholderSnapshot,
    values: Record<string, string | null>,
): void {
    for (const block of snapshot.blocks) {
        // 0. 清理上一轮注入的额外节点（避免重播时越积越多）
        for (const n of block.extraNodes) n.parentNode?.removeChild(n)
        block.extraNodes.length = 0

        // 1. 复原原始 nodeValue
        for (let i = 0; i < block.textNodes.length; i++) {
            block.textNodes[i]!.nodeValue = block.originalValues[i]!
        }

        const merged = block.originalValues.join('')
        // 本块根本不含占位符，无需任何 DOM 改动
        if (!merged.includes('{{')) continue

        const parts = splitMerged(merged, values)

        const first = block.textNodes[0]!
        const parent = first.parentNode
        if (!parent) continue

        // 2. 第一个 Text 节点清空，按序作为兄弟节点插入新内容
        first.nodeValue = ''
        let anchor: Node = first
        for (const p of parts) {
            let node: Node
            if (p.placeholder) {
                const span = document.createElement('span')
                span.className = PLACEHOLDER_UNFILLED_CLASS
                span.textContent = p.text
                node = span
            } else {
                node = document.createTextNode(p.text)
            }
            parent.insertBefore(node, anchor.nextSibling)
            block.extraNodes.push(node)
            anchor = node
        }

        // 3. 其余原始 Text 节点置空，避免与新插入内容重复
        for (let i = 1; i < block.textNodes.length; i++) {
            block.textNodes[i]!.nodeValue = ''
        }
    }
}
