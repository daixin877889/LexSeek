/**
 * ContractReviewVersion Service 测试
 *
 * **Feature: contract-review-versioning-phase-a**
 * **Validates: Plan Task 2.4**
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '~~/server/utils/db'
import {
    saveContractReviewVersionService,
    loadContractReviewVersionSnapshotService,
} from '~~/server/agents/contract/contractReviewVersion.service'
import { createContractRiskDAO } from '~~/server/agents/contract/contractRisk.dao'
import { createContractAnnotationDAO } from '~~/server/agents/contract/contractAnnotation.dao'
import { ensureTestUser } from '../test-db-helper'

describe('contractReviewVersion.service', () => {
    let reviewId: number
    let userId: number

    beforeEach(async () => {
        userId = await ensureTestUser()
        const review = await prisma.contractReviews.create({
            data: {
                userId,
                status: 'completed',
                risks: [],
                sessionId: `ver-svc-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                originalFileId: 0,
                maxVersionNo: 0,
            },
        })
        reviewId = review.id
    })

    afterEach(async () => {
        await prisma.contractReviewVersions.deleteMany({ where: { reviewId } })
        await prisma.contractAnnotations.deleteMany({ where: { reviewId } })
        await prisma.contractRisks.deleteMany({ where: { reviewId } })
        await prisma.contractReviews.delete({ where: { id: reviewId } })
        await prisma.users.deleteMany({ where: { id: userId } })
    })

    it('saveContractReviewVersionService 原子递增 versionNumber', async () => {
        const v1 = await saveContractReviewVersionService({
            reviewId,
            systemLabel: 'lawyer_save',
            createdById: userId,
        })
        const v2 = await saveContractReviewVersionService({
            reviewId,
            systemLabel: 'lawyer_save',
            createdById: userId,
        })
        expect(v1.versionNumber).toBe(1)
        expect(v2.versionNumber).toBe(2)

        const review = await prisma.contractReviews.findUnique({ where: { id: reviewId } })
        expect(review?.maxVersionNo).toBe(2)
        expect(review?.currentVersionId).toBe(v2.id)
    })

    it('snapshotData 包含工作区 risks/annotations 的全量拷贝', async () => {
        const risk = await createContractRiskDAO({
            reviewId,
            source: 'ai',
            category: 'x',
            level: 'high',
            stance: 'balanced',
            problem: 'x',
            anchorQuote: 'x',
        })
        await createContractAnnotationDAO({
            reviewId,
            riskId: risk.id,
            authorType: 'ai',
            authorName: 'AI',
            content: '测试批注',
        })
        const v1 = await saveContractReviewVersionService({
            reviewId,
            systemLabel: 'lawyer_save',
            createdById: userId,
        })

        const loaded = await loadContractReviewVersionSnapshotService(v1.id)
        if ('error' in loaded) throw new Error('snapshot 应返回 data')
        expect(loaded.data.snapshot.risks.length).toBe(1)
        expect(loaded.data.snapshot.annotations.length).toBe(1)
    })

    it('软删的批注不进入 snapshot', async () => {
        const risk = await createContractRiskDAO({
            reviewId,
            source: 'ai',
            category: 'x',
            level: 'high',
            stance: 'balanced',
            problem: 'x',
            anchorQuote: 'x',
        })
        const ann = await createContractAnnotationDAO({
            reviewId,
            riskId: risk.id,
            authorType: 'lawyer',
            authorName: '律师',
            authorUserId: userId,
            content: '待软删',
        })
        // 软删这条批注
        await prisma.contractAnnotations.update({
            where: { id: ann.id },
            data: { deletedAt: new Date() },
        })

        const v1 = await saveContractReviewVersionService({
            reviewId,
            systemLabel: 'lawyer_save',
            createdById: userId,
        })

        const loaded = await loadContractReviewVersionSnapshotService(v1.id)
        if ('error' in loaded) throw new Error('snapshot 应返回 data')
        expect(loaded.data.snapshot.annotations.length).toBe(0)
    })

    it('显式传入 docxText 时存入 snapshot', async () => {
        const v1 = await saveContractReviewVersionService({
            reviewId,
            systemLabel: 'initial_upload',
            createdById: userId,
            docxText: '合同正文内容',
        })

        const loaded = await loadContractReviewVersionSnapshotService(v1.id)
        if ('error' in loaded) throw new Error('snapshot 应返回 data')
        expect(loaded.data.snapshot.docxText).toBe('合同正文内容')
    })

    it('不传 docxText 时从 currentVersion 继承', async () => {
        // v1 有明确的 docxText
        const v1 = await saveContractReviewVersionService({
            reviewId,
            systemLabel: 'initial_upload',
            createdById: userId,
            docxText: '继承测试正文',
        })

        // v2 不传 docxText，应继承 v1 的
        const v2 = await saveContractReviewVersionService({
            reviewId,
            systemLabel: 'lawyer_save',
            createdById: userId,
        })

        const loaded = await loadContractReviewVersionSnapshotService(v2.id)
        if ('error' in loaded) throw new Error('snapshot 应返回 data')
        expect(loaded.data.snapshot.docxText).toBe('继承测试正文')
    })

    it('loadContractReviewVersionSnapshotService 对不存在的版本返回 error', async () => {
        const result = await loadContractReviewVersionSnapshotService(999999999)
        expect('error' in result && result.error).toBe('version_not_found')
    })

    it('显式传入 clauses 时存入 snapshot，snapshot.clauses 包含 offsetStart/offsetEnd', async () => {
        const clauses = [
            { index: 1, text: '第一条 合同标的', offsetStart: 0, offsetEnd: 8 },
            { index: 2, text: '第二条 付款方式', offsetStart: 10, offsetEnd: 18 },
        ]
        const v1 = await saveContractReviewVersionService({
            reviewId,
            systemLabel: 'initial_upload',
            createdById: userId,
            docxText: '第一条 合同标的\n第二条 付款方式',
            clauses,
        })

        const loaded = await loadContractReviewVersionSnapshotService(v1.id)
        if ('error' in loaded) throw new Error('snapshot 应返回 data')
        expect(loaded.data.snapshot.clauses).toHaveLength(2)
        expect(loaded.data.snapshot.clauses[0]).toMatchObject({ index: 1, offsetStart: 0, offsetEnd: 8 })
        expect(loaded.data.snapshot.clauses[1]).toMatchObject({ index: 2, offsetStart: 10, offsetEnd: 18 })
    })

    it('不传 clauses 时从 currentVersion 继承', async () => {
        const clauses = [
            { index: 1, text: '第一条 定义', offsetStart: 0, offsetEnd: 6 },
        ]
        // v1 有 clauses
        const v1 = await saveContractReviewVersionService({
            reviewId,
            systemLabel: 'initial_upload',
            createdById: userId,
            docxText: '第一条 定义',
            clauses,
        })

        // v2 不传 clauses，应继承 v1 的
        const v2 = await saveContractReviewVersionService({
            reviewId,
            systemLabel: 'lawyer_save',
            createdById: userId,
        })

        expect(v2.id).not.toBe(v1.id)
        const loaded = await loadContractReviewVersionSnapshotService(v2.id)
        if ('error' in loaded) throw new Error('snapshot 应返回 data')
        expect(loaded.data.snapshot.clauses).toHaveLength(1)
        expect(loaded.data.snapshot.clauses[0]).toMatchObject({ index: 1, offsetStart: 0, offsetEnd: 6 })
    })
})
