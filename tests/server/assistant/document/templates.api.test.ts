/**
 * 文书模板 CRUD API 端到端测试
 *
 * 策略：直接 import handler default export，传入 mock event（含 auth 上下文），
 * Service/DAO 层由外部 Mock 替换——OSS 上传在此层 mock，避免真实网络调用。
 * 只测 handler 层的鉴权、参数校验、权限隔离、4xx 边界，以及业务码透传。
 *
 * **Feature: document-generation**
 * **Validates: Task 2.3, spec §2.3**
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import '../../case/test-setup'
import {
    createTestUser,
    createEmptyTestIds,
    cleanupTestData,
    disconnectTestDb,
    getTestPrisma,
} from '../../case/test-db-helper'

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
;(globalThis as any).getQuery = (event: any) => event.__query ?? {}
;(globalThis as any).readBody = async (event: any) => event.__body
;(globalThis as any).getRouterParam = (event: any, key: string) => event.__params?.[key]
;(globalThis as any).readMultipartFormData = async (event: any) => event.__formData

// ==================== Mock service 层（避免真实 OSS 调用）====================

vi.mock('~~/server/services/assistant/document/documentTemplate.service', () => ({
    createDocumentTemplateService: vi.fn(),
    MAX_PRIVATE_TEMPLATES: 20,
}))

vi.mock('~~/server/services/assistant/document/documentTemplate.dao', () => ({
    listDocumentTemplatesDAO: vi.fn(),
    getDocumentTemplateDAO: vi.fn(),
    updateDocumentTemplateDAO: vi.fn(),
    softDeleteDocumentTemplateDAO: vi.fn(),
    countUserTemplatesDAO: vi.fn(),
    createDocumentTemplateDAO: vi.fn(),
}))

vi.mock('~~/server/services/rbac/permission.service', () => ({
    checkIsSuperAdmin: vi.fn().mockResolvedValue(false),
}))

vi.mock('~~/server/services/files/ossFiles.dao', () => ({
    findOssFileByIdDao: vi.fn(),
}))

vi.mock('~~/server/services/storage/storage.service', () => ({
    generateSignedUrlService: vi.fn(),
}))

import {
    createDocumentTemplateService,
} from '~~/server/services/assistant/document/documentTemplate.service'
import {
    listDocumentTemplatesDAO,
    getDocumentTemplateDAO,
    updateDocumentTemplateDAO,
    softDeleteDocumentTemplateDAO,
} from '~~/server/services/assistant/document/documentTemplate.dao'
import { checkIsSuperAdmin } from '~~/server/services/rbac/permission.service'
import { findOssFileByIdDao } from '~~/server/services/files/ossFiles.dao'
import { generateSignedUrlService } from '~~/server/services/storage/storage.service'

const mockCreateService = createDocumentTemplateService as ReturnType<typeof vi.fn>
const mockListDAO = listDocumentTemplatesDAO as ReturnType<typeof vi.fn>
const mockGetDAO = getDocumentTemplateDAO as ReturnType<typeof vi.fn>
const mockUpdateDAO = updateDocumentTemplateDAO as ReturnType<typeof vi.fn>
const mockSoftDeleteDAO = softDeleteDocumentTemplateDAO as ReturnType<typeof vi.fn>
const mockCheckIsAdmin = checkIsSuperAdmin as ReturnType<typeof vi.fn>
const mockFindOssFileDao = findOssFileByIdDao as ReturnType<typeof vi.fn>
const mockGenerateSignedUrl = generateSignedUrlService as ReturnType<typeof vi.fn>

// ==================== 动态 import handlers（必须在 mock 之后）====================

const { default: listHandler } = await import(
    '../../../../server/api/v1/assistant/document/templates.get'
)
const { default: createHandler } = await import(
    '../../../../server/api/v1/assistant/document/templates.post'
)
const { default: detailHandler } = await import(
    '../../../../server/api/v1/assistant/document/templates/[id].get'
)
const { default: patchHandler } = await import(
    '../../../../server/api/v1/assistant/document/templates/[id].patch'
)
const { default: deleteHandler } = await import(
    '../../../../server/api/v1/assistant/document/templates/[id].delete'
)
const { default: adminDeleteHandler } = await import(
    '../../../../server/api/v1/admin/document-templates/[id].delete'
)
const { default: adminCreateHandler } = await import(
    '../../../../server/api/v1/admin/document-templates/index.post'
)
const { default: adminPatchHandler } = await import(
    '../../../../server/api/v1/admin/document-templates/[id].patch'
)
const { default: adminListHandler } = await import(
    '../../../../server/api/v1/admin/document-templates/index.get'
)
const { default: adminDetailHandler } = await import(
    '../../../../server/api/v1/admin/document-templates/[id].get'
)
const { default: adminDownloadUrlHandler } = await import(
    '../../../../server/api/v1/admin/document-templates/download-url/[id].get'
)

// ==================== 类型 ====================

interface MockEvent {
    context: { auth?: { user: { id: number; roles?: Array<{ code: string }> } } }
    __query?: Record<string, any>
    __body?: any
    __params?: Record<string, string>
    __formData?: Array<{ name: string; data: Buffer; filename?: string; type?: string }>
    method?: string
}

function makeEvent(opts: {
    userId?: number
    isAdmin?: boolean
    query?: Record<string, any>
    body?: any
    params?: Record<string, string>
    formData?: Array<{ name: string; data: Buffer; filename?: string; type?: string }>
}): MockEvent {
    const roles = opts.isAdmin ? [{ code: 'super_admin' }] : []
    return {
        context: opts.userId
            ? { auth: { user: { id: opts.userId, roles } } }
            : {},
        __query: opts.query,
        __body: opts.body,
        __params: opts.params,
        __formData: opts.formData,
    }
}

/** 构造 multipart 文件上传 formData */
function makeDocxFormData(opts: {
    name?: string
    category?: string
    description?: string
    fileSize?: number
    fileName?: string
    mimeType?: string
}) {
    const {
        name = '测试模板',
        category = 'litigation',
        description,
        fileSize = 1024,
        fileName = 'template.docx',
        mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    } = opts
    const items: Array<{ name: string; data: Buffer; filename?: string; type?: string }> = [
        { name: 'file', data: Buffer.alloc(fileSize, 0), filename: fileName, type: mimeType },
        { name: 'name', data: Buffer.from(name) },
        { name: 'category', data: Buffer.from(category) },
    ]
    if (description !== undefined) {
        items.push({ name: 'description', data: Buffer.from(description) })
    }
    return items
}

