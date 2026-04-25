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
import { persistAiRisksAsContractRows } from '~~/server/services/assistant/contract/contractRisk.service'
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

    it('首次审查路径：默认 source=ai、stance=balanced，anchorQuote 取 risk.clauseText', async () => {
        const aiRisk = buildAiRisk()
        const [created] = await persistAiRisksAsContractRows({
            reviewId,
            rows: [{
                risk: aiRisk,
                anchorParagraphIndex: 7,
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
        expect(created!.anchorQuote).toBe('试用期为 6 个月。')
        expect(created!.anchorParagraphIndex).toBe(7)
        expect(created!.originalAnchorQuote).toBeNull()
        expect(created!.orphaned).toBe(false)
        // risk.id（前端 string UUID）不会写入 DB（DB id 是自增主键）
        expect(typeof created!.id).toBe('number')
        expect(created!.id).toBeGreaterThan(0)
    })

    it('增量审查路径：可显式覆盖 anchorQuote 与 stance', async () => {
        const aiRisk = buildAiRisk({ matchedPointCode: undefined, legalBasis: undefined })
        const [created] = await persistAiRisksAsContractRows({
            reviewId,
            rows: [{
                risk: aiRisk,
                anchorQuote: '客户改后的新条款全文',
                anchorParagraphIndex: 12,
            }],
            stance: 'strict',
        })

        expect(created!.anchorQuote).toBe('客户改后的新条款全文')
        expect(created!.anchorParagraphIndex).toBe(12)
        expect(created!.stance).toBe('strict')
        expect(created!.code).toBeNull()
        expect(created!.legalBasis).toBeNull()
    })

    it('Phase B 字段：originalAnchorQuote 与 orphaned 仅在显式提供时写入', async () => {
        const [created] = await persistAiRisksAsContractRows({
            reviewId,
            rows: [{
                risk: buildAiRisk(),
                anchorParagraphIndex: null,
                originalAnchorQuote: '迁移前的老条款',
                orphaned: true,
            }],
        })

        expect(created!.originalAnchorQuote).toBe('迁移前的老条款')
        expect(created!.orphaned).toBe(true)
        expect(created!.anchorParagraphIndex).toBeNull()
    })

    it('批量写入按入参顺序返回，便于调用方按 index 配对生成批注', async () => {
        const rows = [
            { risk: buildAiRisk({ category: 'A', clauseText: '甲条款' }), anchorParagraphIndex: 1 },
            { risk: buildAiRisk({ category: 'B', clauseText: '乙条款' }), anchorParagraphIndex: 2 },
            { risk: buildAiRisk({ category: 'C', clauseText: '丙条款' }), anchorParagraphIndex: 3 },
        ]
        const created = await persistAiRisksAsContractRows({ reviewId, rows })

        expect(created).toHaveLength(3)
        expect(created.map(r => r.category)).toEqual(['A', 'B', 'C'])
        expect(created.map(r => r.anchorQuote)).toEqual(['甲条款', '乙条款', '丙条款'])
        expect(created.map(r => r.anchorParagraphIndex)).toEqual([1, 2, 3])
    })
})
