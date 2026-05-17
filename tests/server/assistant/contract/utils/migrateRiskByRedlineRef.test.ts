/**
 * migrateRiskByRedlineRef 单元测试（S5 · orphaned 修复）
 *
 * redline-aware 确定性锚点迁移：风险在回传 docx 的 redlineRefs.xml 登记过 paraIdxs 时，
 * 直接用「该段落最终态文本落在哪条 newClauses 条款内」确定性定位，绕开「原文锚点 vs
 * 定稿态语料」模糊匹配（orphaned 大批误判的根因）。
 *
 * **Validates: 合同审查 orphaned 专项 S5**
 */
import { describe, it, expect } from 'vitest'
import { migrateRiskByRedlineRef } from '~~/server/agents/contract/utils/anchorMigrate'
import { normalizeForMatch } from '~~/server/agents/contract/utils/textSimilarity'
import type { ParsedRedlineMarks } from '~~/server/agents/contract/docx/redlineParser'
import { makeClauseFixture } from './_clauseFixture'

function makeRedline(over: Partial<ParsedRedlineMarks>): ParsedRedlineMarks {
    return {
        reviewId: 100,
        refs: [],
        survivingInsIds: new Set(),
        survivingDelIds: new Set(),
        paragraphs: [],
        trustWordIds: true,
        ...over,
    }
}

describe('migrateRiskByRedlineRef（S5 redline-aware 确定性迁移）', () => {
    it('风险在 redlineRefs 登记 + paraIdx 段落落在某条款内 → 确定性定位该条款', async () => {
        const { newClauses } = await makeClauseFixture([
            '第一条 甲方应当按时支付货款。',
            '第二条 乙方应在收款后 7 日内交付货物，逾期的每日按 0.05% 加收滞纳金。',
        ])
        const redline = makeRedline({
            reviewId: 100,
            refs: [{ riskId: 42, delIds: [1], insId: 2, paraIdxs: [1] }],
            paragraphs: [
                { tNorm: normalizeForMatch(newClauses[0]!.text), delNorm: '', insNorm: '' },
                { tNorm: normalizeForMatch(newClauses[1]!.text), delNorm: '', insNorm: '' },
            ],
        })
        const result = migrateRiskByRedlineRef({ riskId: 42, redline, reviewId: 100, newClauses })
        expect(result).not.toBeNull()
        expect(result!.newClauseArrayIdx).toBe(1)
        expect(result!.newClauseText).toBe(newClauses[1]!.text)
        expect(result!.newClauseCharStart).toBe(newClauses[1]!.offsetStart)
        expect(result!.newClauseCharEnd).toBe(newClauses[1]!.offsetEnd)
    })

    it('风险不在 redlineRefs 登记 → 返回 null（交回模糊匹配）', async () => {
        const { newClauses } = await makeClauseFixture(['第一条 甲方应付款，乙方应交货以满足合同。'])
        const redline = makeRedline({ refs: [{ riskId: 1, delIds: [1], insId: 2, paraIdxs: [0] }] })
        expect(migrateRiskByRedlineRef({ riskId: 999, redline, reviewId: 100, newClauses })).toBeNull()
    })

    it('跨审查回传（reviewId 不符）→ 返回 null', async () => {
        const { newClauses } = await makeClauseFixture(['第一条 甲方应付款，乙方应交货以满足合同。'])
        const redline = makeRedline({
            reviewId: 999,
            refs: [{ riskId: 42, delIds: [1], insId: 2, paraIdxs: [0] }],
            paragraphs: [{ tNorm: normalizeForMatch(newClauses[0]!.text), delNorm: '', insNorm: '' }],
        })
        expect(migrateRiskByRedlineRef({ riskId: 42, redline, reviewId: 100, newClauses })).toBeNull()
    })

    it('redline 为 null（回传 docx 无修订标记）→ 返回 null', async () => {
        const { newClauses } = await makeClauseFixture(['第一条 甲方应付款，乙方应交货以满足合同。'])
        expect(migrateRiskByRedlineRef({ riskId: 42, redline: null, reviewId: 100, newClauses })).toBeNull()
    })

    it('paraIdx 段落文本在所有条款里都找不到 → 返回 null', async () => {
        const { newClauses } = await makeClauseFixture(['第一条 甲方应付款，乙方应交货以满足合同。'])
        const redline = makeRedline({
            refs: [{ riskId: 42, delIds: [1], insId: 2, paraIdxs: [0] }],
            paragraphs: [{ tNorm: normalizeForMatch('完全无关的另一份文档段落内容'), delNorm: '', insNorm: '' }],
        })
        expect(migrateRiskByRedlineRef({ riskId: 42, redline, reviewId: 100, newClauses })).toBeNull()
    })

    it('paraIdx 段落文本太短 → 跳过，返回 null（短文易跨条款误命中）', async () => {
        const { newClauses } = await makeClauseFixture(['第一条 甲方应付款，乙方应交货以满足合同。'])
        const redline = makeRedline({
            refs: [{ riskId: 42, delIds: [1], insId: 2, paraIdxs: [0] }],
            paragraphs: [{ tNorm: '短', delNorm: '', insNorm: '' }],
        })
        expect(migrateRiskByRedlineRef({ riskId: 42, redline, reviewId: 100, newClauses })).toBeNull()
    })

    it('多个 paraIdxs：跳过越界/不命中的，取首个命中的条款', async () => {
        const { newClauses } = await makeClauseFixture([
            '第一条 甲方应当按时支付货款。',
            '第二条 乙方应在收款后 7 日内交付货物，逾期的每日按 0.05% 加收滞纳金。',
        ])
        const redline = makeRedline({
            refs: [{ riskId: 42, delIds: [1], insId: 2, paraIdxs: [99, 1] }],
            paragraphs: [
                { tNorm: normalizeForMatch(newClauses[0]!.text), delNorm: '', insNorm: '' },
                { tNorm: normalizeForMatch(newClauses[1]!.text), delNorm: '', insNorm: '' },
            ],
        })
        const result = migrateRiskByRedlineRef({ riskId: 42, redline, reviewId: 100, newClauses })
        expect(result!.newClauseArrayIdx).toBe(1)
    })
})
