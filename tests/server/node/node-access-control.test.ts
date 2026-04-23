/**
 * 节点权限访问控制属性测试
 *
 * **Feature: case-analysis, Property 7: 节点权限访问控制**
 * **Validates: Requirements 14.18**
 *
 * 测试属性：用户执行分析任务时，只能访问其会员级别被授权的节点，
 * 未授权节点应被过滤。
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import * as fc from 'fast-check'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../../generated/prisma/client'
import { config } from 'dotenv'
import { resolve } from 'node:path'
import {
    checkUserNodeAccessService,
    getUserAvailableNodesService,
    filterUserAccessibleNodesService,
    grantAccessService,
    revokeAccessService,
} from '../../../server/services/node/access.service'
import {
    createTestUser,
    createTestMembershipLevel,
    createTestUserMembership,
    MembershipStatus,
    MembershipLevelStatus,
} from '../membership/test-db-helper'

// 加载测试环境变量（强制指向 .env.testing，避免误连生产库）
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
    membershipLevelIds: [] as number[],
    userMembershipIds: [] as number[],
    nodeIds: [] as number[],
    modelIds: [] as number[],
    providerIds: [] as number[],
    accessIds: [] as number[],
}

// 生成唯一的测试标识
const generateTestId = () => `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

// 创建测试模型（节点需要关联模型）
const createTestModel = async () => {
    // 查找已有的模型提供商或创建一个
    let provider = await testPrisma.modelProviders.findFirst({
        where: { deletedAt: null },
    })

    if (!provider) {
        provider = await testPrisma.modelProviders.create({
            data: {
                name: `test_provider_${generateTestId()}`,
                baseUrl: 'https://api.test.com',
            },
        })
        testIds.providerIds.push(provider.id)
    }

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
const createTestNode = async (modelId: number, type: string = 'analysis') => {
    const testId = generateTestId()
    const node = await testPrisma.nodes.create({
        data: {
            name: `test_node_${testId}`,
            title: `测试节点_${testId}`,
            description: '测试用节点',
            type,
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

// 清理测试数据
const cleanupTestData = async () => {
    // 按依赖顺序删除
    if (testIds.accessIds.length > 0) {
        await testPrisma.levelNodeAccess.deleteMany({
            where: { id: { in: testIds.accessIds } },
        })
        testIds.accessIds = []
    }
    if (testIds.userMembershipIds.length > 0) {
        await testPrisma.userMemberships.deleteMany({
            where: { id: { in: testIds.userMembershipIds } },
        })
        testIds.userMembershipIds = []
    }
    if (testIds.nodeIds.length > 0) {
        await testPrisma.nodes.deleteMany({
            where: { id: { in: testIds.nodeIds } },
        })
        testIds.nodeIds = []
    }
    if (testIds.modelIds.length > 0) {
        await testPrisma.models.deleteMany({
            where: { id: { in: testIds.modelIds } },
        })
        testIds.modelIds = []
    }
    if (testIds.providerIds.length > 0) {
        await testPrisma.modelApiKeys.deleteMany({
            where: { providerId: { in: testIds.providerIds } },
        })
        await testPrisma.modelProviders.deleteMany({
            where: { id: { in: testIds.providerIds } },
        })
        testIds.providerIds = []
    }
    if (testIds.membershipLevelIds.length > 0) {
        await testPrisma.membershipLevels.deleteMany({
            where: { id: { in: testIds.membershipLevelIds } },
        })
        testIds.membershipLevelIds = []
    }
    if (testIds.userIds.length > 0) {
        await testPrisma.users.deleteMany({
            where: { id: { in: testIds.userIds } },
        })
        testIds.userIds = []
    }
}

describe('节点权限访问控制属性测试', () => {
    beforeAll(async () => {
        try {
            await testPrisma.$connect()
            // 重置序列以避免冲突
            await testPrisma.$executeRaw`SELECT setval('nodes_id_seq', GREATEST((SELECT MAX(id) FROM nodes), 1000))`
            await testPrisma.$executeRaw`SELECT setval('models_id_seq', GREATEST((SELECT MAX(id) FROM models), 1000))`
            await testPrisma.$executeRaw`SELECT setval('level_node_access_id_seq', GREATEST((SELECT MAX(id) FROM level_node_access), 1000))`
            await testPrisma.$executeRaw`SELECT setval('users_id_seq', GREATEST((SELECT MAX(id) FROM users), 1000))`
            await testPrisma.$executeRaw`SELECT setval('membership_levels_id_seq', GREATEST((SELECT MAX(id) FROM membership_levels), 1000))`
            await testPrisma.$executeRaw`SELECT setval('user_memberships_id_seq', GREATEST((SELECT MAX(id) FROM user_memberships), 1000))`
        } catch (error) {
            console.warn('数据库连接失败，跳过测试')
        }
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

    describe('Property 7: 节点权限访问控制', () => {
        /**
         * 属性测试：用户只能访问其会员级别被授权的节点
         *
         * **Feature: case-analysis, Property 7: 节点权限访问控制**
         * **Validates: Requirements 14.18**
         */
        it('属性测试：用户只能访问其会员级别被授权的节点', async () => {
            // 节点数量生成器（2-5个节点）
            const nodeCountArb = fc.integer({ min: 2, max: 5 })

            // 授权节点索引生成器（随机选择部分节点授权）
            const authorizedIndicesArb = (maxIndex: number) =>
                fc.array(fc.integer({ min: 0, max: maxIndex }), { minLength: 0, maxLength: maxIndex + 1 })
                    .map(indices => [...new Set(indices)]) // 去重

            await fc.assert(
                fc.asyncProperty(
                    nodeCountArb,
                    async (nodeCount) => {
                        // 每次迭代创建新的模型
                        const model = await createTestModel()

                        // 创建测试用户
                        const user = await createTestUser()
                        testIds.userIds.push(user.id)

                        // 创建测试会员级别
                        const level = await createTestMembershipLevel({
                            name: `测试级别_${generateTestId()}`,
                            status: MembershipLevelStatus.ENABLED,
                        })
                        testIds.membershipLevelIds.push(level.id)

                        // 创建用户会员记录
                        const membership = await createTestUserMembership(user.id, level.id, {
                            status: MembershipStatus.ACTIVE,
                        })
                        testIds.userMembershipIds.push(membership.id)

                        // 创建多个测试节点
                        const nodes: { id: number; name: string }[] = []
                        for (let i = 0; i < nodeCount; i++) {
                            const node = await createTestNode(model.id)
                            nodes.push({ id: node.id, name: node.name })
                        }

                        // 随机选择部分节点进行授权
                        const authorizedIndices = await fc.sample(
                            authorizedIndicesArb(nodeCount - 1),
                            1
                        )[0]

                        const authorizedNodeIds = new Set<number>()
                        for (const index of authorizedIndices) {
                            const nodeId = nodes[index].id
                            await createTestAccess(level.id, nodeId)
                            authorizedNodeIds.add(nodeId)
                        }

                        // 验证：检查每个节点的访问权限
                        for (const node of nodes) {
                            const hasAccess = await checkUserNodeAccessService(user.id, node.id)
                            const shouldHaveAccess = authorizedNodeIds.has(node.id)

                            // 属性断言：用户只能访问被授权的节点
                            expect(hasAccess).toBe(shouldHaveAccess)
                        }

                        // 清理本次迭代的数据
                        await cleanupTestData()
                    }
                ),
                { numRuns: 100 }
            )
        })

        /**
         * 属性测试：过滤用户可访问节点时，只返回授权节点
         *
         * **Feature: case-analysis, Property 7: 节点权限访问控制**
         * **Validates: Requirements 14.18**
         */
        it('属性测试：过滤用户可访问节点时，只返回授权节点', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 3, max: 6 }), // 节点数量
                    fc.integer({ min: 0, max: 5 }),  // 授权节点数量
                    async (nodeCount, authorizedCount) => {
                        // 每次迭代创建新的模型
                        const model = await createTestModel()

                        // 确保授权数量不超过节点数量
                        const actualAuthorizedCount = Math.min(authorizedCount, nodeCount)

                        // 创建测试用户
                        const user = await createTestUser()
                        testIds.userIds.push(user.id)

                        // 创建测试会员级别
                        const level = await createTestMembershipLevel({
                            name: `测试级别_${generateTestId()}`,
                            status: MembershipLevelStatus.ENABLED,
                        })
                        testIds.membershipLevelIds.push(level.id)

                        // 创建用户会员记录
                        const membership = await createTestUserMembership(user.id, level.id, {
                            status: MembershipStatus.ACTIVE,
                        })
                        testIds.userMembershipIds.push(membership.id)

                        // 创建测试节点
                        const nodes: number[] = []
                        for (let i = 0; i < nodeCount; i++) {
                            const node = await createTestNode(model.id)
                            nodes.push(node.id)
                        }

                        // 授权前 actualAuthorizedCount 个节点
                        const authorizedNodeIds = new Set<number>()
                        for (let i = 0; i < actualAuthorizedCount; i++) {
                            await createTestAccess(level.id, nodes[i])
                            authorizedNodeIds.add(nodes[i])
                        }

                        // 调用过滤服务
                        const accessibleNodes = await filterUserAccessibleNodesService(user.id, nodes)

                        // 属性断言：返回的节点数量等于授权节点数量
                        expect(accessibleNodes.length).toBe(actualAuthorizedCount)

                        // 属性断言：返回的所有节点都是授权节点
                        for (const nodeId of accessibleNodes) {
                            expect(authorizedNodeIds.has(nodeId)).toBe(true)
                        }

                        // 属性断言：所有授权节点都被返回
                        for (const nodeId of authorizedNodeIds) {
                            expect(accessibleNodes.includes(nodeId)).toBe(true)
                        }

                        // 清理本次迭代的数据
                        await cleanupTestData()
                    }
                ),
                { numRuns: 100 }
            )
        })

        /**
         * 属性测试：无会员身份的用户无法访问任何节点
         *
         * **Feature: case-analysis, Property 7: 节点权限访问控制**
         * **Validates: Requirements 14.18**
         */
        it('属性测试：无会员身份的用户无法访问任何节点', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 5 }), // 节点数量
                    async (nodeCount) => {
                        // 每次迭代创建新的模型
                        const model = await createTestModel()

                        // 创建测试用户（无会员身份）
                        const user = await createTestUser()
                        testIds.userIds.push(user.id)

                        // 创建测试节点
                        const nodes: number[] = []
                        for (let i = 0; i < nodeCount; i++) {
                            const node = await createTestNode(model.id)
                            nodes.push(node.id)
                        }

                        // 验证：无会员身份的用户无法访问任何节点
                        for (const nodeId of nodes) {
                            const hasAccess = await checkUserNodeAccessService(user.id, nodeId)
                            expect(hasAccess).toBe(false)
                        }

                        // 验证：过滤结果为空
                        const accessibleNodes = await filterUserAccessibleNodesService(user.id, nodes)
                        expect(accessibleNodes.length).toBe(0)

                        // 清理本次迭代的数据
                        await cleanupTestData()
                    }
                ),
                { numRuns: 100 }
            )
        })

        /**
         * 属性测试：撤销权限后用户无法访问该节点
         *
         * **Feature: case-analysis, Property 7: 节点权限访问控制**
         * **Validates: Requirements 14.18**
         */
        it('属性测试：撤销权限后用户无法访问该节点', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 2, max: 4 }), // 节点数量
                    fc.integer({ min: 0, max: 3 }),  // 要撤销的节点索引
                    async (nodeCount, revokeIndex) => {
                        // 每次迭代创建新的模型
                        const model = await createTestModel()

                        const safeRevokeIndex = revokeIndex % nodeCount

                        // 创建测试用户
                        const user = await createTestUser()
                        testIds.userIds.push(user.id)

                        // 创建测试会员级别
                        const level = await createTestMembershipLevel({
                            name: `测试级别_${generateTestId()}`,
                            status: MembershipLevelStatus.ENABLED,
                        })
                        testIds.membershipLevelIds.push(level.id)

                        // 创建用户会员记录
                        const membership = await createTestUserMembership(user.id, level.id, {
                            status: MembershipStatus.ACTIVE,
                        })
                        testIds.userMembershipIds.push(membership.id)

                        // 创建测试节点并全部授权
                        const nodes: number[] = []
                        for (let i = 0; i < nodeCount; i++) {
                            const node = await createTestNode(model.id)
                            nodes.push(node.id)
                            await createTestAccess(level.id, node.id)
                        }

                        // 验证：撤销前所有节点都可访问
                        for (const nodeId of nodes) {
                            const hasAccess = await checkUserNodeAccessService(user.id, nodeId)
                            expect(hasAccess).toBe(true)
                        }

                        // 撤销指定节点的权限
                        const nodeToRevoke = nodes[safeRevokeIndex]
                        await revokeAccessService(level.id, nodeToRevoke)

                        // 验证：撤销后该节点不可访问
                        const hasAccessAfterRevoke = await checkUserNodeAccessService(user.id, nodeToRevoke)
                        expect(hasAccessAfterRevoke).toBe(false)

                        // 验证：其他节点仍可访问
                        for (let i = 0; i < nodes.length; i++) {
                            if (i !== safeRevokeIndex) {
                                const hasAccess = await checkUserNodeAccessService(user.id, nodes[i])
                                expect(hasAccess).toBe(true)
                            }
                        }

                        // 清理本次迭代的数据
                        await cleanupTestData()
                    }
                ),
                { numRuns: 100 }
            )
        })

        /**
         * 属性测试：getUserAvailableNodesService 返回正确的权限标记
         *
         * **Feature: case-analysis, Property 7: 节点权限访问控制**
         * **Validates: Requirements 14.18**
         */
        it('属性测试：获取用户可用节点列表时权限标记正确', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 2, max: 5 }), // 节点数量
                    fc.array(fc.boolean(), { minLength: 2, maxLength: 5 }), // 每个节点是否授权
                    async (nodeCount, authorizations) => {
                        // 每次迭代创建新的模型
                        const model = await createTestModel()

                        // 确保授权数组长度与节点数量一致
                        const actualAuthorizations = authorizations.slice(0, nodeCount)
                        while (actualAuthorizations.length < nodeCount) {
                            actualAuthorizations.push(false)
                        }

                        // 创建测试用户
                        const user = await createTestUser()
                        testIds.userIds.push(user.id)

                        // 创建测试会员级别
                        const level = await createTestMembershipLevel({
                            name: `测试级别_${generateTestId()}`,
                            status: MembershipLevelStatus.ENABLED,
                        })
                        testIds.membershipLevelIds.push(level.id)

                        // 创建用户会员记录
                        const membership = await createTestUserMembership(user.id, level.id, {
                            status: MembershipStatus.ACTIVE,
                        })
                        testIds.userMembershipIds.push(membership.id)

                        // 创建测试节点并根据授权数组授权
                        const nodeIdToAuthorized = new Map<number, boolean>()
                        for (let i = 0; i < nodeCount; i++) {
                            const node = await createTestNode(model.id)
                            nodeIdToAuthorized.set(node.id, actualAuthorizations[i])
                            if (actualAuthorizations[i]) {
                                await createTestAccess(level.id, node.id)
                            }
                        }

                        // 获取用户可用节点列表
                        const availableNodes = await getUserAvailableNodesService(user.id)

                        // 验证：每个节点的 available 标记与授权状态一致
                        for (const node of availableNodes) {
                            const expectedAvailable = nodeIdToAuthorized.get(node.id)
                            if (expectedAvailable !== undefined) {
                                expect(node.available).toBe(expectedAvailable)
                            }
                        }

                        // 清理本次迭代的数据
                        await cleanupTestData()
                    }
                ),
                { numRuns: 100 }
            )
        })
    })
})
