/**
 * GET /api/v1/assistant/document/drafts/[id]/versions
 * POST /api/v1/assistant/document/drafts/[id]/versions
 * PATCH /api/v1/assistant/document/drafts/versions/[versionId]
 * DELETE /api/v1/assistant/document/drafts/versions/[versionId]
 *
 * **Feature: document-generation**
 * **Validates: Task 14 - versions list/create/rename/delete API**
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

// ==================== Mock service 层 ====================

vi.mock('~~/server/services/assistant/document/documentDraftVersion.service', () => ({
    listVersionsForUserService: vi.fn(),
    createVersionService: vi.fn(),
    renameVersionService: vi.fn(),
    deleteVersionService: vi.fn(),
}))

import {
    listVersionsForUserService,
    createVersionService,
    renameVersionService,
    deleteVersionService,
} from '~~/server/services/assistant/document/documentDraftVersion.service'

const mockListService = listVersionsForUserService as ReturnType<typeof vi.fn>
const mockCreateService = createVersionService as ReturnType<typeof vi.fn>
const mockRenameService = renameVersionService as ReturnType<typeof vi.fn>
const mockDeleteService = deleteVersionService as ReturnType<typeof vi.fn>

// ==================== 动态 import handlers ====================

const { default: listHandler } = await import(
    '../../../../server/api/v1/assistant/document/drafts/[id]/versions.get'
)
const { default: createHandler } = await import(
    '../../../../server/api/v1/assistant/document/drafts/[id]/versions.post'
)
const { default: renameHandler } = await import(
    '../../../../server/api/v1/assistant/document/drafts/versions/[versionId].patch'
)
const { default: deleteHandler } = await import(
    '../../../../server/api/v1/assistant/document/drafts/versions/[versionId].delete'
)

// ==================== 测试数据 ====================

const USER_A = 1001
const USER_B = 1002

// ==================== GET /drafts/[id]/versions ====================

describe('GET /api/v1/assistant/document/drafts/[id]/versions', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('未登录返回 401', async () => {
        const res: any = await listHandler({ context: {}, __params: { id: '10' } })
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

    it('owner 成功查询版本列表', async () => {
        const versions = [
            { id: 1, draftId: 10, versionNo: 1, name: '版本 1', titleAt: '标题 1', createdAt: new Date() },
            { id: 2, draftId: 10, versionNo: 2, name: '版本 2', titleAt: '标题 2', createdAt: new Date() },
        ]
        mockListService.mockResolvedValue({ versions })
        const res: any = await listHandler({
            context: { auth: { user: { id: USER_A } } },
            __params: { id: '10' },
        })
        expect(res.code).toBe(0)
        expect(res.success).toBe(true)
        expect(res.data.versions).toHaveLength(2)
        expect(res.data.versions[0].id).toBe(1)
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

    it('空列表返回空数组', async () => {
        mockListService.mockResolvedValue({ versions: [] })
        const res: any = await listHandler({
            context: { auth: { user: { id: USER_A } } },
            __params: { id: '10' },
        })
        expect(res.code).toBe(0)
        expect(res.data.versions).toEqual([])
    })
})

// ==================== POST /drafts/[id]/versions ====================

describe('POST /api/v1/assistant/document/drafts/[id]/versions', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('未登录返回 401', async () => {
        const res: any = await createHandler({
            context: {},
            __params: { id: '10' },
            __body: { name: '新版本' },
        })
        expect(res.code).toBe(401)
    })

    it('id 非法字符串返回 400', async () => {
        const res: any = await createHandler({
            context: { auth: { user: { id: USER_A } } },
            __params: { id: 'xyz' },
            __body: { name: '新版本' },
        })
        expect(res.code).toBe(400)
    })

    it('id 为 0 返回 400', async () => {
        const res: any = await createHandler({
            context: { auth: { user: { id: USER_A } } },
            __params: { id: '0' },
            __body: { name: '新版本' },
        })
        expect(res.code).toBe(400)
    })

    it('name 为空字符串返回 400', async () => {
        const res: any = await createHandler({
            context: { auth: { user: { id: USER_A } } },
            __params: { id: '10' },
            __body: { name: '' },
        })
        expect(res.code).toBe(400)
    })

    it('name 超过 100 字符返回 400', async () => {
        const longName = 'x'.repeat(101)
        const res: any = await createHandler({
            context: { auth: { user: { id: USER_A } } },
            __params: { id: '10' },
            __body: { name: longName },
        })
        expect(res.code).toBe(400)
    })

    it('name 缺失返回 400', async () => {
        const res: any = await createHandler({
            context: { auth: { user: { id: USER_A } } },
            __params: { id: '10' },
            __body: {},
        })
        expect(res.code).toBe(400)
    })

    it('owner 成功创建版本', async () => {
        const version = {
            id: 99,
            draftId: 10,
            versionNo: 1,
            name: '新版本',
            titleAt: '标题',
            values: { a: '1' },
            createdAt: new Date(),
        }
        mockCreateService.mockResolvedValue({ version })
        const res: any = await createHandler({
            context: { auth: { user: { id: USER_A } } },
            __params: { id: '10' },
            __body: { name: '新版本' },
        })
        expect(res.code).toBe(0)
        expect(res.success).toBe(true)
        expect(res.data.version).toEqual(version)
        expect(mockCreateService).toHaveBeenCalledWith(USER_A, 10, '新版本')
    })

    it('name 自动去除前后空白', async () => {
        const version = {
            id: 99,
            draftId: 10,
            versionNo: 1,
            name: '版本名',
            titleAt: '标题',
            values: {},
            createdAt: new Date(),
        }
        mockCreateService.mockResolvedValue({ version })
        const res: any = await createHandler({
            context: { auth: { user: { id: USER_A } } },
            __params: { id: '10' },
            __body: { name: '  版本名  ' },
        })
        expect(res.code).toBe(0)
        expect(mockCreateService).toHaveBeenCalledWith(USER_A, 10, '版本名')
    })

    it('service 返 403 无权创建时透传', async () => {
        mockCreateService.mockResolvedValue({ error: '无权访问此草稿', code: 403 })
        const res: any = await createHandler({
            context: { auth: { user: { id: USER_B } } },
            __params: { id: '10' },
            __body: { name: '新版本' },
        })
        expect(res.code).toBe(403)
        expect(res.success).toBe(false)
    })

    it('service 返 404 草稿不存在时透传', async () => {
        mockCreateService.mockResolvedValue({ error: '草稿不存在', code: 404 })
        const res: any = await createHandler({
            context: { auth: { user: { id: USER_A } } },
            __params: { id: '999' },
            __body: { name: '新版本' },
        })
        expect(res.code).toBe(404)
        expect(res.success).toBe(false)
    })
})

// ==================== PATCH /drafts/versions/[versionId] ====================

describe('PATCH /api/v1/assistant/document/drafts/versions/[versionId]', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('未登录返回 401', async () => {
        const res: any = await renameHandler({
            context: {},
            __params: { versionId: '1' },
            __body: { name: '重命名' },
        })
        expect(res.code).toBe(401)
    })

    it('versionId 非法字符串返回 400', async () => {
        const res: any = await renameHandler({
            context: { auth: { user: { id: USER_A } } },
            __params: { versionId: 'abc' },
            __body: { name: '重命名' },
        })
        expect(res.code).toBe(400)
    })

    it('versionId 为 0 返回 400', async () => {
        const res: any = await renameHandler({
            context: { auth: { user: { id: USER_A } } },
            __params: { versionId: '0' },
            __body: { name: '重命名' },
        })
        expect(res.code).toBe(400)
    })

    it('name 为空字符串返回 400', async () => {
        const res: any = await renameHandler({
            context: { auth: { user: { id: USER_A } } },
            __params: { versionId: '1' },
            __body: { name: '' },
        })
        expect(res.code).toBe(400)
    })

    it('name 超过 100 字符返回 400', async () => {
        const longName = 'x'.repeat(101)
        const res: any = await renameHandler({
            context: { auth: { user: { id: USER_A } } },
            __params: { versionId: '1' },
            __body: { name: longName },
        })
        expect(res.code).toBe(400)
    })

    it('owner 成功重命名版本', async () => {
        const version = {
            id: 1,
            draftId: 10,
            versionNo: 1,
            name: '新名字',
            titleAt: '标题',
            values: { a: '1' },
            createdAt: new Date(),
        }
        mockRenameService.mockResolvedValue({ version })
        const res: any = await renameHandler({
            context: { auth: { user: { id: USER_A } } },
            __params: { versionId: '1' },
            __body: { name: '新名字' },
        })
        expect(res.code).toBe(0)
        expect(res.success).toBe(true)
        expect(res.data.version).toEqual(version)
        expect(mockRenameService).toHaveBeenCalledWith(USER_A, 1, '新名字')
    })

    it('name 自动去除前后空白', async () => {
        const version = {
            id: 1,
            draftId: 10,
            versionNo: 1,
            name: '新名',
            titleAt: '标题',
            values: {},
            createdAt: new Date(),
        }
        mockRenameService.mockResolvedValue({ version })
        const res: any = await renameHandler({
            context: { auth: { user: { id: USER_A } } },
            __params: { versionId: '1' },
            __body: { name: '  新名  ' },
        })
        expect(res.code).toBe(0)
        expect(mockRenameService).toHaveBeenCalledWith(USER_A, 1, '新名')
    })

    it('service 返 403 无权重命名时透传', async () => {
        mockRenameService.mockResolvedValue({ error: '无权修改此版本', code: 403 })
        const res: any = await renameHandler({
            context: { auth: { user: { id: USER_B } } },
            __params: { versionId: '1' },
            __body: { name: '新名' },
        })
        expect(res.code).toBe(403)
        expect(res.success).toBe(false)
    })

    it('service 返 404 版本不存在时透传', async () => {
        mockRenameService.mockResolvedValue({ error: '版本不存在', code: 404 })
        const res: any = await renameHandler({
            context: { auth: { user: { id: USER_A } } },
            __params: { versionId: '999' },
            __body: { name: '新名' },
        })
        expect(res.code).toBe(404)
        expect(res.success).toBe(false)
    })
})

// ==================== DELETE /drafts/versions/[versionId] ====================

describe('DELETE /api/v1/assistant/document/drafts/versions/[versionId]', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('未登录返回 401', async () => {
        const res: any = await deleteHandler({
            context: {},
            __params: { versionId: '1' },
        })
        expect(res.code).toBe(401)
    })

    it('versionId 非法字符串返回 400', async () => {
        const res: any = await deleteHandler({
            context: { auth: { user: { id: USER_A } } },
            __params: { versionId: 'xyz' },
        })
        expect(res.code).toBe(400)
    })

    it('versionId 为 0 返回 400', async () => {
        const res: any = await deleteHandler({
            context: { auth: { user: { id: USER_A } } },
            __params: { versionId: '0' },
        })
        expect(res.code).toBe(400)
    })

    it('owner 成功删除版本', async () => {
        mockDeleteService.mockResolvedValue({ ok: true })
        const res: any = await deleteHandler({
            context: { auth: { user: { id: USER_A } } },
            __params: { versionId: '1' },
        })
        expect(res.code).toBe(0)
        expect(res.success).toBe(true)
        expect(res.data.ok).toBe(true)
        expect(mockDeleteService).toHaveBeenCalledWith(USER_A, 1)
    })

    it('service 返 403 无权删除时透传', async () => {
        mockDeleteService.mockResolvedValue({ error: '无权删除此版本', code: 403 })
        const res: any = await deleteHandler({
            context: { auth: { user: { id: USER_B } } },
            __params: { versionId: '1' },
        })
        expect(res.code).toBe(403)
        expect(res.success).toBe(false)
    })

    it('service 返 404 版本不存在时透传', async () => {
        mockDeleteService.mockResolvedValue({ error: '版本不存在', code: 404 })
        const res: any = await deleteHandler({
            context: { auth: { user: { id: USER_A } } },
            __params: { versionId: '999' },
        })
        expect(res.code).toBe(404)
        expect(res.success).toBe(false)
    })
})
