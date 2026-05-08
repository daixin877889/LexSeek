/**
 * POST /api/v1/admin/nodes 接口测试 — 阶段 G：事务化创建节点 + 关联提示词
 *
 * **Feature: prompts-multi-node-and-anti-jailbreak**
 *
 * 策略：直接 import handler default export，传入 mock event（含 auth 上下文 + __body）
 * 断言返回 body。绕过 02.auth / 03.permission 中间件，真实 prisma 直连 worker DB。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// 真实 prisma + 审计 / 缓存调用断言（部分 mock 保留其它导出）
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

// 全局 stub
const resError = (_event: any, code: number, message: string) => ({ code, success: false, message, data: null })
const resSuccess = (_event: any, message: string, data: any) => ({ code: 0, success: true, message, data })
;(globalThis as any).resError = resError
;(globalThis as any).resSuccess = resSuccess
;(globalThis as any).defineEventHandler = (h: any) => h
;(globalThis as any).readBody = async (event: any) => event.__body
;(globalThis as any).getRouterParam = (event: any, key: string) => event.__params?.[key]
;(globalThis as any).getHeader = (event: any, name: string) => event.__headers?.[name.toLowerCase()]
;(globalThis as any).logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }

const { default: postHandler } = await import('~~/server/api/v1/admin/nodes/index.post')

function makeEvent(body: any) {
    return {
        context: { auth: { user: { id: 2 } } },
        __body: body,
        __headers: {},
        node: { req: { socket: {} } },
    }
}

describe('POST /api/v1/admin/nodes — 事务化创建节点 + 提示词关联', () => {
    let prompt1Id: number
    let prompt2Id: number
    let prompt1Name: string
    let prompt2Name: string
    const createdNodeIds: number[] = []
    const createdPromptIds: number[] = []
    let suffix: string

    beforeEach(async () => {
        vi.mocked(invalidateNodeConfigCache).mockClear()
        vi.mocked(logNodePromptLink).mockClear()

        suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        prompt1Name = `nc_p1_${suffix}`
        prompt2Name = `nc_p2_${suffix}`

        const p1 = await prisma.prompts.create({
            data: { name: prompt1Name, content: 'sys A', type: 'system', status: 1, version: 'v1' },
        })
        const p2 = await prisma.prompts.create({
            data: { name: prompt2Name, content: 'sys B', type: 'system', status: 1, version: 'v1' },
        })
        prompt1Id = p1.id
        prompt2Id = p2.id
        createdPromptIds.push(prompt1Id, prompt2Id)
    })

    afterEach(async () => {
        await prisma.node_prompts.deleteMany({ where: { nodeId: { in: createdNodeIds } } })
        await prisma.nodes.deleteMany({ where: { id: { in: createdNodeIds } } })
        await prisma.prompts.deleteMany({ where: { id: { in: createdPromptIds } } })
        createdNodeIds.length = 0
        createdPromptIds.length = 0
    })

    it('不传 prompts → 仅创建节点，不写关联（向后兼容）', async () => {
        const r = await postHandler(
            makeEvent({
                name: `nc_node_${suffix}`,
                title: '无提示词节点',
                type: 'agent',
                modelId: 1,
                priority: 100,
            }),
        )

        expect(r.code).toBe(0)
        expect(r.data?.id).toBeGreaterThan(0)
        expect(r.data?.attachedPromptCount).toBe(0)
        createdNodeIds.push(r.data.id)

        const links = await prisma.node_prompts.findMany({ where: { nodeId: r.data.id } })
        expect(links).toHaveLength(0)
    })

    it('带 prompts 数组 → 节点 + 关联同事务创建，关联用业务身份 (name, type) 写入', async () => {
        const r = await postHandler(
            makeEvent({
                name: `nc_node_${suffix}`,
                title: '含提示词节点',
                type: 'agent',
                modelId: 1,
                priority: 100,
                prompts: [
                    { promptId: prompt1Id, displayOrder: 100 },
                    { promptId: prompt2Id, displayOrder: 200 },
                ],
            }),
        )

        expect(r.code).toBe(0)
        expect(r.data?.id).toBeGreaterThan(0)
        expect(r.data?.attachedPromptCount).toBe(2)
        createdNodeIds.push(r.data.id)

        const links = await prisma.node_prompts.findMany({
            where: { nodeId: r.data.id },
            orderBy: { displayOrder: 'asc' },
        })
        expect(links).toHaveLength(2)
        expect(links.map((l) => l.promptName)).toEqual([prompt1Name, prompt2Name])
        expect(links.map((l) => l.promptType)).toEqual(['system', 'system'])
        expect(links.map((l) => l.displayOrder)).toEqual([100, 200])

        // 写了审计日志（创建关联）
        expect(vi.mocked(logNodePromptLink)).toHaveBeenCalledTimes(1)
        const callArgs = vi.mocked(logNodePromptLink).mock.calls[0]!
        expect(callArgs[2]).toBe(r.data.id)
        expect(callArgs[3].added).toHaveLength(2)
        expect(callArgs[3].removed).toEqual([])
        expect(callArgs[3].reordered).toEqual([])
    })

    it('promptId 不存在 → 整个事务回滚（节点也不创建）', async () => {
        const targetName = `nc_node_${suffix}_rollback`
        const ghostId = 99_999_999

        const r = await postHandler(
            makeEvent({
                name: targetName,
                title: '应回滚',
                type: 'agent',
                modelId: 1,
                priority: 100,
                prompts: [
                    { promptId: prompt1Id, displayOrder: 100 },
                    { promptId: ghostId, displayOrder: 200 },
                ],
            }),
        )

        expect(r.code).toBe(400)
        expect(r.message).toMatch(/提示词不存在或已删除/)

        // 关键断言：节点也没创建（事务整体回滚）
        const node = await prisma.nodes.findFirst({ where: { name: targetName } })
        expect(node).toBeNull()

        // 没写审计日志（事务内 throw 在 logNodePromptLink 之前）
        expect(vi.mocked(logNodePromptLink)).not.toHaveBeenCalled()
    })

    it('prompt 未激活（status=0） → 整个事务回滚', async () => {
        const inactivePrompt = await prisma.prompts.create({
            data: {
                name: `nc_p_inactive_${suffix}`,
                content: 'inactive',
                type: 'system',
                status: 0,
                version: 'v1',
            },
        })
        createdPromptIds.push(inactivePrompt.id)

        const targetName = `nc_node_${suffix}_inactive`
        const r = await postHandler(
            makeEvent({
                name: targetName,
                title: '应回滚-未激活',
                type: 'agent',
                modelId: 1,
                priority: 100,
                prompts: [{ promptId: inactivePrompt.id, displayOrder: 100 }],
            }),
        )

        expect(r.code).toBe(400)
        expect(r.message).toMatch(/必须为激活状态/)

        const node = await prisma.nodes.findFirst({ where: { name: targetName } })
        expect(node).toBeNull()
    })

    it('同一 promptId 重复 → 400（不进事务）', async () => {
        const r = await postHandler(
            makeEvent({
                name: `nc_node_${suffix}_dup`,
                title: '重复 promptId',
                type: 'agent',
                modelId: 1,
                priority: 100,
                prompts: [
                    { promptId: prompt1Id, displayOrder: 100 },
                    { promptId: prompt1Id, displayOrder: 200 },
                ],
            }),
        )

        expect(r.code).toBe(400)
    })
})
