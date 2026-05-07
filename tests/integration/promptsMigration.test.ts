/**
 * 数据迁移脚本集成测试：把 prompts.nodeId 单值搬到 node_prompts 多对多表
 *
 * **Feature: prompts-multi-node**
 * **Validates: Phase 2（Task 2.1 + 2.2）**
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '~~/server/utils/db'
import { migrateNodePrompts } from '~~/server/scripts/migrateNodePrompts'

const generateTestId = () => `mig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

const createdIds = {
    promptIds: [] as number[],
    nodeIds: [] as number[],
    modelIds: [] as number[],
    providerIds: [] as number[],
}

const createTestModel = async () => {
    const provider = await prisma.modelProviders.create({
        data: { name: `prov_${generateTestId()}`, baseUrl: 'https://api.test.com' },
    })
    createdIds.providerIds.push(provider.id)
    const model = await prisma.models.create({
        data: {
            name: `model_${generateTestId()}`,
            displayName: '迁移测试模型',
            providerId: provider.id,
            modelType: 'chat',
            status: 1,
        },
    })
    createdIds.modelIds.push(model.id)
    return model
}

const createTestNode = async () => {
    const model = await createTestModel()
    const node = await prisma.nodes.create({
        data: {
            name: `node_${generateTestId()}`,
            title: '迁移测试节点',
            type: 'analysis',
            priority: 100,
            modelId: model.id,
            tools: [],
            status: 1,
        },
    })
    createdIds.nodeIds.push(node.id)
    return node
}

describe('migrateNodePrompts 数据迁移脚本', () => {
    beforeEach(async () => {
        // 清空之前残留的关联，保证幂等测试干净
        await prisma.node_prompts.deleteMany({})
    })

    afterEach(async () => {
        // 反向清理：先删叶表，再删父表
        if (createdIds.promptIds.length > 0) {
            await prisma.node_prompts.deleteMany({ where: { promptId: { in: createdIds.promptIds } } })
            await prisma.prompts.deleteMany({ where: { id: { in: createdIds.promptIds } } })
        }
        if (createdIds.nodeIds.length > 0) {
            await prisma.node_prompts.deleteMany({ where: { nodeId: { in: createdIds.nodeIds } } })
            await prisma.nodes.deleteMany({ where: { id: { in: createdIds.nodeIds } } })
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

    it('为每条带 nodeId 的 prompts 创建一条 node_prompts 关联（displayOrder 默认 100）', async () => {
        const node = await createTestNode()
        const prompt = await prisma.prompts.create({
            data: {
                name: `p_${generateTestId()}`,
                content: 'hello',
                type: 'system',
                status: 1,
                version: 'v1',
                nodeId: node.id,
            },
        })
        createdIds.promptIds.push(prompt.id)

        await migrateNodePrompts()

        const link = await prisma.node_prompts.findUnique({
            where: { nodeId_promptId: { nodeId: node.id, promptId: prompt.id } },
        })
        expect(link).not.toBeNull()
        expect(link?.displayOrder).toBe(100)
    })

    it('幂等可重跑：同一关联第二次执行不抛唯一约束错', async () => {
        const node = await createTestNode()
        const prompt = await prisma.prompts.create({
            data: {
                name: `p_${generateTestId()}`,
                content: 'x',
                type: 'system',
                status: 1,
                version: 'v1',
                nodeId: node.id,
            },
        })
        createdIds.promptIds.push(prompt.id)

        await migrateNodePrompts()
        await expect(migrateNodePrompts()).resolves.not.toThrow()

        const links = await prisma.node_prompts.findMany({
            where: { nodeId: node.id, promptId: prompt.id },
        })
        expect(links).toHaveLength(1)
    })

    it('迁移后 node_prompts 行数 ≥ 含 nodeId 的旧 prompts 行数', async () => {
        // 测试库中可能已经有种子数据 prompts，至少要保证脚本能完整覆盖
        const promptsWithNodeIdCount = await prisma.prompts.count({
            where: { nodeId: { not: null } },
        })

        await migrateNodePrompts()

        const linksCount = await prisma.node_prompts.count()
        expect(linksCount).toBeGreaterThanOrEqual(promptsWithNodeIdCount)
    })
})
