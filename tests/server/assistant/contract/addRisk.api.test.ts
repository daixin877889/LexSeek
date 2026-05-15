/**
 * POST /reviews/add-risk/:id 接口测试
 * **Feature: contract-add-risk-hover**
 */
import { describe, it, expect, afterEach } from 'vitest'
import { vi } from 'vitest'
import { prisma } from '~~/server/utils/db'

// ===== globalThis stub（Nuxt nitro 自动导入），必须在 import handler 之前 =====
;(globalThis as any).resError = (_e: any, code: number, message: string) => ({ code, success: false, message, data: null })
;(globalThis as any).resSuccess = (_e: any, message: string, data: any) => ({ code: 0, success: true, message, data })
;(globalThis as any).defineEventHandler = (h: any) => h
;(globalThis as any).getRouterParam = (e: any, key: string) => e.__params?.[key]
;(globalThis as any).readBody = async (e: any) => e.__body ?? {}
;(globalThis as any).logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }

const { default: handler } = await import(
    '../../../../server/api/v1/assistant/contract/reviews/add-risk/[id].post'
)

function makeEvent(opts: { userId: number; reviewId: number | string; body: unknown }) {
    return {
        context: { auth: { user: { id: opts.userId, name: '测试律师' } } },
        __params: { id: String(opts.reviewId) },
        __body: opts.body,
    } as any
}

// phone 列是 VarChar(11) 且唯一；用「1 + 7 位时间戳尾 + 3 位自增序号」保证 11 字符且全局唯一
let phoneSeq = 0
function nextPhone(): string {
    phoneSeq += 1
    return `1${String(Date.now()).slice(-7)}${String(phoneSeq).padStart(3, '0')}`
}

describe('POST /reviews/add-risk/:id', () => {
    const created = { reviews: [] as number[], users: [] as number[] }

    afterEach(async () => {
        await prisma.contractRisks.deleteMany({ where: { reviewId: { in: created.reviews } } })
        await prisma.contractReviews.deleteMany({ where: { id: { in: created.reviews } } })
        await prisma.users.deleteMany({ where: { id: { in: created.users } } })
        created.reviews = []
        created.users = []
    })

    async function seedUser(): Promise<number> {
        const u = await prisma.users.create({
            data: { name: '测试律师', phone: nextPhone(), password: 'x' },
        })
        created.users.push(u.id)
        return u.id
    }

    async function seedReview(userId: number, status: string, currentVersionId: number | null): Promise<number> {
        const r = await prisma.contractReviews.create({
            // originalFileId 是 NOT NULL 无默认列，传任意整数
            data: { userId, sessionId: `s-${Date.now()}-${Math.random()}`, status, currentVersionId, originalFileId: 1 },
        })
        created.reviews.push(r.id)
        return r.id
    }

    const validBody = {
        clauseText: '第二条 试用期为 6 个月。',
        clauseParagraphIndex: 5,
        level: 'high',
        category: '试用期',
        problem: '试用期过长',
        analysis: '超过法定上限',
        suggestion: '改为不超过 6 个月',
        suggestedClauseText: '试用期为 2 个月。',
    }

    it('completed + 已迁移：成功新增 manual 风险', async () => {
        const userId = await seedUser()
        const reviewId = await seedReview(userId, 'completed', 1)
        const res: any = await handler(makeEvent({ userId, reviewId, body: validBody }))
        expect(res.code).toBe(0)
        const rows = await prisma.contractRisks.findMany({ where: { reviewId } })
        expect(rows).toHaveLength(1)
        expect(rows[0]!.source).toBe('manual')
    })

    it('未迁移审查（currentVersionId=null）：拒绝，不入库', async () => {
        const userId = await seedUser()
        const reviewId = await seedReview(userId, 'completed', null)
        const res: any = await handler(makeEvent({ userId, reviewId, body: validBody }))
        expect(res.code).not.toBe(0)
        expect(await prisma.contractRisks.count({ where: { reviewId } })).toBe(0)
    })

    it('非 completed 审查：拒绝', async () => {
        const userId = await seedUser()
        const reviewId = await seedReview(userId, 'reviewing', 1)
        const res: any = await handler(makeEvent({ userId, reviewId, body: validBody }))
        expect(res.code).not.toBe(0)
    })

    it('他人审查：owner-only 校验拒绝', async () => {
        const ownerId = await seedUser()
        const reviewId = await seedReview(ownerId, 'completed', 1)
        const otherId = await seedUser()
        const res: any = await handler(makeEvent({ userId: otherId, reviewId, body: validBody }))
        expect(res.code).not.toBe(0)
        expect(await prisma.contractRisks.count({ where: { reviewId } })).toBe(0)
    })
})
