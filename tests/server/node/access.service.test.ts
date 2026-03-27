/**
 * 会员节点权限服务测试
 *
 * **Feature: node-management**
 * **Validates: Requirements 14.15, 14.16, 14.17, 14.18, 14.19**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../../generated/prisma/client'
import { config } from 'dotenv'
import { resolve } from 'node:path'
import {
    getLevelNodeAccessService,
    getNodeLevelAccessService,
    getAccessMatrixService,
    grantAccessService,
    batchGrantAccessService,
    revokeAccessService,
    batchRevokeAccessService,
    batchUpdateAccessService,
    checkUserNodeAccessService,
    getUserAvailableNodesService,
    filterUserAccessibleNodesService,
} from '../../../server/services/node/access.service'

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
    userIds: [] as number[],
    levelIds: [] as number[],
    nodeIds: [] as number[],
    modelIds: [] as number[],
    accessIds: [] as number[],
    membershipIds: [] as number[],
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

// 创建测试用户
const createTestUser = async () => {
    const user = await testPrisma.users.create({
        data: {
            name: `测试用户_${generateTestId()}`,
            phone: `199${Date.now().toString().slice(-8)}`,
            password: 'test_hash',
            status: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    testIds.userIds.push(user.id)
    return user
}

// 创建测试用户会员
const createTestMembership = async (userId: number, levelId: number) => {
    const now = new Date()
    const membership = await testPrisma.userMemberships.create({
        data: {
            userId,
            levelId,
            startDate: now,
            endDate: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000),
            autoRenew: false,
            status: 1,
            sourceType: 2,
            createdAt: now,
            updatedAt: now,
        },
    })
    testIds.membershipIds.push(membership.id)
    return membership
}

// 创建测试权限
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
    // 先删除会员（解除 userId/levelId 外键引用）
    try {
        if (testIds.membershipIds.length > 0) {
            await testPrisma.userMemberships.deleteMany({ where: { id: { in: testIds.membershipIds } } })
        }
    } catch { /* 忽略会员删除错误 */ }
    testIds.membershipIds = []
    // 再删除权限（解除 levelId/nodeId 外键引用）
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
    // 再删除模型
    try {
        if (testIds.modelIds.length > 0) {
            await testPrisma.models.deleteMany({ where: { id: { in: testIds.modelIds } } })
        }
    } catch { /* 忽略模型删除错误 */ }
    testIds.modelIds = []
    // 删除级别
    try {
        if (testIds.levelIds.length > 0) {
            await testPrisma.membershipLevels.deleteMany({ where: { id: { in: testIds.levelIds } } })
        }
    } catch { /* 忽略级别删除错误 */ }
    testIds.levelIds = []
    // 删除用户
    try {
        if (testIds.userIds.length > 0) {
            await testPrisma.users.deleteMany({ where: { id: { in: testIds.userIds } } })
        }
    } catch { /* 忽略用户删除错误 */ }
    testIds.userIds = []
    // 删除 provider（先清理引用它的 apiKeys）
    try {
        if (testIds.providerIds.length > 0) {
            await testPrisma.modelApiKeys.deleteMany({ where: { providerId: { in: testIds.providerIds } } })
            await testPrisma.modelProviders.deleteMany({ where: { id: { in: testIds.providerIds } } })
        }
    } catch { /* 忽略 provider 删除错误 */ }
    testIds.providerIds = []
}

