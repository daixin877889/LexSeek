/**
 * 会员节点权限 DAO 测试
 *
 * **Feature: node-management**
 * **Validates: Requirements 14.15, 14.16, 14.17**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../../generated/prisma/client'
import { config } from 'dotenv'
import { resolve } from 'node:path'
import {
    findAccessByIdDao,
    findAccessByLevelAndNodeDao,
    findAccessByLevelIdDao,
    findAccessByNodeIdDao,
    findAllAccessMatrixDao,
    createAccessDao,
    createManyAccessDao,
    softDeleteAccessDao,
    softDeleteAccessByLevelAndNodeDao,
    softDeleteAccessByLevelAndNodesDao,
    softDeleteAccessByLevelIdDao,
    findDeletedAccessDao,
    restoreAccessDao,
} from '../../../server/services/node/access.dao'

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
    levelIds: [] as number[],
    nodeIds: [] as number[],
    modelIds: [] as number[],
    accessIds: [] as number[],
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

// 创建测试节点
const createTestNode = async (modelId: number) => {
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
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    testIds.nodeIds.push(node.id)
    return node
}

// 创建测试会员级别
const createTestLevel = async () => {
    const level = await testPrisma.membershipLevels.create({
        data: {
            name: `测试级别_${generateTestId()}`,
            description: '测试会员级别',
            sortOrder: 100,
            status: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    testIds.levelIds.push(level.id)
    return level
}

// 创建测试权限记录
const createTestAccess = async (levelId: number, nodeId: number) => {
    const access = await testPrisma.levelNodeAccess.create({
        data: {
            levelId,
            nodeId,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    testIds.accessIds.push(access.id)
    return access
}

// 清理测试数据（按外键依赖顺序，每个步骤独立处理错误）
const cleanupTestData = async () => {
    // 先删除权限（解除 levelId/nodeId 外键引用）
    try {
        if (testIds.accessIds.length > 0) {
            await testPrisma.levelNodeAccess.deleteMany({ where: { id: { in: testIds.accessIds } } })
        }
    } catch { /* 忽略权限删除错误 */ }
    testIds.accessIds = []
    // 再删除节点（解除 modelId 外键引用）
    try {
        if (testIds.nodeIds.length > 0) {
            await testPrisma.nodes.deleteMany({ where: { id: { in: testIds.nodeIds } } })
        }
    } catch { /* 忽略节点删除错误 */ }
    testIds.nodeIds = []
    // 最后删除模型和级别
    try {
        if (testIds.modelIds.length > 0) {
            await testPrisma.models.deleteMany({ where: { id: { in: testIds.modelIds } } })
        }
    } catch { /* 忽略模型删除错误 */ }
    testIds.modelIds = []
    try {
        if (testIds.levelIds.length > 0) {
            await testPrisma.membershipLevels.deleteMany({ where: { id: { in: testIds.levelIds } } })
        }
    } catch { /* 忽略级别删除错误 */ }
    testIds.levelIds = []
    try {
        if (testIds.providerIds.length > 0) {
            await testPrisma.modelProviders.deleteMany({ where: { id: { in: testIds.providerIds } } })
        }
    } catch { /* 忽略 provider 删除错误 */ }
    testIds.providerIds = []
}

