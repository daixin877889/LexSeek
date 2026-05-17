/**
 * clauseToParagraph 工具单元测试。
 *
 * 重点覆盖 M8 新增的 buildClauseToBodyParagraphMap：把条款序号从「分析口径」段落序号
 * （递归含表格）换算成「批注注入口径」body 直接段落序号；表格内条款映射为 null。
 *
 * **Validates: 审计修复 M8（段落口径统一）**
 */
import { describe, it, expect } from 'vitest'
import {
    buildClauseToParagraphMap,
    buildClauseToBodyParagraphMap,
} from '~~/server/agents/contract/utils/clauseToParagraph'
import type { ClauseSnapshotItem } from '#shared/types/contract'

/** 按段落文本构造最小 segments（offsetStart 落在 paragraphs.join('\n') 中各段起点）。 */
function segmentsFromParagraphs(paragraphs: string[]): ClauseSnapshotItem[] {
    const segments: ClauseSnapshotItem[] = []
    let cursor = 0
    for (let i = 0; i < paragraphs.length; i++) {
        const text = paragraphs[i]!
        segments.push({ index: i + 1, text, offsetStart: cursor, offsetEnd: cursor + text.length })
        cursor += text.length + 1 // +1 为 '\n' 分隔符
    }
    return segments
}

describe('buildClauseToBodyParagraphMap', () => {
    it('表格内条款映射为 null，body 直接段落条款映射为 body 直接段落序号', () => {
        // paragraphs：分析口径（递归含表格）4 段；中间两段在表格内
        const paragraphs = ['正文一', '表格段甲', '表格段乙', '正文二']
        // bodyParagraphIndex：表格段为 null，body 直接段为其在 bodyParagraphs 中的下标
        const bodyParagraphIndex: (number | null)[] = [0, null, null, 1]
        const segments = segmentsFromParagraphs(paragraphs)

        const map = buildClauseToBodyParagraphMap(segments, paragraphs, bodyParagraphIndex)

        expect(map.get(1)).toBe(0)      // 正文一 → body 直接段落 0
        expect(map.get(2)).toBeNull()   // 表格段甲 → 表格内，无法注入批注
        expect(map.get(3)).toBeNull()   // 表格段乙 → 表格内
        expect(map.get(4)).toBe(1)      // 正文二 → body 直接段落 1
    })

    it('无表格（bodyParagraphIndex 为 identity）时，与 buildClauseToParagraphMap 结果一致', () => {
        const paragraphs = ['条款一', '条款二', '条款三']
        const bodyParagraphIndex: (number | null)[] = [0, 1, 2]
        const segments = segmentsFromParagraphs(paragraphs)

        const bodyMap = buildClauseToBodyParagraphMap(segments, paragraphs, bodyParagraphIndex)
        const analysisMap = buildClauseToParagraphMap(segments, paragraphs)

        for (const seg of segments) {
            expect(bodyMap.get(seg.index)).toBe(analysisMap.get(seg.index))
        }
    })
})
