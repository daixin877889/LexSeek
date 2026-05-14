/**
 * 管理端利率 CRUD API 测试
 *
 * 覆盖：LPR 全链路（列表 / 创建 / 更新 / 软删除 + zod 校验）
 *       PBOC 存款 / 贷款 happy path
 */
import { describe, it, expect, afterEach } from 'vitest'
import '../../../server/_helpers/handler-test'
import { prisma } from '~~/server/utils/db'
import lprListHandler from '~~/server/api/v1/admin/rates/lpr/index.get'
import lprCreateHandler from '~~/server/api/v1/admin/rates/lpr/index.post'
import lprPatchHandler from '~~/server/api/v1/admin/rates/lpr/[id].patch'
import lprDeleteHandler from '~~/server/api/v1/admin/rates/lpr/[id].delete'
import depositListHandler from '~~/server/api/v1/admin/rates/pboc-deposit/index.get'
import depositCreateHandler from '~~/server/api/v1/admin/rates/pboc-deposit/index.post'
import depositPatchHandler from '~~/server/api/v1/admin/rates/pboc-deposit/[id].patch'
import depositDeleteHandler from '~~/server/api/v1/admin/rates/pboc-deposit/[id].delete'
import loanListHandler from '~~/server/api/v1/admin/rates/pboc-loan/index.get'
import loanCreateHandler from '~~/server/api/v1/admin/rates/pboc-loan/index.post'
import loanPatchHandler from '~~/server/api/v1/admin/rates/pboc-loan/[id].patch'
import loanDeleteHandler from '~~/server/api/v1/admin/rates/pboc-loan/[id].delete'

function buildAdminEvent(opts: { body?: any; param?: string } = {}) {
    return {
        context: { auth: { user: { id: 1, role: 'super_admin' } } },
        __body: opts.body ?? null,
        __params: opts.param ? { id: opts.param } : {},
    } as any
}

// ============ LPR 全链路 ============

describe('admin/rates/lpr CRUD', () => {
    const createdIds: number[] = []

    afterEach(async () => {
        if (createdIds.length) {
            await prisma.lprRates.deleteMany({ where: { id: { in: createdIds } } })
            createdIds.length = 0
        }
    })

    it('GET 列表应包含 seed 数据', async () => {
        const res: any = await lprListHandler(buildAdminEvent())
        expect(res.code).toBe(0)
        expect(Array.isArray(res.data)).toBe(true)
        expect(res.data.length).toBeGreaterThanOrEqual(72)
    })

    it('未登录时 GET 返回 401', async () => {
        const res: any = await lprListHandler({ context: {} } as any)
        expect(res.code).toBe(401)
    })

    it('POST 创建 → PATCH 更新 → DELETE 软删除', async () => {
        const createRes: any = await lprCreateHandler(
            buildAdminEvent({ body: { effectDate: '2099-01-01', oneYear: 5.0, fiveYear: 6.0 } }),
        )
        expect(createRes.code).toBe(0)
        const id = createRes.data.id
        expect(typeof id).toBe('number')
        createdIds.push(id)

        const patchRes: any = await lprPatchHandler(
            buildAdminEvent({ body: { oneYear: 5.5 }, param: String(id) }),
        )
        expect(patchRes.code).toBe(0)
        expect(patchRes.data.oneYear).toBe(5.5)

        const delRes: any = await lprDeleteHandler(
            buildAdminEvent({ param: String(id) }),
        )
        expect(delRes.code).toBe(0)

        const row = await prisma.lprRates.findUnique({ where: { id } })
        expect(row?.deletedAt).not.toBeNull()
    })

    it('POST 校验：effectDate 缺失时返回 400', async () => {
        const res: any = await lprCreateHandler(
            buildAdminEvent({ body: { oneYear: 5.0, fiveYear: 6.0 } }),
        )
        expect(res.code).toBe(400)
    })

    it('PATCH 非法 id 返回 400', async () => {
        const res: any = await lprPatchHandler(
            buildAdminEvent({ body: { oneYear: 5.5 }, param: 'abc' }),
        )
        expect(res.code).toBe(400)
    })

    it('DELETE 非法 id 返回 400', async () => {
        const res: any = await lprDeleteHandler(buildAdminEvent({ param: 'xyz' }))
        expect(res.code).toBe(400)
    })
})

