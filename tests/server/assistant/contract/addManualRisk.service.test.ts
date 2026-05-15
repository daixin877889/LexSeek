/**
 * addManualRiskService 测试
 * **Feature: contract-add-risk-hover**
 */
import { describe, it, expect, afterEach } from 'vitest'
import { prisma } from '~~/server/utils/db'
import { addManualRiskService } from '~~/server/agents/contract/contractRisk.service'

describe('addManualRiskService', () => {
    const created = { reviews: [] as number[], users: [] as number[] }

    afterEach(async () => {
        await prisma.contractRisks.deleteMany({ where: { reviewId: { in: created.reviews } } })
        await prisma.contractReviews.deleteMany({ where: { id: { in: created.reviews } } })
        await prisma.users.deleteMany({ where: { id: { in: created.users } } })
        created.reviews = []
        created.users = []
    })

    async function seedReview(): Promise<number> {
        const user = await prisma.users.create({
            data: { name: '测试律师', phone: `199${Date.now().toString().slice(-8)}`, password: 'x' },
        })
        created.users.push(user.id)
        const review = await prisma.contractReviews.create({
            // originalFileId 是 NOT NULL 无默认列，传任意整数（无 FK 约束）
            data: { userId: user.id, sessionId: `s-${Date.now()}`, status: 'completed', originalFileId: 1 },
        })
        created.reviews.push(review.id)
        return review.id
    }

    it('插入一条 source=manual 的风险，定位字段与 stance 正确落库', async () => {
        const reviewId = await seedReview()
        const risk = await addManualRiskService({
            reviewId,
            clauseText: '第二条 试用期为 6 个月。',
            clauseParagraphIndex: 5,
            level: 'high',
            category: '试用期',
            problem: '试用期过长',
            legalBasis: null,
            analysis: '超过法定上限',
            suggestion: '改为不超过 6 个月',
            suggestedClauseText: '试用期为 2 个月。',
        })
        expect(risk.source).toBe('manual')
        expect(risk.clauseText).toBe('第二条 试用期为 6 个月。')
        expect(risk.clauseParagraphIndex).toBe(5)
        expect(risk.clauseIndex).toBe(5)
        expect(risk.stance).toBe('balanced')
        expect(risk.problematicQuote).toBeNull()
        expect(risk.suggestedClauseText).toBe('试用期为 2 个月。')
    })
})
