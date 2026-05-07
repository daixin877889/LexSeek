/**
 * 多 prompt 端到端装配测试
 *
 * **Feature: prompts-multi-node**
 * **Validates: Phase 3 Task 3.4 — DAO + service 映射 + promptRenderer 整链**
 *
 * 场景：节点关联两段 system prompt（反越狱护栏 displayOrder=10、persona displayOrder=100），
 * 期望 renderSystemPrompt 拼装为「护栏 → persona」的顺序，段落间空行分隔。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma } from '~~/server/utils/db'
import { getNodeConfigService } from '~~/server/services/node/node.service'
import { renderSystemPrompt } from '~~/server/services/agent-platform/nodeConfig/promptRenderer'

const generateTestId = () => `e2e_${Date.now()}_${randomUUID().slice(0, 8)}`

const createdIds = {
    promptIds: [] as number[],
    nodeIds: [] as number[],
    modelIds: [] as number[],
    providerIds: [] as number[],
}

describe('多 prompt 端到端装配', () => {
    let nodeName: string
    let nodeId: number

    beforeEach(async () => {
        const provider = await prisma.modelProviders.create({
            data: { name: `prov_${generateTestId()}`, baseUrl: 'https://api.test.com' },
        })
        createdIds.providerIds.push(provider.id)

        const model = await prisma.models.create({
            data: {
                name: `model_${generateTestId()}`,
                displayName: 'E2E 装配模型',
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
                title: 'E2E 装配节点',
                type: 'analysis',
                priority: 100,
                modelId: model.id,
                tools: [],
                status: 1,
            },
        })
        nodeId = node.id
        createdIds.nodeIds.push(node.id)

        const guard = await prisma.prompts.create({
            data: {
                name: `guard_${generateTestId()}`,
                content: '反越狱护栏内容',
                type: 'system',
                status: 1,
                version: 'v1',
            },
        })
        const persona = await prisma.prompts.create({
            data: {
                name: `persona_${generateTestId()}`,
                content: '你是 LexSeek',
                type: 'system',
                status: 1,
                version: 'v1',
            },
        })
        createdIds.promptIds.push(guard.id, persona.id)

        // 护栏 displayOrder=10（最前），persona=100
        await prisma.node_prompts.create({
            data: { nodeId, promptId: guard.id, displayOrder: 10 },
        })
        await prisma.node_prompts.create({
            data: { nodeId, promptId: persona.id, displayOrder: 100 },
        })
    })

    afterEach(async () => {
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

    it('护栏在前，persona 在后，段落空行分隔', async () => {
        const cfg = await getNodeConfigService(nodeName)
        expect(cfg).not.toBeNull()
        expect(cfg!.prompts).toHaveLength(2)
        const raw = renderSystemPrompt(cfg!, {})
        expect(raw.indexOf('反越狱护栏内容')).toBeLessThan(raw.indexOf('你是 LexSeek'))
        expect(raw).toBe('反越狱护栏内容\n\n你是 LexSeek')
    })

    it('每段 prompt 在 cfg.prompts 中带 displayOrder 字段', async () => {
        const cfg = await getNodeConfigService(nodeName)
        expect(cfg!.prompts[0]!.displayOrder).toBe(10)
        expect(cfg!.prompts[1]!.displayOrder).toBe(100)
    })
})
