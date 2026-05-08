/**
 * 管理端合同审查清单要点接口测试：
 *   GET    /api/v1/admin/contract-playbooks
 *   POST   /api/v1/admin/contract-playbooks
 *   PATCH  /api/v1/admin/contract-playbooks/:id
 *
 * 鉴权跳过（由 03.permission 中间件统一处理，这里只验证 handler 内部逻辑）。
 * 所有 DAO 调用真实执行到测试数据库。
 *
 * **Feature: contract-review-playbook (M7)**
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest'
import { prisma } from '~~/server/utils/db'
import { ensureTestUser, cleanupTestData } from '../test-db-helper'

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
;(globalThis as any).readBody = async (event: any) => event.__body ?? {}
;(globalThis as any).logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }

// ==================== 动态 import handler（在 stub 之后）====================

const { default: listHandler } = await import(
    '../../../../server/api/v1/admin/contract-playbooks/index.get'
)
const { default: createHandler } = await import(
    '../../../../server/api/v1/admin/contract-playbooks/index.post'
)
const { default: patchHandler } = await import(
    '../../../../server/api/v1/admin/contract-playbooks/[id].patch'
)

function makeEvent(opts: {
    adminUserId?: number
    query?: Record<string, any>
    params?: Record<string, string>
    body?: Record<string, any>
}) {
    return {
        context: opts.adminUserId ? { auth: { user: { id: opts.adminUserId } } } : {},
        __query: opts.query ?? {},
        __params: opts.params ?? {},
        __body: opts.body ?? {},
    } as any
}

// ==================== 公共 fixture ====================

let adminUserId: number
const createdPlaybookIds: number[] = []

beforeAll(async () => {
    adminUserId = await ensureTestUser()
})

afterEach(async () => {
    if (createdPlaybookIds.length > 0) {
        await prisma.contractPlaybooks.deleteMany({
            where: { id: { in: createdPlaybookIds } },
        })
        createdPlaybookIds.length = 0
    }
})

afterAll(async () => {
    await cleanupTestData()
})

// ==================== POST /admin/contract-playbooks（新增）====================

describe('POST /api/v1/admin/contract-playbooks', () => {
    it('新增要点 → 返回 success=true + 含 id', async () => {
        const res: any = await createHandler(
            makeEvent({
                adminUserId,
                body: {
                    contractType: '劳动合同',
                    code: `p_${Date.now().toString().slice(-8)}`,
                    title: '试用期合规',
                    defaultLevel: 'high',
                    stancePreference: 'strict',
                    checkContent: '检查试用期是否超过法定上限',
                },
            }),
        )
        expect(res.success).toBe(true)
        expect(res.data.id).toBeGreaterThan(0)
        expect(res.data.contractType).toBe('劳动合同')
        createdPlaybookIds.push(res.data.id)
    })

    it('defaultLevel 非法值（critical）→ 返回 400', async () => {
        const res: any = await createHandler(
            makeEvent({
                adminUserId,
                body: {
                    contractType: '劳动合同',
                    code: `inv_${Date.now().toString().slice(-8)}`,
                    title: '非法等级',
                    defaultLevel: 'critical',
                    checkContent: '检查内容',
                },
            }),
        )
        expect(res.code).toBe(400)
    })
})

// ==================== GET /admin/contract-playbooks（列表）====================

describe('GET /api/v1/admin/contract-playbooks', () => {
    it('contractType 过滤 → 只返回指定合同类型的要点', async () => {
        // 先插入两条不同合同类型的要点
        const suffix = Date.now()
        const r1: any = await createHandler(
            makeEvent({
                adminUserId,
                body: {
                    contractType: '劳动合同',
                    code: `labor_${suffix}`,
                    title: '劳动合同要点',
                    defaultLevel: 'high',
                    stancePreference: 'balanced',
                    checkContent: '检查劳动合同内容',
                },
            }),
        )
        const r2: any = await createHandler(
            makeEvent({
                adminUserId,
                body: {
                    contractType: '租赁合同',
                    code: `lease_${suffix}`,
                    title: '租赁合同要点',
                    defaultLevel: 'medium',
                    stancePreference: 'balanced',
                    checkContent: '检查租赁合同内容',
                },
            }),
        )
        createdPlaybookIds.push(r1.data.id, r2.data.id)

        const res: any = await listHandler(
            makeEvent({
                adminUserId,
                query: { contractType: '劳动合同' },
            }),
        )
        expect(res.success).toBe(true)
        // 结果中只包含劳动合同类型
        const ids = res.data.list.map((i: any) => i.id)
        expect(ids).toContain(r1.data.id)
        expect(ids).not.toContain(r2.data.id)
        // 所有项的 contractType 都是劳动合同
        for (const item of res.data.list) {
            expect(item.contractType).toBe('劳动合同')
        }
    })

    it('enabled=false 字符串被正确解析为 false（仅返回停用项）', async () => {
        // schema 限制 code ≤ 20 字符，所以只取 Date.now() 后 9 位做后缀
        const suffix = String(Date.now()).slice(-9)
        const r1: any = await createHandler(
            makeEvent({
                adminUserId,
                body: {
                    contractType: '劳动合同',
                    code: `en_${suffix}`,
                    title: '启用项',
                    defaultLevel: 'high',
                    stancePreference: 'balanced',
                    checkContent: '检查内容',
                },
            }),
        )
        const r2: any = await createHandler(
            makeEvent({
                adminUserId,
                body: {
                    contractType: '劳动合同',
                    code: `di_${suffix}`,
                    title: '停用项',
                    defaultLevel: 'low',
                    stancePreference: 'balanced',
                    checkContent: '检查内容',
                },
            }),
        )
        createdPlaybookIds.push(r1.data.id, r2.data.id)

        // 把 r2 切到停用
        await patchHandler(
            makeEvent({
                adminUserId,
                params: { id: String(r2.data.id) },
                body: { enabled: false },
            }),
        )

        // 关键：之前 z.coerce.boolean 会把 'false' 字符串错当真值，导致返回启用项
        const res: any = await listHandler(
            makeEvent({
                adminUserId,
                query: { contractType: '劳动合同', enabled: 'false' },
            }),
        )
        expect(res.success).toBe(true)
        const ids = res.data.list.map((i: any) => i.id)
        expect(ids).toContain(r2.data.id)
        expect(ids).not.toContain(r1.data.id)
    })
})

// ==================== PATCH /admin/contract-playbooks/:id（编辑）====================

describe('PATCH /api/v1/admin/contract-playbooks/:id', () => {
    it('切换 enabled → 返回 success=true + enabled=false', async () => {
        // 先创建要点
        const suffix = Date.now()
        const created: any = await createHandler(
            makeEvent({
                adminUserId,
                body: {
                    contractType: '劳动合同',
                    code: `pt_${String(suffix).slice(-8)}`,
                    title: '待禁用要点',
                    defaultLevel: 'low',
                    stancePreference: 'lenient',
                    checkContent: '检查内容',
                },
            }),
        )
        createdPlaybookIds.push(created.data.id)

        const res: any = await patchHandler(
            makeEvent({
                adminUserId,
                params: { id: String(created.data.id) },
                body: { enabled: false },
            }),
        )
        expect(res.success).toBe(true)
        expect(res.data.enabled).toBe(false)
    })

    it('PATCH 不存在的 id → 返回 404', async () => {
        const res: any = await patchHandler(
            makeEvent({
                adminUserId,
                params: { id: '99999999' },
                body: { enabled: false },
            }),
        )
        expect(res.code).toBe(404)
    })
})
