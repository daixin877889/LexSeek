/**
 * Session API Handler 集成测试（mock 版）
 *
 * 测试瘦化后的 4 个 Session API + 新增 2 个 API 的行为正确性。
 *
 * **Feature: session-api-refactor**
 * **Validates: PR #1 改造后的 6 个 Session API 端点**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============================================================
// Mock：DAO 层
// ============================================================
vi.mock('~~/server/services/case/session.dao', () => ({
    listSessionsWithActiveRunDAO: vi.fn(),
    createSessionDAO: vi.fn(),
    softDeleteSessionDAO: vi.fn(),
    renameSessionDAO: vi.fn(),
}))

// ============================================================
// Mock：getNodeByNameService（Nuxt 自动导入的 services）
// ============================================================
vi.mock('~~/server/services/node/node.service', () => ({
    getNodeByNameService: vi.fn(),
}))

// ============================================================
// Mock：Nuxt 自动导入的全局函数
// defineEventHandler 直接执行回调，方便测试
// ============================================================
vi.stubGlobal('defineEventHandler', (handler: Function) => handler)
vi.stubGlobal('getQuery', vi.fn())
vi.stubGlobal('readBody', vi.fn())
vi.stubGlobal('getRouterParam', vi.fn())
vi.stubGlobal('resSuccess', vi.fn((event: any, message: string, data: any) => ({ success: true, message, data })))
vi.stubGlobal('resError', vi.fn((event: any, code: number, message: string) => ({ success: false, code, message })))

// ============================================================
// 动态引入 handler（必须在 mock 后执行）
// ============================================================
import { listSessionsWithActiveRunDAO, createSessionDAO, softDeleteSessionDAO, renameSessionDAO } from '../../../server/services/case/session.dao'
import { getNodeByNameService } from '../../../server/services/node/node.service'

// 帮助类型
type MockFn = ReturnType<typeof vi.fn>

// 辅助：构造 event
function makeEvent(auth?: { user: { id: number } }) {
    return { context: { auth } } as any
}

// ============================================================
// 1. GET xiaosuo-sessions
// ============================================================
describe('GET /api/v1/case/analysis/xiaosuo-sessions', () => {
    let handler: Function

    beforeEach(async () => {
        vi.resetAllMocks()
        vi.stubGlobal('resSuccess', vi.fn((event: any, message: string, data: any) => ({ success: true, message, data })))
        vi.stubGlobal('resError', vi.fn((event: any, code: number, message: string) => ({ success: false, code, message })))
        handler = (await import('../../../server/api/v1/case/analysis/xiaosuo-sessions.get')).default
    })

    it('未登录时应返回 401', async () => {
        const event = makeEvent(undefined)
        ;(global.getQuery as MockFn).mockReturnValue({})

        const result = await handler(event)

        expect(result.success).toBe(false)
        expect(result.code).toBe(401)
    })

    it('缺少 caseId 时应返回 400', async () => {
        const event = makeEvent({ user: { id: 1 } })
        ;(global.getQuery as MockFn).mockReturnValue({ caseId: undefined })

        const result = await handler(event)

        expect(result.success).toBe(false)
        expect(result.code).toBe(400)
    })

    it('案件不存在（DAO 返回 null）时应返回 404', async () => {
        const event = makeEvent({ user: { id: 1 } })
        ;(global.getQuery as MockFn).mockReturnValue({ caseId: '100' })
        ;(listSessionsWithActiveRunDAO as MockFn).mockResolvedValue(null)

        const result = await handler(event)

        expect(result.success).toBe(false)
        expect(result.code).toBe(404)
    })

    it('正常情况下应返回格式化的 session 列表，type=1', async () => {
        const event = makeEvent({ user: { id: 1 } })
        ;(global.getQuery as MockFn).mockReturnValue({ caseId: '100' })

        const now = new Date()
        ;(listSessionsWithActiveRunDAO as MockFn).mockResolvedValue([
            {
                sessionId: 'sid-001',
                type: 1,
                metadata: { source: 'xiaosuo', title: '对话1' },
                hasActiveRun: true,
                createdAt: now,
                updatedAt: now,
            },
        ])

        const result = await handler(event)

        expect(result.success).toBe(true)
        expect(result.data).toHaveLength(1)
        expect(result.data[0].sessionId).toBe('sid-001')
        expect(result.data[0].title).toBe('对话1')
        expect(result.data[0].hasActiveRun).toBe(true)

        // 验证 DAO 调用时 type=1 且 metadataFilter 正确
        expect(listSessionsWithActiveRunDAO).toHaveBeenCalledWith(
            expect.objectContaining({
                caseId: 100,
                userId: 1,
                type: 1,
                metadataFilter: { path: ['source'], equals: 'xiaosuo' },
            }),
        )
    })

    it('metadata.title 缺失时应回退为"新对话"', async () => {
        const event = makeEvent({ user: { id: 1 } })
        ;(global.getQuery as MockFn).mockReturnValue({ caseId: '100' })
        const now = new Date()
        ;(listSessionsWithActiveRunDAO as MockFn).mockResolvedValue([
            {
                sessionId: 'sid-002',
                type: 1,
                metadata: { source: 'xiaosuo' }, // 无 title
                hasActiveRun: false,
                createdAt: now,
                updatedAt: now,
            },
        ])

        const result = await handler(event)

        expect(result.data[0].title).toBe('新对话')
    })
})

// ============================================================
// 2. GET module-sessions
// ============================================================
describe('GET /api/v1/case/analysis/module-sessions', () => {
    let handler: Function

    beforeEach(async () => {
        vi.resetAllMocks()
        vi.stubGlobal('resSuccess', vi.fn((event: any, message: string, data: any) => ({ success: true, message, data })))
        vi.stubGlobal('resError', vi.fn((event: any, code: number, message: string) => ({ success: false, code, message })))
        handler = (await import('../../../server/api/v1/case/analysis/module-sessions.get')).default
    })

    it('未登录时应返回 401', async () => {
        const event = makeEvent(undefined)
        ;(global.getQuery as MockFn).mockReturnValue({})

        const result = await handler(event)

        expect(result.success).toBe(false)
        expect(result.code).toBe(401)
    })

    it('缺少 caseId 时应返回 400', async () => {
        const event = makeEvent({ user: { id: 1 } })
        ;(global.getQuery as MockFn).mockReturnValue({})

        const result = await handler(event)

        expect(result.success).toBe(false)
        expect(result.code).toBe(400)
    })

    it('正常情况下应返回含 moduleName/nodeId/title 的格式，type=3', async () => {
        const event = makeEvent({ user: { id: 1 } })
        ;(global.getQuery as MockFn).mockReturnValue({ caseId: '200' })
        const now = new Date()
        ;(listSessionsWithActiveRunDAO as MockFn).mockResolvedValue([
            {
                sessionId: 'sid-003',
                type: 3,
                metadata: { moduleName: 'summary', nodeId: 'node-1', title: '生成案件概要-2405011200' },
                hasActiveRun: false,
                createdAt: now,
                updatedAt: now,
            },
        ])

        const result = await handler(event)

        expect(result.success).toBe(true)
        expect(result.data[0].sessionId).toBe('sid-003')
        expect(result.data[0].moduleName).toBe('summary')
        expect(result.data[0].nodeId).toBe('node-1')
        expect(result.data[0].title).toBe('生成案件概要-2405011200')

        // 验证 DAO 调用时 type=3
        expect(listSessionsWithActiveRunDAO).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 3,
                metadataFilter: undefined,
            }),
        )
    })

    it('传入 moduleName 过滤参数时应应用 metadataFilter', async () => {
        const event = makeEvent({ user: { id: 1 } })
        ;(global.getQuery as MockFn).mockReturnValue({ caseId: '200', moduleName: 'summary' })
        ;(listSessionsWithActiveRunDAO as MockFn).mockResolvedValue([])

        await handler(event)

        expect(listSessionsWithActiveRunDAO).toHaveBeenCalledWith(
            expect.objectContaining({
                metadataFilter: { path: ['moduleName'], equals: 'summary' },
            }),
        )
    })

    it('title 缺失时应回退为 moduleName', async () => {
        const event = makeEvent({ user: { id: 1 } })
        ;(global.getQuery as MockFn).mockReturnValue({ caseId: '200' })
        const now = new Date()
        ;(listSessionsWithActiveRunDAO as MockFn).mockResolvedValue([
            {
                sessionId: 'sid-004',
                type: 3,
                metadata: { moduleName: 'chronicle' }, // 无 title
                hasActiveRun: false,
                createdAt: now,
                updatedAt: now,
            },
        ])

        const result = await handler(event)

        expect(result.data[0].title).toBe('chronicle')
    })
})

// ============================================================
// 3. POST xiaosuo-session
// ============================================================
describe('POST /api/v1/case/analysis/xiaosuo-session', () => {
    let handler: Function

    beforeEach(async () => {
        vi.resetAllMocks()
        vi.stubGlobal('resSuccess', vi.fn((event: any, message: string, data: any) => ({ success: true, message, data })))
        vi.stubGlobal('resError', vi.fn((event: any, code: number, message: string) => ({ success: false, code, message })))
        handler = (await import('../../../server/api/v1/case/analysis/xiaosuo-session.post')).default
    })

    it('未登录时应返回 401', async () => {
        const event = makeEvent(undefined)
        ;(global.readBody as MockFn).mockResolvedValue({})

        const result = await handler(event)

        expect(result.success).toBe(false)
        expect(result.code).toBe(401)
    })

    it('caseId 非正整数时 zod 校验失败应返回 400', async () => {
        const event = makeEvent({ user: { id: 1 } })
        ;(global.readBody as MockFn).mockResolvedValue({ caseId: -1 })

        const result = await handler(event)

        expect(result.success).toBe(false)
        expect(result.code).toBe(400)
    })

    it('缺少 caseId 时应返回 400', async () => {
        const event = makeEvent({ user: { id: 1 } })
        ;(global.readBody as MockFn).mockResolvedValue({ title: '测试' })

        const result = await handler(event)

        expect(result.success).toBe(false)
        expect(result.code).toBe(400)
    })

    it('案件不存在（DAO 返回 null）时应返回 404', async () => {
        const event = makeEvent({ user: { id: 1 } })
        ;(global.readBody as MockFn).mockResolvedValue({ caseId: 100 })
        ;(createSessionDAO as MockFn).mockResolvedValue(null)

        const result = await handler(event)

        expect(result.success).toBe(false)
        expect(result.code).toBe(404)
    })

    it('创建成功应返回 sessionId + title，type=1', async () => {
        const event = makeEvent({ user: { id: 1 } })
        ;(global.readBody as MockFn).mockResolvedValue({ caseId: 100, title: '我的对话' })
        ;(createSessionDAO as MockFn).mockResolvedValue({ sessionId: 'new-sid', isNew: true })

        const result = await handler(event)

        expect(result.success).toBe(true)
        expect(result.data.sessionId).toBe('new-sid')
        expect(result.data.title).toBe('我的对话')

        // 验证 DAO 调用时 type=1
        expect(createSessionDAO).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 1,
                metadata: expect.objectContaining({ source: 'xiaosuo', title: '我的对话' }),
            }),
        )
    })

    it('未传 title 时应自动生成时间格式的标题', async () => {
        const event = makeEvent({ user: { id: 1 } })
        ;(global.readBody as MockFn).mockResolvedValue({ caseId: 100 })
        ;(createSessionDAO as MockFn).mockResolvedValue({ sessionId: 'new-sid-2', isNew: true })

        const result = await handler(event)

        expect(result.success).toBe(true)
        // 标题格式：YYMMDDHHmm，10 位数字
        expect(result.data.title).toMatch(/^\d{10}$/)
    })
})

// ============================================================
// 4. POST module-session
// ============================================================
describe('POST /api/v1/case/analysis/module-session', () => {
    let handler: Function

    beforeEach(async () => {
        vi.resetAllMocks()
        vi.stubGlobal('resSuccess', vi.fn((event: any, message: string, data: any) => ({ success: true, message, data })))
        vi.stubGlobal('resError', vi.fn((event: any, code: number, message: string) => ({ success: false, code, message })))
        // 设置 getNodeByNameService 全局 mock
        ;(global as any).getNodeByNameService = vi.fn()
        handler = (await import('../../../server/api/v1/case/analysis/module-session.post')).default
    })

    it('未登录时应返回 401', async () => {
        const event = makeEvent(undefined)
        ;(global.readBody as MockFn).mockResolvedValue({})

        const result = await handler(event)

        expect(result.success).toBe(false)
        expect(result.code).toBe(401)
    })

    it('缺少 moduleName 时 zod 校验失败应返回 400', async () => {
        const event = makeEvent({ user: { id: 1 } })
        ;(global.readBody as MockFn).mockResolvedValue({ caseId: 100 })

        const result = await handler(event)

        expect(result.success).toBe(false)
        expect(result.code).toBe(400)
    })

    it('caseId 非正整数时应返回 400', async () => {
        const event = makeEvent({ user: { id: 1 } })
        ;(global.readBody as MockFn).mockResolvedValue({ caseId: 0, moduleName: 'summary' })

        const result = await handler(event)

        expect(result.success).toBe(false)
        expect(result.code).toBe(400)
    })

    it('模块节点不存在时应返回 404', async () => {
        const event = makeEvent({ user: { id: 1 } })
        ;(global.readBody as MockFn).mockResolvedValue({ caseId: 100, moduleName: 'unknown_module' })
        ;(global as any).getNodeByNameService.mockResolvedValue(null)

        const result = await handler(event)

        expect(result.success).toBe(false)
        expect(result.code).toBe(404)
    })

    it('案件不存在（DAO 返回 null）时应返回 404', async () => {
        const event = makeEvent({ user: { id: 1 } })
        ;(global.readBody as MockFn).mockResolvedValue({ caseId: 100, moduleName: 'summary' })
        ;(global as any).getNodeByNameService.mockResolvedValue({ id: 'node-abc' })
        ;(createSessionDAO as MockFn).mockResolvedValue(null)

        const result = await handler(event)

        expect(result.success).toBe(false)
        expect(result.code).toBe(404)
    })

    it('创建成功应返回 sessionId + isNew，type=3', async () => {
        const event = makeEvent({ user: { id: 1 } })
        ;(global.readBody as MockFn).mockResolvedValue({ caseId: 100, moduleName: 'summary' })
        ;(getNodeByNameService as MockFn).mockResolvedValue({ id: 'node-abc' })
        ;(createSessionDAO as MockFn).mockResolvedValue({ sessionId: 'mod-sid-001', isNew: true })

        const result = await handler(event)

        expect(result.success).toBe(true)
        expect(result.data.sessionId).toBe('mod-sid-001')
        expect(result.data.isNew).toBe(true)

        // 验证 DAO 调用时 type=3
        expect(createSessionDAO).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 3,
            }),
        )
    })

    it('未传 title 时应自动生成纯时间戳标题（前缀由 UI 负责）', async () => {
        const event = makeEvent({ user: { id: 1 } })
        ;(global.readBody as MockFn).mockResolvedValue({ caseId: 100, moduleName: 'summary' })
        ;(getNodeByNameService as MockFn).mockResolvedValue({ id: 'node-abc' })

        let capturedMetadata: any = null
        ;(createSessionDAO as MockFn).mockImplementation(async (params) => {
            capturedMetadata = params.metadata
            return { sessionId: 'mod-sid-002', isNew: true }
        })

        await handler(event)

        // 标题格式：YYMMDDHHmm，10 位数字（不含模块名前缀）
        expect(capturedMetadata.title).toMatch(/^\d{10}$/)
        expect(capturedMetadata.moduleName).toBe('summary')
        expect(capturedMetadata.nodeId).toBe('node-abc')
    })
})

// ============================================================
// 5. DELETE module-session/[sessionId]
// ============================================================
describe('DELETE /api/v1/case/analysis/module-session/[sessionId]', () => {
    let handler: Function

    beforeEach(async () => {
        vi.resetAllMocks()
        vi.stubGlobal('resSuccess', vi.fn((event: any, message: string, data: any) => ({ success: true, message, data })))
        vi.stubGlobal('resError', vi.fn((event: any, code: number, message: string) => ({ success: false, code, message })))
        handler = (await import('../../../server/api/v1/case/analysis/module-session/[sessionId].delete')).default
    })

    it('未登录时应返回 401', async () => {
        const event = makeEvent(undefined)
        ;(global.getRouterParam as MockFn).mockReturnValue('sid-001')

        const result = await handler(event)

        expect(result.success).toBe(false)
        expect(result.code).toBe(401)
    })

    it('缺少 sessionId 时应返回 400', async () => {
        const event = makeEvent({ user: { id: 1 } })
        ;(global.getRouterParam as MockFn).mockReturnValue(undefined)

        const result = await handler(event)

        expect(result.success).toBe(false)
        expect(result.code).toBe(400)
    })

    it('session 不存在时应返回 404', async () => {
        const event = makeEvent({ user: { id: 1 } })
        ;(global.getRouterParam as MockFn).mockReturnValue('sid-not-found')
        ;(softDeleteSessionDAO as MockFn).mockResolvedValue({ success: false, error: 'Session 不存在' })

        const result = await handler(event)

        expect(result.success).toBe(false)
        expect(result.code).toBe(404)
    })

    it('无权操作时应返回 403', async () => {
        const event = makeEvent({ user: { id: 1 } })
        ;(global.getRouterParam as MockFn).mockReturnValue('sid-another')
        ;(softDeleteSessionDAO as MockFn).mockResolvedValue({ success: false, error: '无权操作该 Session' })

        const result = await handler(event)

        expect(result.success).toBe(false)
        expect(result.code).toBe(403)
    })

    it('删除成功应返回 success', async () => {
        const event = makeEvent({ user: { id: 1 } })
        ;(global.getRouterParam as MockFn).mockReturnValue('sid-001')
        ;(softDeleteSessionDAO as MockFn).mockResolvedValue({ success: true })

        const result = await handler(event)

        expect(result.success).toBe(true)
    })

    it('应仅允许删除 type=3 的 session（allowedTypes=[3]）', async () => {
        const event = makeEvent({ user: { id: 1 } })
        ;(global.getRouterParam as MockFn).mockReturnValue('sid-001')
        ;(softDeleteSessionDAO as MockFn).mockResolvedValue({ success: true })

        await handler(event)

        // 验证 allowedTypes 限制为 [3]
        expect(softDeleteSessionDAO).toHaveBeenCalledWith(
            expect.objectContaining({
                allowedTypes: [3],
            }),
        )
    })
})

// ============================================================
// 6. PATCH session/rename/[sessionId]
// ============================================================
describe('PATCH /api/v1/case/analysis/session/rename/[sessionId]', () => {
    let handler: Function

    beforeEach(async () => {
        vi.resetAllMocks()
        vi.stubGlobal('resSuccess', vi.fn((event: any, message: string, data: any) => ({ success: true, message, data })))
        vi.stubGlobal('resError', vi.fn((event: any, code: number, message: string) => ({ success: false, code, message })))
        handler = (await import('../../../server/api/v1/case/analysis/session/rename/[sessionId].patch')).default
    })

    it('未登录时应返回 401', async () => {
        const event = makeEvent(undefined)
        ;(global.getRouterParam as MockFn).mockReturnValue('sid-001')
        ;(global.readBody as MockFn).mockResolvedValue({ title: '新名称' })

        const result = await handler(event)

        expect(result.success).toBe(false)
        expect(result.code).toBe(401)
    })

    it('缺少 sessionId 时应返回 400', async () => {
        const event = makeEvent({ user: { id: 1 } })
        ;(global.getRouterParam as MockFn).mockReturnValue(undefined)
        ;(global.readBody as MockFn).mockResolvedValue({ title: '新名称' })

        const result = await handler(event)

        expect(result.success).toBe(false)
        expect(result.code).toBe(400)
    })

    it('title 为空字符串时 zod 校验失败应返回 400', async () => {
        const event = makeEvent({ user: { id: 1 } })
        ;(global.getRouterParam as MockFn).mockReturnValue('sid-001')
        ;(global.readBody as MockFn).mockResolvedValue({ title: '' })

        const result = await handler(event)

        expect(result.success).toBe(false)
        expect(result.code).toBe(400)
    })

    it('title 超过 100 字符时 zod 校验失败应返回 400', async () => {
        const event = makeEvent({ user: { id: 1 } })
        ;(global.getRouterParam as MockFn).mockReturnValue('sid-001')
        ;(global.readBody as MockFn).mockResolvedValue({ title: 'a'.repeat(101) })

        const result = await handler(event)

        expect(result.success).toBe(false)
        expect(result.code).toBe(400)
    })

    it('session 不存在时应返回 404', async () => {
        const event = makeEvent({ user: { id: 1 } })
        ;(global.getRouterParam as MockFn).mockReturnValue('sid-not-found')
        ;(global.readBody as MockFn).mockResolvedValue({ title: '新名称' })
        ;(renameSessionDAO as MockFn).mockResolvedValue({ success: false, error: 'Session 不存在' })

        const result = await handler(event)

        expect(result.success).toBe(false)
        expect(result.code).toBe(404)
    })

    it('无权操作时应返回 403', async () => {
        const event = makeEvent({ user: { id: 1 } })
        ;(global.getRouterParam as MockFn).mockReturnValue('sid-another')
        ;(global.readBody as MockFn).mockResolvedValue({ title: '新名称' })
        ;(renameSessionDAO as MockFn).mockResolvedValue({ success: false, error: '无权操作该 Session' })

        const result = await handler(event)

        expect(result.success).toBe(false)
        expect(result.code).toBe(403)
    })

    it('重命名成功应返回 success', async () => {
        const event = makeEvent({ user: { id: 1 } })
        ;(global.getRouterParam as MockFn).mockReturnValue('sid-001')
        ;(global.readBody as MockFn).mockResolvedValue({ title: '新名称' })
        ;(renameSessionDAO as MockFn).mockResolvedValue({ success: true })

        const result = await handler(event)

        expect(result.success).toBe(true)

        // 验证 DAO 调用参数
        expect(renameSessionDAO).toHaveBeenCalledWith({
            sessionId: 'sid-001',
            userId: 1,
            newTitle: '新名称',
        })
    })
})
