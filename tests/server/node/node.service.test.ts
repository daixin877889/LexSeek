/**
 * 节点服务测试
 *
 * **Feature: node-management**
 * **Validates: Requirements 14.1, 14.2, 14.3, 14.4, 14.6, 14.7, 14.8, 14.9**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../../generated/prisma/client'
import { config } from 'dotenv'
import { resolve } from 'node:path'
import {
    createNodeGroupService,
    getNodeGroupByIdService,
    getNodeGroupsService,
    getAllNodeGroupsService,
    updateNodeGroupService,
    deleteNodeGroupService,
    createNodeService,
    getNodeByIdService,
    getNodeByNameService,
    getNodesService,
    getAllNodesService,
    getNodesByGroupIdService,
    updateNodeService,
    updateNodeStatusService,
    deleteNodeService,
    batchUpdateNodeGroupService,
} from '../../../server/services/node/node.service'

config({ path: resolve(__dirname, '../../../.env.testing') })

// 创建测试数据库连接
const createTestPrisma = () => {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) {
        throw new Error('DATABASE_URL 环境变量未设置')
    }
    const pool = new PrismaPg({ connectionString })
    return new PrismaClient({ adapter: pool })
}

const testPrisma = createTestPrisma()

// 测试数据 ID 追踪
const testIds = {
    groupIds: [] as number[],
    nodeIds: [] as number[],
    modelIds: [] as number[],
    providerIds: [] as number[],
}

const generateTestId = () => `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

// 创建测试模型（每个测试使用独立的 provider）
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
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    testIds.modelIds.push(model.id)
    return model
}

// 创建测试节点分组
const createTestGroup = async () => {
    const group = await testPrisma.nodeGroups.create({
        data: {
            name: `测试分组_${generateTestId()}`,
            description: '测试分组描述',
            priority: 100,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    testIds.groupIds.push(group.id)
    return group
}

// 创建测试节点
const createTestNode = async (modelId: number, groupId?: number) => {
    const node = await testPrisma.nodes.create({
        data: {
            name: `test_node_${generateTestId()}`,
            title: '测试节点',
            description: '测试用节点',
            type: 'analysis',
            priority: 100,
            modelId,
            tools: [],
            status: 1,
            groupId: groupId,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    testIds.nodeIds.push(node.id)
    return node
}

// 清理测试数据（按外键依赖顺序，每个步骤独立处理错误）
const cleanupTestData = async () => {
    // 先删除节点（解除 modelId 和 groupId 外键引用）
    try {
        if (testIds.nodeIds.length > 0) {
            await testPrisma.nodes.deleteMany({ where: { id: { in: testIds.nodeIds } } })
        }
    } catch { /* 忽略节点删除错误 */ }
    testIds.nodeIds = []
    // 再删除分组
    try {
        if (testIds.groupIds.length > 0) {
            await testPrisma.nodeGroups.deleteMany({ where: { id: { in: testIds.groupIds } } })
        }
    } catch { /* 忽略分组删除错误 */ }
    testIds.groupIds = []
    // 最后删除模型和 provider
    try {
        if (testIds.modelIds.length > 0) {
            await testPrisma.models.deleteMany({ where: { id: { in: testIds.modelIds } } })
        }
    } catch { /* 忽略模型删除错误 */ }
    testIds.modelIds = []
    try {
        if (testIds.providerIds.length > 0) {
            await testPrisma.modelApiKeys.deleteMany({ where: { providerId: { in: testIds.providerIds } } })
            await testPrisma.modelProviders.deleteMany({ where: { id: { in: testIds.providerIds } } })
        }
    } catch { /* 忽略 provider 删除错误 */ }
    testIds.providerIds = []
}

