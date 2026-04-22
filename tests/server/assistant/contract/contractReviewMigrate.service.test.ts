/**
 * 存量 ContractReview.risks JSON 迁移 Service 测试
 *
 * **Feature: contract-review-versioning-phase-a**
 * **Validates: Plan Task 4.2**
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '~~/server/utils/db'
import {
    migrateLegacyRisksService,
    migrateAllLegacyRisksService,
} from '~~/server/services/assistant/contract/contractReviewMigrate.service'
import { ensureTestUser } from '../test-db-helper'

describe('contractReviewMigrate.service', () => {
    let reviewId: number
    let userId: number

    beforeEach(async () => {
        userId = await ensureTestUser()
    })

    afterEach(async () => {
        if (reviewId) {
            await prisma.contractReviewVersions.deleteMany({ where: { reviewId } })
            await prisma.contractAnnotations.deleteMany({ where: { reviewId } })
            await prisma.contractRisks.deleteMany({ where: { reviewId } })
            await prisma.contractReviews.delete({ where: { id: reviewId } }).catch(() => {})
        }
        await prisma.users.deleteMany({ where: { id: userId } }).catch(() => {})
        reviewId = 0
    })

    it('迁移带 3 条 legacy risks 的 review，生成 ContractRisk/Annotation + v1 快照', async () => {
        const legacyRisks = [
            {
                id: 'uuid-1',
                clauseIndex: 1,
                clauseText: '试用期条款',
                level: 'high',
                category: '试用期',
                problem: '试用期过长',
                legalBasis: '劳动合同法第19条',
                analysis: '超过法定上限',
                risk: '风险高',
                suggestion: '缩短为1个月',
                suggestion_text: '缩短',
            },
            {
                id: 'uuid-2',
                clauseIndex: 2,
                clauseText: '保密条款',
                level: 'medium',
                category: '保密义务',
                problem: '保密范围过宽',
                analysis: '超出合理范围',
                risk: '有风险',
                suggestion: '明确保密范围',
            },
            {
                id: 'uuid-3',
                clauseIndex: 3,
                clauseText: '竞业限制',
                level: 'low',
                category: '竞业限制',
                problem: '区域过宽',
                analysis: '无合理限制',
                risk: '低风险',
                suggestion: '限定行业范围',
            },
        ]

        const review = await prisma.contractReviews.create({
            data: {
                userId,
                status: 'completed',
                risks: legacyRisks as any,
                sessionId: `migrate-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                originalFileId: 0,
                maxVersionNo: 0,
            },
        })
        reviewId = review.id

        const result = await migrateLegacyRisksService(reviewId)

        expect(result.migrated).toBe(true)
        expect(result.risksCreated).toBe(3)

        // 检查 ContractRisk 行
        const risks = await prisma.contractRisks.findMany({ where: { reviewId } })
        expect(risks).toHaveLength(3)
        expect(risks[0].category).toBe('试用期')
        expect(risks[0].level).toBe('high')
        expect(risks[0].anchorQuote).toBe('试用期条款')
        expect(risks[0].source).toBe('ai')

        // 检查 ContractAnnotation 行（每条 risk 各一条 authorType=ai）
        const annotations = await prisma.contractAnnotations.findMany({ where: { reviewId } })
        expect(annotations).toHaveLength(3)
        expect(annotations.every(a => a.authorType === 'ai')).toBe(true)
        expect(annotations.every(a => a.authorName === 'AI')).toBe(true)
        expect(annotations[0].content).toContain('高风险')

        // 检查 v1 initial_upload 快照
        const versions = await prisma.contractReviewVersions.findMany({ where: { reviewId } })
        expect(versions).toHaveLength(1)
        expect(versions[0].versionNumber).toBe(1)
        expect(versions[0].systemLabel).toBe('initial_upload')

        // 检查 review.currentVersionId 已更新
        const updatedReview = await prisma.contractReviews.findUnique({ where: { id: reviewId } })
        expect(updatedReview?.currentVersionId).toBe(versions[0].id)
        expect(updatedReview?.maxVersionNo).toBe(1)
    })

    it('再次迁移同一 review 时幂等跳过', async () => {
        const legacyRisks = [
            { id: 'u1', clauseIndex: 1, clauseText: '测试条款', level: 'low', category: '其他', problem: 'p', analysis: 'a', risk: 'r', suggestion: 's' },
        ]

        const review = await prisma.contractReviews.create({
            data: {
                userId,
                status: 'completed',
                risks: legacyRisks as any,
                sessionId: `migrate-idempotent-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                originalFileId: 0,
                maxVersionNo: 0,
            },
        })
        reviewId = review.id

        // 第一次迁移
        const r1 = await migrateLegacyRisksService(reviewId)
        expect(r1.migrated).toBe(true)

        // 第二次调用：currentVersionId 已非 null，应跳过
        const r2 = await migrateLegacyRisksService(reviewId)
        expect(r2.migrated).toBe(false)
        expect(r2.risksCreated).toBe(0)

        // 确保没有重复写入
        const risks = await prisma.contractRisks.findMany({ where: { reviewId } })
        expect(risks).toHaveLength(1)
    })

    it('risks JSON 为空的 review（审查失败类）不迁移', async () => {
        const review = await prisma.contractReviews.create({
            data: {
                userId,
                status: 'failed',
                risks: [] as any,
                sessionId: `migrate-empty-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                originalFileId: 0,
                maxVersionNo: 0,
            },
        })
        reviewId = review.id

        const result = await migrateLegacyRisksService(reviewId)
        expect(result.migrated).toBe(false)
        expect(result.risksCreated).toBe(0)

        const versions = await prisma.contractReviewVersions.findMany({ where: { reviewId } })
        expect(versions).toHaveLength(0)
    })

    it('不存在的 reviewId 返回 migrated=false', async () => {
        reviewId = 0 // 避免 afterEach 报错
        const result = await migrateLegacyRisksService(999999999)
        expect(result.migrated).toBe(false)
    })
})

describe('migrateAllLegacyRisksService', () => {
    const createdReviewIds: number[] = []
    let userId: number

    beforeEach(async () => {
        userId = await ensureTestUser()
    })

    afterEach(async () => {
        for (const id of createdReviewIds) {
            await prisma.contractReviewVersions.deleteMany({ where: { reviewId: id } })
            await prisma.contractAnnotations.deleteMany({ where: { reviewId: id } })
            await prisma.contractRisks.deleteMany({ where: { reviewId: id } })
            await prisma.contractReviews.delete({ where: { id } }).catch(() => {})
        }
        createdReviewIds.length = 0
        await prisma.users.deleteMany({ where: { id: userId } }).catch(() => {})
    })

    it('批量迁移统计数据正确', async () => {
        const legacyRisk = { id: 'u1', clauseIndex: 1, clauseText: 'c', level: 'low', category: 'c', problem: 'p', analysis: 'a', risk: 'r', suggestion: 's' }

        // 创建 2 个有 legacy risks 的 review
        for (let i = 0; i < 2; i++) {
            const r = await prisma.contractReviews.create({
                data: {
                    userId,
                    status: 'completed',
                    risks: [legacyRisk] as any,
                    sessionId: `migrate-all-${Date.now()}-${i}-${Math.random().toString(36).slice(2)}`,
                    originalFileId: 0,
                    maxVersionNo: 0,
                },
            })
            createdReviewIds.push(r.id)
        }

        // 创建 1 个 risks=[] 的 review（应被跳过）
        const emptyR = await prisma.contractReviews.create({
            data: {
                userId,
                status: 'failed',
                risks: [] as any,
                sessionId: `migrate-all-empty-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                originalFileId: 0,
                maxVersionNo: 0,
            },
        })
        createdReviewIds.push(emptyR.id)

        const result = await migrateAllLegacyRisksService()

        // processed 包含所有 currentVersionId=null 的 review（含其他测试遗留的，所以只验证 migrated >= 2）
        expect(result.migrated).toBeGreaterThanOrEqual(2)
        expect(result.processed).toBeGreaterThanOrEqual(3)
    })
})
