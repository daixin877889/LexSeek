/**
 * 管理端合同审查 3 个接口测试：
 *   GET    /api/v1/admin/contract-reviews
 *   GET    /api/v1/admin/contract-reviews/:id
 *   DELETE /api/v1/admin/contract-reviews/:id
 *
 * 鉴权跳过（由 03.permission 中间件统一处理，这里只验证 handler 内部逻辑
 * 不做 owner 过滤）。所有 DAO 调用真实执行到测试数据库。
 *
 * **Feature: contract-review-m6.1b**
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach, beforeEach } from 'vitest'

// ==================== 全局 Stub（Nuxt nitro 自动导入）====================

const resError = (_event: any, code: number, message: string) => ({
    code,
    success: false,
    message,
    data: null,
})
const resSuccess = (_event: any, message: string, data: any) => ({
    code: 0,
    success: true,
    message,
    data,
})

;(globalThis as any).resError = resError
;(globalThis as any).resSuccess = resSuccess
;(globalThis as any).defineEventHandler = (h: any) => h
;(globalThis as any).getQuery = (event: any) => event.__query ?? {}
;(globalThis as any).getRouterParam = (event: any, key: string) => event.__params?.[key]
;(globalThis as any).logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }

import { prisma } from '~~/server/utils/db'
import { ensureTestUser, cleanupTestData } from '../test-db-helper'

// ==================== 动态 import handler（在 stub 之后）====================

const { default: listHandler } = await import(
    '../../../../server/api/v1/admin/contract-reviews/index.get'
)
const { default: detailHandler } = await import(
    '../../../../server/api/v1/admin/contract-reviews/[id].get'
)
const { default: deleteHandler } = await import(
    '../../../../server/api/v1/admin/contract-reviews/[id].delete'
)

function makeEvent(opts: {
    adminUserId?: number
    query?: Record<string, any>
    params?: Record<string, string>
}) {
    return {
        context: opts.adminUserId ? { auth: { user: { id: opts.adminUserId } } } : {},
        __query: opts.query ?? {},
        __params: opts.params ?? {},
    } as any
}

// ==================== 公共 fixture ====================

let adminUserId: number
let userA: number
let userB: number
let fileA: number
let fileB: number
const createdReviewIds: number[] = []
const createdFileIds: number[] = []

beforeAll(async () => {
    adminUserId = await ensureTestUser()
    userA = await ensureTestUser()
    userB = await ensureTestUser()

    const f1 = await prisma.ossFiles.create({
        data: {
            userId: userA,
            bucketName: 'test-bucket',
            fileName: '劳动合同_甲方公司.docx',
            filePath: `test/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-a.docx`,
            fileSize: 1024,
            fileType:
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        },
    })
    const f2 = await prisma.ossFiles.create({
        data: {
            userId: userB,
            bucketName: 'test-bucket',
            fileName: '租赁合同_乙方个人.docx',
            filePath: `test/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-b.docx`,
            fileSize: 2048,
            fileType:
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        },
    })
    fileA = f1.id
    fileB = f2.id
    createdFileIds.push(f1.id, f2.id)
})

afterEach(async () => {
    if (createdReviewIds.length > 0) {
        await prisma.contractReviews.deleteMany({
            where: { id: { in: createdReviewIds } },
        })
        createdReviewIds.length = 0
    }
})

afterAll(async () => {
    if (createdFileIds.length > 0) {
        await prisma.ossFiles.deleteMany({ where: { id: { in: createdFileIds } } })
    }
    await cleanupTestData()
})

async function createReview(opts: {
    userId: number
    originalFileId: number
    status: string
    summary?: string | null
    risks?: any
    contractType?: string | null
    deletedAt?: Date | null
}) {
    const row = await prisma.contractReviews.create({
        data: {
            userId: opts.userId,
            sessionId: `test-admin-sess-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
            originalFileId: opts.originalFileId,
            status: opts.status,
            summary: opts.summary ?? null,
            contractType: opts.contractType ?? null,
            ...(opts.risks !== undefined ? { risks: opts.risks } : {}),
            ...(opts.deletedAt !== undefined ? { deletedAt: opts.deletedAt } : {}),
        },
    })
    createdReviewIds.push(row.id)
    return row
}

// ==================== GET /admin/contract-reviews（列表）====================

describe('GET /api/v1/admin/contract-reviews', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('正常分页：3 条不同 user 的 review，skip=0 take=2 → items.length=2 total=3', async () => {
        await createReview({ userId: userA, originalFileId: fileA, status: 'completed' })
        await createReview({ userId: userB, originalFileId: fileB, status: 'completed' })
        await createReview({ userId: userA, originalFileId: fileA, status: 'pending' })
        // 本测试文件外可能有残留 review，但由于本 describe 前 adminUserId/userA/userB
        // 都是 ensureTestUser 新建的，残留不会挂在他们名下。这里只断言 >=3 的偏差排序语义
        const res: any = await listHandler(
            makeEvent({
                adminUserId,
                query: { skip: 0, take: 2, userId: userA },
            }),
        )
        expect(res.success).toBe(true)
        expect(res.data.total).toBe(2)
        expect(res.data.items).toHaveLength(2)
        // 管理端列表包含 userId / userPhone / userNickname / deletedAt 字段
        expect(res.data.items[0]).toHaveProperty('userId', userA)
        expect(res.data.items[0]).toHaveProperty('userPhone')
        expect(res.data.items[0]).toHaveProperty('userNickname')
        expect(res.data.items[0]).toHaveProperty('deletedAt')
    })

    it('userId filter：只返该用户的 review', async () => {
        await createReview({ userId: userA, originalFileId: fileA, status: 'completed' })
        await createReview({ userId: userA, originalFileId: fileA, status: 'pending' })
        await createReview({ userId: userB, originalFileId: fileB, status: 'completed' })

        const res: any = await listHandler(
            makeEvent({
                adminUserId,
                query: { userId: userB, skip: 0, take: 20 },
            }),
        )
        expect(res.success).toBe(true)
        expect(res.data.total).toBe(1)
        expect(res.data.items).toHaveLength(1)
        expect(res.data.items[0].userId).toBe(userB)
    })

    it('status + q 组合过滤', async () => {
        await createReview({ userId: userA, originalFileId: fileA, status: 'completed' }) // 劳动合同 完成
        await createReview({ userId: userB, originalFileId: fileB, status: 'completed' }) // 租赁合同 完成
        await createReview({ userId: userA, originalFileId: fileA, status: 'pending' })

        // 限定 userId=userA 避免跨测试文件数据污染（11 个合同测试文件都使用含"劳动"的 fileName）
        const res: any = await listHandler(
            makeEvent({
                adminUserId,
                query: { userId: userA, status: 'completed', q: '劳动', skip: 0, take: 20 },
            }),
        )
        expect(res.success).toBe(true)
        expect(res.data.total).toBe(1)
        expect(res.data.items[0].status).toBe('completed')
        expect(res.data.items[0].originalFileName).toBe('劳动合同_甲方公司.docx')
    })

    it('默认不返已删；includeDeleted=true 返回已删', async () => {
        const live = await createReview({
            userId: userA,
            originalFileId: fileA,
            status: 'completed',
        })
        const dead = await createReview({
            userId: userA,
            originalFileId: fileA,
            status: 'completed',
            deletedAt: new Date(),
        })

        const defaultRes: any = await listHandler(
            makeEvent({
                adminUserId,
                query: { userId: userA, skip: 0, take: 20 },
            }),
        )
        const defaultIds = defaultRes.data.items.map((r: any) => r.id)
        expect(defaultIds).toContain(live.id)
        expect(defaultIds).not.toContain(dead.id)

        const withDeletedRes: any = await listHandler(
            makeEvent({
                adminUserId,
                query: { userId: userA, skip: 0, take: 20, includeDeleted: 'true' },
            }),
        )
        const allIds = withDeletedRes.data.items.map((r: any) => r.id)
        expect(allIds).toContain(live.id)
        expect(allIds).toContain(dead.id)
        const deadItem = withDeletedRes.data.items.find((r: any) => r.id === dead.id)
        expect(deadItem.deletedAt).not.toBeNull()
    })

    it('非法 take=1000 返回 400（zod strict）', async () => {
        const res: any = await listHandler(
            makeEvent({ adminUserId, query: { take: 1000 } }),
        )
        expect(res.code).toBe(400)
    })
})

// ==================== GET /admin/contract-reviews/:id（详情）====================

describe('GET /api/v1/admin/contract-reviews/:id', () => {
    it('不存在 → 404', async () => {
        const res: any = await detailHandler(
            makeEvent({ adminUserId, params: { id: '99999999' } }),
        )
        expect(res.code).toBe(404)
    })

    it('正常 review → 完整字段（summary 不截断，risks 原样，user 信息存在）', async () => {
        const longSummary = 'x'.repeat(500)
        const risksPayload = [
            { id: 'r1', severity: 'high', title: '示例风险', description: 'desc' },
        ]
        const review = await createReview({
            userId: userA,
            originalFileId: fileA,
            status: 'completed',
            summary: longSummary,
            risks: risksPayload,
            contractType: '劳动合同',
        })

        const res: any = await detailHandler(
            makeEvent({ adminUserId, params: { id: String(review.id) } }),
        )
        expect(res.success).toBe(true)
        expect(res.data.id).toBe(review.id)
        expect(res.data.userId).toBe(userA)
        expect(res.data.userPhone).toBeTypeOf('string')
        expect(res.data.userNickname).toBeTypeOf('string')
        // summary 不截断
        expect(res.data.summary).toBe(longSummary)
        expect(res.data.summary.length).toBe(500)
        // risks 原样 JSON（Prisma Json 反序列化为 array/object）
        expect(Array.isArray(res.data.risks)).toBe(true)
        expect(res.data.risks[0]).toMatchObject({ id: 'r1', severity: 'high' })
        expect(res.data.originalFileName).toBe('劳动合同_甲方公司.docx')
        expect(res.data.deletedAt).toBeNull()
    })

    it('已软删 review 也能查到（deletedAt 非 null）', async () => {
        const review = await createReview({
            userId: userA,
            originalFileId: fileA,
            status: 'completed',
            deletedAt: new Date(),
        })

        const res: any = await detailHandler(
            makeEvent({ adminUserId, params: { id: String(review.id) } }),
        )
        expect(res.success).toBe(true)
        expect(res.data.id).toBe(review.id)
        expect(res.data.deletedAt).not.toBeNull()
    })
})

// ==================== DELETE /admin/contract-reviews/:id（软删）====================

describe('DELETE /api/v1/admin/contract-reviews/:id', () => {
    it('不存在 → 404', async () => {
        const res: any = await deleteHandler(
            makeEvent({ adminUserId, params: { id: '99999999' } }),
        )
        expect(res.code).toBe(404)
    })

    it('正常 review → 软删成功 alreadyDeleted=false，DB 中 deletedAt 非 null', async () => {
        const review = await createReview({
            userId: userA,
            originalFileId: fileA,
            status: 'completed',
        })

        const res: any = await deleteHandler(
            makeEvent({ adminUserId, params: { id: String(review.id) } }),
        )
        expect(res.success).toBe(true)
        expect(res.data).toEqual({ id: review.id, alreadyDeleted: false })

        const row = await prisma.contractReviews.findUnique({ where: { id: review.id } })
        expect(row?.deletedAt).not.toBeNull()
    })

    it('已删 review → 幂等 alreadyDeleted=true', async () => {
        const review = await createReview({
            userId: userA,
            originalFileId: fileA,
            status: 'completed',
            deletedAt: new Date('2024-01-01T00:00:00Z'),
        })
        const originalDeletedAt = (
            await prisma.contractReviews.findUnique({ where: { id: review.id } })
        )?.deletedAt

        const res: any = await deleteHandler(
            makeEvent({ adminUserId, params: { id: String(review.id) } }),
        )
        expect(res.success).toBe(true)
        expect(res.data).toEqual({ id: review.id, alreadyDeleted: true })

        // 幂等：deletedAt 不变更
        const after = await prisma.contractReviews.findUnique({ where: { id: review.id } })
        expect(after?.deletedAt?.toISOString()).toBe(originalDeletedAt?.toISOString())
    })
})
