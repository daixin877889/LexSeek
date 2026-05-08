/**
 * migrateRiskWithDualAnchor 单元测试
 *
 * Spec §9.2 三档 fallback：
 *   档 1：problematicQuote 在 newDocxText 上 fuzzy 命中 → 回查 newClauses 找包含的 segment
 *         （命中后做相似度二次校验，长 quote >32 字 Bitap probe 仅前 32 字会假阳）
 *   档 2：档 1 失败（quote 为 null / fuzzy miss / 跨段 / 相似度过低）→ migrateAnchor 走 clauseText
 *   档 3：两档都失败 → null
 *
 * **Feature: contract-review-precise-anchoring**
 * **Validates: spec §9.2**
 */
import { describe, it, expect } from 'vitest'
import { migrateRiskWithDualAnchor } from '~~/server/agents/contract/utils/anchorMigrate'
import { makeClauseFixture } from './_clauseFixture'

describe('migrateRiskWithDualAnchor', () => {
    describe('档 1：quote 优先', () => {
        it('quote 在新文档完全相同位置：matchType=quote, 重摘 quote + 重算 segment 内偏移', async () => {
            const { newClauses, newDocxText } = await makeClauseFixture([
                '第一条 甲方应当按时支付货款。',
                '第二条 乙方应在收款后 7 日内交付货物，逾期支付的，每日按 0.05% 加收滞纳金。',
            ])
            const result = migrateRiskWithDualAnchor({
                oldClauseText: '第二条 乙方应在收款后 7 日内交付货物，逾期支付的，每日按 0.05% 加收滞纳金。',
                oldProblematicQuote: '逾期支付的，每日按 0.05% 加收滞纳金',
                preferredNewClauseArrayIdx: 1,
                newClauses,
                newDocxText,
            })
            expect(result).not.toBeNull()
            expect(result!.matchType).toBe('quote')
            expect(result!.newClauseArrayIdx).toBe(1)
            expect(result!.newClauseText).toBe(newClauses[1]!.text)
            expect(result!.newClauseCharStart).toBe(newClauses[1]!.offsetStart)
            expect(result!.newClauseCharEnd).toBe(newClauses[1]!.offsetEnd)
            expect(result!.newProblematicQuote).toBe('逾期支付的，每日按 0.05% 加收滞纳金')
            expect(result!.newQuoteCharStart).toBeGreaterThanOrEqual(0)
            // segment 内相对 offset 切片应等于 quote 原文
            expect(
                result!.newClauseText.slice(result!.newQuoteCharStart!, result!.newQuoteCharEnd!),
            ).toBe('逾期支付的，每日按 0.05% 加收滞纳金')
        })

        it('quote 落到了不同的 clause 上（条款顺序被客户调整）：matchType=quote, newClauseArrayIdx 跟着 quote 走', async () => {
            const { newClauses, newDocxText } = await makeClauseFixture([
                '第一条 乙方应在收款后 7 日内交付货物，逾期支付的，每日按 0.05% 加收滞纳金。',
                '第二条 甲方应当按时支付货款。',
            ])
            const result = migrateRiskWithDualAnchor({
                oldClauseText: '第二条 乙方应在收款后 7 日内交付货物。',
                oldProblematicQuote: '逾期支付的，每日按 0.05% 加收滞纳金',
                preferredNewClauseArrayIdx: 1, // 先验是错的
                newClauses,
                newDocxText,
            })
            expect(result).not.toBeNull()
            expect(result!.matchType).toBe('quote')
            expect(result!.newClauseArrayIdx).toBe(0) // 跟着 quote 走，不是 preferredIdx
            expect(result!.newProblematicQuote).toBe('逾期支付的，每日按 0.05% 加收滞纳金')
        })

        it('长 quote (>32 字 Bitap probe 上限)：命中后相似度校验通过 → 档 1', async () => {
            // 80 字 quote，超过 dmp Match_MaxBits=32，wrapper 必须在 fuzzy 命中后做相似度二次校验
            // 这条 case 防止"档 1 假阳"（probe 前 32 字命中但 hit.end 推算落在不相关字符上）
            const longQuote = '乙方逾期支付货款超过 30 日的，甲方有权单方解除合同，并要求乙方按合同总价 20% 支付违约金，且不影响甲方就实际损失追偿权利'
            const newClauseText = `第三条 ${longQuote}。`
            const { newClauses, newDocxText } = await makeClauseFixture([
                '第一条 双方应诚实信用履行本合同。',
                newClauseText,
            ])
            const result = migrateRiskWithDualAnchor({
                oldClauseText: newClauseText, // 内容未改
                oldProblematicQuote: longQuote,
                preferredNewClauseArrayIdx: 1,
                newClauses,
                newDocxText,
            })
            expect(result).not.toBeNull()
            expect(result!.matchType).toBe('quote')
            expect(result!.newProblematicQuote).toBe(longQuote)
            // 切片回原 quote
            expect(
                result!.newClauseText.slice(result!.newQuoteCharStart!, result!.newQuoteCharEnd!),
            ).toBe(longQuote)
        })

        it('长 quote 后半被改写：fuzzy 前 32 字命中但相似度校验不过 → 落档 2', async () => {
            // 旧 quote 80 字，新文档把 quote 后 50 字改写但保留前 30 字 → Bitap probe 命中但 slice 后相似度低
            const oldQuote = '乙方逾期支付货款超过 30 日的，甲方有权单方解除合同，并要求乙方按合同总价 20% 支付违约金，且不影响甲方就实际损失追偿权利'
            const newClauseText = '第三条 乙方逾期支付货款超过 30 日的，双方应当友好协商解决争议，必要时可以申请仲裁。'
            const { newClauses, newDocxText } = await makeClauseFixture([
                '第一条 双方应诚实信用履行本合同。',
                newClauseText,
            ])
            const result = migrateRiskWithDualAnchor({
                oldClauseText: '第三条 ' + oldQuote + '。',
                oldProblematicQuote: oldQuote,
                preferredNewClauseArrayIdx: 1,
                newClauses,
                newDocxText,
            })
            // 不强求一定 match 成功（取决于 clauseText fuzzy 阈值），但绝不能档 1 假阳
            // 档 1 假阳的表现是 matchType='quote' + newProblematicQuote 不等于 oldQuote
            if (result?.matchType === 'quote') {
                throw new Error(`档 1 假阳：probe 命中但相似度未守住，得到 quote=${result.newProblematicQuote}`)
            }
            // 期望落档 2 或 orphaned 都可接受
            expect(result === null || result.matchType === 'clause').toBe(true)
        })
    })

    describe('档 2：clause fallback', () => {
        it('quote 为 null（PR3 之前的旧 risk）：直接走 clauseText fuzzy', async () => {
            const { newClauses, newDocxText } = await makeClauseFixture([
                '第一条 甲方应当按时支付货款。',
                '第二条 乙方应在收款后 7 日内交付货物。',
            ])
            const result = migrateRiskWithDualAnchor({
                oldClauseText: '第二条 乙方应在收款后 7 日内交付货物。',
                oldProblematicQuote: null,
                preferredNewClauseArrayIdx: 1,
                newClauses,
                newDocxText,
            })
            expect(result).not.toBeNull()
            expect(result!.matchType).toBe('clause')
            expect(result!.newClauseArrayIdx).toBe(1)
            expect(result!.newClauseText).toBe(newClauses[1]!.text)
            expect(result!.newClauseCharStart).toBe(newClauses[1]!.offsetStart)
            expect(result!.newClauseCharEnd).toBe(newClauses[1]!.offsetEnd)
            expect(result!.newProblematicQuote).toBeNull()
            expect(result!.newQuoteCharStart).toBeNull()
            expect(result!.newQuoteCharEnd).toBeNull()
        })

        it('quote 在新文档已被客户彻底删除：fuzzy miss → 落档 2', async () => {
            // 新条款长度需 ≥ 老条款 75%（绕开 migrateAnchor 25% 长度容差边界），
            // 且与老条款相似度 ≥ 0.6（默认 similarityThreshold）。删掉的"违约的应承担责任"
            // 那一句替换为不含 quote 字符的等长 filler，使 fuzzy 一定 miss、clause fuzzy 仍能命中。
            const { newClauses, newDocxText } = await makeClauseFixture([
                '第一条 甲方应当按时支付货款。',
                '第二条 乙方应在收款后 7 日内交付货物，由甲方完成全部验收。',
            ])
            const result = migrateRiskWithDualAnchor({
                oldClauseText: '第二条 乙方应在收款后 7 日内交付货物，违约的应承担责任。',
                oldProblematicQuote: '违约的应承担责任',
                preferredNewClauseArrayIdx: 1,
                newClauses,
                newDocxText,
            })
            expect(result).not.toBeNull()
            expect(result!.matchType).toBe('clause')
            expect(result!.newClauseArrayIdx).toBe(1)
            expect(result!.newProblematicQuote).toBeNull()
            expect(result!.newQuoteCharStart).toBeNull()
        })

        it('quote 太短（<4 字符）：跳过档 1，走档 2', async () => {
            const { newClauses, newDocxText } = await makeClauseFixture([
                '第一条 甲方应当按时支付货款。',
            ])
            const result = migrateRiskWithDualAnchor({
                oldClauseText: '第一条 甲方应当按时支付货款。',
                oldProblematicQuote: '货款', // 2 字符
                preferredNewClauseArrayIdx: 0,
                newClauses,
                newDocxText,
            })
            expect(result).not.toBeNull()
            expect(result!.matchType).toBe('clause')
        })
    })

    describe('档 3：orphaned', () => {
        it('quote miss + clause 也找不到（条款完全被替换）：返回 null', async () => {
            const { newClauses, newDocxText } = await makeClauseFixture([
                'XYZXYZXYZ ABCABC DEF GHIJKL MNOPQRSTUVWXYZ啊啊啊啊啊啊啊啊啊啊啊啊啊',
            ])
            const result = migrateRiskWithDualAnchor({
                oldClauseText: '第二条 乙方应在收款后 7 日内交付货物。',
                oldProblematicQuote: '逾期支付的，每日按 0.05% 加收滞纳金',
                preferredNewClauseArrayIdx: 0,
                newClauses,
                newDocxText,
            })
            expect(result).toBeNull()
        })

        it('newClauses 为空：返回 null', () => {
            const result = migrateRiskWithDualAnchor({
                oldClauseText: '第一条 甲方应支付。',
                oldProblematicQuote: '甲方应支付',
                preferredNewClauseArrayIdx: null,
                newClauses: [],
                newDocxText: '',
            })
            expect(result).toBeNull()
        })
    })

    describe('档 1 边界：quote 跨 segment 边界', () => {
        it('quote 起点在某 segment 内但终点超过该 segment：判档 1 失败，落档 2', async () => {
            // 必须用「第X条」编号让 segmentClauses 真切 2 段（无编号会并入"无标号散段"单段，
            // 测不到跨段边界）。quote 横跨 segment[0] 末尾 + segment[1] 开头。
            const { newClauses, newDocxText } = await makeClauseFixture([
                '第一条 前段简短。',
                '第二条 后段且包含很长的内容用于 fallback 命中且确保 migrateAnchor 能匹配上的足够长度版本。',
            ])
            const result = migrateRiskWithDualAnchor({
                oldClauseText: '第二条 后段且包含很长的内容用于 fallback 命中且确保 migrateAnchor 能匹配上的足够长度版本。',
                oldProblematicQuote: '简短。\n第二条', // quote 跨越 segment[0] 末尾 + segment[1] 开头
                preferredNewClauseArrayIdx: 1,
                newClauses,
                newDocxText,
            })
            expect(result).not.toBeNull()
            // quote 跨段 → 档 1 失败 → 走档 2 → 命中 segment[1]
            expect(result!.matchType).toBe('clause')
            expect(result!.newClauseArrayIdx).toBe(1)
        })
    })
})