// ============ PBOC 存款 happy path ============

describe('admin/rates/pboc-deposit CRUD', () => {
    const createdIds: number[] = []

    afterEach(async () => {
        if (createdIds.length) {
            await prisma.pbocDepositRates.deleteMany({ where: { id: { in: createdIds } } })
            createdIds.length = 0
        }
    })

    it('GET 列表应包含 seed 数据', async () => {
        const res: any = await depositListHandler(buildAdminEvent())
        expect(res.code).toBe(0)
        expect(Array.isArray(res.data)).toBe(true)
        expect(res.data.length).toBeGreaterThan(0)
    })

    it('POST 创建 → PATCH 更新 → DELETE 软删除', async () => {
        const body = {
            effectDate: '2099-02-01',
            demand: 0.1,
            threeMonths: 1.0,
            sixMonths: 1.5,
            oneYear: 2.0,
            twoYear: 2.5,
            threeYear: 3.0,
            fiveYear: 3.5,
        }
        const createRes: any = await depositCreateHandler(buildAdminEvent({ body }))
        expect(createRes.code).toBe(0)
        const id = createRes.data.id
        createdIds.push(id)

        const patchRes: any = await depositPatchHandler(
            buildAdminEvent({ body: { demand: 0.2 }, param: String(id) }),
        )
        expect(patchRes.code).toBe(0)
        expect(patchRes.data.demand).toBe(0.2)

        const delRes: any = await depositDeleteHandler(buildAdminEvent({ param: String(id) }))
        expect(delRes.code).toBe(0)

        const row = await prisma.pbocDepositRates.findUnique({ where: { id } })
        expect(row?.deletedAt).not.toBeNull()
    })

    it('POST 校验：effectDate 缺失时返回 400', async () => {
        const res: any = await depositCreateHandler(
            buildAdminEvent({ body: { demand: 0.1, threeMonths: 1.0, sixMonths: 1.5, oneYear: 2.0, twoYear: 2.5, threeYear: 3.0, fiveYear: 3.5 } }),
        )
        expect(res.code).toBe(400)
    })
})

// ============ PBOC 贷款 happy path ============

describe('admin/rates/pboc-loan CRUD', () => {
    const createdIds: number[] = []

    afterEach(async () => {
        if (createdIds.length) {
            await prisma.pbocLoanRates.deleteMany({ where: { id: { in: createdIds } } })
            createdIds.length = 0
        }
    })

    it('GET 列表应包含 seed 数据', async () => {
        const res: any = await loanListHandler(buildAdminEvent())
        expect(res.code).toBe(0)
        expect(Array.isArray(res.data)).toBe(true)
        expect(res.data.length).toBeGreaterThan(0)
    })

    it('POST 创建 → PATCH 更新 → DELETE 软删除', async () => {
        const body = {
            effectDate: '2099-03-01',
            sixMonths: 3.0,
            oneYear: 3.5,
            oneToFiveYear: 4.0,
            fiveYear: 4.5,
        }
        const createRes: any = await loanCreateHandler(buildAdminEvent({ body }))
        expect(createRes.code).toBe(0)
        const id = createRes.data.id
        createdIds.push(id)

        const patchRes: any = await loanPatchHandler(
            buildAdminEvent({ body: { sixMonths: 3.1 }, param: String(id) }),
        )
        expect(patchRes.code).toBe(0)
        expect(patchRes.data.sixMonths).toBe(3.1)

        const delRes: any = await loanDeleteHandler(buildAdminEvent({ param: String(id) }))
        expect(delRes.code).toBe(0)

        const row = await prisma.pbocLoanRates.findUnique({ where: { id } })
        expect(row?.deletedAt).not.toBeNull()
    })

    it('POST 校验：effectDate 缺失时返回 400', async () => {
        const res: any = await loanCreateHandler(
            buildAdminEvent({ body: { sixMonths: 3.0, oneYear: 3.5, oneToFiveYear: 4.0, fiveYear: 4.5 } }),
        )
        expect(res.code).toBe(400)
    })
})
