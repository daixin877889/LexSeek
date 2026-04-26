/**
 * 管理端节点 Skills 关联 API 测试
 *
 * **Feature: admin-nodes-skills**
 * **Validates: Task 20 - 节点关联 Skills PATCH 接口**
 *
 * 测试策略：vi.mock 所有外部依赖，vi.stubGlobal 替换 prisma 和 H3 助手函数，
 * 专注测试 handler 的参数校验逻辑和缓存失效行为。
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

// ---- vi.mock 必须在顶部（vitest 会自动提升到模块顶部）----
vi.mock('~~/server/services/node/node.service', () => ({
    getNodeByIdService: vi.fn(),
}))

vi.mock('~~/server/services/agent-platform/nodeConfig/loader', () => ({
    invalidateNodeConfigCache: vi.fn(),
}))

vi.mock('~~/server/services/agent-platform/skills/filesystemBackendCache', () => ({
    invalidateBackendCache: vi.fn(),
}))

// ---- 在 mock 声明后 import 被 mock 的模块 ----
import { getNodeByIdService } from '~~/server/services/node/node.service'
import { invalidateNodeConfigCache } from '~~/server/services/agent-platform/nodeConfig/loader'
import { invalidateBackendCache } from '~~/server/services/agent-platform/skills/filesystemBackendCache'

// ---- nitro 全局 stub（仅覆盖 test-setup 里没有设置的函数） ----
vi.stubGlobal('defineEventHandler', (h: any) => h)

// H3 工具函数
vi.stubGlobal('getRouterParam', (event: any, key: string) => (event as any)[`__${key}`])
vi.stubGlobal('readBody', async (event: any) => (event as any).__body)

// prisma mock（仅 handler 需要的最小方法集，覆盖 test-setup 中的 getTestPrisma）
const mockDeleteMany = vi.fn()
const mockCreateMany = vi.fn()
const mockTransaction = vi.fn()

vi.stubGlobal('prisma', {
    $transaction: mockTransaction,
    node_skills: { deleteMany: mockDeleteMany, createMany: mockCreateMany },
})

// ---- helper：mock event 包含 context.requestId 供 resError/resSuccess 使用 ----
function makeEvent(id: string | undefined, body: unknown) {
    return {
        __id: id,
        __body: body,
        context: { requestId: 'test-request-id' },
    }
}

describe('PATCH /api/v1/admin/nodes/:id/skills', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        // 默认事务：执行 callback，传入包含 node_skills 操作的 tx
        mockTransaction.mockImplementation(async (fn: (tx: any) => any) =>
            fn({ node_skills: { deleteMany: mockDeleteMany, createMany: mockCreateMany } })
        )
    })

    afterAll(() => {
        vi.unstubAllGlobals()
    })

    it('handler 可加载且为函数', async () => {
        const mod = await import('~~/server/api/v1/admin/nodes/[id]/skills.patch')
        expect(typeof mod.default).toBe('function')
    })

    it('id 为非数字时返回 400', async () => {
        const { default: handler } = await import('~~/server/api/v1/admin/nodes/[id]/skills.patch')
        const result = await handler(makeEvent('abc', { skills: [] }) as any)
        expect(result.code).toBe(400)
    })

    it('请求体缺 skills 字段时返回 400', async () => {
        const { default: handler } = await import('~~/server/api/v1/admin/nodes/[id]/skills.patch')
        const result = await handler(makeEvent('1', { wrongField: [] }) as any)
        expect(result.code).toBe(400)
    })

    it('节点不存在时返回 404', async () => {
        vi.mocked(getNodeByIdService).mockResolvedValue(null)
        const { default: handler } = await import('~~/server/api/v1/admin/nodes/[id]/skills.patch')
        const result = await handler(makeEvent('99999', { skills: [] }) as any)
        expect(result.code).toBe(404)
        expect(result.message).toContain('节点不存在')
    })

    it('成功更新后失效 NodeConfig 缓存和 backend 缓存', async () => {
        vi.mocked(getNodeByIdService).mockResolvedValue({ id: 1, name: 'caseMain' } as any)

        const { default: handler } = await import('~~/server/api/v1/admin/nodes/[id]/skills.patch')
        const result = await handler(makeEvent('1', {
            skills: [{ skillName: 'docx', priority: 10 }],
        }) as any)

        expect(result.code).toBe(0)
        expect(result.success).toBe(true)
        expect(mockTransaction).toHaveBeenCalledOnce()
        expect(vi.mocked(invalidateNodeConfigCache)).toHaveBeenCalledWith('caseMain')
        expect(vi.mocked(invalidateBackendCache)).toHaveBeenCalledOnce()
    })

    it('skills 为空数组时成功清空并失效缓存', async () => {
        vi.mocked(getNodeByIdService).mockResolvedValue({ id: 2, name: 'legalAssistant' } as any)

        const { default: handler } = await import('~~/server/api/v1/admin/nodes/[id]/skills.patch')
        const result = await handler(makeEvent('2', { skills: [] }) as any)

        expect(result.code).toBe(0)
        expect(vi.mocked(invalidateNodeConfigCache)).toHaveBeenCalledWith('legalAssistant')
        expect(vi.mocked(invalidateBackendCache)).toHaveBeenCalledOnce()
    })
})
