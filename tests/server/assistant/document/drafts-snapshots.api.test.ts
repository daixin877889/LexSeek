/**
 * GET /api/v1/assistant/document/drafts/[id]/snapshots
 * POST /api/v1/assistant/document/drafts/snapshots/apply/[snapshotId]
 *
 * **Feature: document-generation**
 * **Validates: Task 13 - snapshots list + apply API**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ==================== 全局 Stub（模拟 Nuxt nitro 自动导入）====================

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
;(globalThis as any).readBody = async (event: any) => event.__body
;(globalThis as any).getRouterParam = (event: any, key: string) => event.__params?.[key]
;(globalThis as any).logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }

// ==================== Mock service & dao 层 ====================

vi.mock('~~/server/agents/document/documentDraftSnapshot.service', () => ({
    listSnapshotsForUserService: vi.fn(),
    applySnapshotFieldsService: vi.fn(),
}))
vi.mock('~~/server/agents/document/documentDraftSnapshot.dao', () => ({
    getSnapshotByIdDAO: vi.fn(),
}))

import {
    listSnapshotsForUserService,
    applySnapshotFieldsService,
} from '~~/server/agents/document/documentDraftSnapshot.service'
import { getSnapshotByIdDAO } from '~~/server/agents/document/documentDraftSnapshot.dao'

const mockListService = listSnapshotsForUserService as ReturnType<typeof vi.fn>
const mockApplyService = applySnapshotFieldsService as ReturnType<typeof vi.fn>
const mockGetSnapshot = getSnapshotByIdDAO as ReturnType<typeof vi.fn>

// ==================== 动态 import handlers ====================

const { default: listHandler } = await import(
    '../../../../server/api/v1/assistant/document/drafts/[id]/snapshots.get'
)
const { default: applyHandler } = await import(
    '../../../../server/api/v1/assistant/document/drafts/snapshots/apply/[snapshotId].post'
)

// ==================== 测试数据 ====================

const USER_A = 1001
const USER_B = 1002

// ==================== GET /drafts/[id]/snapshots ====================

describe('GET /api/v1/assistant/document/drafts/[id]/snapshots', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('未登录返回 401', async () => {
        const res: any = await listHandler({ context: {}, __params: { id: '1' } })
        expect(res.code).toBe(401)
    })

    it('id 非法字符串返回 400', async () => {
        const res: any = await listHandler({
            context: { auth: { user: { id: USER_A } } },
            __params: { id: 'abc' },
        })
        expect(res.code).toBe(400)
    })

    it('id 为 0 返回 400', async () => {
        const res: any = await listHandler({
            context: { auth: { user: { id: USER_A } } },
            __params: { id: '0' },
        })
        expect(res.code).toBe(400)
    })

    it('id 为负数返回 400', async () => {
        const res: any = await listHandler({
            context: { auth: { user: { id: USER_A } } },
            __params: { id: '-1' },
        })
        expect(res.code).toBe(400)
    })

    it('owner 成功查询快照列表', async () => {
        const snapshots = [
            { id: 1, draftId: 10, source: 'ai-extract', values: { a: '1' }, createdAt: new Date() },
            { id: 2, draftId: 10, source: 'workspace-backup', values: { b: '2' }, createdAt: new Date() },
        ]
        mockListService.mockResolvedValue({ snapshots })
        const res: any = await listHandler({
            context: { auth: { user: { id: USER_A } } },
            __params: { id: '10' },
        })
        expect(res.code).toBe(0)
        expect(res.success).toBe(true)
        expect(res.data.snapshots).toHaveLength(2)
        expect(res.data.snapshots[0].id).toBe(1)
        expect(mockListService).toHaveBeenCalledWith(USER_A, 10)
    })

    it('service 返 403 无权访问时透传', async () => {
        mockListService.mockResolvedValue({ error: '无权访问此草稿', code: 403 })
        const res: any = await listHandler({
            context: { auth: { user: { id: USER_B } } },
            __params: { id: '10' },
        })
        expect(res.code).toBe(403)
        expect(res.success).toBe(false)
    })

    it('service 返 404 草稿不存在时透传', async () => {
        mockListService.mockResolvedValue({ error: '草稿不存在', code: 404 })
        const res: any = await listHandler({
            context: { auth: { user: { id: USER_A } } },
            __params: { id: '999' },
        })
        expect(res.code).toBe(404)
        expect(res.success).toBe(false)
    })

    it('空列表返回空数组', async () => {
        mockListService.mockResolvedValue({ snapshots: [] })
        const res: any = await listHandler({
            context: { auth: { user: { id: USER_A } } },
            __params: { id: '10' },
        })
        expect(res.code).toBe(0)
        expect(res.data.snapshots).toEqual([])
    })
})

// ==================== POST /drafts/snapshots/apply/[snapshotId] ====================

describe('POST /api/v1/assistant/document/drafts/snapshots/apply/[snapshotId]', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('未登录返回 401', async () => {
        const res: any = await applyHandler({
            context: {},
            __params: { snapshotId: '1' },
            __body: {},
        })
        expect(res.code).toBe(401)
    })

    it('snapshotId 非法字符串返回 400', async () => {
        const res: any = await applyHandler({
            context: { auth: { user: { id: USER_A } } },
            __params: { snapshotId: 'xyz' },
            __body: {},
        })
        expect(res.code).toBe(400)
    })

    it('snapshotId 为 0 返回 400', async () => {
        const res: any = await applyHandler({
            context: { auth: { user: { id: USER_A } } },
            __params: { snapshotId: '0' },
            __body: {},
        })
        expect(res.code).toBe(400)
    })

    it('snapshotId 为负数返回 400', async () => {
        const res: any = await applyHandler({
            context: { auth: { user: { id: USER_A } } },
            __params: { snapshotId: '-5' },
            __body: {},
        })
        expect(res.code).toBe(400)
    })

    it('fieldNames 包含空字符串返回 400', async () => {
        const res: any = await applyHandler({
            context: { auth: { user: { id: USER_A } } },
            __params: { snapshotId: '5' },
            __body: { fieldNames: ['', 'name'] },
        })
        expect(res.code).toBe(400)
    })

    it('fieldNames 非数组返回 400', async () => {
        const res: any = await applyHandler({
            context: { auth: { user: { id: USER_A } } },
            __params: { snapshotId: '5' },
            __body: { fieldNames: 'name' },
        })
        expect(res.code).toBe(400)
    })

    it('snapshot 不存在返回 404', async () => {
        mockGetSnapshot.mockResolvedValue(null)
        const res: any = await applyHandler({
            context: { auth: { user: { id: USER_A } } },
            __params: { snapshotId: '999' },
            __body: {},
        })
        expect(res.code).toBe(404)
    })

    it('全量恢复成功（不传 fieldNames）', async () => {
        const draft = { id: 99, values: { a: '1', b: '2' }, updatedAt: new Date() }
        mockGetSnapshot.mockResolvedValue({ id: 5, draftId: 99 })
        mockApplyService.mockResolvedValue({ draft })
        const res: any = await applyHandler({
            context: { auth: { user: { id: USER_A } } },
            __params: { snapshotId: '5' },
            __body: {},
        })
        expect(res.code).toBe(0)
        expect(res.success).toBe(true)
        expect(res.data.draft).toEqual(draft)
        expect(mockApplyService).toHaveBeenCalledWith(USER_A, 99, 5, undefined)
    })

    it('字段级恢复成功（传 fieldNames）', async () => {
        const draft = { id: 99, values: { a: '1', b: '2' }, updatedAt: new Date() }
        mockGetSnapshot.mockResolvedValue({ id: 5, draftId: 99 })
        mockApplyService.mockResolvedValue({ draft })
        const res: any = await applyHandler({
            context: { auth: { user: { id: USER_A } } },
            __params: { snapshotId: '5' },
            __body: { fieldNames: ['a', 'b'] },
        })
        expect(res.code).toBe(0)
        expect(res.success).toBe(true)
        expect(mockApplyService).toHaveBeenCalledWith(USER_A, 99, 5, ['a', 'b'])
    })

    it('单个字段恢复', async () => {
        const draft = { id: 99, values: { name: 'updated' }, updatedAt: new Date() }
        mockGetSnapshot.mockResolvedValue({ id: 5, draftId: 99 })
        mockApplyService.mockResolvedValue({ draft })
        const res: any = await applyHandler({
            context: { auth: { user: { id: USER_A } } },
            __params: { snapshotId: '5' },
            __body: { fieldNames: ['name'] },
        })
        expect(res.code).toBe(0)
        expect(mockApplyService).toHaveBeenCalledWith(USER_A, 99, 5, ['name'])
    })

    it('service 返 403 无权恢复时透传', async () => {
        mockGetSnapshot.mockResolvedValue({ id: 5, draftId: 99 })
        mockApplyService.mockResolvedValue({ error: '无权访问此草稿', code: 403 })
        const res: any = await applyHandler({
            context: { auth: { user: { id: USER_B } } },
            __params: { snapshotId: '5' },
            __body: {},
        })
        expect(res.code).toBe(403)
        expect(res.success).toBe(false)
    })

    it('service 返 404 草稿不存在时透传', async () => {
        mockGetSnapshot.mockResolvedValue({ id: 5, draftId: 999 })
        mockApplyService.mockResolvedValue({ error: '草稿不存在', code: 404 })
        const res: any = await applyHandler({
            context: { auth: { user: { id: USER_A } } },
            __params: { snapshotId: '5' },
            __body: {},
        })
        expect(res.code).toBe(404)
        expect(res.success).toBe(false)
    })

    it('body 为 null 处理', async () => {
        const draft = { id: 99, values: {}, updatedAt: new Date() }
        mockGetSnapshot.mockResolvedValue({ id: 5, draftId: 99 })
        mockApplyService.mockResolvedValue({ draft })
        const res: any = await applyHandler({
            context: { auth: { user: { id: USER_A } } },
            __params: { snapshotId: '5' },
            __body: null,
        })
        expect(res.code).toBe(0)
        expect(mockApplyService).toHaveBeenCalledWith(USER_A, 99, 5, undefined)
    })
})