describe('权限 DAO 测试', () => {
    beforeAll(async () => {
        await testPrisma.$connect()
        await testPrisma.$executeRaw`SELECT setval('level_node_access_id_seq', GREATEST((SELECT MAX(id) FROM level_node_access), 1000))`
        await testPrisma.$executeRaw`SELECT setval('nodes_id_seq', GREATEST((SELECT MAX(id) FROM nodes), 1000))`
        await testPrisma.$executeRaw`SELECT setval('models_id_seq', GREATEST((SELECT MAX(id) FROM models), 1000))`
        await testPrisma.$executeRaw`SELECT setval('membership_levels_id_seq', GREATEST((SELECT MAX(id) FROM membership_levels), 1000))`
    })

    afterEach(async () => {
        await cleanupTestData()
    })

    afterAll(async () => {
        await testPrisma.$disconnect()
    })

    describe('findAccessByIdDao', () => {
        it('应返回存在的权限记录', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)
            const level = await createTestLevel()
            const access = await createTestAccess(level.id, node.id)

            const found = await findAccessByIdDao(access.id)
            expect(found).not.toBeNull()
            expect(found!.id).toBe(access.id)
            expect(found!.levelId).toBe(level.id)
            expect(found!.nodeId).toBe(node.id)
        })

        it('不存在的 ID 应返回 null', async () => {
            const found = await findAccessByIdDao(999999)
            expect(found).toBeNull()
        })

        it('已删除的记录应返回 null', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)
            const level = await createTestLevel()
            const access = await createTestAccess(level.id, node.id)

            // 软删除
            await testPrisma.levelNodeAccess.update({
                where: { id: access.id },
                data: { deletedAt: new Date() },
            })

            const found = await findAccessByIdDao(access.id)
            expect(found).toBeNull()
        })
    })

    describe('findAccessByLevelAndNodeDao', () => {
        it('应返回正确的权限记录', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)
            const level = await createTestLevel()
            const access = await createTestAccess(level.id, node.id)

            const found = await findAccessByLevelAndNodeDao(level.id, node.id)
            expect(found).not.toBeNull()
            expect(found!.id).toBe(access.id)
        })

        it('不存在的组合应返回 null', async () => {
            const found = await findAccessByLevelAndNodeDao(999999, 999998)
            expect(found).toBeNull()
        })
    })

    describe('findAccessByLevelIdDao', () => {
        it('应返回会员级别的所有权限记录', async () => {
            const model = await createTestModel()
            const node1 = await createTestNode(model.id)
            const node2 = await createTestNode(model.id)
            const level = await createTestLevel()

            await createTestAccess(level.id, node1.id)
            await createTestAccess(level.id, node2.id)

            const records = await findAccessByLevelIdDao(level.id)
            expect(records.length).toBe(2)
            // 验证包含节点信息
            expect(records[0].node).toBeDefined()
        })
    })

    describe('findAccessByNodeIdDao', () => {
        it('应返回节点的所有权限记录', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)
            const level1 = await createTestLevel()
            const level2 = await createTestLevel()

            await createTestAccess(level1.id, node.id)
            await createTestAccess(level2.id, node.id)

            const records = await findAccessByNodeIdDao(node.id)
            expect(records.length).toBe(2)
            // 验证包含级别信息
            expect(records[0].level).toBeDefined()
        })
    })

    describe('findAllAccessMatrixDao', () => {
        it('应返回所有权限记录', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)
            const level = await createTestLevel()

            await createTestAccess(level.id, node.id)

            const records = await findAllAccessMatrixDao()
            expect(records.length).toBeGreaterThanOrEqual(1)
            expect(records[0].level).toBeDefined()
            expect(records[0].node).toBeDefined()
        })
    })

    describe('createAccessDao', () => {
        it('应创建权限记录', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)
            const level = await createTestLevel()

            const access = await createAccessDao({ levelId: level.id, nodeId: node.id })
            testIds.accessIds.push(access.id)

            expect(access.id).toBeDefined()
            expect(access.levelId).toBe(level.id)
            expect(access.nodeId).toBe(node.id)
            expect(access.deletedAt).toBeNull()
        })
    })

    describe('createManyAccessDao', () => {
        it('应批量创建权限记录', async () => {
            const model = await createTestModel()
            const node1 = await createTestNode(model.id)
            const node2 = await createTestNode(model.id)
            const level = await createTestLevel()

            const records = [
                { levelId: level.id, nodeId: node1.id },
                { levelId: level.id, nodeId: node2.id },
            ]

            const count = await createManyAccessDao(records)
            expect(count).toBe(2)
        })

        it('应跳过重复记录', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)
            const level = await createTestLevel()

            // 先创建一条
            await createAccessDao({ levelId: level.id, nodeId: node.id })

            // 尝试重复创建
            const count = await createManyAccessDao([{ levelId: level.id, nodeId: node.id }])
            expect(count).toBe(0)
        })
    })

    describe('softDeleteAccessDao', () => {
        it('应软删除权限记录', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)
            const level = await createTestLevel()
            const access = await createTestAccess(level.id, node.id)

            await softDeleteAccessDao(access.id)

            const found = await testPrisma.levelNodeAccess.findUnique({
                where: { id: access.id },
            })
            expect(found!.deletedAt).not.toBeNull()
        })
    })

    describe('softDeleteAccessByLevelAndNodeDao', () => {
        it('应通过级别和节点删除权限', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)
            const level = await createTestLevel()
            await createTestAccess(level.id, node.id)

            await softDeleteAccessByLevelAndNodeDao(level.id, node.id)

            const found = await findAccessByLevelAndNodeDao(level.id, node.id)
            expect(found).toBeNull()
        })
    })

    describe('softDeleteAccessByLevelAndNodesDao', () => {
        it('应批量删除权限', async () => {
            const model = await createTestModel()
            const node1 = await createTestNode(model.id)
            const node2 = await createTestNode(model.id)
            const level = await createTestLevel()

            await createTestAccess(level.id, node1.id)
            await createTestAccess(level.id, node2.id)

            await softDeleteAccessByLevelAndNodesDao(level.id, [node1.id, node2.id])

            const remaining = await findAccessByLevelIdDao(level.id)
            expect(remaining.length).toBe(0)
        })
    })

    describe('softDeleteAccessByLevelIdDao', () => {
        it('应删除会员级别的所有权限', async () => {
            const model = await createTestModel()
            const node1 = await createTestNode(model.id)
            const node2 = await createTestNode(model.id)
            const level = await createTestLevel()

            await createTestAccess(level.id, node1.id)
            await createTestAccess(level.id, node2.id)

            await softDeleteAccessByLevelIdDao(level.id)

            const remaining = await findAccessByLevelIdDao(level.id)
            expect(remaining.length).toBe(0)
        })
    })

    describe('findDeletedAccessDao', () => {
        it('应返回已删除的权限记录', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)
            const level = await createTestLevel()
            const access = await createTestAccess(level.id, node.id)

            // 软删除
            await testPrisma.levelNodeAccess.update({
                where: { id: access.id },
                data: { deletedAt: new Date() },
            })

            const found = await findDeletedAccessDao(level.id, node.id)
            expect(found).not.toBeNull()
            expect(found!.id).toBe(access.id)
        })

        it('未删除的记录应返回 null', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)
            const level = await createTestLevel()
            await createTestAccess(level.id, node.id)

            const found = await findDeletedAccessDao(level.id, node.id)
            expect(found).toBeNull()
        })
    })

    describe('restoreAccessDao', () => {
        it('应恢复已删除的权限记录', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)
            const level = await createTestLevel()
            const access = await createTestAccess(level.id, node.id)

            // 软删除
            await softDeleteAccessDao(access.id)

            // 恢复
            const restored = await restoreAccessDao(access.id)
            expect(restored.deletedAt).toBeNull()

            // 验证可以查询到
            const found = await findAccessByLevelAndNodeDao(level.id, node.id)
            expect(found).not.toBeNull()
        })
    })
})
