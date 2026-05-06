/**
 * 提示词 DAO 测试
 *
 * **Feature: node-management**
 * **Validates: Requirements 14.9, 14.10, 14.11, 14.12, 14.13, 14.14**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../../generated/prisma/client'
import { config } from 'dotenv'
import { resolve } from 'node:path'
import {
    createPromptDao,
    findPromptByIdDao,
    findManyPromptsDao,
    findPromptsByNodeIdDao,
    findActivePromptDao,
    findPromptVersionsDao,
    getLatestVersionDao,
    updatePromptDao,
    updatePromptStatusDao,
    deactivatePromptsByTypeDao,
    softDeletePromptDao,
} from '../../../server/services/node/prompt.dao'

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
    promptIds: [] as number[],
    modelIds: [] as number[],
    providerIds: [] as number[],
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
    return model
}

const createTestNode = async (modelId: number) => {
    const node = await testPrisma.nodes.create({
        data: {
            name: `test_node_${generateTestId()}`,
            title: '测试节点',
            type: 'analysis',
            priority: 100,
            modelId,
            tools: [],
            status: 1,
        },
    })
    testIds.nodeIds.push(node.id)
    return node
}

const cleanupTestData = async () => {
    try {
        if (testIds.promptIds.length > 0) {
            await testPrisma.prompts.deleteMany({ where: { id: { in: testIds.promptIds } } })
        }
    } catch { /* 忽略 */ }
    testIds.promptIds = []

    try {
        if (testIds.nodeIds.length > 0) {
            await testPrisma.prompts.deleteMany({ where: { nodeId: { in: testIds.nodeIds } } })
            await testPrisma.levelNodeAccess.deleteMany({ where: { nodeId: { in: testIds.nodeIds } } })
            await testPrisma.caseAnalyses.deleteMany({ where: { nodeId: { in: testIds.nodeIds } } })
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

describe('提示词 DAO 测试', () => {
    beforeAll(async () => {
        await testPrisma.$connect()
    })

    afterEach(async () => {
        await cleanupTestData()
    })

    afterAll(async () => {
        // 全局清理
        try {
            const testNodeIds = (await testPrisma.nodes.findMany({
                where: { name: { startsWith: 'test_node_' } },
                select: { id: true },
            })).map(n => n.id)
            if (testNodeIds.length > 0) {
                await testPrisma.prompts.deleteMany({ where: { nodeId: { in: testNodeIds } } })
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

    describe('createPromptDao', () => {
        it('应创建提示词', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)

            const prompt = await createPromptDao({
                name: `prompt_${generateTestId()}`,
                title: '测试提示词',
                content: '你是一个法律助手',
                type: 'system',
                nodeId: node.id,
            }, '1.0.0')
            testIds.promptIds.push(prompt.id)

            expect(prompt.id).toBeDefined()
            expect(prompt.version).toBe('1.0.0')
            expect(prompt.status).toBe(0) // 默认未生效
            expect(prompt.node).toBeDefined()
        })

        it('应创建带变量的提示词', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)

            const prompt = await createPromptDao({
                name: `prompt_${generateTestId()}`,
                title: '带变量提示词',
                content: '分析 {{case_name}} 的 {{topic}}',
                variables: ['case_name', 'topic'],
                type: 'system',
                nodeId: node.id,
            }, '1.0.0')
            testIds.promptIds.push(prompt.id)

            expect(prompt.variables).toEqual(['case_name', 'topic'])
        })
    })

    describe('findPromptByIdDao', () => {
        it('应返回存在的提示词', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)
            const prompt = await createPromptDao({
                name: `prompt_${generateTestId()}`,
                title: '测试',
                content: '内容',
                type: 'system',
                nodeId: node.id,
            }, '1.0.0')
            testIds.promptIds.push(prompt.id)

            const found = await findPromptByIdDao(prompt.id)
            expect(found).not.toBeNull()
            expect(found!.id).toBe(prompt.id)
        })

        it('不存在的 ID 应返回 null', async () => {
            const found = await findPromptByIdDao(999999)
            expect(found).toBeNull()
        })

        it('已删除的提示词应返回 null', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)
            const prompt = await createPromptDao({
                name: `prompt_${generateTestId()}`,
                title: '测试',
                content: '内容',
                type: 'system',
                nodeId: node.id,
            }, '1.0.0')
            testIds.promptIds.push(prompt.id)

            await softDeletePromptDao(prompt.id)

            const found = await findPromptByIdDao(prompt.id)
            expect(found).toBeNull()
        })
    })

    describe('findManyPromptsDao', () => {
        it('应返回分页的提示词列表', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)

            await createPromptDao({
                name: `prompt_${generateTestId()}`,
                title: '提示词1',
                content: '内容1',
                type: 'system',
                nodeId: node.id,
            }, '1.0.0').then(p => testIds.promptIds.push(p.id))

            await createPromptDao({
                name: `prompt_${generateTestId()}`,
                title: '提示词2',
                content: '内容2',
                type: 'user',
                nodeId: node.id,
            }, '1.0.0').then(p => testIds.promptIds.push(p.id))

            const result = await findManyPromptsDao({ nodeId: node.id })
            expect(result.total).toBe(2)
            expect(result.list.length).toBe(2)
        })

        it('关键词搜索应正确过滤', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)
            const uniqueName = `unique_prompt_${generateTestId()}`

            await createPromptDao({
                name: uniqueName,
                title: '独特提示词',
                content: '内容',
                type: 'system',
                nodeId: node.id,
            }, '1.0.0').then(p => testIds.promptIds.push(p.id))

            const result = await findManyPromptsDao({ keyword: uniqueName })
            expect(result.list.some(p => p.name === uniqueName)).toBe(true)
        })

        it('类型筛选应正确过滤', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)

            await createPromptDao({
                name: `prompt_${generateTestId()}`,
                title: 'system 提示词',
                content: '内容',
                type: 'system',
                nodeId: node.id,
            }, '1.0.0').then(p => testIds.promptIds.push(p.id))

            const result = await findManyPromptsDao({
                nodeId: node.id,
                type: 'system',
            })
            expect(result.list.every(p => p.type === 'system')).toBe(true)
        })

        it('状态筛选应正确过滤', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)

            const prompt = await createPromptDao({
                name: `prompt_${generateTestId()}`,
                title: '活跃提示词',
                content: '内容',
                type: 'system',
                nodeId: node.id,
            }, '1.0.0')
            testIds.promptIds.push(prompt.id)

            await updatePromptStatusDao(prompt.id, 1)

            const result = await findManyPromptsDao({
                nodeId: node.id,
                status: 1,
            })
            expect(result.list.every(p => p.status === 1)).toBe(true)
        })
    })

    describe('findPromptsByNodeIdDao', () => {
        it('应返回节点的所有提示词', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)

            await createPromptDao({
                name: `prompt_${generateTestId()}`,
                title: 'p1',
                content: 'c1',
                type: 'system',
                nodeId: node.id,
            }, '1.0.0').then(p => testIds.promptIds.push(p.id))

            await createPromptDao({
                name: `prompt_${generateTestId()}`,
                title: 'p2',
                content: 'c2',
                type: 'user',
                nodeId: node.id,
            }, '1.0.0').then(p => testIds.promptIds.push(p.id))

            const prompts = await findPromptsByNodeIdDao(node.id)
            expect(prompts.length).toBe(2)
        })
    })

    describe('findActivePromptDao', () => {
        it('应返回生效的提示词', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)

            const prompt = await createPromptDao({
                name: `prompt_${generateTestId()}`,
                title: '活跃提示词',
                content: '内容',
                type: 'system',
                nodeId: node.id,
            }, '1.0.0')
            testIds.promptIds.push(prompt.id)

            await updatePromptStatusDao(prompt.id, 1)

            const found = await findActivePromptDao(node.id, 'system')
            expect(found).not.toBeNull()
            expect(found!.id).toBe(prompt.id)
        })

        it('无生效提示词应返回 null', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)

            await createPromptDao({
                name: `prompt_${generateTestId()}`,
                title: '未生效',
                content: '内容',
                type: 'system',
                nodeId: node.id,
            }, '1.0.0').then(p => testIds.promptIds.push(p.id))

            const found = await findActivePromptDao(node.id, 'system')
            expect(found).toBeNull()
        })
    })

    describe('findPromptVersionsDao', () => {
        it('应返回提示词版本历史（降序）', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)
            const promptName = `prompt_${generateTestId()}`

            await createPromptDao({
                name: promptName,
                title: '版本1',
                content: '内容v1',
                type: 'system',
                nodeId: node.id,
            }, '1.0.0').then(p => testIds.promptIds.push(p.id))

            await createPromptDao({
                name: promptName,
                title: '版本2',
                content: '内容v2',
                type: 'system',
                nodeId: node.id,
            }, '2.0.0').then(p => testIds.promptIds.push(p.id))

            const versions = await findPromptVersionsDao(node.id, promptName, 'system')
            expect(versions.length).toBe(2)
            expect(versions[0].version).toBe('2.0.0')
            expect(versions[1].version).toBe('1.0.0')
        })
    })

    describe('getLatestVersionDao', () => {
        it('应返回最新版本号', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)
            const promptName = `prompt_${generateTestId()}`

            await createPromptDao({
                name: promptName,
                title: 'v1',
                content: 'c1',
                type: 'system',
                nodeId: node.id,
            }, '1.0.0').then(p => testIds.promptIds.push(p.id))

            await createPromptDao({
                name: promptName,
                title: 'v2',
                content: 'c2',
                type: 'system',
                nodeId: node.id,
            }, '2.0.0').then(p => testIds.promptIds.push(p.id))

            const version = await getLatestVersionDao(node.id, promptName, 'system')
            expect(version).toBe('2.0.0')
        })

        it('无记录时返回 null', async () => {
            const version = await getLatestVersionDao(999999, 'nonexistent', 'system')
            expect(version).toBeNull()
        })

        it('v\\d+ 版本号需按数字大小取最新（v10 > v9，避免字典序卡死）', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)
            const promptName = `prompt_${generateTestId()}`

            for (let i = 1; i <= 10; i++) {
                const created = await createPromptDao({
                    name: promptName,
                    title: `版本v${i}`,
                    content: `内容 v${i}`,
                    type: 'system',
                    nodeId: node.id,
                }, `v${i}`)
                testIds.promptIds.push(created.id)
            }

            const latest = await getLatestVersionDao(node.id, promptName, 'system')
            expect(latest).toBe('v10')

            const versions = await findPromptVersionsDao(node.id, promptName, 'system')
            expect(versions.map(v => v.version)).toEqual([
                'v10', 'v9', 'v8', 'v7', 'v6', 'v5', 'v4', 'v3', 'v2', 'v1',
            ])
        })
    })

    describe('updatePromptDao', () => {
        it('应更新提示词内容', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)
            const prompt = await createPromptDao({
                name: `prompt_${generateTestId()}`,
                title: '旧标题',
                content: '旧内容',
                type: 'system',
                nodeId: node.id,
            }, '1.0.0')
            testIds.promptIds.push(prompt.id)

            const updated = await updatePromptDao(prompt.id, {
                title: '新标题',
                content: '新内容',
                variables: ['var1'],
            })

            expect(updated.title).toBe('新标题')
            expect(updated.content).toBe('新内容')
            expect(updated.variables).toEqual(['var1'])
        })

        it('部分更新应只修改指定字段', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)
            const prompt = await createPromptDao({
                name: `prompt_${generateTestId()}`,
                title: '标题',
                content: '内容',
                type: 'system',
                nodeId: node.id,
            }, '1.0.0')
            testIds.promptIds.push(prompt.id)

            const updated = await updatePromptDao(prompt.id, {
                title: '新标题',
            })

            expect(updated.title).toBe('新标题')
            expect(updated.content).toBe('内容') // 未修改
        })
    })

    describe('updatePromptStatusDao', () => {
        it('应更新提示词状态', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)
            const prompt = await createPromptDao({
                name: `prompt_${generateTestId()}`,
                title: '标题',
                content: '内容',
                type: 'system',
                nodeId: node.id,
            }, '1.0.0')
            testIds.promptIds.push(prompt.id)

            const updated = await updatePromptStatusDao(prompt.id, 1)
            expect(updated.status).toBe(1)
        })
    })

    describe('deactivatePromptsByTypeDao', () => {
        it('应停用指定类型的所有生效提示词', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)

            const p1 = await createPromptDao({
                name: `prompt_${generateTestId()}`,
                title: 'p1',
                content: 'c1',
                type: 'system',
                nodeId: node.id,
            }, '1.0.0')
            testIds.promptIds.push(p1.id)
            await updatePromptStatusDao(p1.id, 1)

            const p2 = await createPromptDao({
                name: `prompt_${generateTestId()}`,
                title: 'p2',
                content: 'c2',
                type: 'system',
                nodeId: node.id,
            }, '2.0.0')
            testIds.promptIds.push(p2.id)
            await updatePromptStatusDao(p2.id, 1)

            await deactivatePromptsByTypeDao(node.id, 'system')

            const active = await findActivePromptDao(node.id, 'system')
            expect(active).toBeNull()
        })
    })

    describe('softDeletePromptDao', () => {
        it('应软删除提示词', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)
            const prompt = await createPromptDao({
                name: `prompt_${generateTestId()}`,
                title: '标题',
                content: '内容',
                type: 'system',
                nodeId: node.id,
            }, '1.0.0')
            testIds.promptIds.push(prompt.id)

            await softDeletePromptDao(prompt.id)

            const found = await findPromptByIdDao(prompt.id)
            expect(found).toBeNull()
        })
    })
})
