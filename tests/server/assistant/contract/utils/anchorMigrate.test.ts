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

    it('L1：preferred 条款达标但非全局最优时，返回相似度更高的条款', () => {
        const anchor = '甲方应当按时付款并承担违约责任'
        const newClauses = makeClauses([
            // preferred（idx 0）：轻微改写，相似度达标（≥0.6）但非最优
            '第一条 甲方应当按时付款并承担相应责任。',
            // idx 1：含 anchor 原文，相似度 1.0（全局最优）
            '第三条 甲方应当按时付款并承担违约责任。',
        ])
        const result = migrateAnchor({
            oldAnchorQuote: anchor,
            preferredNewClauseArrayIdx: 0,
            newClauses,
        })
        expect(result).not.toBeNull()
        // 旧实现 fast-path「首个达标即返回」会锁定 idx 0；修复后纳入全局取 max → idx 1
        expect(result!.newClauseIndex).toBe(1)
        expect(result!.similarity).toBe(1)
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

describe('migrateAnchor S7：fallback 全文扫描上限保护', () => {
    it('超长条款 + fuzzy 失配 → 不做无界全文扫描，毫秒级返回', () => {
        // 2 万字条款 + 400 字 anchor（不在条款里）→ fallback 格点数远超上限 80k
        const hugeClause = '甲'.repeat(20000)
        const anchor = '乙'.repeat(400)
        const newClauses = makeClauses([hugeClause])
        const t0 = Date.now()
        const result = migrateAnchor({ oldAnchorQuote: anchor, preferredNewClauseArrayIdx: null, newClauses })
        const elapsed = Date.now() - t0
        // anchor 不在条款里 → 无匹配
        expect(result).toBeNull()
        // 加上限保护后毫秒级返回；无保护时约 4e6 格点全文扫描会卡数十秒
        expect(elapsed).toBeLessThan(2000)
    })
})
