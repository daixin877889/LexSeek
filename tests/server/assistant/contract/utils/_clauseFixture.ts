/**
 * 合同测试共享 fixture：用真实 segmentClauses 切句产生 (newClauses, newDocxText)。
 *
 * 为什么不用手工拼装：
 *   - segmentClauses 内部用 lineStarts + trim offset 计算 offsetStart/End，段间空行 / 子项编号会
 *     让 segment 间的 char gap 不固定为 1（不是简单的 \n 分隔）。手工 fixture 的 `offset += text.length + 1`
 *     在多行 segment 上失真，单测全绿但生产偏移对不上。
 *   - 直接用真值才能让档 1 的 fuzzyLocateInText + segment 包含校验得到生产同等行为。
 *
 * 适用范围：所有需要 ClauseSnapshotItem[] + normalizedText 的合同业务测试。
 *
 * **Feature: contract-review-precise-anchoring**
 */
import type { ClauseSnapshotItem } from '#shared/types/contract'
import { segmentClauses } from '~~/server/agents/contract/docx/clauseSegmenter'

/**
 * 用真实 segmentClauses 把段落数组切成 ClauseSnapshotItem[] + normalizedText。
 *
 * @param paragraphs 一组段落（每段对应 docx 里一个 \<w:p\>）
 * @returns { newClauses, newDocxText } 与生产 uploadClientVersion Step 2 同等产物
 */
export async function makeClauseFixture(paragraphs: string[]): Promise<{
    newClauses: ClauseSnapshotItem[]
    newDocxText: string
}> {
    const { segments, normalizedText } = await segmentClauses(paragraphs.join('\n'))
    const newClauses: ClauseSnapshotItem[] = segments.map(s => ({
        index: s.index, // segmentClauses 1-based
        text: s.text,
        offsetStart: s.offsetStart,
        offsetEnd: s.offsetEnd,
    }))
    return { newClauses, newDocxText: normalizedText }
}
