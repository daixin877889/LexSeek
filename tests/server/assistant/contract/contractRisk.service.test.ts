/**
 * contractRisk.service 测试
 *
 * 覆盖 CORE-R2 抽取的 persistAiRisksAsContractRows 字段映射。
 *
 * **Feature: contract-review-versioning Phase A/B refactor**
 * **Validates: CORE-R2**
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '~~/server/utils/db'
import { persistAiRisksAsContractRows, type PersistAiRiskRow } from '~~/server/agents/contract/contractRisk.service'
import type { Risk } from '#shared/types/contract'
import { ensureTestUser } from '../test-db-helper'

describe('contractRisk.service · persistAiRisksAsContractRows', () => {
    let reviewId: number
    let userId: number

    beforeEach(async () => {
        userId = await ensureTestUser()
        const review = await prisma.contractReviews.create({
            data: {
                userId,
                status: 'completed',
                risks: [],
                sessionId: `risk-svc-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                originalFileId: 0,
            },
        })
        reviewId = review.id
    })

    afterEach(async () => {
        await prisma.contractAnnotations.deleteMany({ where: { reviewId } })
        await prisma.contractRisks.deleteMany({ where: { reviewId } })
        await prisma.contractReviews.delete({ where: { id: reviewId } })
        await prisma.users.deleteMany({ where: { id: userId } })
    })

    function buildAiRisk(overrides: Partial<Risk> = {}): Risk {
        return {
            id: 'ai-risk-uuid',
            clauseIndex: 3,
            clauseText: '试用期为 6 个月。',
            level: 'high',
            category: '试用期',
            problem: '试用期超长',
            legalBasis: '《劳动合同法》第19条',
            analysis: '超过法定最长 6 个月违反规定',
            risk: '试用期超长可能导致违法',
            suggestion: '调整为不超过 6 个月',
            matchedPointCode: 'probation',
            ...overrides,
        }
    }

    it('首次审查路径：默认 source=ai、stance=balanced，clauseText 取 risk.clauseText', async () => {
        const aiRisk = buildAiRisk()
        const [created] = await persistAiRisksAsContractRows({
            reviewId,
            rows: [{
                risk: aiRisk,
                clauseParagraphIndex: 7,
            }],
        })

        expect(created).toBeDefined()
        expect(created!.reviewId).toBe(reviewId)
        expect(created!.source).toBe('ai')
        expect(created!.code).toBe('probation')
        expect(created!.category).toBe('试用期')
        expect(created!.level).toBe('high')
        expect(created!.stance).toBe('balanced')
        expect(created!.problem).toBe('试用期超长')
        expect(created!.legalBasis).toBe('《劳动合同法》第19条')
        expect(created!.analysis).toBe('超过法定最长 6 个月违反规定')
        expect(created!.suggestion).toBe('调整为不超过 6 个月')
        expect(created!.clauseText).toBe('试用期为 6 个月。')
        expect(created!.clauseParagraphIndex).toBe(7)
        expect(created!.originalClauseText).toBeNull()
        expect(created!.orphaned).toBe(false)
        // risk.id（前端 string UUID）不会写入 DB（DB id 是自增主键）
        expect(typeof created!.id).toBe('number')
        expect(created!.id).toBeGreaterThan(0)
    })

    it('增量审查路径：可显式覆盖 clauseText 与 stance', async () => {
        const aiRisk = buildAiRisk({ matchedPointCode: undefined, legalBasis: undefined })
        const [created] = await persistAiRisksAsContractRows({
            reviewId,
            rows: [{
                risk: aiRisk,
                clauseText: '客户改后的新条款全文',
                clauseParagraphIndex: 12,
            }],
            stance: 'strict',
        })

        expect(created!.clauseText).toBe('客户改后的新条款全文')
        expect(created!.clauseParagraphIndex).toBe(12)
        expect(created!.stance).toBe('strict')
        expect(created!.code).toBeNull()
        expect(created!.legalBasis).toBeNull()
    })

    it('Phase B 字段：originalClauseText 与 orphaned 仅在显式提供时写入', async () => {
        const [created] = await persistAiRisksAsContractRows({
            reviewId,
            rows: [{
                risk: buildAiRisk(),
                clauseParagraphIndex: null,
                originalClauseText: '迁移前的老条款',
                orphaned: true,
            }],
        })

        expect(created!.originalClauseText).toBe('迁移前的老条款')
        expect(created!.orphaned).toBe(true)
        expect(created!.clauseParagraphIndex).toBeNull()
    })

    it('AI 改写文本（suggestedClauseText）必须落库', async () => {
        const aiRisk = buildAiRisk({
            suggestedClauseText: '试用期为 3 个月，符合《劳动合同法》第19条规定。',
        })
        const [created] = await persistAiRisksAsContractRows({
            reviewId,
            rows: [{ risk: aiRisk, clauseParagraphIndex: 7 }],
        })
        expect(created!.suggestedClauseText).toBe('试用期为 3 个月，符合《劳动合同法》第19条规定。')
    })

    it('AI 未提供 suggestedClauseText（如 low 风险）时落 null', async () => {
        const aiRisk = buildAiRisk({ level: 'low', suggestedClauseText: undefined })
        const [created] = await persistAiRisksAsContractRows({
            reviewId,
            rows: [{ risk: aiRisk, clauseParagraphIndex: 7 }],
        })
        expect(created!.suggestedClauseText).toBeNull()
    })

    it('批量写入按入参顺序返回，便于调用方按 index 配对生成批注', async () => {
        const rows = [
            { risk: buildAiRisk({ category: 'A', clauseText: '甲条款' }), clauseParagraphIndex: 1 },
            { risk: buildAiRisk({ category: 'B', clauseText: '乙条款' }), clauseParagraphIndex: 2 },
            { risk: buildAiRisk({ category: 'C', clauseText: '丙条款' }), clauseParagraphIndex: 3 },
        ]
        const created = await persistAiRisksAsContractRows({ reviewId, rows })

        expect(created).toHaveLength(3)
        expect(created.map(r => r.category)).toEqual(['A', 'B', 'C'])
        expect(created.map(r => r.clauseText)).toEqual(['甲条款', '乙条款', '丙条款'])
        expect(created.map(r => r.clauseParagraphIndex)).toEqual([1, 2, 3])
    })

    // PR 3 主路径接入 splitSentences + resolveQuoteAnchor 后：
    // - 有 problemSentenceIds → quoteMatchSource='sentence_id'，quote 字段按 sentenceId 解析
    // - 没有 ids 但有 problematicQuote → quoteMatchSource='fuzzy'
    // - 两者都无 → quoteMatchSource='fallback'，quote 字段全 null
    // clauseIndex 由 risk.clauseIndex 填值（不再是 null）
    it('有 problemSentenceIds 时：quote_* 字段按 sentence_id 解析，quoteMatchSource=sentence_id', async () => {
        const clauseText = '第三条 工资支付。逾期支付的，每日按 0.05% 加收滞纳金。'
        const rows: PersistAiRiskRow[] = [{
            risk: buildAiRisk({
                clauseText,
                clauseIndex: 3,
                problemSentenceIds: [2],
                problematicQuote: '逾期支付的，每日按 0.05% 加收滞纳金',
            }),
        }]
        const created = await persistAiRisksAsContractRows({ reviewId, rows })
        const row = created[0]!
        expect(row.clauseText).toBe(clauseText)
        expect(row.clauseIndex).toBe(3)
        expect(row.quoteMatchSource).toBe('sentence_id')
        expect(row.problematicQuote).toBeTruthy()
        expect(row.quoteCharStart).not.toBeNull()
        expect(row.quoteCharEnd).not.toBeNull()
        expect(row.quoteCharEnd!).toBeGreaterThan(row.quoteCharStart!)
        // 解析出的 quote 必须是 clauseText 的子串
        expect(clauseText.slice(row.quoteCharStart!, row.quoteCharEnd!)).toBe(row.problematicQuote)
    })

    it('没有 problemSentenceIds 但有 problematicQuote → quoteMatchSource=fuzzy', async () => {
        const clauseText = '甲方应当履行义务。乙方支付报酬，逾期支付按 0.05% 加收。'
        const rows: PersistAiRiskRow[] = [{
            risk: buildAiRisk({
                clauseText,
                clauseIndex: 1,
                problemSentenceIds: [],
                problematicQuote: '逾期支付按 0.05% 加收',
            }),
        }]
        const created = await persistAiRisksAsContractRows({ reviewId, rows })
        const row = created[0]!
        expect(row.clauseIndex).toBe(1)
        expect(row.quoteMatchSource).toBe('fuzzy')
        expect(row.problematicQuote).toContain('0.05%')
        expect(row.quoteCharStart).not.toBeNull()
    })

    it('没有 problemSentenceIds 也没有 problematicQuote → quoteMatchSource=fallback，quote 字段全 null', async () => {
        const clauseText = '工资按月支付。'
        const rows: PersistAiRiskRow[] = [{
            risk: buildAiRisk({
                clauseText,
                clauseIndex: 2,
                problemSentenceIds: [],
                problematicQuote: undefined,
            }),
        }]
        const created = await persistAiRisksAsContractRows({ reviewId, rows })
        const row = created[0]!
        expect(row.clauseIndex).toBe(2)
        expect(row.quoteMatchSource).toBe('fallback')
        expect(row.problematicQuote).toBeNull()
        expect(row.quoteCharStart).toBeNull()
        expect(row.quoteCharEnd).toBeNull()
    })
})
