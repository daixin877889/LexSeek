/**
 * OSS 孤儿文件 GC 测试（bug #15）。
 *
 * 覆盖：
 * - 孤儿文件被识别并软删
 * - 被 caseMaterials 引用的文件不会被误删
 * - 被 contractReviews.originalFileId 引用的文件不会被误删
 * - 已软删文件不会重复软删
 * - 空场景返回 0
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import { findOrphanOssFilesDAO } from '~~/server/services/files/ossFiles.dao'
import { gcOrphanOssFilesService } from '~~/server/services/files/ossFilesGc.service'
import {
    createTestUser,
    createTestOssFile,
    cleanupTestData,
    createEmptyTestIds,
    getTestPrisma,
    type TestIds,
} from './test-db-helper'

describe('OSS 孤儿文件 GC（bug #15）', () => {
    const testIds: TestIds = createEmptyTestIds()
    const createdMaterialIds: number[] = []
    const createdReviewIds: number[] = []
    let userId: number

    beforeAll(async () => {
        const user = await createTestUser()
        userId = user.id
        testIds.userIds.push(user.id)
    })

    afterEach(async () => {
        const p = getTestPrisma()
        if (createdReviewIds.length > 0) {
            await p.contractReviews.deleteMany({ where: { id: { in: createdReviewIds } } })
            createdReviewIds.length = 0
        }
        if (createdMaterialIds.length > 0) {
            await p.caseMaterials.deleteMany({ where: { id: { in: createdMaterialIds } } })
            createdMaterialIds.length = 0
        }
        if (testIds.ossFileIds.length > 0) {
            await p.ossFiles.deleteMany({ where: { id: { in: testIds.ossFileIds } } })
            testIds.ossFileIds.length = 0
        }
    })

    afterAll(async () => {
        await cleanupTestData(testIds)
    })

    it('孤儿文件被识别并软删为 deletedAt', async () => {
        const orphan = await createTestOssFile(userId)
        testIds.ossFileIds.push(orphan.id)

        const ids = await findOrphanOssFilesDAO(500)
        expect(ids).toContain(orphan.id)

        await gcOrphanOssFilesService()

        const after = await getTestPrisma().ossFiles.findUnique({ where: { id: orphan.id } })
        expect(after?.deletedAt).not.toBeNull()
    })

    it('被 caseMaterials 引用的文件不被识别为孤儿', async () => {
        const file = await createTestOssFile(userId)
        testIds.ossFileIds.push(file.id)

        const material = await getTestPrisma().caseMaterials.create({
            data: {
                caseId: null,
                draftId: null,
                name: 'gc-test-material',
                type: 2,
                ossFileId: file.id,
            },
        })
        createdMaterialIds.push(material.id)

        const ids = await findOrphanOssFilesDAO(500)
        expect(ids).not.toContain(file.id)
    })

    it('被 contractReviews 引用的文件不被识别为孤儿', async () => {
        const file = await createTestOssFile(userId)
        testIds.ossFileIds.push(file.id)

        const review = await getTestPrisma().contractReviews.create({
            data: {
                userId,
                sessionId: `gc-test-${Date.now()}-${Math.random()}`,
                originalFileId: file.id,
                status: 'pending',
            },
        })
        createdReviewIds.push(review.id)

        const ids = await findOrphanOssFilesDAO(500)
        expect(ids).not.toContain(file.id)
    })

    it('已软删文件不会被二次软删（deletedAt 不变）', async () => {
        const file = await createTestOssFile(userId)
        testIds.ossFileIds.push(file.id)

        const original = new Date('2026-01-01T00:00:00Z')
        await getTestPrisma().ossFiles.update({
            where: { id: file.id },
            data: { deletedAt: original },
        })

        const ids = await findOrphanOssFilesDAO(500)
        expect(ids).not.toContain(file.id)

        const after = await getTestPrisma().ossFiles.findUnique({ where: { id: file.id } })
        expect(after?.deletedAt?.getTime()).toBe(original.getTime())
    })

    it('limit 参数限制返回条数', async () => {
        const f1 = await createTestOssFile(userId)
        const f2 = await createTestOssFile(userId)
        const f3 = await createTestOssFile(userId)
        testIds.ossFileIds.push(f1.id, f2.id, f3.id)

        const ids = await findOrphanOssFilesDAO(2)
        expect(ids.length).toBeLessThanOrEqual(2)
    })
})
