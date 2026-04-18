/**
 * 合同审查 DAO 测试
 *
 * 覆盖 M3 需要的 4 个 CRUD 函数 + 软删过滤行为。
 * 真打测试数据库。
 *
 * **Feature: contract-review-m3**
 * **Validates: Plan Task 2.2**
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import {
    createContractReviewDAO,
    getContractReviewDAO,
    findContractReviewBySessionIdDAO,
    updateContractReviewDAO,
} from '~~/server/services/assistant/contract/contractReview.dao'
import { prisma } from '~~/server/utils/db'
import { ensureTestUser, cleanupTestData } from '../test-db-helper'

describe('contractReview DAO', () => {
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

    it('createContractReviewDAO 可建立 pending 行', async () => {
        const row = await createContractReviewDAO({
            userId: testUserId,
            sessionId: `test-session-${Date.now()}`,
            originalFileId: 0,
            status: 'pending',
        })
        createdIds.push(row.id)
        expect(row.id).toBeGreaterThan(0)
        expect(row.status).toBe('pending')
    })

    it('findContractReviewBySessionIdDAO 对未知 sessionId 返回 null', async () => {
        const row = await findContractReviewBySessionIdDAO('no-such-session-' + Date.now())
        expect(row).toBeNull()
    })

    it('findContractReviewBySessionIdDAO 命中 unique 索引', async () => {
        const sessionId = `test-session-${Date.now()}`
        const created = await createContractReviewDAO({
            userId: testUserId, sessionId, originalFileId: 0, status: 'pending',
        })
        createdIds.push(created.id)
        const found = await findContractReviewBySessionIdDAO(sessionId)
        expect(found?.id).toBe(created.id)
    })

    it('updateContractReviewDAO 可更新 stance + status', async () => {
        const row = await createContractReviewDAO({
            userId: testUserId, sessionId: `test-session-${Date.now()}`,
            originalFileId: 0, status: 'awaiting_stance',
        })
        createdIds.push(row.id)
        const updated = await updateContractReviewDAO(row.id, {
            stance: 'partyA', partyA: '甲', partyB: '乙', status: 'reviewing',
        })
        expect(updated.stance).toBe('partyA')
        expect(updated.status).toBe('reviewing')
    })

    it('getContractReviewDAO 不可见 deletedAt!=null 行', async () => {
        const row = await createContractReviewDAO({
            userId: testUserId, sessionId: `test-session-${Date.now()}`,
            originalFileId: 0, status: 'pending',
        })
        createdIds.push(row.id)
        await prisma.contractReviews.update({
            where: { id: row.id }, data: { deletedAt: new Date() },
        })
        const found = await getContractReviewDAO(row.id)
        expect(found).toBeNull()
    })
})
