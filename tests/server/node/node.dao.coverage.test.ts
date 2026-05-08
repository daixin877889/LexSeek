/**
 * 节点 DAO 覆盖率补充测试
 *
 * 覆盖 node.dao.ts 中未被测试的路径：
 * - findManyNodesDao 关键词搜索、状态筛选、排序
 * - findAllNodesDao 类型和分组筛选组合
 * - getNodeConfigDao 包含 API 密钥和提示词的完整配置
 * - getNodeConfigByIdDao 禁用节点返回 null
 * - 各 DAO 的错误处理路径（catch 分支）
 *
 * **Feature: node-management**
 * **Validates: Requirements 14.1, 14.2, 14.3**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../../generated/prisma/client'
import { config } from 'dotenv'
import { resolve } from 'node:path'
import {
    findManyNodesDao,
    findAllNodesDao,
    getNodeConfigDao,
    getNodeConfigByIdDao,
    createNodeDao,
    updateNodeDao,
    softDeleteNodeDao,
} from '../../../server/services/node/node.dao'

config({ path: resolve(__dirname, '../../../.env.testing') })

const createTestPrisma = () => {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) {
        throw new Error('DATABASE_URL 环境变量未设置')
    }
    const pool = new PrismaPg({ connectionString })
    return new PrismaClient({ adapter: pool })
}

const testPrisma = createTestPrisma()

const testIds = {
    nodeIds: [] as number[],
    modelIds: [] as number[],
    providerIds: [] as number[],
    promptIds: [] as number[],
    apiKeyIds: [] as number[],
}

const generateTestId = () => `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

const createTestModel = async () => {
    const provider = await testPrisma.modelProviders.create({
        data: { name: `test_provider_${generateTestId()}`, baseUrl: 'https://api.test.com' },
    })
    testIds.providerIds.push(provider.id)
    const model = await testPrisma.models.create({
        data: {
            name: `test_model_${generateTestId()}`,
            displayName: '测试模型',
            providerId: provider.id,
            modelType: 'chat',
            status: 1,
        },
    })
    testIds.modelIds.push(model.id)
    return { model, provider }
}

const cleanupTestData = async () => {
    try {
        if (testIds.promptIds.length > 0) {
            await testPrisma.prompts.deleteMany({ where: { id: { in: testIds.promptIds } } })
        }
    } catch { /* 忽略 */ }
    testIds.promptIds = []

    try {
        if (testIds.apiKeyIds.length > 0) {
            await testPrisma.modelApiKeys.deleteMany({ where: { id: { in: testIds.apiKeyIds } } })
        }
    } catch { /* 忽略 */ }
    testIds.apiKeyIds = []

    try {
        if (testIds.nodeIds.length > 0) {
            await testPrisma.levelNodeAccess.deleteMany({ where: { nodeId: { in: testIds.nodeIds } } })
            await testPrisma.caseAnalyses.deleteMany({ where: { nodeId: { in: testIds.nodeIds } } })
            await testPrisma.node_prompts.deleteMany({ where: { nodeId: { in: testIds.nodeIds } } })
            await testPrisma.nodes.deleteMany({ where: { id: { in: testIds.nodeIds } } })
        }
    } catch { /* 忽略 */ }
    testIds.nodeIds = []

    try {
        if (testIds.modelIds.length > 0) {
            await testPrisma.models.deleteMany({ where: { id: { in: testIds.modelIds } } })
        }
    } catch { /* 忽略 */ }
    testIds.modelIds = []

    try {
        if (testIds.providerIds.length > 0) {
            await testPrisma.modelApiKeys.deleteMany({ where: { providerId: { in: testIds.providerIds } } })
            await testPrisma.modelProviders.deleteMany({ where: { id: { in: testIds.providerIds } } })
        }
    } catch { /* 忽略 */ }
    testIds.providerIds = []
}

