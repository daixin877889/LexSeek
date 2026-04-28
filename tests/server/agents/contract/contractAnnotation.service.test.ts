/**
 * contractAnnotation.service 单元测试
 *
 * 覆盖目标：90%+ 行覆盖率
 *
 * 测试范围：
 * - createLawyerAnnotationService：risk 不存在 / risk 跨 review / parent 跨 review / parent 已软删 / happy path
 * - updateAnnotationContentService：not_found / not_own（authorType 错） / not_own（userId 错） / happy path
 * - softDeleteAnnotationService：not_found / not_own / happy path
 * - isAnnotationExportable：deletedAt / suppressInExport / risk null / anchorParagraphIndex null / orphaned / happy path
 * - filterExportableDbAnnotations：过滤 + warn 日志
 * - restoreAnnotationPushService：not_found / not_removed / 幂等 / happy path
 *
 * 用真实 DB（test-db-helper）确保业务逻辑真实可信，不在测试里替身实现。
 *
 * **Validates: 阶段 8 测试覆盖率提升**
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '~~/server/utils/db'
import {
    createLawyerAnnotationService,
    updateAnnotationContentService,
    softDeleteAnnotationService,
    isAnnotationExportable,
    filterExportableDbAnnotations,
    restoreAnnotationPushService,
} from '~~/server/agents/contract/contractAnnotation.service'
import { createContractRiskDAO } from '~~/server/agents/contract/contractRisk.dao'
import { createContractAnnotationDAO } from '~~/server/agents/contract/contractAnnotation.dao'
import { ensureTestUser } from '../../assistant/test-db-helper'

describe('contractAnnotation.service', () => {
    let userId: number
    let reviewId: number
    let riskId: number
    const otherReviewIds: number[] = []

    beforeEach(async () => {
        userId = await ensureTestUser()
        const review = await prisma.contractReviews.create({
            data: {
                userId,
                status: 'completed',
                risks: [],
                sessionId: `ann-svc-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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
            anchorQuote: '试用期 6 个月',
            anchorParagraphIndex: 0,
        })
        riskId = risk.id
    })

    afterEach(async () => {
        // 清理本测试创建的所有数据
        const allReviewIds = [reviewId, ...otherReviewIds]
        await prisma.contractAnnotations.deleteMany({ where: { reviewId: { in: allReviewIds } } })
        await prisma.contractRisks.deleteMany({ where: { reviewId: { in: allReviewIds } } })
        await prisma.contractReviews.deleteMany({ where: { id: { in: allReviewIds } } })
        await prisma.users.deleteMany({ where: { id: userId } })
        otherReviewIds.length = 0
    })

    describe('createLawyerAnnotationService', () => {
        it('risk 不存在 → error: risk_not_found', async () => {
            const r = await createLawyerAnnotationService({
                reviewId,
                riskId: 99999999, // 不存在
                content: '不该被创建',
                user: { id: userId, name: '律师A' },
            })
            expect(r).toEqual({ error: 'risk_not_found' })
        })

        it('risk 属于其他 review → error: risk_not_found', async () => {
            // 建一个不同的 review 和 risk
            const otherReview = await prisma.contractReviews.create({
                data: {
                    userId, status: 'completed', risks: [],
                    sessionId: `other-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                    originalFileId: 0,
                },
            })
            otherReviewIds.push(otherReview.id)
            const otherRisk = await createContractRiskDAO({
                reviewId: otherReview.id,
                source: 'ai',
                category: '其他',
                level: 'low',
                stance: 'balanced',
                problem: '其他',
                anchorQuote: '其他',
            })
            const r = await createLawyerAnnotationService({
                reviewId, // 当前 review
                riskId: otherRisk.id, // 但 risk 属于 otherReview
                content: '跨 review 攻击',
                user: { id: userId, name: '律师A' },
            })
            expect(r).toEqual({ error: 'risk_not_found' })
        })

        it('parentAnnotationId 不存在 → error: parent_invalid', async () => {
            const r = await createLawyerAnnotationService({
                reviewId,
                riskId,
                content: '回复',
                parentAnnotationId: 99999999,
                user: { id: userId, name: '律师A' },
            })
            expect(r).toEqual({ error: 'parent_invalid' })
        })

        it('parentAnnotationId 已软删 → error: parent_invalid', async () => {
            const parent = await createContractAnnotationDAO({
                reviewId, riskId,
                authorType: 'ai', authorName: 'AI',
                content: '父批注',
            })
            await prisma.contractAnnotations.update({
                where: { id: parent.id },
                data: { deletedAt: new Date() },
            })
            const r = await createLawyerAnnotationService({
                reviewId, riskId,
                content: '回复',
                parentAnnotationId: parent.id,
                user: { id: userId, name: '律师A' },
            })
            expect(r).toEqual({ error: 'parent_invalid' })
        })

        it('parentAnnotationId 跨 review → error: parent_invalid', async () => {
            // 建另一个 review + 它的批注
            const otherReview = await prisma.contractReviews.create({
                data: {
                    userId, status: 'completed', risks: [],
                    sessionId: `other2-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                    originalFileId: 0,
                },
            })
            otherReviewIds.push(otherReview.id)
            const otherRisk = await createContractRiskDAO({
                reviewId: otherReview.id, source: 'ai', category: 'x', level: 'low',
                stance: 'balanced', problem: 'x', anchorQuote: 'x',
            })
            const otherParent = await createContractAnnotationDAO({
                reviewId: otherReview.id, riskId: otherRisk.id,
                authorType: 'ai', authorName: 'AI', content: '其他 review 批注',
            })
            const r = await createLawyerAnnotationService({
                reviewId, riskId,
                content: '回复',
                parentAnnotationId: otherParent.id,
                user: { id: userId, name: '律师A' },
            })
            expect(r).toEqual({ error: 'parent_invalid' })
        })

        it('happy path：返回 annotation 含 lawyer 类型', async () => {
            const r = await createLawyerAnnotationService({
                reviewId, riskId,
                content: '律师批注内容',
                user: { id: userId, name: '律师A' },
            })
            expect('annotation' in r).toBe(true)
            if ('annotation' in r) {
                expect(r.annotation.authorType).toBe('lawyer')
                expect(r.annotation.authorName).toBe('律师A')
                expect(r.annotation.authorUserId).toBe(userId)
                expect(r.annotation.content).toBe('律师批注内容')
                expect(r.annotation.parentAnnotationId).toBeNull()
            }
        })

        it('happy path with valid parent：建立父子关系', async () => {
            const parent = await createContractAnnotationDAO({
                reviewId, riskId,
                authorType: 'ai', authorName: 'AI',
                content: '父批注',
            })
            const r = await createLawyerAnnotationService({
                reviewId, riskId,
                content: '回复',
                parentAnnotationId: parent.id,
                user: { id: userId, name: '律师A' },
            })
            expect('annotation' in r).toBe(true)
            if ('annotation' in r) {
                expect(r.annotation.parentAnnotationId).toBe(parent.id)
            }
        })

        it('parentAnnotationId 显式 null 也走 happy path', async () => {
            const r = await createLawyerAnnotationService({
                reviewId, riskId,
                content: '内容',
                parentAnnotationId: null,
                user: { id: userId, name: '律师A' },
            })
            expect('annotation' in r).toBe(true)
        })
    })

    describe('updateAnnotationContentService', () => {
        let annId: number

        beforeEach(async () => {
            const ann = await createContractAnnotationDAO({
                reviewId, riskId,
                authorType: 'lawyer', authorName: '律师A',
                authorUserId: userId,
                content: '原始内容',
            })
            annId = ann.id
        })

        it('annotation 不存在 → not_found', async () => {
            const r = await updateAnnotationContentService({
                annotationId: 99999999,
                ownerUserId: userId,
                content: '新内容',
            })
            expect(r).toEqual({ error: 'not_found' })
        })

        it('annotation 已软删 → not_found', async () => {
            await prisma.contractAnnotations.update({
                where: { id: annId },
                data: { deletedAt: new Date() },
            })
            const r = await updateAnnotationContentService({
                annotationId: annId,
                ownerUserId: userId,
                content: '新内容',
            })
            expect(r).toEqual({ error: 'not_found' })
        })

        it('annotation authorType 不是 lawyer → not_own', async () => {
            await prisma.contractAnnotations.update({
                where: { id: annId },
                data: { authorType: 'ai' },
            })
            const r = await updateAnnotationContentService({
                annotationId: annId,
                ownerUserId: userId,
                content: '新内容',
            })
            expect(r).toEqual({ error: 'not_own' })
        })

        it('其他律师改自己的 annotation → not_own', async () => {
            const r = await updateAnnotationContentService({
                annotationId: annId,
                ownerUserId: userId + 99999,
                content: '别人的内容',
            })
            expect(r).toEqual({ error: 'not_own' })
        })

        it('happy path：返回更新后的 annotation', async () => {
            const r = await updateAnnotationContentService({
                annotationId: annId,
                ownerUserId: userId,
                content: '已更新的内容',
            })
            expect('annotation' in r).toBe(true)
            if ('annotation' in r) {
                expect(r.annotation.content).toBe('已更新的内容')
            }
        })
    })

    describe('softDeleteAnnotationService', () => {
        let annId: number

        beforeEach(async () => {
            const ann = await createContractAnnotationDAO({
                reviewId, riskId,
                authorType: 'lawyer', authorName: '律师A',
                authorUserId: userId,
                content: '待删',
            })
            annId = ann.id
        })

        it('annotation 不存在 → not_found', async () => {
            const r = await softDeleteAnnotationService({
                annotationId: 99999999,
                ownerUserId: userId,
            })
            expect(r).toEqual({ error: 'not_found' })
        })

        it('annotation 已软删 → not_found', async () => {
            await prisma.contractAnnotations.update({
                where: { id: annId },
                data: { deletedAt: new Date() },
            })
            const r = await softDeleteAnnotationService({
                annotationId: annId,
                ownerUserId: userId,
            })
            expect(r).toEqual({ error: 'not_found' })
        })

        it('AI 批注不可删 → not_own', async () => {
            await prisma.contractAnnotations.update({
                where: { id: annId },
                data: { authorType: 'ai', authorUserId: null },
            })
            const r = await softDeleteAnnotationService({
                annotationId: annId,
                ownerUserId: userId,
            })
            expect(r).toEqual({ error: 'not_own' })
        })

        it('其他律师不可删 → not_own', async () => {
            const r = await softDeleteAnnotationService({
                annotationId: annId,
                ownerUserId: userId + 99999,
            })
            expect(r).toEqual({ error: 'not_own' })
        })

        it('happy path：软删成功返回 ok=true', async () => {
            const r = await softDeleteAnnotationService({
                annotationId: annId,
                ownerUserId: userId,
            })
            expect(r).toEqual({ ok: true })
            // 验证 deletedAt 已被设置
            const after = await prisma.contractAnnotations.findUnique({ where: { id: annId } })
            expect(after?.deletedAt).not.toBeNull()
        })
    })

    describe('isAnnotationExportable', () => {
        const baseRisk = { anchorParagraphIndex: 0, orphaned: false }
        const baseAnn = { deletedAt: null, suppressInExport: false }

        it('正常路径返回 true', () => {
            expect(isAnnotationExportable(baseAnn, baseRisk)).toBe(true)
        })

        it('annotation 软删 → false', () => {
            expect(isAnnotationExportable({ ...baseAnn, deletedAt: new Date() }, baseRisk)).toBe(false)
            expect(isAnnotationExportable({ ...baseAnn, deletedAt: '2024-01-01' }, baseRisk)).toBe(false)
        })

        it('suppressInExport=true → false', () => {
            expect(isAnnotationExportable({ ...baseAnn, suppressInExport: true }, baseRisk)).toBe(false)
        })

        it('risk null → false', () => {
            expect(isAnnotationExportable(baseAnn, null)).toBe(false)
            expect(isAnnotationExportable(baseAnn, undefined)).toBe(false)
        })

        it('anchorParagraphIndex null → false', () => {
            expect(isAnnotationExportable(baseAnn, { ...baseRisk, anchorParagraphIndex: null })).toBe(false)
        })

        it('anchorParagraphIndex undefined → false', () => {
            expect(isAnnotationExportable(baseAnn, { orphaned: false })).toBe(false)
        })

        it('orphaned=true → false', () => {
            expect(isAnnotationExportable(baseAnn, { ...baseRisk, orphaned: true })).toBe(false)
        })

        it('orphaned=null/undefined 不影响（仅严格 true 才过滤）', () => {
            expect(isAnnotationExportable(baseAnn, { anchorParagraphIndex: 0, orphaned: null })).toBe(true)
            expect(isAnnotationExportable(baseAnn, { anchorParagraphIndex: 0 })).toBe(true)
        })
    })

    describe('filterExportableDbAnnotations', () => {
        it('过滤 + 保留可导出项', () => {
            const annotations = [
                {
                    id: 1, riskId: 10,
                    deletedAt: null, suppressInExport: false,
                    risk: { anchorParagraphIndex: 0, orphaned: false },
                },
                {
                    id: 2, riskId: 11,
                    deletedAt: null, suppressInExport: true, // suppressed
                    risk: { anchorParagraphIndex: 0, orphaned: false },
                },
                {
                    id: 3, riskId: 12,
                    deletedAt: null, suppressInExport: false,
                    risk: { anchorParagraphIndex: null, orphaned: false }, // 锚点空
                },
                {
                    id: 4, riskId: 13,
                    deletedAt: null, suppressInExport: false,
                    risk: { anchorParagraphIndex: 5, orphaned: true }, // 孤立
                },
            ]
            const result = filterExportableDbAnnotations(annotations, 100)
            expect(result.map(a => a.id)).toEqual([1])
        })

        it('全部可导出 → 全保留', () => {
            const annotations = [
                {
                    id: 1, riskId: 10,
                    deletedAt: null, suppressInExport: false,
                    risk: { anchorParagraphIndex: 0, orphaned: false },
                },
                {
                    id: 2, riskId: 11,
                    deletedAt: null, suppressInExport: false,
                    risk: { anchorParagraphIndex: 1, orphaned: false },
                },
            ]
            const result = filterExportableDbAnnotations(annotations, 100)
            expect(result.map(a => a.id)).toEqual([1, 2])
        })

        it('全部不可导出 → 空数组', () => {
            const annotations = [
                {
                    id: 1, riskId: 10,
                    deletedAt: new Date(), suppressInExport: false,
                    risk: { anchorParagraphIndex: 0, orphaned: false },
                },
            ]
            const result = filterExportableDbAnnotations(annotations, 100)
            expect(result).toEqual([])
        })
    })

    describe('restoreAnnotationPushService', () => {
        let annId: number

        beforeEach(async () => {
            const ann = await createContractAnnotationDAO({
                reviewId, riskId,
                authorType: 'ai', authorName: 'AI',
                content: '客户已删的批注',
            })
            // 模拟客户删除
            await prisma.contractAnnotations.update({
                where: { id: ann.id },
                data: { removedByClient: true, suppressInExport: true },
            })
            annId = ann.id
        })

        it('annotation 不存在 → not_found', async () => {
            const r = await restoreAnnotationPushService({ annotationId: 99999999 })
            expect(r).toEqual({ error: 'not_found' })
        })

        it('annotation 已软删 → not_found', async () => {
            await prisma.contractAnnotations.update({
                where: { id: annId },
                data: { deletedAt: new Date() },
            })
            const r = await restoreAnnotationPushService({ annotationId: annId })
            expect(r).toEqual({ error: 'not_found' })
        })

        it('annotation 未被客户删除 → not_removed', async () => {
            await prisma.contractAnnotations.update({
                where: { id: annId },
                data: { removedByClient: false, suppressInExport: false },
            })
            const r = await restoreAnnotationPushService({ annotationId: annId })
            expect(r).toEqual({ error: 'not_removed' })
        })

        it('幂等：suppressInExport 已是 false 直接返回 ok', async () => {
            // 模拟"客户已删但已恢复推送"的状态
            await prisma.contractAnnotations.update({
                where: { id: annId },
                data: { removedByClient: true, suppressInExport: false },
            })
            const r = await restoreAnnotationPushService({ annotationId: annId })
            expect(r).toEqual({ ok: true, suppressInExport: false })
        })

        it('happy path：清 suppressInExport，保留 removedByClient', async () => {
            const r = await restoreAnnotationPushService({ annotationId: annId })
            expect(r).toEqual({ ok: true, suppressInExport: false })
            // DB 验证：suppressInExport=false 但 removedByClient 仍为 true
            const after = await prisma.contractAnnotations.findUnique({ where: { id: annId } })
            expect(after?.suppressInExport).toBe(false)
            expect(after?.removedByClient).toBe(true)
        })

        it('lawyer 批注被客户删除也可恢复', async () => {
            await prisma.contractAnnotations.update({
                where: { id: annId },
                data: { authorType: 'lawyer', authorUserId: userId, authorName: '律师A' },
            })
            const r = await restoreAnnotationPushService({ annotationId: annId })
            expect(r).toEqual({ ok: true, suppressInExport: false })
        })

        it('external 批注被客户删除也可恢复', async () => {
            await prisma.contractAnnotations.update({
                where: { id: annId },
                data: { authorType: 'external', authorName: '客户' },
            })
            const r = await restoreAnnotationPushService({ annotationId: annId })
            expect(r).toEqual({ ok: true, suppressInExport: false })
        })
    })
})
