import { describe, it, expect } from 'vitest'
import type { ClauseSnapshotItem } from '#shared/types/contract'
import { migrateAnchor } from '~~/server/agents/contract/utils/anchorMigrate'

function makeClauses(texts: string[]): ClauseSnapshotItem[] {
    let offset = 0
    return texts.map((text, index) => {
        const item: ClauseSnapshotItem = { index, text, offsetStart: offset, offsetEnd: offset + text.length }
        offset += text.length + 1
        return item
    })
}

describe('migrateAnchor', () => {
    it('同 index 精确匹配：返回正确偏移', () => {
        const newClauses = makeClauses(['第一条 甲方应按时付款，不得拖延。', '第二条 乙方应按时交货。'])
        const anchor = '甲方应按时付款'
        const result = migrateAnchor({
            oldAnchorQuote: anchor,
            preferredNewClauseArrayIdx: 0,
            newClauses,
        })
        expect(result).not.toBeNull()
        expect(result!.newClauseIndex).toBe(0)
        expect(result!.similarity).toBe(1)
        const text = newClauses[0].text
        expect(text.slice(result!.newCharStart, result!.newCharEnd)).toBe(anchor)
    })

    it('同 index 微改找到：相似度高且 charStart/End 合理', () => {
        // 条款被轻微修改（多一个字）
        const newClauses = makeClauses(['第一条 甲方应当按时付款，不得拖延。', '第二条 乙方交货。'])
        const result = migrateAnchor({
            oldAnchorQuote: '甲方应按时付款',
            preferredNewClauseArrayIdx: 0,
            newClauses,
        })
        expect(result).not.toBeNull()
        expect(result!.newClauseIndex).toBe(0)
        expect(result!.similarity).toBeGreaterThanOrEqual(0.6)
    })

    it('大改导致找不到：返回 null', () => {
        // 条款内容完全不同
        const newClauses = makeClauses(['XYZXYZXYZ ABCABC DEF GHIJKL MNOPQRSTUVWXYZ啊啊啊啊啊啊啊啊啊啊啊啊啊'])
        const result = migrateAnchor({
            oldAnchorQuote: '甲方应按时付款，不得拖延',
            preferredNewClauseArrayIdx: 0,
            newClauses,
        })
        expect(result).toBeNull()
    })

    it('跨条款迁移：同 index 无匹配，全局扫描找到', () => {
        // oldParagraphIndex=0 的条款内容已改变，anchor 内容移到 index=1
        const newClauses = makeClauses([
            '第一条 本合同适用中华人民共和国法律。',
            '第二条 甲方应按时付款，不得拖延。',
        ])
        const result = migrateAnchor({
            oldAnchorQuote: '甲方应按时付款',
            preferredNewClauseArrayIdx: 0,
            newClauses,
        })
        expect(result).not.toBeNull()
        expect(result!.newClauseIndex).toBe(1)
        expect(result!.similarity).toBeGreaterThanOrEqual(0.6)
    })

    it('空输入（newClauses 为空）：返回 null', () => {
        const result = migrateAnchor({
            oldAnchorQuote: '甲方应按时付款',
            preferredNewClauseArrayIdx: 0,
            newClauses: [],
        })
        expect(result).toBeNull()
    })

    it('oldAnchorQuote 为空字符串：返回 null', () => {
        const newClauses = makeClauses(['第一条 甲方应按时付款。'])
        const result = migrateAnchor({
            oldAnchorQuote: '',
            preferredNewClauseArrayIdx: 0,
            newClauses,
        })
        expect(result).toBeNull()
    })

    it('自定义 similarityThreshold 生效：阈值过高时返回 null', () => {
        const newClauses = makeClauses(['第一条 甲方应当按时付款，不得拖延。'])
        const result = migrateAnchor({
            oldAnchorQuote: '甲方应按时付款',
            preferredNewClauseArrayIdx: 0,
            newClauses,
            similarityThreshold: 0.999,
        })
        // 微改导致相似度 < 0.999，期望返回 null
        expect(result).toBeNull()
    })
})