describe('权限服务测试', () => {
    beforeAll(async () => {
        await testPrisma.$connect()
        await testPrisma.$executeRaw`SELECT setval('level_node_access_id_seq', GREATEST((SELECT MAX(id) FROM level_node_access), 1000))`
        await testPrisma.$executeRaw`SELECT setval('nodes_id_seq', GREATEST((SELECT MAX(id) FROM nodes), 1000))`
        await testPrisma.$executeRaw`SELECT setval('models_id_seq', GREATEST((SELECT MAX(id) FROM models), 1000))`
        await testPrisma.$executeRaw`SELECT setval('membership_levels_id_seq', GREATEST((SELECT MAX(id) FROM membership_levels), 1000))`
        await testPrisma.$executeRaw`SELECT setval('users_id_seq', GREATEST((SELECT MAX(id) FROM users), 1000))`
        await testPrisma.$executeRaw`SELECT setval('user_memberships_id_seq', GREATEST((SELECT MAX(id) FROM user_memberships), 1000))`
    })

    afterEach(async () => {
        await cleanupTestData()
    })

    afterAll(async () => {
        await testPrisma.$disconnect()
    })

    describe('getLevelNodeAccessService', () => {
        it('应返回会员级别的节点权限列表', async () => {
            const model = await createTestModel()
            const node1 = await createTestNode(model.id)
            const node2 = await createTestNode(model.id)
            const level = await createTestLevel()

            await createTestAccess(level.id, node1.id)
            await createTestAccess(level.id, node2.id)

            const result = await getLevelNodeAccessService(level.id)
            expect(result.length).toBe(2)
        })

        it('不存在的会员级别应抛出错误', async () => {
            await expect(getLevelNodeAccessService(999999)).rejects.toThrow('会员级别不存在')
        })
    })

    describe('getNodeLevelAccessService', () => {
        it('应返回节点的会员级别权限列表', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)
            const level1 = await createTestLevel()
            const level2 = await createTestLevel()

            await createTestAccess(level1.id, node.id)
            await createTestAccess(level2.id, node.id)

            const result = await getNodeLevelAccessService(node.id)
            expect(result.length).toBe(2)
        })

        it('不存在的节点应抛出错误', async () => {
            await expect(getNodeLevelAccessService(999999)).rejects.toThrow('节点不存在')
        })
    })

    describe('getAccessMatrixService', () => {
        it('应返回权限矩阵数据', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)
            const level = await createTestLevel()

            await createTestAccess(level.id, node.id)

            const result = await getAccessMatrixService()

            expect(result.levels.length).toBeGreaterThanOrEqual(1)
            expect(result.nodes.length).toBeGreaterThanOrEqual(1)
            expect(result.matrix.length).toBeGreaterThanOrEqual(1)

            // 验证矩阵数据包含权限信息
            const levelRow = result.matrix.find((m) => m.levelId === level.id)
            expect(levelRow).toBeDefined()
            const nodeAccess = levelRow!.nodes.find((n) => n.nodeId === node.id)
            expect(nodeAccess).toBeDefined()
            expect(nodeAccess!.hasAccess).toBe(true)
        })
    })

    describe('grantAccessService', () => {
        it('应创建新的权限记录', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)
            const level = await createTestLevel()

            const access = await grantAccessService(level.id, node.id)
            testIds.accessIds.push(access.id)

            expect(access.id).toBeDefined()
            expect(access.levelId).toBe(level.id)
            expect(access.nodeId).toBe(node.id)
        })

        it('已存在的权限应抛出错误', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)
            const level = await createTestLevel()

            await grantAccessService(level.id, node.id)

            await expect(grantAccessService(level.id, node.id)).rejects.toThrow('该权限已存在')
        })

        it('不存在的会员级别应抛出错误', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)

            await expect(grantAccessService(999999, node.id)).rejects.toThrow('会员级别不存在')
        })

        it('不存在的节点应抛出错误', async () => {
            const level = await createTestLevel()

            await expect(grantAccessService(level.id, 999999)).rejects.toThrow('节点不存在')
        })

        it('应恢复已删除的权限记录', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)
            const level = await createTestLevel()

            // 首次创建
            await grantAccessService(level.id, node.id)

            // 软删除
            await revokeAccessService(level.id, node.id)

            // 重新授权（应恢复）
            const access = await grantAccessService(level.id, node.id)
            testIds.accessIds.push(access.id)

            expect(access.deletedAt).toBeNull()
        })
    })

    describe('batchGrantAccessService', () => {
        it('应批量创建权限记录', async () => {
            const model = await createTestModel()
            const node1 = await createTestNode(model.id)
            const node2 = await createTestNode(model.id)
            const level = await createTestLevel()

            const count = await batchGrantAccessService(level.id, [node1.id, node2.id])
            expect(count).toBe(2)
        })

        it('不存在的节点应抛出错误', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)
            const level = await createTestLevel()

            await expect(batchGrantAccessService(level.id, [node.id, 999999])).rejects.toThrow(
                '节点 999999 不存在'
            )
        })

        it('已存在的节点应跳过', async () => {
            const model = await createTestModel()
            const node1 = await createTestNode(model.id)
            const node2 = await createTestNode(model.id)
            const level = await createTestLevel()

            await batchGrantAccessService(level.id, [node1.id])
            const count = await batchGrantAccessService(level.id, [node1.id, node2.id])
            expect(count).toBe(1)
        })
    })

    describe('revokeAccessService', () => {
        it('应软删除权限记录', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)
            const level = await createTestLevel()
            await createTestAccess(level.id, node.id)

            await revokeAccessService(level.id, node.id)

            const found = await testPrisma.levelNodeAccess.findFirst({
                where: { levelId: level.id, nodeId: node.id, deletedAt: null },
            })
            expect(found).toBeNull()
        })

        it('不存在的权限应抛出错误', async () => {
            const level = await createTestLevel()
            const model = await createTestModel()
            const node = await createTestNode(model.id)

            await expect(revokeAccessService(level.id, node.id)).rejects.toThrow('权限记录不存在')
        })
    })

    describe('batchRevokeAccessService', () => {
        it('应批量撤销权限', async () => {
            const model = await createTestModel()
            const node1 = await createTestNode(model.id)
            const node2 = await createTestNode(model.id)
            const level = await createTestLevel()

            await batchGrantAccessService(level.id, [node1.id, node2.id])
            await batchRevokeAccessService(level.id, [node1.id, node2.id])

            const remaining = await testPrisma.levelNodeAccess.findMany({
                where: { levelId: level.id, deletedAt: null },
            })
            expect(remaining.length).toBe(0)
        })
    })

    describe('batchUpdateAccessService', () => {
        it('应完全替换权限列表', async () => {
            const model = await createTestModel()
            const node1 = await createTestNode(model.id)
            const node2 = await createTestNode(model.id)
            const node3 = await createTestNode(model.id)
            const level = await createTestLevel()

            // 初始授权 node1, node2
            await batchGrantAccessService(level.id, [node1.id, node2.id])

            // 更新为 node2, node3（应删除 node1，新增 node3）
            await batchUpdateAccessService(level.id, [node2.id, node3.id])

            const remaining = await testPrisma.levelNodeAccess.findMany({
                where: { levelId: level.id, deletedAt: null },
            })

            const nodeIds = remaining.map((r) => r.nodeId)
            expect(nodeIds).toContain(node2.id)
            expect(nodeIds).toContain(node3.id)
            expect(nodeIds).not.toContain(node1.id)
        })

        it('不存在的会员级别应抛出错误', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)

            await expect(batchUpdateAccessService(999999, [node.id])).rejects.toThrow(
                '会员级别不存在'
            )
        })

        it('不存在的节点应抛出错误', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)
            const level = await createTestLevel()

            await expect(batchUpdateAccessService(level.id, [node.id, 999999])).rejects.toThrow(
                '节点 999999 不存在'
            )
        })
    })

    describe('checkUserNodeAccessService', () => {
        it('有权限的用户应返回 true', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)
            const level = await createTestLevel()
            const user = await createTestUser()
            await createTestMembership(user.id, level.id)
            await createTestAccess(level.id, node.id)

            const hasAccess = await checkUserNodeAccessService(user.id, node.id)
            expect(hasAccess).toBe(true)
        })

        it('无权限的用户应返回 false', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)
            const level = await createTestLevel()
            const user = await createTestUser()
            await createTestMembership(user.id, level.id)

            const hasAccess = await checkUserNodeAccessService(user.id, node.id)
            expect(hasAccess).toBe(false)
        })

        it('无会员的用户应返回 false', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)
            const user = await createTestUser()

            const hasAccess = await checkUserNodeAccessService(user.id, node.id)
            expect(hasAccess).toBe(false)
        })
    })

    describe('getUserAvailableNodesService', () => {
        it('有会员的用户应返回节点列表', async () => {
            const model = await createTestModel()
            const node1 = await createTestNode(model.id)
            const node2 = await createTestNode(model.id)
            const level = await createTestLevel()
            const user = await createTestUser()
            await createTestMembership(user.id, level.id)
            await createTestAccess(level.id, node1.id)

            const nodes = await getUserAvailableNodesService(user.id)

            expect(nodes.length).toBeGreaterThanOrEqual(2)
            const node1Result = nodes.find((n) => n.id === node1.id)
            const node2Result = nodes.find((n) => n.id === node2.id)
            expect(node1Result!.available).toBe(true)
            expect(node2Result!.available).toBe(false)
        })

        it('无会员的用户应返回空列表', async () => {
            const user = await createTestUser()

            const nodes = await getUserAvailableNodesService(user.id)
            expect(nodes).toEqual([])
        })
    })

    describe('filterUserAccessibleNodesService', () => {
        it('应只返回有权限的节点', async () => {
            const model = await createTestModel()
            const node1 = await createTestNode(model.id)
            const node2 = await createTestNode(model.id)
            const node3 = await createTestNode(model.id)
            const level = await createTestLevel()
            const user = await createTestUser()
            await createTestMembership(user.id, level.id)
            await createTestAccess(level.id, node1.id)
            await createTestAccess(level.id, node3.id)

            const accessible = await filterUserAccessibleNodesService(user.id, [
                node1.id,
                node2.id,
                node3.id,
            ])

            expect(accessible.length).toBe(2)
            expect(accessible).toContain(node1.id)
            expect(accessible).toContain(node3.id)
            expect(accessible).not.toContain(node2.id)
        })

        it('无会员的用户应返回空列表', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)
            const user = await createTestUser()

            const accessible = await filterUserAccessibleNodesService(user.id, [node.id])
            expect(accessible).toEqual([])
        })
    })
})
