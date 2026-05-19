/**
 * 节点 PUT/DELETE 缓存失效回归测试
 *
 * 回归原始 bug：后台改节点模型后，nodeConfig 缓存未被失效，运行中分析仍用旧模型。
 * 范式沿用 tests/server/admin/nodes.create.api.test.ts：spy-through 包住
 * invalidateNodeConfigCache、模块顶层注入 h3 全局、直接 import handler default、
 * 真实 prisma 直连 worker DB、真跑 handler。
 *
 * **Feature: cache-invalidation**
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// spy-through：保留 loader 其它真实导出，只把 invalidateNodeConfigCache 包成 spy
vi.mock('~~/server/services/agent-platform/nodeConfig/loader', async () => {
    const actual = await vi.importActual<typeof import('~~/server/services/agent-platform/nodeConfig/loader')>(
        '~~/server/services/agent-platform/nodeConfig/loader',
    )
    return {
        ...actual,
        invalidateNodeConfigCache: vi.fn(actual.invalidateNodeConfigCache),
    }
})

import { prisma } from '~~/server/utils/db'
import { invalidateNodeConfigCache } from '~~/server/services/agent-platform/nodeConfig/loader'

// h3 / logger 全局桩（模块顶层注入，import handler 前就位）
const resError = (_e: any, code: number, message: string) => ({ code, success: false, message, data: null })
const resSuccess = (_e: any, message: string, data: any) => ({ code: 0, success: true, message, data })
;(globalThis as any).resError = resError
;(globalThis as any).resSuccess = resSuccess
;(globalThis as any).defineEventHandler = (h: any) => h
;(globalThis as any).readBody = async (event: any) => event.__body
;(globalThis as any).getRouterParam = (event: any, key: string) => event.__params?.[key]
;(globalThis as any).logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }

const { default: putHandler } = await import('~~/server/api/v1/admin/nodes/[id].put')
const { default: deleteHandler } = await import('~~/server/api/v1/admin/nodes/[id].delete')

function makeEvent(params: Record<string, string>, body?: any) {
    return { context: {}, __params: params, __body: body, node: { req: { socket: {} } } }
}

describe('节点 PUT/DELETE 缓存失效回归', () => {
    const createdNodeIds: number[] = []
    const createdModelIds: number[] = []
    const createdProviderIds: number[] = []
    let nodeName: string
    let nodeId: number

    beforeEach(async () => {
        vi.mocked(invalidateNodeConfigCache).mockClear()
        const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

        const provider = await prisma.modelProviders.create({
            data: { name: `prov_${suffix}`, baseUrl: 'https://api.test.com' },
        })
        createdProviderIds.push(provider.id)
        const model = await prisma.models.create({
            data: {
                name: `model_${suffix}`, displayName: 'M',
                providerId: provider.id, modelType: 'chat', status: 1,
            },
        })
        createdModelIds.push(model.id)
        nodeName = `cinv_node_${suffix}`
        const node = await prisma.nodes.create({
            data: {
                name: nodeName, title: '回归测试节点', type: 'analysis',
                priority: 100, modelId: model.id, tools: [], status: 1,
            },
        })
        nodeId = node.id
        createdNodeIds.push(node.id)
    })

    afterEach(async () => {
        await prisma.nodes.deleteMany({ where: { id: { in: createdNodeIds } } })
        await prisma.models.deleteMany({ where: { id: { in: createdModelIds } } })
        await prisma.modelProviders.deleteMany({ where: { id: { in: createdProviderIds } } })
        createdNodeIds.length = 0
        createdModelIds.length = 0
        createdProviderIds.length = 0
    })

    it('PUT /admin/nodes/:id 更新成功后调用 invalidateNodeConfigCache(node.name)', async () => {
        const r: any = await putHandler(makeEvent({ id: String(nodeId) }, { priority: 200 }))
        expect(r.code).toBe(0)
        expect(vi.mocked(invalidateNodeConfigCache)).toHaveBeenCalledWith(nodeName)
        // DB 确实被更新
        const updated = await prisma.nodes.findUnique({ where: { id: nodeId } })
        expect(updated?.priority).toBe(200)
    })

    it('DELETE /admin/nodes/:id 删除成功后调用 invalidateNodeConfigCache(node.name)', async () => {
        const r: any = await deleteHandler(makeEvent({ id: String(nodeId) }))
        expect(r.code).toBe(0)
        expect(vi.mocked(invalidateNodeConfigCache)).toHaveBeenCalledWith(nodeName)
    })
})
