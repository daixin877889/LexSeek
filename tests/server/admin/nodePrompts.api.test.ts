/**
 * PATCH/GET /api/v1/admin/nodes/:id/prompts 接口测试
 *
 * **Feature: prompts-multi-node-and-anti-jailbreak**
 *
 * 策略：直接 import handler default export，传入 mock event（含 auth 上下文 +
 * __params + __body），断言返回 body。绕过 02.auth / 03.permission 中间件。
 *
 * 真实 prisma 直连 worker DB；审计日志/缓存失效通过 vi.mock 部分替换以做行为断言。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// 真实 prisma 调用 + 审计/缓存调用断言（使用部分 mock 保留其它导出）
vi.mock('~~/server/services/agent-platform/nodeConfig/loader', async () => {
    const actual = await vi.importActual<typeof import('~~/server/services/agent-platform/nodeConfig/loader')>(
        '~~/server/services/agent-platform/nodeConfig/loader',
    )
    return {
        ...actual,
        invalidateNodeConfigCache: vi.fn(actual.invalidateNodeConfigCache),
    }
})

vi.mock('~~/server/services/rbac/auditLog.service', async () => {
    const actual = await vi.importActual<typeof import('~~/server/services/rbac/auditLog.service')>(
        '~~/server/services/rbac/auditLog.service',
    )
    return {
        ...actual,
        logNodePromptLink: vi.fn(actual.logNodePromptLink),
    }
})

import { prisma } from '~~/server/utils/db'
import { invalidateNodeConfigCache } from '~~/server/services/agent-platform/nodeConfig/loader'
import { logNodePromptLink } from '~~/server/services/rbac/auditLog.service'

// 全局 stub：模拟 Nuxt nitro 自动导入的 H3 函数与响应工具
const resError = (_event: any, code: number, message: string) => ({ code, success: false, message, data: null })
const resSuccess = (_event: any, message: string, data: any) => ({ code: 0, success: true, message, data })
;(globalThis as any).resError = resError
;(globalThis as any).resSuccess = resSuccess
;(globalThis as any).defineEventHandler = (h: any) => h
;(globalThis as any).readBody = async (event: any) => event.__body
;(globalThis as any).readValidatedBody = async (event: any, validate: any) => validate(event.__body)
;(globalThis as any).getRouterParam = (event: any, key: string) => event.__params?.[key]
;(globalThis as any).getHeader = (event: any, name: string) => event.__headers?.[name.toLowerCase()]
;(globalThis as any).logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }

const { default: patchHandler } = await import(
    '~~/server/api/v1/admin/nodes/[id]/prompts/index.patch'
)

function makeEvent(opts: { params?: Record<string, string>; body?: any }) {
    return {
        context: { auth: { user: { id: 2 } } },
        __params: opts.params,
        __body: opts.body,
        __headers: {},
        node: { req: { socket: {} } },
    }
}

describe('PATCH /api/v1/admin/nodes/:id/prompts', () => {
    let nodeId: number
    let prompt1Id: number
    let prompt2Id: number
    let prompt1Name: string
    let prompt2Name: string
    const createdNodeIds: number[] = []
    const createdPromptIds: number[] = []

    beforeEach(async () => {
        vi.mocked(invalidateNodeConfigCache).mockClear()
        vi.mocked(logNodePromptLink).mockClear()

        const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        const node = await prisma.nodes.create({
            data: {
                name: `np_test_${suffix}`,
                title: '测试节点',
                type: 'chat',
                status: 1,
                modelId: 1,
            },
        })
        nodeId = node.id
        createdNodeIds.push(nodeId)

        prompt1Name = `np_p1_${suffix}`
        prompt2Name = `np_p2_${suffix}`
        const p1 = await prisma.prompts.create({
            data: {
                name: prompt1Name,
                content: 'system content A',
                type: 'system',
                status: 1,
                version: 'v1',
            },
        })
        const p2 = await prisma.prompts.create({
            data: {
                name: prompt2Name,
                content: 'system content B',
                type: 'system',
                status: 1,
                version: 'v1',
            },
        })
        prompt1Id = p1.id
        prompt2Id = p2.id
        createdPromptIds.push(prompt1Id, prompt2Id)

        // 阶段 F 改造：node_prompts 按业务身份 (name, type) 关联
        // 初始关联：prompt1 已挂载（displayOrder=100）
        await prisma.node_prompts.create({
            data: { nodeId, promptName: prompt1Name, promptType: 'system', displayOrder: 100 },
        })
    })

    afterEach(async () => {
        // 反向清理：node_prompts → prompts → nodes
        await prisma.node_prompts.deleteMany({ where: { nodeId: { in: createdNodeIds } } })
        await prisma.prompts.deleteMany({ where: { id: { in: createdPromptIds } } })
        await prisma.nodes.deleteMany({ where: { id: { in: createdNodeIds } } })
        createdNodeIds.length = 0
        createdPromptIds.length = 0
    })

    it('add：传入新 prompt → 创建关联', async () => {
        const r = await patchHandler(
            makeEvent({
                params: { id: String(nodeId) },
                body: {
                    prompts: [
                        { promptId: prompt1Id, displayOrder: 100 },
                        { promptId: prompt2Id, displayOrder: 200 },
                    ],
                },
            }),
        )
        expect(r.code).toBe(0)
        expect(r.data.added).toBe(1)
        expect(r.data.removed).toBe(0)
        expect(r.data.reordered).toBe(0)

        const links = await prisma.node_prompts.findMany({
            where: { nodeId },
            orderBy: { displayOrder: 'asc' },
        })
        expect(links).toHaveLength(2)
        expect(links.map((l) => l.promptName)).toContain(prompt2Name)
    })

    it('remove：从 body 中移除已关联 prompt → 删除关联', async () => {
        const r = await patchHandler(
            makeEvent({
                params: { id: String(nodeId) },
                body: { prompts: [] },
            }),
        )
        expect(r.code).toBe(0)
        expect(r.data.removed).toBe(1)
        expect(r.data.added).toBe(0)

        const links = await prisma.node_prompts.findMany({ where: { nodeId } })
        expect(links).toHaveLength(0)
    })

    it('reorder：displayOrder 改变 → 更新现有关联', async () => {
        const r = await patchHandler(
            makeEvent({
                params: { id: String(nodeId) },
                body: { prompts: [{ promptId: prompt1Id, displayOrder: 10 }] },
            }),
        )
        expect(r.code).toBe(0)
        expect(r.data.reordered).toBe(1)
        expect(r.data.added).toBe(0)
        expect(r.data.removed).toBe(0)

        const link = await prisma.node_prompts.findUnique({
            where: {
                nodeId_promptName_promptType: {
                    nodeId,
                    promptName: prompt1Name,
                    promptType: 'system',
                },
            },
        })
        expect(link?.displayOrder).toBe(10)
    })

    it('唯一约束：同一 promptId 出现两次 → 400', async () => {
        const r = await patchHandler(
            makeEvent({
                params: { id: String(nodeId) },
                body: {
                    prompts: [
                        { promptId: prompt1Id, displayOrder: 100 },
                        { promptId: prompt1Id, displayOrder: 200 },
                    ],
                },
            }),
        )
        expect(r.code).toBe(400)
    })

    it('调用 logNodePromptLink 记录 diff（按业务身份 (name, type)）', async () => {
        await patchHandler(
            makeEvent({
                params: { id: String(nodeId) },
                body: {
                    prompts: [
                        { promptId: prompt1Id, displayOrder: 100 },
                        { promptId: prompt2Id, displayOrder: 200 },
                    ],
                },
            }),
        )

        expect(vi.mocked(logNodePromptLink)).toHaveBeenCalledTimes(1)
        const callArgs = vi.mocked(logNodePromptLink).mock.calls[0]!
        expect(callArgs[1]).toBe(2) // operatorId
        expect(callArgs[2]).toBe(nodeId)
        // 阶段 F 改造：审计字段由 addedIds/removedIds/reorderedIds 切到 added/removed/reordered，
        // 每项是 (name, type[, displayOrder]) 业务身份元组
        expect(callArgs[3]).toEqual(
            expect.objectContaining({
                added: [{ name: prompt2Name, type: 'system', displayOrder: 200 }],
                removed: [],
                reordered: [],
            }),
        )
    })

    it('调用 invalidateNodeConfigCache 传入节点名（非 nodeId）', async () => {
        await patchHandler(
            makeEvent({
                params: { id: String(nodeId) },
                body: { prompts: [] },
            }),
        )

        expect(vi.mocked(invalidateNodeConfigCache)).toHaveBeenCalledTimes(1)
        const cachedCallArgs = vi.mocked(invalidateNodeConfigCache).mock.calls[0]!
        expect(cachedCallArgs[0]).toMatch(/^np_test_/) // 节点 name 前缀
        expect(cachedCallArgs[0]).not.toBe(String(nodeId)) // 不是 nodeId 字符串化
    })
})