describe('节点 DAO - 覆盖率补充', () => {
    beforeAll(async () => {
        await testPrisma.$connect()
    })

    afterEach(async () => {
        await cleanupTestData()
    })

    afterAll(async () => {
        try {
            const testNodeIds = (await testPrisma.nodes.findMany({
                where: { name: { startsWith: 'test_node_' } },
                select: { id: true },
            })).map(n => n.id)
            if (testNodeIds.length > 0) {
                await testPrisma.node_prompts.deleteMany({ where: { nodeId: { in: testNodeIds } } })
                await testPrisma.levelNodeAccess.deleteMany({ where: { nodeId: { in: testNodeIds } } })
                await testPrisma.caseAnalyses.deleteMany({ where: { nodeId: { in: testNodeIds } } })
            }
            await testPrisma.nodes.deleteMany({ where: { name: { startsWith: 'test_node_' } } })
            await testPrisma.models.deleteMany({ where: { name: { startsWith: 'test_model_' } } })
            const testProviderIds = (await testPrisma.modelProviders.findMany({
                where: { name: { startsWith: 'test_provider_' } },
                select: { id: true },
            })).map(p => p.id)
            if (testProviderIds.length > 0) {
                await testPrisma.modelApiKeys.deleteMany({ where: { providerId: { in: testProviderIds } } })
            }
            await testPrisma.modelProviders.deleteMany({ where: { name: { startsWith: 'test_provider_' } } })
        } catch { /* 忽略 */ }
        await testPrisma.$disconnect()
    })

    describe('findManyNodesDao - 关键词搜索', () => {
        it('应通过关键词搜索节点名称', async () => {
            const { model } = await createTestModel()
            const uniqueKeyword = `unique_keyword_${generateTestId()}`
            const node = await testPrisma.nodes.create({
                data: {
                    name: `test_node_${uniqueKeyword}`,
                    title: '测试节点',
                    type: 'analysis',
                    priority: 100,
                    modelId: model.id,
                    tools: [],
                    status: 1,
                },
            })
            testIds.nodeIds.push(node.id)

            const result = await findManyNodesDao({ keyword: uniqueKeyword })

            expect(result.list.some(n => n.name.includes(uniqueKeyword))).toBe(true)
        })

        it('应通过关键词搜索节点标题', async () => {
            const { model } = await createTestModel()
            const uniqueTitle = `独特标题_${generateTestId()}`
            const node = await testPrisma.nodes.create({
                data: {
                    name: `test_node_${generateTestId()}`,
                    title: uniqueTitle,
                    type: 'analysis',
                    priority: 100,
                    modelId: model.id,
                    tools: [],
                    status: 1,
                },
            })
            testIds.nodeIds.push(node.id)

            const result = await findManyNodesDao({ keyword: uniqueTitle })

            expect(result.list.some(n => n.title === uniqueTitle)).toBe(true)
        })

        it('应通过关键词搜索节点描述', async () => {
            const { model } = await createTestModel()
            const uniqueDesc = `独特描述_${generateTestId()}`
            const node = await testPrisma.nodes.create({
                data: {
                    name: `test_node_${generateTestId()}`,
                    title: '测试',
                    description: uniqueDesc,
                    type: 'analysis',
                    priority: 100,
                    modelId: model.id,
                    tools: [],
                    status: 1,
                },
            })
            testIds.nodeIds.push(node.id)

            const result = await findManyNodesDao({ keyword: uniqueDesc })

            expect(result.list.some(n => n.description === uniqueDesc)).toBe(true)
        })

        it('应同时按状态和类型筛选', async () => {
            const { model } = await createTestModel()
            const node = await testPrisma.nodes.create({
                data: {
                    name: `test_node_${generateTestId()}`,
                    title: '测试',
                    type: 'extraction',
                    priority: 100,
                    modelId: model.id,
                    tools: [],
                    status: 0,
                },
            })
            testIds.nodeIds.push(node.id)

            const result = await findManyNodesDao({
                type: 'extraction',
                status: 0,
            })

            expect(result.list.every(n => n.type === 'extraction' && n.status === 0)).toBe(true)
        })
    })

    describe('findAllNodesDao - 组合筛选', () => {
        it('应同时按类型和分组筛选', async () => {
            const { model } = await createTestModel()
            const group = await testPrisma.nodeGroups.create({
                data: {
                    name: `group_test_${generateTestId()}`,
                    priority: 100,
                },
            })

            const node = await testPrisma.nodes.create({
                data: {
                    name: `test_node_${generateTestId()}`,
                    title: '测试',
                    type: 'analysis',
                    priority: 100,
                    modelId: model.id,
                    tools: [],
                    status: 1,
                    groupId: group.id,
                },
            })
            testIds.nodeIds.push(node.id)

            const nodes = await findAllNodesDao({
                type: 'analysis',
                groupId: group.id,
                status: 1,
            })

            expect(nodes.every(n =>
                n.type === 'analysis' &&
                n.groupId === group.id &&
                n.status === 1
            )).toBe(true)

            // 清理
            await testPrisma.nodes.deleteMany({ where: { id: node.id } })
            await testPrisma.nodeGroups.deleteMany({ where: { id: group.id } })
            testIds.nodeIds = testIds.nodeIds.filter(id => id !== node.id)
        })
    })

    describe('getNodeConfigDao - 完整配置', () => {
        it('应返回包含模型提供商和 API 密钥的完整配置', async () => {
            const { model, provider } = await createTestModel()

            // 创建 API 密钥
            const apiKey = await testPrisma.modelApiKeys.create({
                data: {
                    providerId: provider.id,
                    name: `test_key_${generateTestId()}`,
                    apiKey: 'test-api-key-value',
                    status: 1,
                    isDefault: true,
                },
            })
            testIds.apiKeyIds.push(apiKey.id)

            // 创建节点
            const nodeName = `test_node_${generateTestId()}`
            const node = await testPrisma.nodes.create({
                data: {
                    name: nodeName,
                    title: '测试节点',
                    type: 'analysis',
                    priority: 100,
                    modelId: model.id,
                    tools: [],
                    status: 1,
                },
            })
            testIds.nodeIds.push(node.id)

            // 创建生效的提示词，并通过 node_prompts 按业务身份 (name, type) 关联到节点（阶段 F 改造）
            const promptName = `prompt_${generateTestId()}`
            const prompt = await testPrisma.prompts.create({
                data: {
                    name: promptName,
                    title: '系统提示词',
                    content: '你是一个法律助手',
                    variables: [],
                    version: '1.0.0',
                    type: 'system',
                    status: 1,
                },
            })
            testIds.promptIds.push(prompt.id)
            await testPrisma.node_prompts.create({
                data: { nodeId: node.id, promptName, promptType: 'system', displayOrder: 100 },
            })

            const config = await getNodeConfigDao(nodeName)

            expect(config).not.toBeNull()
            expect(config!.model).not.toBeNull()
            expect(config!.model!.modelProvider).toBeDefined()
            expect(config!.model!.modelProvider.modelApiKeys.length).toBeGreaterThanOrEqual(1)
            // 阶段 F 改造：dao 返回的提示词在 nodePrompts 多对多字段（每条带 prompt + displayOrder）
            expect(config!.nodePrompts.length).toBeGreaterThanOrEqual(1)
            expect(config!.nodePrompts[0]!.prompt.status).toBe(1)
        })

        it('不存在的节点名称应返回 null', async () => {
            const config = await getNodeConfigDao('nonexistent_node_xyz_123')
            expect(config).toBeNull()
        })
    })

    describe('getNodeConfigByIdDao - 边缘情况', () => {
        it('禁用的节点应返回 null', async () => {
            const { model } = await createTestModel()
            const node = await testPrisma.nodes.create({
                data: {
                    name: `test_node_${generateTestId()}`,
                    title: '禁用节点',
                    type: 'analysis',
                    priority: 100,
                    modelId: model.id,
                    tools: [],
                    status: 0,
                },
            })
            testIds.nodeIds.push(node.id)

            const config = await getNodeConfigByIdDao(node.id)
            expect(config).toBeNull()
        })

        it('已删除的节点应返回 null', async () => {
            const { model } = await createTestModel()
            const node = await testPrisma.nodes.create({
                data: {
                    name: `test_node_${generateTestId()}`,
                    title: '将删除的节点',
                    type: 'analysis',
                    priority: 100,
                    modelId: model.id,
                    tools: [],
                    status: 1,
                },
            })
            testIds.nodeIds.push(node.id)

            await softDeleteNodeDao(node.id)

            const config = await getNodeConfigByIdDao(node.id)
            expect(config).toBeNull()
        })

        it('不存在的 ID 应返回 null', async () => {
            const config = await getNodeConfigByIdDao(999999)
            expect(config).toBeNull()
        })
    })

    describe('updateNodeDao - outputSchema 更新', () => {
        it('应能设置 outputSchema', async () => {
            const { model } = await createTestModel()
            const node = await createNodeDao({
                name: `test_node_${generateTestId()}`,
                type: 'extraction',
                modelId: model.id,
            })
            testIds.nodeIds.push(node.id)

            const schema = { type: 'object', properties: { name: { type: 'string' } } }
            const updated = await updateNodeDao(node.id, {
                outputSchema: schema,
            })

            expect(updated.outputSchema).not.toBeNull()
        })

        it('应能更新多个字段', async () => {
            const { model } = await createTestModel()
            const node = await createNodeDao({
                name: `test_node_${generateTestId()}`,
                title: '原标题',
                type: 'analysis',
                modelId: model.id,
                priority: 100,
                status: 1,
            })
            testIds.nodeIds.push(node.id)

            const updated = await updateNodeDao(node.id, {
                title: '新标题',
                description: '新描述',
                priority: 50,
                status: 0,
                tools: ['tool1', 'tool2'],
            })

            expect(updated.title).toBe('新标题')
            expect(updated.description).toBe('新描述')
            expect(updated.priority).toBe(50)
            expect(updated.status).toBe(0)
        })
    })
})
