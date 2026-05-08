import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma } from '~~/server/utils/db'
import {
    getNodeConfigCached,
    invalidateNodeConfigCache,
    _resetCacheForTests,
} from '~~/server/services/agent-platform/nodeConfig/loader'
import { getNodeConfigService } from '~~/server/services/node/node.service'

describe('NodeConfig loader 缓存', () => {
    beforeEach(() => {
        _resetCacheForTests()
    })

    afterEach(() => {
        _resetCacheForTests()
    })

    it('首次调用打 DB；二次调用走缓存（同一对象引用）', async () => {
        // 假设 nodes 表里有 'caseMain' 节点（项目 seed 数据应有）
        const first = await getNodeConfigCached('caseMain')
        if (!first) {
            // 如果不存在则跳过
            console.warn('caseMain 节点不存在于测试库，跳过本断言')
            return
        }
        const second = await getNodeConfigCached('caseMain')
        expect(second).toBe(first)   // 同一引用，证明缓存命中
    })

    it('invalidateNodeConfigCache 清单条', async () => {
        const first = await getNodeConfigCached('caseMain')
        if (!first) return
        invalidateNodeConfigCache('caseMain')
        const second = await getNodeConfigCached('caseMain')
        expect(second).not.toBe(first)   // 缓存失效，重新加载（即使内容一样，对象引用不同）
    })

    it('invalidateNodeConfigCache 不带参数清全部', async () => {
        await getNodeConfigCached('caseMain')
        invalidateNodeConfigCache()
        const after = await getNodeConfigCached('caseMain')
        // 应该重新打 DB
        expect(after).toBeDefined()
    })

    it('节点不存在时返回 null 且缓存 null', async () => {
        const fake = `__fake_node_${Date.now()}`
        const r1 = await getNodeConfigCached(fake)
        expect(r1).toBeNull()
        const r2 = await getNodeConfigCached(fake)
        expect(r2).toBeNull()   // 第二次仍 null（缓存了 null 节省 DB 查询）
    })
})

describe('nodeConfig.loader 多对多 prompts 装配', () => {
    const createdIds = {
        promptIds: [] as number[],
        nodeIds: [] as number[],
        modelIds: [] as number[],
        providerIds: [] as number[],
    }
    let nodeName: string
    let nodeId: number

    const generateTestId = () => `cfg_${Date.now()}_${randomUUID().slice(0, 8)}`

    beforeEach(async () => {
        _resetCacheForTests()
        const provider = await prisma.modelProviders.create({
            data: { name: `prov_${generateTestId()}`, baseUrl: 'https://api.test.com' },
        })
        createdIds.providerIds.push(provider.id)

        const model = await prisma.models.create({
            data: {
                name: `model_${generateTestId()}`,
                displayName: '装配测试模型',
                providerId: provider.id,
                modelType: 'chat',
                status: 1,
            },
        })
        createdIds.modelIds.push(model.id)

        nodeName = `node_${generateTestId()}`
        const node = await prisma.nodes.create({
            data: {
                name: nodeName,
                title: '装配测试节点',
                type: 'analysis',
                priority: 100,
                modelId: model.id,
                tools: [],
                status: 1,
            },
        })
        nodeId = node.id
        createdIds.nodeIds.push(node.id)

        const p1Name = `p1_${generateTestId()}`
        const p2Name = `p2_${generateTestId()}`
        const p1 = await prisma.prompts.create({
            data: { name: p1Name, content: 'A', type: 'system', status: 1, version: 'v1' },
        })
        const p2 = await prisma.prompts.create({
            data: { name: p2Name, content: 'B', type: 'system', status: 1, version: 'v1' },
        })
        createdIds.promptIds.push(p1.id, p2.id)

        // 阶段 F 改造：node_prompts 按业务身份 (name, type) 关联
        await prisma.node_prompts.create({
            data: { nodeId, promptName: p1Name, promptType: 'system', displayOrder: 200 },
        })
        await prisma.node_prompts.create({
            data: { nodeId, promptName: p2Name, promptType: 'system', displayOrder: 100 },
        })
    })

    afterEach(async () => {
        _resetCacheForTests()
        if (createdIds.nodeIds.length > 0) {
            await prisma.node_prompts.deleteMany({ where: { nodeId: { in: createdIds.nodeIds } } })
            await prisma.nodes.deleteMany({ where: { id: { in: createdIds.nodeIds } } })
        }
        if (createdIds.promptIds.length > 0) {
            await prisma.prompts.deleteMany({ where: { id: { in: createdIds.promptIds } } })
        }
        if (createdIds.modelIds.length > 0) {
            await prisma.models.deleteMany({ where: { id: { in: createdIds.modelIds } } })
        }
        if (createdIds.providerIds.length > 0) {
            await prisma.modelProviders.deleteMany({ where: { id: { in: createdIds.providerIds } } })
        }
        createdIds.promptIds = []
        createdIds.nodeIds = []
        createdIds.modelIds = []
        createdIds.providerIds = []
    })

    it('按 displayOrder 升序返回多 prompts', async () => {
        const cfg = await getNodeConfigService(nodeName)
        expect(cfg).not.toBeNull()
        expect(cfg!.prompts).toHaveLength(2)
        expect(cfg!.prompts[0]!.content).toBe('B')   // displayOrder=100 在前
        expect(cfg!.prompts[1]!.content).toBe('A')   // displayOrder=200 在后
        expect(cfg!.prompts[0]!.displayOrder).toBe(100)
        expect(cfg!.prompts[1]!.displayOrder).toBe(200)
    })
})
