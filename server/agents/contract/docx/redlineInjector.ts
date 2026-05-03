/**
 * OOXML Track Changes（修订模式）注入。
 *
 * 主实现在 Task 7 / Task 8 完成；Task 5 仅占位 RedlineWrapTarget 类型供 commentInjector
 * 单向 import（避免循环依赖：commentInjector → redlineInjector，反向不存在）。
 */

/**
 * redlineInjector 装填后单条 risk 的修订段坐标（spec §8.3.6）。
 *
 * 跨段 risk 的 paragraphSpans 含多个元素：commentRange 的 Start 在第一段 del 之前、
 * End 在最后段 ins 之后（或最后段 del 之后，无 ins 时）。
 *
 * 类型只在 commentInjector ⇄ redlineInjector 流转，前端不消费 → 放 server 端
 * （非 shared，参考 .claude/rules/types.md）。commentInjector 单向 import，无循环依赖。
 */
export interface RedlineWrapTarget {
    paragraphSpans: Array<{
        /** 段落在 collectNonEmptyParagraphs 数组里的索引 */
        paraIdx: number
        /** 该段内 w:del 节点的 w:id（commentInjector 据此 grep 节点位置） */
        delId: number
        /** 该段内 w:ins 节点的 w:id；null = 跨段非结尾段（无 ins） */
        insId: number | null
    }>
}
