/**
 * GET /api/v1/assistant/contract/reviews 用户端分页列表测试
 *
 * 覆盖：
 *  Handler（mock DAO）：
 *   - 401 未登录
 *   - 400 take 超出上限（take=1000）
 *   - 400 skip 为负
 *   - 400 含未识别字段（zod strict）
 *   - handler 转发 user.id / skip / take / status / q 给 DAO
 *  DAO（真实 DB）：
 *   - 分页 skip/take 基础 + owner-only + deletedAt 过滤 + createdAt desc 排序
 *   - status 精确过滤
 *   - q 按 originalFile.fileName 模糊匹配（case-insensitive）
 *   - summary 前 120 字符截断
 *   - item 字段白名单（不含 userId / deletedAt）
 *
 * **Feature: contract-review-m6.1a（Task 4）**
 * **Validates: GET /reviews 列表接口**
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
;(globalThis as any).logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }

// ==================== Mock DAO（仅 listUserReviewsDAO，保留其他真实方法）====================

vi.mock('~~/server/services/assistant/contract/contractReview.dao', async (orig) => {
    const actual = await (orig as any)()
    return {
        ...actual,
        listUserReviewsDAO: vi.fn(),
    }
})

import * as daoModule from '~~/server/services/assistant/contract/contractReview.dao'
import { prisma } from '~~/server/utils/db'
import { ensureTestUser, cleanupTestData } from '../test-db-helper'

const mockList = daoModule.listUserReviewsDAO as unknown as ReturnType<typeof vi.fn>

// ==================== 动态 import handler（在 mock 之后）====================

const { default: listHandler } = await import(
    '../../../../server/api/v1/assistant/contract/reviews/index.get'
)

// 通过 importActual 拿到真实 DAO（绕开 mock），用于 DAO 真实 DB 测试
const actualDao = await vi.importActual<
    typeof import('~~/server/services/assistant/contract/contractReview.dao')
>('~~/server/services/assistant/contract/contractReview.dao')
const listUserReviewsDAOReal = actualDao.listUserReviewsDAO

function makeEvent(opts: { userId?: number; query?: Record<string, any> }) {
    return {
        context: opts.userId ? { auth: { user: { id: opts.userId } } } : {},
        __query: opts.query ?? {},
    } as any
}

// ==================== Handler 分支测试 ====================

describe('GET /api/v1/assistant/contract/reviews - handler 分支', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('未登录返回 401', async () => {
        const res: any = await listHandler(makeEvent({}))
        expect(res.code).toBe(401)
        expect(mockList).not.toHaveBeenCalled()
    })

    it('take 超过 100 返回 400', async () => {
        const res: any = await listHandler(
            makeEvent({ userId: 1, query: { take: 1000 } }),
        )
        expect(res.code).toBe(400)
        expect(mockList).not.toHaveBeenCalled()
    })

    it('skip 为负数返回 400', async () => {
        const res: any = await listHandler(
            makeEvent({ userId: 1, query: { skip: -1 } }),
        )
        expect(res.code).toBe(400)
        expect(mockList).not.toHaveBeenCalled()
    })

    it('含未识别字段返回 400（zod strict）', async () => {
        const res: any = await listHandler(
            makeEvent({ userId: 1, query: { foo: 'bar' } }),
        )
        expect(res.code).toBe(400)
        expect(mockList).not.toHaveBeenCalled()
    })

    it('handler 正确转发 user.id / skip / take / status / q 给 DAO', async () => {
        mockList.mockResolvedValue({ items: [], total: 0 })
        const res: any = await listHandler(
            makeEvent({
                userId: 1001,
                query: { skip: '5', take: '10', status: 'completed', q: '劳动' },
            }),
        )
        expect(res.success).toBe(true)
        expect(res.data).toEqual({ items: [], total: 0, skip: 5, take: 10 })
        expect(mockList).toHaveBeenCalledWith({
            userId: 1001,
            skip: 5,
            take: 10,
            status: 'completed',
            q: '劳动',
        })
    })
})

// ==================== DAO 真实 DB 测试 ====================

describe('listUserReviewsDAO - 真实数据库', () => {
    let testUserId: number
    let otherUserId: number
    let testFileIdA: number
    let testFileIdB: number
    const createdReviewIds: number[] = []
    const createdFileIds: number[] = []

    beforeAll(async () => {
        testUserId = await ensureTestUser()
        otherUserId = await ensureTestUser()

        const fileA = await prisma.ossFiles.create({
            data: {
                userId: testUserId,
                bucketName: 'test-bucket',
                fileName: '劳动合同_甲方公司.docx',
                filePath: `test/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-a.docx`,
                fileSize: 1024,
                fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            },
        })
        const fileB = await prisma.ossFiles.create({
            data: {
                userId: testUserId,
                bucketName: 'test-bucket',
                fileName: '租赁合同_乙方个人.docx',
                filePath: `test/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-b.docx`,
                fileSize: 2048,
                fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            },
        })
        testFileIdA = fileA.id
        testFileIdB = fileB.id
        createdFileIds.push(fileA.id, fileB.id)
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
        contractType?: string | null
        createdAt?: Date
        deletedAt?: Date | null
    }) {
        const row = await prisma.contractReviews.create({
            data: {
                userId: opts.userId,
                sessionId: `test-sess-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
                originalFileId: opts.originalFileId,
                status: opts.status,
                summary: opts.summary ?? null,
                contractType: opts.contractType ?? null,
                ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
                ...(opts.deletedAt !== undefined ? { deletedAt: opts.deletedAt } : {}),
            },
        })
        createdReviewIds.push(row.id)
        return row
    }

    it('分页 skip/take 基础 + owner-only + 排除软删 + 排序 createdAt desc', async () => {
        const base = Date.now()
        const r1 = await createReview({
            userId: testUserId,
            originalFileId: testFileIdA,
            status: 'completed',
            createdAt: new Date(base - 3000),
        })
        const r2 = await createReview({
            userId: testUserId,
            originalFileId: testFileIdA,
            status: 'completed',
            createdAt: new Date(base - 2000),
        })
        const r3 = await createReview({
            userId: testUserId,
            originalFileId: testFileIdB,
            status: 'completed',
            createdAt: new Date(base - 1000),
        })
        await createReview({
            userId: otherUserId,
            originalFileId: testFileIdA,
            status: 'completed',
        })
        await createReview({
            userId: testUserId,
            originalFileId: testFileIdA,
            status: 'completed',
            deletedAt: new Date(),
        })

        const page1 = await listUserReviewsDAOReal({
            userId: testUserId,
            skip: 0,
            take: 2,
        })
        expect(page1.total).toBe(3)
        expect(page1.items).toHaveLength(2)
        expect(page1.items[0].id).toBe(r3.id)
        expect(page1.items[1].id).toBe(r2.id)

        const page2 = await listUserReviewsDAOReal({
            userId: testUserId,
            skip: 2,
            take: 2,
        })
        expect(page2.total).toBe(3)
        expect(page2.items).toHaveLength(1)
        expect(page2.items[0].id).toBe(r1.id)
    })

    it('按 status 精确过滤', async () => {
        await createReview({
            userId: testUserId,
            originalFileId: testFileIdA,
            status: 'completed',
        })
        await createReview({
            userId: testUserId,
            originalFileId: testFileIdA,
            status: 'pending',
        })

        const completed = await listUserReviewsDAOReal({
            userId: testUserId,
            skip: 0,
            take: 20,
            status: 'completed',
        })
        expect(completed.total).toBe(1)
        expect(completed.items[0].status).toBe('completed')

        const pending = await listUserReviewsDAOReal({
            userId: testUserId,
            skip: 0,
            take: 20,
            status: 'pending',
        })
        expect(pending.total).toBe(1)
        expect(pending.items[0].status).toBe('pending')
    })

    it('按 q 模糊匹配 originalFile.fileName（case-insensitive）', async () => {
        const rA = await createReview({
            userId: testUserId,
            originalFileId: testFileIdA, // 劳动合同_甲方公司.docx
            status: 'completed',
        })
        await createReview({
            userId: testUserId,
            originalFileId: testFileIdB, // 租赁合同_乙方个人.docx
            status: 'completed',
        })

        const hit = await listUserReviewsDAOReal({
            userId: testUserId,
            skip: 0,
            take: 20,
            q: '劳动',
        })
        expect(hit.total).toBe(1)
        expect(hit.items[0].id).toBe(rA.id)
        expect(hit.items[0].originalFileName).toBe('劳动合同_甲方公司.docx')

        // fileName 小写 "docx"，查询用大写 "DOCX" 应命中两条（case-insensitive）
        const caseInsensitive = await listUserReviewsDAOReal({
            userId: testUserId,
            skip: 0,
            take: 20,
            q: 'DOCX',
        })
        expect(caseInsensitive.total).toBe(2)
    })

    it('summary 截断到 120 字符', async () => {
        const longSummary = 'x'.repeat(500)
        await createReview({
            userId: testUserId,
            originalFileId: testFileIdA,
            status: 'completed',
            summary: longSummary,
        })

        const res = await listUserReviewsDAOReal({
            userId: testUserId,
            skip: 0,
            take: 20,
        })
        expect(res.total).toBe(1)
        expect(res.items[0].summary).not.toBeNull()
        expect(res.items[0].summary!.length).toBe(120)
    })

    it('item 字段白名单：不含 userId / deletedAt', async () => {
        await createReview({
            userId: testUserId,
            originalFileId: testFileIdA,
            status: 'completed',
            contractType: '劳动合同',
        })
        const res = await listUserReviewsDAOReal({
            userId: testUserId,
            skip: 0,
            take: 20,
        })
        expect(res.items).toHaveLength(1)
        const item = res.items[0]
        expect(item).toHaveProperty('id')
        expect(item).toHaveProperty('sessionId')
        expect(item).toHaveProperty('contractType', '劳动合同')
        expect(item).toHaveProperty('partyA')
        expect(item).toHaveProperty('partyB')
        expect(item).toHaveProperty('stance')
        expect(item).toHaveProperty('status', 'completed')
        expect(item).toHaveProperty('summary')
        expect(item).toHaveProperty('originalFileName', '劳动合同_甲方公司.docx')
        expect(item).toHaveProperty('hasUnsavedDocxChanges', false)
        expect(item).toHaveProperty('createdAt')
        expect(item).toHaveProperty('updatedAt')
        expect(item).not.toHaveProperty('userId')
        expect(item).not.toHaveProperty('deletedAt')
    })
})
