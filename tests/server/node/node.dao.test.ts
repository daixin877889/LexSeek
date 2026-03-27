/**
 * 节点 DAO 测试
 *
 * **Feature: node-management**
 * **Validates: Requirements 14.1, 14.2, 14.3, 14.4, 14.6, 14.7, 14.8**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../../generated/prisma/client'
import { config } from 'dotenv'
import { resolve } from 'node:path'
import {
    createNodeGroupDao,
    findNodeGroupByIdDao,
    findManyNodeGroupsDao,
    findAllNodeGroupsDao,
    updateNodeGroupDao,
    softDeleteNodeGroupDao,
    createNodeDao,
    findNodeByIdDao,
    findNodesByIdsDao,
    findNodeByNameDao,
    findManyNodesDao,
    findAllNodesDao,
    findNodesByGroupIdDao,
    updateNodeDao,
    updateNodeStatusDao,
    softDeleteNodeDao,
    batchUpdateNodeGroupDao,
    getNodeConfigDao,
    getNodeConfigByIdDao,
} from '../../../server/services/node/node.dao'

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

describe('节点 DAO 测试', () => {
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
        await testPrisma.$disconnect()
    })

    // ==================== 节点分组 DAO ====================

    describe('节点分组 DAO', () => {
        describe('createNodeGroupDao', () => {
            it('应创建节点分组', async () => {
                const group = await createNodeGroupDao({
                    name: `group_${generateTestId()}`,
                    description: '测试分组',
                })

                expect(group.id).toBeDefined()
                expect(group.name).toContain('group_')
                expect(group.description).toBe('测试分组')
                expect(group.deletedAt).toBeNull()
            })

            it('应使用默认优先级', async () => {
                const group = await createNodeGroupDao({
                    name: `group_${generateTestId()}`,
                })

                expect(group.priority).toBe(100)
            })
        })

        describe('findNodeGroupByIdDao', () => {
            it('应返回存在的分组', async () => {
                const created = await createNodeGroupDao({
                    name: `group_${generateTestId()}`,
                })

                const found = await findNodeGroupByIdDao(created.id)
                expect(found).not.toBeNull()
                expect(found!.id).toBe(created.id)
            })

            it('不存在的 ID 应返回 null', async () => {
                const found = await findNodeGroupByIdDao(999999)
                expect(found).toBeNull()
            })

            it('已删除的分组应返回 null', async () => {
                const created = await createNodeGroupDao({
                    name: `group_${generateTestId()}`,
                })

                await softDeleteNodeGroupDao(created.id)

                const found = await findNodeGroupByIdDao(created.id)
                expect(found).toBeNull()
            })

            it('应包含节点数量统计', async () => {
                const model = await createTestModel()
                const created = await createNodeGroupDao({
                    name: `group_${generateTestId()}`,
                })
                await createNodeDao({
                    name: `node_${generateTestId()}`,
                    type: 'analysis',
                    modelId: model.id,
                    groupId: created.id,
                })

                const found = await findNodeGroupByIdDao(created.id)
                expect(found!._count.nodes).toBe(1)
            })
        })

        describe('findManyNodeGroupsDao', () => {
            it('应返回分页的分组列表', async () => {
                await createNodeGroupDao({ name: `group_${generateTestId()}` })
                await createNodeGroupDao({ name: `group_${generateTestId()}` })

                const result = await findManyNodeGroupsDao({ page: 1, pageSize: 10 })
                expect(result.total).toBeGreaterThanOrEqual(2)
                expect(result.list.length).toBeGreaterThanOrEqual(2)
            })

            it('关键词搜索应正确过滤', async () => {
                const uniqueKeyword = `unique_${generateTestId()}`
                await createNodeGroupDao({ name: `group_${uniqueKeyword}` })

                const result = await findManyNodeGroupsDao({ keyword: uniqueKeyword })
                expect(result.list.some((g) => g.name.includes(uniqueKeyword))).toBe(true)
            })
        })

        describe('findAllNodeGroupsDao', () => {
            it('应返回所有分组', async () => {
                const group = await createNodeGroupDao({ name: `group_${generateTestId()}` })

                const groups = await findAllNodeGroupsDao()
                expect(groups.some((g) => g.id === group.id)).toBe(true)
            })
        })

        describe('updateNodeGroupDao', () => {
            it('应更新分组信息', async () => {
                const group = await createNodeGroupDao({
                    name: `group_${generateTestId()}`,
                    description: '旧描述',
                })

                const updated = await updateNodeGroupDao(group.id, {
                    name: `group_${generateTestId()}_updated`,
                    description: '新描述',
                })

                expect(updated.description).toBe('新描述')
            })
        })

        describe('softDeleteNodeGroupDao', () => {
            it('应软删除分组', async () => {
                const group = await createNodeGroupDao({ name: `group_${generateTestId()}` })

                await softDeleteNodeGroupDao(group.id)

                const found = await findNodeGroupByIdDao(group.id)
                expect(found).toBeNull()
            })
        })
    })

    // ==================== 节点 DAO ====================

    describe('节点 DAO', () => {
        describe('createNodeDao', () => {
            it('应创建节点', async () => {
                const model = await createTestModel()

                const node = await createNodeDao({
                    name: `node_${generateTestId()}`,
                    title: '测试节点',
                    type: 'analysis',
                    modelId: model.id,
                })

                expect(node.id).toBeDefined()
                expect(node.name).toContain('node_')
                expect(node.type).toBe('analysis')
                expect(node.status).toBe(1)
                expect(node.deletedAt).toBeNull()
            })

            it('应包含关联的分组和模型信息', async () => {
                const model = await createTestModel()
                const group = await createTestGroup()

                const node = await createNodeDao({
                    name: `node_${generateTestId()}`,
                    type: 'analysis',
                    modelId: model.id,
                    groupId: group.id,
                })

                expect(node.group).not.toBeNull()
                expect(node.group!.id).toBe(group.id)
                expect(node.model).not.toBeNull()
                expect(node.model!.id).toBe(model.id)
            })
        })

        describe('findNodeByIdDao', () => {
            it('应返回存在的节点', async () => {
                const model = await createTestModel()
                const created = await createNodeDao({
                    name: `node_${generateTestId()}`,
                    type: 'analysis',
                    modelId: model.id,
                })

                const found = await findNodeByIdDao(created.id)
                expect(found).not.toBeNull()
                expect(found!.id).toBe(created.id)
            })

            it('不存在的 ID 应返回 null', async () => {
                const found = await findNodeByIdDao(999999)
                expect(found).toBeNull()
            })
        })

        describe('findNodesByIdsDao', () => {
            it('应批量查询节点', async () => {
                const model = await createTestModel()
                const node1 = await createNodeDao({
                    name: `node_${generateTestId()}`,
                    type: 'analysis',
                    modelId: model.id,
                })
                const node2 = await createNodeDao({
                    name: `node_${generateTestId()}`,
                    type: 'analysis',
                    modelId: model.id,
                })

                const nodes = await findNodesByIdsDao([node1.id, node2.id])
                expect(nodes.length).toBe(2)
            })

            it('应过滤已删除的节点', async () => {
                const model = await createTestModel()
                const node = await createNodeDao({
                    name: `node_${generateTestId()}`,
                    type: 'analysis',
                    modelId: model.id,
                })

                await softDeleteNodeDao(node.id)

                const nodes = await findNodesByIdsDao([node.id])
                expect(nodes.length).toBe(0)
            })
        })

        describe('findNodeByNameDao', () => {
            it('应通过名称查询节点', async () => {
                const model = await createTestModel()
                const name = `node_${generateTestId()}`
                const created = await createNodeDao({
                    name,
                    type: 'analysis',
                    modelId: model.id,
                })

                const found = await findNodeByNameDao(name)
                expect(found).not.toBeNull()
                expect(found!.id).toBe(created.id)
            })

            it('不存在的名称应返回 null', async () => {
                const found = await findNodeByNameDao('nonexistent_node_name_xyz')
                expect(found).toBeNull()
            })
        })

        describe('findManyNodesDao', () => {
            it('应返回分页的节点列表', async () => {
                const model = await createTestModel()
                await createNodeDao({ name: `node_${generateTestId()}`, type: 'analysis', modelId: model.id })
                await createNodeDao({ name: `node_${generateTestId()}`, type: 'analysis', modelId: model.id })

                const result = await findManyNodesDao({ page: 1, pageSize: 10 })
                expect(result.total).toBeGreaterThanOrEqual(2)
                expect(result.list.length).toBeGreaterThanOrEqual(2)
            })

            it('类型筛选应正确过滤', async () => {
                const model = await createTestModel()
                await createNodeDao({ name: `node_${generateTestId()}`, type: 'analysis', modelId: model.id })
                await createNodeDao({ name: `node_${generateTestId()}`, type: 'document', modelId: model.id })

                const result = await findManyNodesDao({ type: 'analysis' })
                expect(result.list.every((n) => n.type === 'analysis')).toBe(true)
            })

            it('分组筛选应正确过滤', async () => {
                const model = await createTestModel()
                const group = await createTestGroup()
                await createNodeDao({
                    name: `node_${generateTestId()}`,
                    type: 'analysis',
                    modelId: model.id,
                    groupId: group.id,
                })

                const result = await findManyNodesDao({ groupId: group.id })
                expect(result.list.every((n) => n.groupId === group.id)).toBe(true)
            })
        })

        describe('findAllNodesDao', () => {
            it('应返回所有节点', async () => {
                const model = await createTestModel()
                const node = await createNodeDao({
                    name: `node_${generateTestId()}`,
                    type: 'analysis',
                    modelId: model.id,
                })

                const nodes = await findAllNodesDao()
                expect(nodes.some((n) => n.id === node.id)).toBe(true)
            })

            it('状态筛选应正确过滤', async () => {
                const model = await createTestModel()
                const node1 = await createNodeDao({
                    name: `node_${generateTestId()}`,
                    type: 'analysis',
                    modelId: model.id,
                    status: 1,
                })
                const node2 = await createNodeDao({
                    name: `node_${generateTestId()}`,
                    type: 'analysis',
                    modelId: model.id,
                    status: 0,
                })

                const activeNodes = await findAllNodesDao({ status: 1 })
                expect(activeNodes.some((n) => n.id === node1.id)).toBe(true)
                expect(activeNodes.some((n) => n.id === node2.id)).toBe(false)
            })
        })

        describe('findNodesByGroupIdDao', () => {
            it('应返回分组下的所有节点', async () => {
                const model = await createTestModel()
                const group = await createTestGroup()
                const node1 = await createNodeDao({
                    name: `node_${generateTestId()}`,
                    type: 'analysis',
                    modelId: model.id,
                    groupId: group.id,
                })
                const node2 = await createNodeDao({
                    name: `node_${generateTestId()}`,
                    type: 'analysis',
                    modelId: model.id,
                    groupId: group.id,
                })

                const nodes = await findNodesByGroupIdDao(group.id)
                const ids = nodes.map((n) => n.id)
                expect(ids).toContain(node1.id)
                expect(ids).toContain(node2.id)
            })
        })

        describe('updateNodeDao', () => {
            it('应更新节点信息', async () => {
                const model = await createTestModel()
                const node = await createNodeDao({
                    name: `node_${generateTestId()}`,
                    title: '旧标题',
                    type: 'analysis',
                    modelId: model.id,
                })

                const updated = await updateNodeDao(node.id, {
                    title: '新标题',
                    description: '新描述',
                })

                expect(updated.title).toBe('新标题')
                expect(updated.description).toBe('新描述')
            })

            it('应能清空 outputSchema', async () => {
                const { Prisma } = await import('../../../generated/prisma/client')
                const model = await createTestModel()
                const node = await createNodeDao({
                    name: `node_${generateTestId()}`,
                    type: 'extraction',
                    modelId: model.id,
                    outputSchema: { type: 'object' },
                })

                const updated = await updateNodeDao(node.id, {
                    outputSchema: null,
                })

                expect(updated.outputSchema).toBeNull()
            })
        })

        describe('updateNodeStatusDao', () => {
            it('应更新节点状态', async () => {
                const model = await createTestModel()
                const node = await createNodeDao({
                    name: `node_${generateTestId()}`,
                    type: 'analysis',
                    modelId: model.id,
                    status: 1,
                })

                const updated = await updateNodeStatusDao(node.id, 0)
                expect(updated.status).toBe(0)
            })
        })

        describe('softDeleteNodeDao', () => {
            it('应软删除节点', async () => {
                const model = await createTestModel()
                const node = await createNodeDao({
                    name: `node_${generateTestId()}`,
                    type: 'analysis',
                    modelId: model.id,
                })

                await softDeleteNodeDao(node.id)

                const found = await findNodeByIdDao(node.id)
                expect(found).toBeNull()
            })
        })

        describe('batchUpdateNodeGroupDao', () => {
            it('应批量更新节点分组', async () => {
                const model = await createTestModel()
                const group1 = await createTestGroup()
                const group2 = await createTestGroup()
                const node1 = await createNodeDao({
                    name: `node_${generateTestId()}`,
                    type: 'analysis',
                    modelId: model.id,
                    groupId: group1.id,
                })
                const node2 = await createNodeDao({
                    name: `node_${generateTestId()}`,
                    type: 'analysis',
                    modelId: model.id,
                    groupId: group1.id,
                })

                await batchUpdateNodeGroupDao([node1.id, node2.id], group2.id)

                const nodes = await findNodesByIdsDao([node1.id, node2.id])
                expect(nodes.every((n) => n.groupId === group2.id)).toBe(true)
            })

            it('应能移除节点分组（传 null）', async () => {
                const model = await createTestModel()
                const group = await createTestGroup()
                const node = await createNodeDao({
                    name: `node_${generateTestId()}`,
                    type: 'analysis',
                    modelId: model.id,
                    groupId: group.id,
                })

                await batchUpdateNodeGroupDao([node.id], null)

                const found = await findNodeByIdDao(node.id)
                expect(found!.groupId).toBeNull()
            })
        })

        describe('getNodeConfigDao', () => {
            it('应返回节点完整配置', async () => {
                const model = await createTestModel()
                const node = await createNodeDao({
                    name: `node_${generateTestId()}`,
                    type: 'analysis',
                    modelId: model.id,
                    status: 1,
                })

                const config = await getNodeConfigDao(node.name)
                expect(config).not.toBeNull()
                expect(config!.id).toBe(node.id)
                expect(config!.model).not.toBeNull()
            })

            it('禁用的节点应返回 null', async () => {
                const model = await createTestModel()
                const node = await createNodeDao({
                    name: `node_${generateTestId()}`,
                    type: 'analysis',
                    modelId: model.id,
                    status: 0,
                })

                const config = await getNodeConfigDao(node.name)
                expect(config).toBeNull()
            })
        })

        describe('getNodeConfigByIdDao', () => {
            it('应通过 ID 返回节点完整配置', async () => {
                const model = await createTestModel()
                const node = await createNodeDao({
                    name: `node_${generateTestId()}`,
                    type: 'analysis',
                    modelId: model.id,
                    status: 1,
                })

                const config = await getNodeConfigByIdDao(node.id)
                expect(config).not.toBeNull()
                expect(config!.id).toBe(node.id)
            })
        })
    })
})
