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
 * 2. 每次替换前先复原原始 nodeValue（让替换操作可重播 / 可跨次字段变更）。
 * 3. 合并块内所有 Text 节点为一个字符串，在合并字符串上跑正则替换。
 * 4. 把替换后的整段字符串写到第一个 Text 节点，其余节点置空。
 *
 * 未选 td/th/tr：docx-preview 在 table cell 内也会包 <p>，选 p 已足够命中。
 * 避免双计同一 Text 节点。
 */

/** 占位符名允许除 `{` `}` 和空白外的任意字符（中英文、数字、下划线、斜杠等） */
export const PLACEHOLDER_RE = /\{\{([^{}\s]+)\}\}/g

/** 块级容器选择器：段落 + 列表项 + 标题 */
const BLOCK_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6'

interface Block {
    textNodes: Text[]
    originalValues: string[]
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
        })
    }
    return { blocks }
}

/** 按段落合并替换：先复原原始文本，再合并 → 正则替换 → 写回第一个节点 */
export function replacePlaceholdersWithSnapshot(
    snapshot: PlaceholderSnapshot,
    values: Record<string, string | null>,
): void {
    for (const block of snapshot.blocks) {
        // 1. 复原原始 nodeValue，保证本次替换从原始文本出发
        for (let i = 0; i < block.textNodes.length; i++) {
            block.textNodes[i]!.nodeValue = block.originalValues[i]!
        }
        // 2. 合并本块所有 Text 节点内容
        const merged = block.originalValues.join('')
        // 3. 正则替换：未命中（key 不存在或 value 为 null）则保留原占位符
        const replaced = merged.replace(PLACEHOLDER_RE, (match, name: string) => {
            const v = values[name]
            return v == null ? match : String(v)
        })
        // 4. 未发生变化时跳过，避免不必要写操作
        if (replaced === merged) continue
        // 5. 替换后的整段字符串写到第一个 Text 节点，其余置空
        block.textNodes[0]!.nodeValue = replaced
        for (let i = 1; i < block.textNodes.length; i++) {
            block.textNodes[i]!.nodeValue = ''
        }
    }
}