// ==================== 测试套件 ====================

describe('文书模板 CRUD API', () => {
    let userIds: number[] = []

    beforeEach(() => {
        vi.resetAllMocks()
        // 默认 mock 返回值
        mockListDAO.mockResolvedValue({ list: [], total: 0 })
        mockGetDAO.mockResolvedValue(null)
        mockUpdateDAO.mockResolvedValue({ id: 1, name: '更新后', category: 'litigation', scope: 'user' })
        mockSoftDeleteDAO.mockResolvedValue(undefined)
        mockCreateService.mockResolvedValue({ templateId: 100 })
        mockCheckIsAdmin.mockResolvedValue(false)
    })

    afterEach(async () => {
        if (userIds.length > 0) {
            const ids = createEmptyTestIds()
            ids.userIds = [...userIds]
            await cleanupTestData(ids)
            userIds = []
        }
    })

    afterAll(async () => {
        await disconnectTestDb()
    })

    // ==================== GET /templates 列表 ====================

    describe('GET /api/v1/assistant/document/templates', () => {
        it('未登录返回 401', async () => {
            const res: any = await listHandler(makeEvent({}) as any)
            expect(res.code).toBe(401)
            expect(res.message).toContain('登录')
        })

        it('登录用户可获取模板列表', async () => {
            const user = await createTestUser()
            userIds.push(user.id)

            const mockTemplates = [{ id: 1, name: '模板A', scope: 'global', category: 'litigation' }]
            mockListDAO.mockResolvedValue({ list: mockTemplates, total: 1 })

            const res: any = await listHandler(makeEvent({ userId: user.id, query: {} }) as any)
            expect(res.success).toBe(true)
            expect(res.data.total).toBe(1)
            expect(res.data.list).toHaveLength(1)
            expect(res.data.skip).toBe(0)
            expect(res.data.take).toBe(20)
        })

        it('支持 ?scope=global 过滤', async () => {
            const user = await createTestUser()
            userIds.push(user.id)

            await listHandler(makeEvent({ userId: user.id, query: { scope: 'global' } }) as any)
            expect(mockListDAO).toHaveBeenCalledWith(
                expect.objectContaining({ scope: 'global', viewerUserId: user.id }),
            )
        })

        it('支持 ?scope=user 过滤', async () => {
            const user = await createTestUser()
            userIds.push(user.id)

            await listHandler(makeEvent({ userId: user.id, query: { scope: 'user' } }) as any)
            expect(mockListDAO).toHaveBeenCalledWith(
                expect.objectContaining({ scope: 'user', viewerUserId: user.id }),
            )
        })

        it('任何查询都透传 viewerUserId（避免越权暴露他人私人模板）', async () => {
            const user = await createTestUser()
            userIds.push(user.id)

            await listHandler(makeEvent({ userId: user.id, query: {} }) as any)
            expect(mockListDAO).toHaveBeenCalledWith(
                expect.objectContaining({ viewerUserId: user.id }),
            )
        })

        it('支持 ?category=litigation 过滤', async () => {
            const user = await createTestUser()
            userIds.push(user.id)

            await listHandler(makeEvent({ userId: user.id, query: { category: 'litigation' } }) as any)
            expect(mockListDAO).toHaveBeenCalledWith(
                expect.objectContaining({ category: 'litigation' }),
            )
        })

        it('支持 ?q=搜索词 过滤', async () => {
            const user = await createTestUser()
            userIds.push(user.id)

            await listHandler(makeEvent({ userId: user.id, query: { q: '合同' } }) as any)
            expect(mockListDAO).toHaveBeenCalledWith(
                expect.objectContaining({ q: '合同' }),
            )
        })

        it('支持 ?skip=N&take=N 分页', async () => {
            const user = await createTestUser()
            userIds.push(user.id)

            await listHandler(
                makeEvent({ userId: user.id, query: { skip: '10', take: '5' } }) as any,
            )
            expect(mockListDAO).toHaveBeenCalledWith(
                expect.objectContaining({ skip: 10, take: 5 }),
            )
        })

        it('scope 传非法值返回 400', async () => {
            const user = await createTestUser()
            userIds.push(user.id)

            const res: any = await listHandler(
                makeEvent({ userId: user.id, query: { scope: 'invalid' } }) as any,
            )
            expect(res.code).toBe(400)
        })

        it('take > 100 返回 400', async () => {
            const user = await createTestUser()
            userIds.push(user.id)

            const res: any = await listHandler(
                makeEvent({ userId: user.id, query: { take: '200' } }) as any,
            )
            expect(res.code).toBe(400)
        })
    })

    // ==================== POST /templates 上传 ====================

    describe('POST /api/v1/assistant/document/templates', () => {
        it('未登录返回 401', async () => {
            const res: any = await createHandler(makeEvent({}) as any)
            expect(res.code).toBe(401)
        })

        it('缺少 file 字段返回 400', async () => {
            const user = await createTestUser()
            userIds.push(user.id)

            const res: any = await createHandler(
                makeEvent({
                    userId: user.id,
                    formData: [{ name: 'name', data: Buffer.from('模板') }],
                }) as any,
            )
            expect(res.code).toBe(400)
            expect(res.message).toContain('文件')
        })

        it('缺少 name 字段返回 400', async () => {
            const user = await createTestUser()
            userIds.push(user.id)

            const formData = makeDocxFormData({ name: '' })
            // 移除 name 项
            const noName = formData.filter(f => f.name !== 'name')

            const res: any = await createHandler(
                makeEvent({ userId: user.id, formData: noName }) as any,
            )
            expect(res.code).toBe(400)
            expect(res.message).toContain('name')
        })

        it('缺少 category 字段返回 400', async () => {
            const user = await createTestUser()
            userIds.push(user.id)

            const formData = makeDocxFormData({}).filter(f => f.name !== 'category')

            const res: any = await createHandler(
                makeEvent({ userId: user.id, formData }) as any,
            )
            expect(res.code).toBe(400)
        })

        it('普通用户上传成功，service 返回 templateId', async () => {
            const user = await createTestUser()
            userIds.push(user.id)

            mockCreateService.mockResolvedValue({ templateId: 101 })

            const res: any = await createHandler(
                makeEvent({
                    userId: user.id,
                    formData: makeDocxFormData({}),
                }) as any,
            )
            expect(res.success).toBe(true)
            expect(res.data.templateId).toBe(101)
        })

        it('普通用户上传时 isAdmin=false 传给 service', async () => {
            const user = await createTestUser()
            userIds.push(user.id)

            await createHandler(
                makeEvent({
                    userId: user.id,
                    formData: makeDocxFormData({}),
                }) as any,
            )
            expect(mockCreateService).toHaveBeenCalledWith(
                expect.objectContaining({ isAdmin: false }),
            )
        })

        it('用户端接口：super_admin 上传也强制 isAdmin=false（改走 admin 接口才能建全局模板）', async () => {
            const user = await createTestUser()
            userIds.push(user.id)

            mockCheckIsAdmin.mockResolvedValue(true)

            await createHandler(
                makeEvent({
                    userId: user.id,
                    isAdmin: true,
                    formData: makeDocxFormData({}),
                }) as any,
            )
            expect(mockCreateService).toHaveBeenCalledWith(
                expect.objectContaining({ isAdmin: false }),
            )
        })

        it('service 返回 code=413 时，handler 响应 413', async () => {
            const user = await createTestUser()
            userIds.push(user.id)

            mockCreateService.mockResolvedValue({ error: '文件不能超过 20MB', code: 413 })

            const res: any = await createHandler(
                makeEvent({
                    userId: user.id,
                    formData: makeDocxFormData({ fileSize: 20 * 1024 * 1024 + 1 }),
                }) as any,
            )
            expect(res.code).toBe(413)
        })

        it('service 返回 code=400（非 .docx）时，handler 响应 400', async () => {
            const user = await createTestUser()
            userIds.push(user.id)

            mockCreateService.mockResolvedValue({ error: '仅支持 .docx 格式', code: 400 })

            const res: any = await createHandler(
                makeEvent({
                    userId: user.id,
                    formData: makeDocxFormData({ fileName: 'bad.pdf' }),
                }) as any,
            )
            expect(res.code).toBe(400)
        })

        it('配额达上限：service 返回 code=403 时，handler 响应 403', async () => {
            const user = await createTestUser()
            userIds.push(user.id)

            mockCreateService.mockResolvedValue({ error: '私人模板已达上限 20 个', code: 403 })

            const res: any = await createHandler(
                makeEvent({
                    userId: user.id,
                    formData: makeDocxFormData({}),
                }) as any,
            )
            expect(res.code).toBe(403)
            expect(res.message).toContain('上限')
        })

        it('service 返回 code=400（扫描失败）时，handler 响应 400', async () => {
            const user = await createTestUser()
            userIds.push(user.id)

            mockCreateService.mockResolvedValue({ error: '未扫描到占位符，请检查模板', code: 400 })

            const res: any = await createHandler(
                makeEvent({
                    userId: user.id,
                    formData: makeDocxFormData({}),
                }) as any,
            )
            expect(res.code).toBe(400)
        })
    })

    // ==================== GET /templates/:id ====================

    describe('GET /api/v1/assistant/document/templates/:id', () => {
        it('未登录返回 401', async () => {
            const res: any = await detailHandler(makeEvent({ params: { id: '1' } }) as any)
            expect(res.code).toBe(401)
        })

        it('id 非数字返回 400', async () => {
            const user = await createTestUser()
            userIds.push(user.id)

            const res: any = await detailHandler(
                makeEvent({ userId: user.id, params: { id: 'abc' } }) as any,
            )
            expect(res.code).toBe(400)
        })

        it('模板不存在返回 404', async () => {
            const user = await createTestUser()
            userIds.push(user.id)

            mockGetDAO.mockResolvedValue(null)

            const res: any = await detailHandler(
                makeEvent({ userId: user.id, params: { id: '999' } }) as any,
            )
            expect(res.code).toBe(404)
        })

        it('访问 global 模板成功', async () => {
            const user = await createTestUser()
            userIds.push(user.id)

            mockGetDAO.mockResolvedValue({ id: 1, name: '全局模板', scope: 'global', userId: null })

            const res: any = await detailHandler(
                makeEvent({ userId: user.id, params: { id: '1' } }) as any,
            )
            expect(res.success).toBe(true)
            expect(res.data.id).toBe(1)
        })

        it('访问自己的 user 模板成功', async () => {
            const user = await createTestUser()
            userIds.push(user.id)

            mockGetDAO.mockResolvedValue({ id: 2, name: '我的模板', scope: 'user', userId: user.id })

            const res: any = await detailHandler(
                makeEvent({ userId: user.id, params: { id: '2' } }) as any,
            )
            expect(res.success).toBe(true)
            expect(res.data.id).toBe(2)
        })

        it('访问他人的 user 模板返回 404', async () => {
            const userA = await createTestUser()
            const userB = await createTestUser()
            userIds.push(userA.id, userB.id)

            mockGetDAO.mockResolvedValue({ id: 3, name: '他人模板', scope: 'user', userId: userA.id })

            const res: any = await detailHandler(
                makeEvent({ userId: userB.id, params: { id: '3' } }) as any,
            )
            expect(res.code).toBe(404)
        })
    })

    // ==================== PATCH /templates/:id ====================

    describe('PATCH /api/v1/assistant/document/templates/:id', () => {
        it('未登录返回 401', async () => {
            const res: any = await patchHandler(makeEvent({ params: { id: '1' } }) as any)
            expect(res.code).toBe(401)
        })

        it('id 非数字返回 400', async () => {
            const user = await createTestUser()
            userIds.push(user.id)

            const res: any = await patchHandler(
                makeEvent({ userId: user.id, params: { id: 'abc' }, body: { name: '新名' } }) as any,
            )
            expect(res.code).toBe(400)
        })

        it('模板不存在返回 404', async () => {
            const user = await createTestUser()
            userIds.push(user.id)

            mockGetDAO.mockResolvedValue(null)

            const res: any = await patchHandler(
                makeEvent({ userId: user.id, params: { id: '999' }, body: { name: '新名' } }) as any,
            )
            expect(res.code).toBe(404)
        })

        it('修改自己的模板成功', async () => {
            const user = await createTestUser()
            userIds.push(user.id)

            mockGetDAO.mockResolvedValue({ id: 1, name: '原始', scope: 'user', userId: user.id })
            mockUpdateDAO.mockResolvedValue({ id: 1, name: '新名', scope: 'user', userId: user.id })

            const res: any = await patchHandler(
                makeEvent({ userId: user.id, params: { id: '1' }, body: { name: '新名' } }) as any,
            )
            expect(res.success).toBe(true)
            expect(mockUpdateDAO).toHaveBeenCalledWith(1, expect.objectContaining({ name: '新名' }))
        })

        it('修改他人模板返回 403', async () => {
            const userA = await createTestUser()
            const userB = await createTestUser()
            userIds.push(userA.id, userB.id)

            mockGetDAO.mockResolvedValue({ id: 1, name: '他人模板', scope: 'user', userId: userA.id })

            const res: any = await patchHandler(
                makeEvent({ userId: userB.id, params: { id: '1' }, body: { name: '篡改' } }) as any,
            )
            expect(res.code).toBe(403)
            expect(mockUpdateDAO).not.toHaveBeenCalled()
        })

        it('admin（super_admin）经用户端接口修改他人模板也返回 403', async () => {
            const admin = await createTestUser()
            const owner = await createTestUser()
            userIds.push(admin.id, owner.id)

            mockGetDAO.mockResolvedValue({ id: 1, name: '用户模板', scope: 'user', userId: owner.id })
            mockCheckIsAdmin.mockResolvedValue(true)

            const res: any = await patchHandler(
                makeEvent({
                    userId: admin.id,
                    isAdmin: true,
                    params: { id: '1' },
                    body: { name: 'Admin修改' },
                }) as any,
            )
            expect(res.code).toBe(403)
            expect(mockUpdateDAO).not.toHaveBeenCalled()
        })

        it('用户端接口拒绝修改 global 模板（即使是 super_admin）', async () => {
            const admin = await createTestUser()
            userIds.push(admin.id)

            mockGetDAO.mockResolvedValue({ id: 2, name: '全局模板', scope: 'global', userId: null })
            mockCheckIsAdmin.mockResolvedValue(true)

            const res: any = await patchHandler(
                makeEvent({
                    userId: admin.id,
                    isAdmin: true,
                    params: { id: '2' },
                    body: { name: '篡改' },
                }) as any,
            )
            expect(res.code).toBe(403)
            expect(mockUpdateDAO).not.toHaveBeenCalled()
        })

        it('传入未知字段被忽略（不报错）', async () => {
            const user = await createTestUser()
            userIds.push(user.id)

            mockGetDAO.mockResolvedValue({ id: 1, name: '模板', scope: 'user', userId: user.id })

            const res: any = await patchHandler(
                makeEvent({
                    userId: user.id,
                    params: { id: '1' },
                    body: { name: '合法字段', hackerField: 'injected' },
                }) as any,
            )
            expect(res.success).toBe(true)
        })

        it('body 为空时 updateDAO 不被调用或只传空 patch', async () => {
            const user = await createTestUser()
            userIds.push(user.id)

            mockGetDAO.mockResolvedValue({ id: 1, name: '模板', scope: 'user', userId: user.id })

            const res: any = await patchHandler(
                makeEvent({ userId: user.id, params: { id: '1' }, body: {} }) as any,
            )
            // 空 body 不报错，幂等更新
            expect(res.success).toBe(true)
        })
    })

    // ==================== DELETE /templates/:id ====================

    describe('DELETE /api/v1/assistant/document/templates/:id', () => {
        it('未登录返回 401', async () => {
            const res: any = await deleteHandler(makeEvent({ params: { id: '1' } }) as any)
            expect(res.code).toBe(401)
        })

        it('id 非数字返回 400', async () => {
            const user = await createTestUser()
            userIds.push(user.id)

            const res: any = await deleteHandler(
                makeEvent({ userId: user.id, params: { id: 'abc' } }) as any,
            )
            expect(res.code).toBe(400)
        })

        it('模板不存在返回 404', async () => {
            const user = await createTestUser()
            userIds.push(user.id)

            mockGetDAO.mockResolvedValue(null)

            const res: any = await deleteHandler(
                makeEvent({ userId: user.id, params: { id: '999' } }) as any,
            )
            expect(res.code).toBe(404)
        })

        it('软删自己的模板成功', async () => {
            const user = await createTestUser()
            userIds.push(user.id)

            mockGetDAO.mockResolvedValue({ id: 1, name: '我的模板', scope: 'user', userId: user.id })

            const res: any = await deleteHandler(
                makeEvent({ userId: user.id, params: { id: '1' } }) as any,
            )
            expect(res.success).toBe(true)
            expect(mockSoftDeleteDAO).toHaveBeenCalledWith(1)
        })

        it('软删他人模板返回 403', async () => {
            const userA = await createTestUser()
            const userB = await createTestUser()
            userIds.push(userA.id, userB.id)

            mockGetDAO.mockResolvedValue({ id: 1, name: '他人模板', scope: 'user', userId: userA.id })

            const res: any = await deleteHandler(
                makeEvent({ userId: userB.id, params: { id: '1' } }) as any,
            )
            expect(res.code).toBe(403)
            expect(mockSoftDeleteDAO).not.toHaveBeenCalled()
        })

        it('admin（super_admin）经用户端接口删除他人模板也返回 403', async () => {
            const admin = await createTestUser()
            const owner = await createTestUser()
            userIds.push(admin.id, owner.id)

            mockGetDAO.mockResolvedValue({ id: 1, name: '用户模板', scope: 'user', userId: owner.id })
            mockCheckIsAdmin.mockResolvedValue(true)

            const res: any = await deleteHandler(
                makeEvent({
                    userId: admin.id,
                    isAdmin: true,
                    params: { id: '1' },
                }) as any,
            )
            expect(res.code).toBe(403)
            expect(mockSoftDeleteDAO).not.toHaveBeenCalled()
        })

        it('用户端接口拒绝删除 global 模板（即使是 super_admin）', async () => {
            const admin = await createTestUser()
            userIds.push(admin.id)

            mockGetDAO.mockResolvedValue({ id: 2, name: '全局模板', scope: 'global', userId: null })
            mockCheckIsAdmin.mockResolvedValue(true)

            const res: any = await deleteHandler(
                makeEvent({
                    userId: admin.id,
                    isAdmin: true,
                    params: { id: '2' },
                }) as any,
            )
            expect(res.code).toBe(403)
            expect(mockSoftDeleteDAO).not.toHaveBeenCalled()
        })
    })

    // ==================== DELETE /admin/document-templates/:id ====================

    describe('DELETE /api/v1/admin/document-templates/:id', () => {
        it('未登录返回 401', async () => {
            const res: any = await adminDeleteHandler(makeEvent({ params: { id: '1' } }) as any)
            expect(res.code).toBe(401)
        })

        it('id 非数字返回 400', async () => {
            const admin = await createTestUser()
            userIds.push(admin.id)
            const res: any = await adminDeleteHandler(
                makeEvent({ userId: admin.id, params: { id: 'abc' } }) as any,
            )
            expect(res.code).toBe(400)
        })

        it('模板不存在返回 404', async () => {
            const admin = await createTestUser()
            userIds.push(admin.id)
            mockGetDAO.mockResolvedValue(null)
            const res: any = await adminDeleteHandler(
                makeEvent({ userId: admin.id, params: { id: '999' } }) as any,
            )
            expect(res.code).toBe(404)
        })

        it('拒绝删除 user 模板（仅管理系统模板）', async () => {
            const admin = await createTestUser()
            const owner = await createTestUser()
            userIds.push(admin.id, owner.id)
            mockGetDAO.mockResolvedValue({ id: 3, name: '他人模板', scope: 'user', userId: owner.id })

            const res: any = await adminDeleteHandler(
                makeEvent({ userId: admin.id, params: { id: '3' } }) as any,
            )
            expect(res.code).toBe(403)
            expect(mockSoftDeleteDAO).not.toHaveBeenCalled()
        })

        it('可删除 global 模板', async () => {
            const admin = await createTestUser()
            userIds.push(admin.id)
            mockGetDAO.mockResolvedValue({ id: 4, name: '全局模板', scope: 'global', userId: null })

            const res: any = await adminDeleteHandler(
                makeEvent({ userId: admin.id, params: { id: '4' } }) as any,
            )
            expect(res.success).toBe(true)
            expect(mockSoftDeleteDAO).toHaveBeenCalledWith(4)
        })
    })

    // ==================== POST /admin/document-templates ====================

    describe('POST /api/v1/admin/document-templates', () => {
        it('未登录返回 401', async () => {
            const res: any = await adminCreateHandler(
                makeEvent({ formData: makeDocxFormData({}) }) as any,
            )
            expect(res.code).toBe(401)
        })

        it('强制 isAdmin=true 传给 service（创建全局模板）', async () => {
            const admin = await createTestUser()
            userIds.push(admin.id)

            await adminCreateHandler(
                makeEvent({
                    userId: admin.id,
                    formData: makeDocxFormData({}),
                }) as any,
            )
            expect(mockCreateService).toHaveBeenCalledWith(
                expect.objectContaining({ isAdmin: true }),
            )
        })
    })

    // ==================== PATCH /admin/document-templates/:id ====================

    describe('PATCH /api/v1/admin/document-templates/:id', () => {
        it('未登录返回 401', async () => {
            const res: any = await adminPatchHandler(
                makeEvent({ params: { id: '1' }, body: { name: 'x' } }) as any,
            )
            expect(res.code).toBe(401)
        })

        it('模板不存在返回 404', async () => {
            const admin = await createTestUser()
            userIds.push(admin.id)
            mockGetDAO.mockResolvedValue(null)

            const res: any = await adminPatchHandler(
                makeEvent({ userId: admin.id, params: { id: '999' }, body: { name: 'x' } }) as any,
            )
            expect(res.code).toBe(404)
        })

        it('拒绝修改 user 模板（仅管理系统模板）', async () => {
            const admin = await createTestUser()
            const owner = await createTestUser()
            userIds.push(admin.id, owner.id)

            mockGetDAO.mockResolvedValue({ id: 5, name: '他人模板', scope: 'user', userId: owner.id })

            const res: any = await adminPatchHandler(
                makeEvent({
                    userId: admin.id,
                    params: { id: '5' },
                    body: { name: 'Admin改名' },
                }) as any,
            )
            expect(res.code).toBe(403)
            expect(mockUpdateDAO).not.toHaveBeenCalled()
        })

        it('可修改 global 模板', async () => {
            const admin = await createTestUser()
            userIds.push(admin.id)

            mockGetDAO.mockResolvedValue({ id: 6, name: '全局', scope: 'global', userId: null })

            const res: any = await adminPatchHandler(
                makeEvent({
                    userId: admin.id,
                    params: { id: '6' },
                    body: { status: 0 },
                }) as any,
            )
            expect(res.success).toBe(true)
            expect(mockUpdateDAO).toHaveBeenCalledWith(6, expect.objectContaining({ status: 0 }))
        })
    })

    // ==================== GET /admin/document-templates ====================

    describe('GET /api/v1/admin/document-templates', () => {
        it('未登录返回 401', async () => {
            const res: any = await adminListHandler(makeEvent({}) as any)
            expect(res.code).toBe(401)
        })

        it('不传 viewerUserId 且强制 scope=global（只看系统模板）', async () => {
            const admin = await createTestUser()
            userIds.push(admin.id)
            mockListDAO.mockResolvedValue({ list: [], total: 0 })

            await adminListHandler(
                makeEvent({ userId: admin.id, query: { skip: '0', take: '20' } }) as any,
            )
            const arg = mockListDAO.mock.calls.at(-1)?.[0]
            expect(arg).toBeDefined()
            expect(arg).not.toHaveProperty('viewerUserId')
            expect(arg.scope).toBe('global')
        })

        it('透传 category/q/skip/take 给 DAO，scope 被强制为 global', async () => {
            const admin = await createTestUser()
            userIds.push(admin.id)
            mockListDAO.mockResolvedValue({ list: [], total: 0 })

            await adminListHandler(
                makeEvent({
                    userId: admin.id,
                    query: { scope: 'user', category: '起诉状', q: '张三', skip: '10', take: '5' },
                }) as any,
            )
            expect(mockListDAO).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    scope: 'global',
                    category: '起诉状',
                    q: '张三',
                    skip: 10,
                    take: 5,
                }),
            )
        })
    })

    // ==================== GET /admin/document-templates/:id ====================

    describe('GET /api/v1/admin/document-templates/:id', () => {
        it('未登录返回 401', async () => {
            const res: any = await adminDetailHandler(makeEvent({ params: { id: '1' } }) as any)
            expect(res.code).toBe(401)
        })

        it('模板不存在返回 404', async () => {
            const admin = await createTestUser()
            userIds.push(admin.id)
            mockGetDAO.mockResolvedValue(null)

            const res: any = await adminDetailHandler(
                makeEvent({ userId: admin.id, params: { id: '1' } }) as any,
            )
            expect(res.code).toBe(404)
        })

        it('拒绝查看他人的 user 模板（仅管理系统模板）', async () => {
            const admin = await createTestUser()
            const owner = await createTestUser()
            userIds.push(admin.id, owner.id)
            mockGetDAO.mockResolvedValue({ id: 7, name: '他人模板', scope: 'user', userId: owner.id })

            const res: any = await adminDetailHandler(
                makeEvent({ userId: admin.id, params: { id: '7' } }) as any,
            )
            expect(res.code).toBe(403)
        })

        it('可查看 global 模板', async () => {
            const admin = await createTestUser()
            userIds.push(admin.id)
            mockGetDAO.mockResolvedValue({ id: 10, name: '系统模板', scope: 'global', userId: null })

            const res: any = await adminDetailHandler(
                makeEvent({ userId: admin.id, params: { id: '10' } }) as any,
            )
            expect(res.success).toBe(true)
            expect(res.data.id).toBe(10)
        })
    })

    // ==================== GET /admin/document-templates/download-url/:id ====================

    describe('GET /api/v1/admin/document-templates/download-url/:id', () => {
        it('未登录返回 401', async () => {
            const res: any = await adminDownloadUrlHandler(
                makeEvent({ params: { id: '1' } }) as any,
            )
            expect(res.code).toBe(401)
        })

        it('拒绝为 user 模板生成下载链接（仅管理系统模板）', async () => {
            const admin = await createTestUser()
            const owner = await createTestUser()
            userIds.push(admin.id, owner.id)

            mockGetDAO.mockResolvedValue({
                id: 8,
                name: '他人模板',
                scope: 'user',
                userId: owner.id,
                ossFileId: 100,
            })

            const res: any = await adminDownloadUrlHandler(
                makeEvent({ userId: admin.id, params: { id: '8' } }) as any,
            )
            expect(res.code).toBe(403)
            expect(mockGenerateSignedUrl).not.toHaveBeenCalled()
        })

        it('可为 global 模板生成下载链接', async () => {
            const admin = await createTestUser()
            userIds.push(admin.id)

            mockGetDAO.mockResolvedValue({
                id: 11,
                name: '系统模板',
                scope: 'global',
                userId: null,
                ossFileId: 101,
            })
            mockFindOssFileDao.mockResolvedValue({ id: 101, filePath: '/g/f.docx' })
            mockGenerateSignedUrl.mockResolvedValue('https://signed.example/global')

            const res: any = await adminDownloadUrlHandler(
                makeEvent({ userId: admin.id, params: { id: '11' } }) as any,
            )
            expect(res.success).toBe(true)
            expect(res.data.downloadUrl).toBe('https://signed.example/global')
        })
    })
})