describe('节点服务测试', () => {
    beforeAll(async () => {
        await testPrisma.$connect()
        await testPrisma.$executeRaw`SELECT setval('node_groups_id_seq', GREATEST((SELECT MAX(id) FROM node_groups), 1000))`
        await testPrisma.$executeRaw`SELECT setval('nodes_id_seq', GREATEST((SELECT MAX(id) FROM nodes), 1000))`
        await testPrisma.$executeRaw`SELECT setval('models_id_seq', GREATEST((SELECT MAX(id) FROM models), 1000))`
    })

    afterEach(async () => {
        await cleanupTestData()
    })

    afterAll(async () => {
        // 按前缀做全局清理，覆盖 afterEach 中 testIds 未追踪到的残留数据
        try {
            const testNodeIds = (await testPrisma.nodes.findMany({ where: { name: { startsWith: 'test_node_' } }, select: { id: true } })).map(n => n.id)
            if (testNodeIds.length > 0) {
                await testPrisma.prompts.deleteMany({ where: { nodeId: { in: testNodeIds } } })
                await testPrisma.levelNodeAccess.deleteMany({ where: { nodeId: { in: testNodeIds } } })
                await testPrisma.caseAnalyses.deleteMany({ where: { nodeId: { in: testNodeIds } } })
            }
            await testPrisma.nodes.deleteMany({ where: { name: { startsWith: 'test_node_' } } })
            await testPrisma.nodeGroups.deleteMany({ where: { name: { startsWith: 'group_test_' } } })
            await testPrisma.models.deleteMany({ where: { name: { startsWith: 'test_model_' } } })
            const testProviderIds = (await testPrisma.modelProviders.findMany({ where: { name: { startsWith: 'test_provider_' } }, select: { id: true } })).map(p => p.id)
            if (testProviderIds.length > 0) {
                await testPrisma.modelApiKeys.deleteMany({ where: { providerId: { in: testProviderIds } } })
            }
            await testPrisma.modelProviders.deleteMany({ where: { name: { startsWith: 'test_provider_' } } })
        } catch { /* 最终清理忽略错误 */ }
        await testPrisma.$disconnect()
    })

    // ==================== 节点分组服务 ====================

    describe('节点分组服务', () => {
        describe('createNodeGroupService', () => {
            it('应创建节点分组', async () => {
                const group = await createNodeGroupService({
                    name: `group_${generateTestId()}`,
                    description: '测试分组',
                })

                expect(group.id).toBeDefined()
                expect(group.name).toContain('group_')
            })
        })

        describe('getNodeGroupByIdService', () => {
            it('应返回存在的分组', async () => {
                const created = await createNodeGroupService({
                    name: `group_${generateTestId()}`,
                })

                const found = await getNodeGroupByIdService(created.id)
                expect(found).not.toBeNull()
                expect(found!.id).toBe(created.id)
            })

            it('不存在的 ID 应返回 null', async () => {
                const found = await getNodeGroupByIdService(999999)
                expect(found).toBeNull()
            })
        })

        describe('getNodeGroupsService', () => {
            it('应返回分页的分组列表', async () => {
                await createNodeGroupService({ name: `group_${generateTestId()}` })
                await createNodeGroupService({ name: `group_${generateTestId()}` })

                const result = await getNodeGroupsService({ page: 1, pageSize: 10 })
                expect(result.total).toBeGreaterThanOrEqual(2)
            })
        })

        describe('getAllNodeGroupsService', () => {
            it('应返回所有分组', async () => {
                const created = await createNodeGroupService({
                    name: `group_${generateTestId()}`,
                })

                const groups = await getAllNodeGroupsService()
                expect(groups.some((g) => g.id === created.id)).toBe(true)
            })
        })

        describe('updateNodeGroupService', () => {
            it('应更新分组信息', async () => {
                const group = await createNodeGroupService({
                    name: `group_${generateTestId()}`,
                    description: '旧描述',
                })

                const updated = await updateNodeGroupService(group.id, {
                    description: '新描述',
                })

                expect(updated.description).toBe('新描述')
            })

            it('不存在的分组应抛出错误', async () => {
                await expect(
                    updateNodeGroupService(999999, { description: 'test' })
                ).rejects.toThrow('节点分组不存在')
            })
        })

        describe('deleteNodeGroupService', () => {
            it('应删除无节点的分组', async () => {
                const group = await createNodeGroupService({
                    name: `group_${generateTestId()}`,
                })

                await deleteNodeGroupService(group.id)

                const found = await getNodeGroupByIdService(group.id)
                expect(found).toBeNull()
            })

            it('不存在的分组应抛出错误', async () => {
                await expect(deleteNodeGroupService(999999)).rejects.toThrow('节点分组不存在')
            })

            it('有节点的分组应抛出错误', async () => {
                const model = await createTestModel()
                const group = await createNodeGroupService({
                    name: `group_${generateTestId()}`,
                })
                await createNodeService({
                    name: `node_${generateTestId()}`,
                    type: 'analysis',
                    modelId: model.id,
                    groupId: group.id,
                })

                await expect(deleteNodeGroupService(group.id)).rejects.toThrow(
                    '该分组下存在节点，无法删除'
                )
            })
        })
    })

    // ==================== 节点服务 ====================

    describe('节点服务', () => {
        describe('createNodeService', () => {
            it('应创建节点', async () => {
                const model = await createTestModel()

                const node = await createNodeService({
                    name: `node_${generateTestId()}`,
                    title: '测试节点',
                    type: 'analysis',
                    modelId: model.id,
                })

                expect(node.id).toBeDefined()
                expect(node.name).toContain('node_')
            })

            it('重复名称应抛出错误', async () => {
                const model = await createTestModel()
                const name = `node_${generateTestId()}`

                await createNodeService({
                    name,
                    type: 'analysis',
                    modelId: model.id,
                })

                await expect(
                    createNodeService({
                        name,
                        type: 'analysis',
                        modelId: model.id,
                    })
                ).rejects.toThrow('节点名称已存在')
            })

            it('不存在的模型应抛出错误', async () => {
                await expect(
                    createNodeService({
                        name: `node_${generateTestId()}`,
                        type: 'analysis',
                        modelId: 999999,
                    })
                ).rejects.toThrow('关联的模型不存在')
            })

            it('不存在的分组应抛出错误', async () => {
                const model = await createTestModel()

                await expect(
                    createNodeService({
                        name: `node_${generateTestId()}`,
                        type: 'analysis',
                        modelId: model.id,
                        groupId: 999999,
                    })
                ).rejects.toThrow('关联的分组不存在')
            })

            it('extraction 类型节点应保留 outputSchema', async () => {
                const model = await createTestModel()
                const schema = { type: 'object', properties: { title: { type: 'string' } } }

                const node = await createNodeService({
                    name: `node_${generateTestId()}`,
                    type: 'extraction',
                    modelId: model.id,
                    outputSchema: schema,
                })

                expect(node.outputSchema).toEqual(schema)
            })

            it('analysis 类型节点应清空 outputSchema', async () => {
                const model = await createTestModel()
                const schema = { type: 'object', properties: { title: { type: 'string' } } }

                const node = await createNodeService({
                    name: `node_${generateTestId()}`,
                    type: 'analysis',
                    modelId: model.id,
                    outputSchema: schema,
                })

                expect(node.outputSchema).toBeNull()
            })
        })

        describe('getNodeByIdService', () => {
            it('应返回存在的节点', async () => {
                const model = await createTestModel()
                const created = await createNodeService({
                    name: `node_${generateTestId()}`,
                    type: 'analysis',
                    modelId: model.id,
                })

                const found = await getNodeByIdService(created.id)
                expect(found).not.toBeNull()
                expect(found!.id).toBe(created.id)
            })

            it('不存在的 ID 应返回 null', async () => {
                const found = await getNodeByIdService(999999)
                expect(found).toBeNull()
            })
        })

        describe('getNodeByNameService', () => {
            it('应通过名称返回节点', async () => {
                const model = await createTestModel()
                const name = `node_${generateTestId()}`
                const created = await createNodeService({
                    name,
                    type: 'analysis',
                    modelId: model.id,
                })

                const found = await getNodeByNameService(name)
                expect(found).not.toBeNull()
                expect(found!.id).toBe(created.id)
            })
        })

        describe('getNodesService', () => {
            it('应返回分页的节点列表', async () => {
                const model = await createTestModel()
                await createNodeService({ name: `node_${generateTestId()}`, type: 'analysis', modelId: model.id })
                await createNodeService({ name: `node_${generateTestId()}`, type: 'analysis', modelId: model.id })

                const result = await getNodesService({ page: 1, pageSize: 10 })
                expect(result.total).toBeGreaterThanOrEqual(2)
            })
        })

        describe('getAllNodesService', () => {
            it('应返回所有节点', async () => {
                const model = await createTestModel()
                const created = await createNodeService({
                    name: `node_${generateTestId()}`,
                    type: 'analysis',
                    modelId: model.id,
                })

                const nodes = await getAllNodesService()
                expect(nodes.some((n) => n.id === created.id)).toBe(true)
            })

            it('类型筛选应正确过滤', async () => {
                const model = await createTestModel()
                await createNodeService({ name: `node_${generateTestId()}`, type: 'analysis', modelId: model.id })
                await createNodeService({ name: `node_${generateTestId()}`, type: 'document', modelId: model.id })

                const nodes = await getAllNodesService({ type: 'analysis' })
                expect(nodes.every((n) => n.type === 'analysis')).toBe(true)
            })
        })

        describe('getNodesByGroupIdService', () => {
            it('应返回分组下的节点', async () => {
                const model = await createTestModel()
                const group = await createTestGroup()
                const node = await createNodeService({
                    name: `node_${generateTestId()}`,
                    type: 'analysis',
                    modelId: model.id,
                    groupId: group.id,
                })

                const nodes = await getNodesByGroupIdService(group.id)
                expect(nodes.some((n) => n.id === node.id)).toBe(true)
            })
        })

        describe('updateNodeService', () => {
            it('应更新节点信息', async () => {
                const model = await createTestModel()
                const node = await createNodeService({
                    name: `node_${generateTestId()}`,
                    title: '旧标题',
                    type: 'analysis',
                    modelId: model.id,
                })

                const updated = await updateNodeService(node.id, {
                    title: '新标题',
                })

                expect(updated.title).toBe('新标题')
            })

            it('不存在的节点应抛出错误', async () => {
                await expect(updateNodeService(999999, { title: 'test' })).rejects.toThrow(
                    '节点不存在'
                )
            })

            it('不存在的模型应抛出错误', async () => {
                const model = await createTestModel()
                const node = await createNodeService({
                    name: `node_${generateTestId()}`,
                    type: 'analysis',
                    modelId: model.id,
                })

                await expect(
                    updateNodeService(node.id, { modelId: 999999 })
                ).rejects.toThrow('关联的模型不存在')
            })

            it('不存在的分组应抛出错误', async () => {
                const model = await createTestModel()
                const node = await createNodeService({
                    name: `node_${generateTestId()}`,
                    type: 'analysis',
                    modelId: model.id,
                })

                await expect(
                    updateNodeService(node.id, { groupId: 999999 })
                ).rejects.toThrow('关联的分组不存在')
            })

            it('extraction 类型应保留 outputSchema', async () => {
                const model = await createTestModel()
                const node = await createNodeService({
                    name: `node_${generateTestId()}`,
                    type: 'extraction',
                    modelId: model.id,
                })
                const schema = { type: 'object', properties: { title: { type: 'string' } } }

                const updated = await updateNodeService(node.id, {
                    outputSchema: schema,
                })

                expect(updated.outputSchema).toEqual(schema)
            })

            it('非 extraction/agent 类型应清空 outputSchema', async () => {
                const model = await createTestModel()
                const node = await createNodeService({
                    name: `node_${generateTestId()}`,
                    type: 'analysis',
                    modelId: model.id,
                })
                const schema = { type: 'object', properties: { title: { type: 'string' } } }

                const updated = await updateNodeService(node.id, {
                    outputSchema: schema,
                })

                expect(updated.outputSchema).toBeNull()
            })
        })

        describe('updateNodeStatusService', () => {
            it('应更新节点状态', async () => {
                const model = await createTestModel()
                const node = await createNodeService({
                    name: `node_${generateTestId()}`,
                    type: 'analysis',
                    modelId: model.id,
                    status: 1,
                })

                const updated = await updateNodeStatusService(node.id, 0)
                expect(updated.status).toBe(0)
            })

            it('不存在的节点应抛出错误', async () => {
                await expect(updateNodeStatusService(999999, 0)).rejects.toThrow('节点不存在')
            })
        })

        describe('deleteNodeService', () => {
            it('应删除节点', async () => {
                const model = await createTestModel()
                const node = await createNodeService({
                    name: `node_${generateTestId()}`,
                    type: 'analysis',
                    modelId: model.id,
                })

                await deleteNodeService(node.id)

                const found = await getNodeByIdService(node.id)
                expect(found).toBeNull()
            })

            it('不存在的节点应抛出错误', async () => {
                await expect(deleteNodeService(999999)).rejects.toThrow('节点不存在')
            })
        })

        describe('batchUpdateNodeGroupService', () => {
            it('应批量更新节点分组', async () => {
                const model = await createTestModel()
                const group = await createTestGroup()
                const node1 = await createNodeService({
                    name: `node_${generateTestId()}`,
                    type: 'analysis',
                    modelId: model.id,
                })
                const node2 = await createNodeService({
                    name: `node_${generateTestId()}`,
                    type: 'analysis',
                    modelId: model.id,
                })

                await batchUpdateNodeGroupService([node1.id, node2.id], group.id)

                const found1 = await getNodeByIdService(node1.id)
                expect(found1!.groupId).toBe(group.id)
            })

            it('不存在的分组应抛出错误', async () => {
                const model = await createTestModel()
                const node = await createNodeService({
                    name: `node_${generateTestId()}`,
                    type: 'analysis',
                    modelId: model.id,
                })

                await expect(
                    batchUpdateNodeGroupService([node.id], 999999)
                ).rejects.toThrow('关联的分组不存在')
            })
        })
    })
})
