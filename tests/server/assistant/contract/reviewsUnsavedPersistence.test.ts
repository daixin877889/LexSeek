/**
 * hasUnsavedDocxChanges 字段持久化测试（真打测试数据库）
 *
 * 覆盖 M6.1A-e：
 *   - 默认 false
 *   - setHasUnsavedTrueDAO 置 true
 *   - setHasUnsavedFalseDAO 置 false
 *   - setCompletedAfterRebuildDAO 在 completed 的同时清零 hasUnsavedDocxChanges
 *
 * **Feature: contract-review-m6.1A**
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import {
    createContractReviewDAO,
    setHasUnsavedTrueDAO,
    setHasUnsavedFalseDAO,
    setCompletedAfterRebuildDAO,
} from '~~/server/services/assistant/contract/contractReview.dao'
import { prisma } from '~~/server/utils/db'
import { ensureTestUser, cleanupTestData } from '../test-db-helper'

describe('contractReview.dao hasUnsavedDocxChanges 持久化', () => {
    let testUserId: number
    const createdIds: number[] = []

    beforeAll(async () => {
        testUserId = await ensureTestUser()
    })

    afterEach(async () => {
        if (createdIds.length > 0) {
            await prisma.contractReviews.deleteMany({ where: { id: { in: createdIds } } })
            createdIds.length = 0
        }
    })

    afterAll(async () => {
        await cleanupTestData()
    })

    it('默认新建时 hasUnsavedDocxChanges = false', async () => {
        const row = await createContractReviewDAO({
            userId: testUserId,
            sessionId: `test-session-${Date.now()}-${Math.random()}`,
            originalFileId: 0,
            status: 'completed',
        })
        createdIds.push(row.id)
        const found = await prisma.contractReviews.findUnique({ where: { id: row.id } })
        expect(found?.hasUnsavedDocxChanges).toBe(false)
    })

    it('setHasUnsavedTrueDAO 应置 true', async () => {
        const row = await createContractReviewDAO({
            userId: testUserId,
            sessionId: `test-session-${Date.now()}-${Math.random()}`,
            originalFileId: 0,
            status: 'completed',
        })
        createdIds.push(row.id)
        await setHasUnsavedTrueDAO(row.id)
        const found = await prisma.contractReviews.findUnique({ where: { id: row.id } })
        expect(found?.hasUnsavedDocxChanges).toBe(true)
    })

    it('setHasUnsavedFalseDAO 应置 false', async () => {
        const row = await createContractReviewDAO({
            userId: testUserId,
            sessionId: `test-session-${Date.now()}-${Math.random()}`,
            originalFileId: 0,
            status: 'completed',
        })
        createdIds.push(row.id)
        await setHasUnsavedTrueDAO(row.id)
        await setHasUnsavedFalseDAO(row.id)
        const found = await prisma.contractReviews.findUnique({ where: { id: row.id } })
        expect(found?.hasUnsavedDocxChanges).toBe(false)
    })

    it('setCompletedAfterRebuildDAO 应在置 completed 的同时清 hasUnsavedDocxChanges', async () => {
        const row = await createContractReviewDAO({
            userId: testUserId,
            sessionId: `test-session-${Date.now()}-${Math.random()}`,
            originalFileId: 0,
            status: 'completed',
        })
        createdIds.push(row.id)
        // 模拟真实流程：先标记脏，再进入 rebuilding，再重生完成
        await setHasUnsavedTrueDAO(row.id)
        await prisma.contractReviews.update({
            where: { id: row.id },
            data: { status: 'rebuilding' },
        })
        await setCompletedAfterRebuildDAO(row.id, 123)
        const found = await prisma.contractReviews.findUnique({ where: { id: row.id } })
        expect(found?.status).toBe('completed')
        expect(found?.reviewedFileId).toBe(123)
        expect(found?.hasUnsavedDocxChanges).toBe(false)
    })
})
