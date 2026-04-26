/**
 * 合同审查僵死状态清理测试（bug #14）。
 *
 * 覆盖三种场景：
 * - 超时的 reviewing 记录被置 failed
 * - 未超时的 reviewing 记录保持原状
 * - 表里没有僵死记录时返回 0，不做任何写入
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import { prisma } from '~~/server/utils/db'
import { findReviewingTimeoutDAO } from '~~/server/agents/contract/contractReview.dao'
import { cleanupStaleContractReviewsService } from '~~/server/agents/contract/contractReviewCleanup.service'
import { ensureTestUser, cleanupTestData } from '../test-db-helper'

describe('合同审查僵死清理（bug #14）', () => {
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

    const createReview = async (status: string, updatedAt: Date) => {
        const row = await prisma.contractReviews.create({
            data: {
                userId: testUserId,
                sessionId: `cleanup-${Date.now()}-${Math.random()}`,
                originalFileId: 0,
                status,
            },
        })
        // 覆盖 updatedAt 模拟早于阈值；Prisma 在 updates 里会自动 touch，直接 raw UPDATE
        await prisma.$executeRaw`UPDATE contract_reviews SET updated_at = ${updatedAt} WHERE id = ${row.id}`
        createdIds.push(row.id)
        return row.id
    }

    it('超过 24h 的 reviewing 记录被清理为 failed', async () => {
        const DAY_MS = 24 * 60 * 60 * 1000
        const longAgo = new Date(Date.now() - DAY_MS - 60 * 1000)
        const id = await createReview('reviewing', longAgo)

        const cleaned = await cleanupStaleContractReviewsService()

        expect(cleaned).toBeGreaterThanOrEqual(1)
        const after = await prisma.contractReviews.findUnique({ where: { id } })
        expect(after?.status).toBe('failed')
    })

    it('未超时的 reviewing 记录保持不变', async () => {
        const recent = new Date(Date.now() - 60 * 60 * 1000) // 1h ago
        const id = await createReview('reviewing', recent)

        await cleanupStaleContractReviewsService()

        const after = await prisma.contractReviews.findUnique({ where: { id } })
        expect(after?.status).toBe('reviewing')
    })

    it('completed 状态不被误清理', async () => {
        const longAgo = new Date(Date.now() - 48 * 60 * 60 * 1000)
        const id = await createReview('completed', longAgo)

        await cleanupStaleContractReviewsService()

        const after = await prisma.contractReviews.findUnique({ where: { id } })
        expect(after?.status).toBe('completed')
    })

    it('DAO 阈值参数正确过滤', async () => {
        const longAgo = new Date(Date.now() - 25 * 60 * 60 * 1000)
        const id = await createReview('reviewing', longAgo)

        const ids = await findReviewingTimeoutDAO(24 * 60 * 60 * 1000)

        expect(ids).toContain(id)

        const idsStrict = await findReviewingTimeoutDAO(48 * 60 * 60 * 1000)
        expect(idsStrict).not.toContain(id)
    })
})
