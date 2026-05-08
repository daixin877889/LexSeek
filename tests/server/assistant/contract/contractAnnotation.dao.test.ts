/**
 * ContractAnnotation DAO 测试
 *
 * **Feature: contract-review-versioning-phase-a**
 * **Validates: Plan Task 2.2**
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '~~/server/utils/db'
import {
    createContractAnnotationDAO,
    updateContractAnnotationDAO,
    listContractAnnotationsByRiskDAO,
    listContractAnnotationsByReviewDAO,
    softDeleteContractAnnotationDAO,
    getContractAnnotationByIdDAO,
    restoreAnnotationPushDAO,
} from '~~/server/agents/contract/contractAnnotation.dao'
import { createContractRiskDAO } from '~~/server/agents/contract/contractRisk.dao'
import { ensureTestUser } from '../test-db-helper'

describe('contractAnnotation.dao', () => {
    let reviewId: number
    let riskId: number
    let userId: number

    beforeEach(async () => {
        userId = await ensureTestUser()
        const review = await prisma.contractReviews.create({
            data: {
                userId,
                status: 'completed',
                risks: [],
                sessionId: `ann-dao-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                originalFileId: 0,
            },
        })
        reviewId = review.id
        const risk = await createContractRiskDAO({
            reviewId,
            source: 'ai',
            category: '试用期',
            level: 'high',
            stance: 'balanced',
            problem: '超长试用期',
            clauseText: '试用期 6 个月',
        })
        riskId = risk.id
    })

    afterEach(async () => {
        await prisma.contractAnnotations.deleteMany({ where: { reviewId } })
        await prisma.contractRisks.deleteMany({ where: { reviewId } })
        await prisma.contractReviews.delete({ where: { id: reviewId } })
        await prisma.users.deleteMany({ where: { id: userId } })
    })

    it('create 写入（含 authorType / authorName / content）', async () => {
        const ann = await createContractAnnotationDAO({
            reviewId,
            riskId,
            authorType: 'ai',
            authorName: 'AI',
            content: '风险分析：超长试用期',
        })
        expect(ann.id).toBeGreaterThan(0)
        expect(ann.authorType).toBe('ai')
        expect(ann.content).toBe('风险分析：超长试用期')
        expect(ann.deletedAt).toBeNull()
    })

    it('create 含 parentAnnotationId 时成功建立父子关系', async () => {
        const parent = await createContractAnnotationDAO({
            reviewId,
            riskId,
            authorType: 'ai',
            authorName: 'AI',
            content: '原始批注',
        })
        const reply = await createContractAnnotationDAO({
            reviewId,
            riskId,
            parentAnnotationId: parent.id,
            authorType: 'lawyer',
            authorName: '张律师',
            authorUserId: userId,
            content: '律师回复',
        })
        expect(reply.parentAnnotationId).toBe(parent.id)
    })

    it('list 按 riskId 返回，软删的不返回', async () => {
        const ann1 = await createContractAnnotationDAO({
            reviewId,
            riskId,
            authorType: 'ai',
            authorName: 'AI',
            content: '批注1',
        })
        const ann2 = await createContractAnnotationDAO({
            reviewId,
            riskId,
            authorType: 'lawyer',
            authorName: '律师',
            authorUserId: userId,
            content: '批注2',
        })
        // 软删 ann2
        await softDeleteContractAnnotationDAO(ann2.id)

        const list = await listContractAnnotationsByRiskDAO(riskId)
        expect(list.length).toBe(1)
        expect(list[0]!.id).toBe(ann1.id)
    })

    it('listContractAnnotationsByReviewDAO 过滤软删', async () => {
        const ann1 = await createContractAnnotationDAO({
            reviewId,
            riskId,
            authorType: 'ai',
            authorName: 'AI',
            content: '批注1',
        })
        const ann2 = await createContractAnnotationDAO({
            reviewId,
            riskId,
            authorType: 'lawyer',
            authorName: '律师',
            authorUserId: userId,
            content: '批注2',
        })
        await softDeleteContractAnnotationDAO(ann2.id)

        const list = await listContractAnnotationsByReviewDAO(reviewId)
        expect(list.length).toBe(1)
        expect(list[0]!.id).toBe(ann1.id)
    })

    it('update content 生效', async () => {
        const ann = await createContractAnnotationDAO({
            reviewId,
            riskId,
            authorType: 'lawyer',
            authorName: '律师',
            authorUserId: userId,
            content: '初始内容',
        })
        const updated = await updateContractAnnotationDAO(ann.id, { content: '修改后内容' })
        expect(updated.content).toBe('修改后内容')
    })

    it('softDelete 只设 deletedAt，数据行仍在 DB', async () => {
        const ann = await createContractAnnotationDAO({
            reviewId,
            riskId,
            authorType: 'lawyer',
            authorName: '律师',
            authorUserId: userId,
            content: '待软删',
        })
        await softDeleteContractAnnotationDAO(ann.id)

        // 直接查 DB，不走 DAO 过滤
        const raw = await prisma.contractAnnotations.findUnique({ where: { id: ann.id } })
        expect(raw).not.toBeNull()
        expect(raw?.deletedAt).not.toBeNull()

        // DAO 过滤后不返回
        const listResult = await listContractAnnotationsByRiskDAO(riskId)
        expect(listResult.find(a => a.id === ann.id)).toBeUndefined()
    })

    it('getById 能正确返回单条（包含软删的）', async () => {
        const ann = await createContractAnnotationDAO({
            reviewId,
            riskId,
            authorType: 'ai',
            authorName: 'AI',
            content: '测试内容',
        })
        const found = await getContractAnnotationByIdDAO(ann.id)
        expect(found?.id).toBe(ann.id)
    })

    it('restoreAnnotationPush 仅清 suppressInExport，removedByClient 保留为 true', async () => {
        const ann = await createContractAnnotationDAO({
            reviewId,
            riskId,
            authorType: 'ai',
            authorName: 'AI',
            content: '被客户删掉的批注',
        })
        // 模拟 uploadClientVersion 标记客户已删
        await prisma.contractAnnotations.update({
            where: { id: ann.id },
            data: { removedByClient: true, suppressInExport: true },
        })

        const restored = await restoreAnnotationPushDAO(ann.id)
        expect(restored.suppressInExport).toBe(false)
        // removedByClient 必须保留作为历史证据
        expect(restored.removedByClient).toBe(true)
    })
})
