/**
 * contractReviewVersion.dao 单元测试
 *
 * 覆盖目标：90%+ 行覆盖率
 *
 * 测试范围：
 * - createContractReviewVersionDAO：创建并返回完整记录
 * - listContractReviewVersionsDAO：按 versionNumber 降序、含 createdBy.name
 * - getContractReviewVersionByIdDAO：未知 id 返回 null / 已存在返回完整对象
 * - updateContractReviewVersionNoteDAO：更新 lawyerNote 含 null 清空
 *
 * **Validates: 阶段 8 测试覆盖率提升**
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '~~/server/utils/db'
import {
    createContractReviewVersionDAO,
    listContractReviewVersionsDAO,
    getContractReviewVersionByIdDAO,
    updateContractReviewVersionNoteDAO,
} from '~~/server/agents/contract/contractReviewVersion.dao'
import { ensureTestUser } from '../../assistant/test-db-helper'

describe('contractReviewVersion.dao', () => {
    let userId: number
    let reviewId: number

    beforeEach(async () => {
        userId = await ensureTestUser()
        const review = await prisma.contractReviews.create({
            data: {
                userId,
                status: 'completed',
                risks: [],
                sessionId: `version-dao-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                originalFileId: 0,
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

    describe('createContractReviewVersionDAO', () => {
        it('创建版本并返回 id / 各字段', async () => {
            const v = await createContractReviewVersionDAO({
                reviewId,
                versionNumber: 1,
                systemLabel: 'lawyer_save',
                lawyerNote: '初版备注',
                snapshotData: { docxText: 'hello', risks: [], annotations: [] },
                createdById: userId,
            })
            expect(v.id).toBeGreaterThan(0)
            expect(v.reviewId).toBe(reviewId)
            expect(v.versionNumber).toBe(1)
            expect(v.systemLabel).toBe('lawyer_save')
            expect(v.lawyerNote).toBe('初版备注')
            expect(v.createdById).toBe(userId)
        })

        it('lawyerNote 可以是 null', async () => {
            const v = await createContractReviewVersionDAO({
                reviewId,
                versionNumber: 1,
                systemLabel: 'auto_backup',
                snapshotData: {},
                createdById: userId,
            })
            expect(v.lawyerNote).toBeNull()
        })
    })

    describe('listContractReviewVersionsDAO', () => {
        it('按 versionNumber 降序返回', async () => {
            await createContractReviewVersionDAO({
                reviewId, versionNumber: 1, systemLabel: 'lawyer_save',
                snapshotData: {}, createdById: userId,
            })
            await createContractReviewVersionDAO({
                reviewId, versionNumber: 2, systemLabel: 'auto_backup',
                snapshotData: {}, createdById: userId,
            })
            await createContractReviewVersionDAO({
                reviewId, versionNumber: 3, systemLabel: 'client_return',
                snapshotData: {}, createdById: userId,
            })

            const list = await listContractReviewVersionsDAO(reviewId)
            expect(list).toHaveLength(3)
            expect(list.map(v => v.versionNumber)).toEqual([3, 2, 1])
        })

        it('返回字段含 createdBy.name', async () => {
            await createContractReviewVersionDAO({
                reviewId, versionNumber: 1, systemLabel: 'lawyer_save',
                snapshotData: {}, createdById: userId,
            })
            const list = await listContractReviewVersionsDAO(reviewId)
            expect(list[0]?.createdBy?.name).toBeTruthy()
        })

        it('其他 review 的版本不会泄露', async () => {
            const otherReview = await prisma.contractReviews.create({
                data: {
                    userId, status: 'completed', risks: [],
                    sessionId: `other-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                    originalFileId: 0,
                },
            })
            await createContractReviewVersionDAO({
                reviewId: otherReview.id, versionNumber: 1,
                systemLabel: 'lawyer_save', snapshotData: {}, createdById: userId,
            })
            const list = await listContractReviewVersionsDAO(reviewId)
            expect(list).toHaveLength(0)
            // 清理
            await prisma.contractReviewVersions.deleteMany({ where: { reviewId: otherReview.id } })
            await prisma.contractReviews.delete({ where: { id: otherReview.id } })
        })

        it('空列表 → 空数组', async () => {
            const list = await listContractReviewVersionsDAO(reviewId)
            expect(list).toEqual([])
        })
    })

    describe('getContractReviewVersionByIdDAO', () => {
        it('未知 id → null', async () => {
            const v = await getContractReviewVersionByIdDAO(99999999)
            expect(v).toBeNull()
        })

        it('已存在 id → 返回完整对象', async () => {
            const created = await createContractReviewVersionDAO({
                reviewId, versionNumber: 1, systemLabel: 'lawyer_save',
                snapshotData: { foo: 'bar' }, createdById: userId,
            })
            const v = await getContractReviewVersionByIdDAO(created.id)
            expect(v).not.toBeNull()
            expect(v?.id).toBe(created.id)
            expect(v?.snapshotData).toEqual({ foo: 'bar' })
        })
    })

    describe('updateContractReviewVersionNoteDAO', () => {
        it('更新 lawyerNote 文本', async () => {
            const created = await createContractReviewVersionDAO({
                reviewId, versionNumber: 1, systemLabel: 'lawyer_save',
                lawyerNote: '原备注', snapshotData: {}, createdById: userId,
            })
            const updated = await updateContractReviewVersionNoteDAO(created.id, '新备注')
            expect(updated.lawyerNote).toBe('新备注')
        })

        it('更新 lawyerNote 为 null（清空）', async () => {
            const created = await createContractReviewVersionDAO({
                reviewId, versionNumber: 1, systemLabel: 'lawyer_save',
                lawyerNote: '原备注', snapshotData: {}, createdById: userId,
            })
            const updated = await updateContractReviewVersionNoteDAO(created.id, null)
            expect(updated.lawyerNote).toBeNull()
        })
    })
})
