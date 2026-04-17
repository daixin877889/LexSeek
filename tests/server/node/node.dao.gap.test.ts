/**
 * 节点 DAO 覆盖率补齐测试（gap）
 *
 * 目标：覆盖 server/services/node/node.dao.ts 中剩余的 catch 分支以及
 * 部分未被 node.dao.test.ts / node.dao.coverage.test.ts /
 * node.dao.extra.coverage.test.ts 覆盖的路径。
 *
 * - 通过替换全局 prisma 为 Proxy 注入故障，命中每个 DAO 的 catch 分支
 * - 同时覆盖正常路径，验证 tx 参数透传与排序/分页等未覆盖分支
 *
 * **Feature: node-management**
 * **Validates: Requirements 14.1, 14.2, 14.3**
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
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
    if (!connectionString) throw new Error('DATABASE_URL 环境变量未设置')
    const pool = new PrismaPg({ connectionString })
    return new PrismaClient({ adapter: pool })
}

const testPrisma = createTestPrisma()

// 确保全局 prisma / logger 可用（部分测试场景 test-setup 已设置，此处做兜底）
;(globalThis as any).prisma = (globalThis as any).prisma ?? testPrisma
if (!(globalThis as any).logger) {
    ;(globalThis as any).logger = {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
    }
}

const testIds = {
    nodeIds: [] as number[],
    groupIds: [] as number[],
    modelIds: [] as number[],
    providerIds: [] as number[],
    promptIds: [] as number[],
    apiKeyIds: [] as number[],
}

const generateTestId = () =>
    `gap_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`

const createTestModel = async () => {
    const provider = await testPrisma.modelProviders.create({
        data: {
            name: `test_provider_${generateTestId()}`,
            baseUrl: 'https://api.test.com',
        },
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

/**
 * 以 Proxy 替换全局 prisma，使任何属性访问都抛出指定错误，
 * 用于命中 DAO 中的 catch 分支。执行完毕后还原原始 prisma。
 */
const withFaultInjection = async (
    run: () => Promise<void>,
    faultMessage = 'injected-fault'
) => {
    const originalPrisma = (globalThis as any).prisma
    ;(globalThis as any).prisma = new Proxy(
        {},
        {
            get: () => {
                throw new Error(faultMessage)
            },
        }
    )
    try {
        await run()
    } finally {
        ;(globalThis as any).prisma = originalPrisma
    }
}

describe('节点 DAO 覆盖率补齐（gap）', () => {
    beforeAll(async () => {
        await testPrisma.$connect()
    })

    afterAll(async () => {
        // 按外键依赖顺序清理本轮全部测试数据（afterAll hard delete）
        try {
            if (testIds.promptIds.length > 0) {
                await testPrisma.prompts.deleteMany({
                    where: { id: { in: testIds.promptIds } },
                })
            }
            if (testIds.apiKeyIds.length > 0) {
                await testPrisma.modelApiKeys.deleteMany({
                    where: { id: { in: testIds.apiKeyIds } },
                })
            }
            if (testIds.nodeIds.length > 0) {
                await testPrisma.prompts.deleteMany({
                    where: { nodeId: { in: testIds.nodeIds } },
                })
                await testPrisma.levelNodeAccess.deleteMany({
                    where: { nodeId: { in: testIds.nodeIds } },
                })
                await testPrisma.caseAnalyses.deleteMany({
                    where: { nodeId: { in: testIds.nodeIds } },
                })
                await testPrisma.nodes.deleteMany({
                    where: { id: { in: testIds.nodeIds } },
                })
            }
            if (testIds.groupIds.length > 0) {
                await testPrisma.nodeGroups.deleteMany({
                    where: { id: { in: testIds.groupIds } },
                })
            }
            if (testIds.modelIds.length > 0) {
                await testPrisma.models.deleteMany({
                    where: { id: { in: testIds.modelIds } },
                })
            }
            if (testIds.providerIds.length > 0) {
                await testPrisma.modelApiKeys.deleteMany({
                    where: { providerId: { in: testIds.providerIds } },
                })
                await testPrisma.modelProviders.deleteMany({
                    where: { id: { in: testIds.providerIds } },
                })
            }
        } catch (err) {
            // 不因清理异常阻塞测试收尾
            console.warn('[node.dao.gap] 清理异常：', err)
        }
        await testPrisma.$disconnect()
    })

    // ==================== catch 分支 ====================

    describe('catch 分支 - 节点分组 DAO', () => {
        it('createNodeGroupDao prisma 异常时应抛出', async () => {
            await withFaultInjection(async () => {
                await expect(
                    createNodeGroupDao({ name: 'whatever' })
                ).rejects.toThrow('injected-fault')
            })
        })

        it('findNodeGroupByIdDao prisma 异常时应抛出', async () => {
            await withFaultInjection(async () => {
                await expect(findNodeGroupByIdDao(1)).rejects.toThrow(
                    'injected-fault'
                )
            })
        })

        it('findManyNodeGroupsDao prisma 异常时应抛出', async () => {
            await withFaultInjection(async () => {
                await expect(findManyNodeGroupsDao({})).rejects.toThrow(
                    'injected-fault'
                )
            })
        })

        it('findAllNodeGroupsDao prisma 异常时应抛出', async () => {
            await withFaultInjection(async () => {
                await expect(findAllNodeGroupsDao()).rejects.toThrow(
                    'injected-fault'
                )
            })
        })

        it('updateNodeGroupDao prisma 异常时应抛出', async () => {
            await withFaultInjection(async () => {
                await expect(
                    updateNodeGroupDao(1, { name: 'x' })
                ).rejects.toThrow('injected-fault')
            })
        })

        it('softDeleteNodeGroupDao prisma 异常时应抛出', async () => {
            await withFaultInjection(async () => {
                await expect(softDeleteNodeGroupDao(1)).rejects.toThrow(
                    'injected-fault'
                )
            })
        })
    })

    describe('catch 分支 - 节点 DAO', () => {
        it('createNodeDao prisma 异常时应抛出', async () => {
            await withFaultInjection(async () => {
                await expect(
                    createNodeDao({
                        name: 'x',
                        type: 'analysis',
                        modelId: 1,
                    })
                ).rejects.toThrow('injected-fault')
            })
        })

        it('findNodeByIdDao prisma 异常时应抛出', async () => {
            await withFaultInjection(async () => {
                await expect(findNodeByIdDao(1)).rejects.toThrow(
                    'injected-fault'
                )
            })
        })

        it('findNodesByIdsDao prisma 异常时应抛出', async () => {
            await withFaultInjection(async () => {
                await expect(findNodesByIdsDao([1, 2])).rejects.toThrow(
                    'injected-fault'
                )
            })
        })

        it('findNodeByNameDao prisma 异常时应抛出', async () => {
            await withFaultInjection(async () => {
                await expect(findNodeByNameDao('x')).rejects.toThrow(
                    'injected-fault'
                )
            })
        })

        it('findManyNodesDao prisma 异常时应抛出', async () => {
            await withFaultInjection(async () => {
                await expect(findManyNodesDao({})).rejects.toThrow(
                    'injected-fault'
                )
            })
        })

        it('findAllNodesDao prisma 异常时应抛出', async () => {
            await withFaultInjection(async () => {
                await expect(findAllNodesDao()).rejects.toThrow(
                    'injected-fault'
                )
            })
        })

        it('findNodesByGroupIdDao prisma 异常时应抛出', async () => {
            await withFaultInjection(async () => {
                await expect(findNodesByGroupIdDao(1)).rejects.toThrow(
                    'injected-fault'
                )
            })
        })

        it('updateNodeDao prisma 异常时应抛出', async () => {
            await withFaultInjection(async () => {
                await expect(
                    updateNodeDao(1, { title: 'x' })
                ).rejects.toThrow('injected-fault')
            })
        })

        it('updateNodeStatusDao prisma 异常时应抛出', async () => {
            await withFaultInjection(async () => {
                await expect(updateNodeStatusDao(1, 0)).rejects.toThrow(
                    'injected-fault'
                )
            })
        })

        it('softDeleteNodeDao prisma 异常时应抛出', async () => {
            await withFaultInjection(async () => {
                await expect(softDeleteNodeDao(1)).rejects.toThrow(
                    'injected-fault'
                )
            })
        })

        it('batchUpdateNodeGroupDao prisma 异常时应抛出', async () => {
            await withFaultInjection(async () => {
                await expect(
                    batchUpdateNodeGroupDao([1], null)
                ).rejects.toThrow('injected-fault')
            })
        })

        it('getNodeConfigDao prisma 异常时应抛出', async () => {
            await withFaultInjection(async () => {
                await expect(getNodeConfigDao('x')).rejects.toThrow(
                    'injected-fault'
                )
            })
        })

        it('getNodeConfigByIdDao prisma 异常时应抛出', async () => {
            await withFaultInjection(async () => {
                await expect(getNodeConfigByIdDao(1)).rejects.toThrow(
                    'injected-fault'
                )
            })
        })
    })

    // ==================== 正常路径补齐（tx + 特殊分支） ====================

    describe('正常路径 - tx 事务参数透传', () => {
        it('createNodeGroupDao 使用 tx 参数应通过事务客户端执行', async () => {
            const group = await testPrisma.$transaction(async (tx) => {
                return createNodeGroupDao(
                    {
                        name: `group_test_tx_${generateTestId()}`,
                        description: '事务分组',
                    },
                    tx as any
                )
            })
            testIds.groupIds.push(group.id)
            expect(group.id).toBeDefined()
            expect(group.description).toBe('事务分组')
        })

        it('createNodeDao 使用 tx 参数创建节点', async () => {
            const { model } = await createTestModel()
            const node = await testPrisma.$transaction(async (tx) => {
                return createNodeDao(
                    {
                        name: `test_node_${generateTestId()}`,
                        title: '事务节点',
                        type: 'analysis',
                        modelId: model.id,
                        outputSchema: { type: 'object' },
                    },
                    tx as any
                )
            })
            testIds.nodeIds.push(node.id)
            expect(node.id).toBeDefined()
        })

        it('findNodeByIdDao 使用 tx 参数查询节点', async () => {
            const { model } = await createTestModel()
            const created = await createNodeDao({
                name: `test_node_${generateTestId()}`,
                type: 'analysis',
                modelId: model.id,
            })
            testIds.nodeIds.push(created.id)

            const found = await testPrisma.$transaction(async (tx) => {
                return findNodeByIdDao(created.id, tx as any)
            })
            expect(found).not.toBeNull()
            expect(found!.id).toBe(created.id)
        })

        it('findManyNodesDao 使用 tx 参数 + 不同排序方向', async () => {
            const { model } = await createTestModel()
            const node = await createNodeDao({
                name: `test_node_${generateTestId()}`,
                type: 'analysis',
                modelId: model.id,
            })
            testIds.nodeIds.push(node.id)

            const result = await testPrisma.$transaction(async (tx) => {
                return findManyNodesDao(
                    {
                        page: 1,
                        pageSize: 5,
                        orderBy: 'createdAt',
                        orderDir: 'desc',
                    },
                    tx as any
                )
            })
            expect(result.total).toBeGreaterThanOrEqual(1)
        })

        it('findManyNodeGroupsDao 使用 tx 参数 + 关键词 + 不同排序', async () => {
            const keyword = `grp_kw_${generateTestId()}`
            const created = await createNodeGroupDao({
                name: `group_test_${keyword}`,
                description: keyword,
            })
            testIds.groupIds.push(created.id)

            const result = await testPrisma.$transaction(async (tx) => {
                return findManyNodeGroupsDao(
                    {
                        keyword,
                        orderBy: 'createdAt',
                        orderDir: 'desc',
                    },
                    tx as any
                )
            })
            expect(result.list.some((g) => g.id === created.id)).toBe(true)
        })

        it('findAllNodeGroupsDao 使用 tx 参数', async () => {
            const groups = await testPrisma.$transaction(async (tx) => {
                return findAllNodeGroupsDao(tx as any)
            })
            expect(Array.isArray(groups)).toBe(true)
        })

        it('updateNodeGroupDao 仅更新部分字段并透传 tx', async () => {
            const group = await createNodeGroupDao({
                name: `group_test_${generateTestId()}`,
                description: '旧描述',
                priority: 50,
            })
            testIds.groupIds.push(group.id)

            const updated = await testPrisma.$transaction(async (tx) => {
                return updateNodeGroupDao(
                    group.id,
                    { priority: 200 },
                    tx as any
                )
            })
            expect(updated.priority).toBe(200)
            // 未传 name / description 时保持不变
            expect(updated.name).toBe(group.name)
            expect(updated.description).toBe('旧描述')
        })

        it('softDeleteNodeGroupDao 使用 tx 参数', async () => {
            const group = await createNodeGroupDao({
                name: `group_test_${generateTestId()}`,
            })
            testIds.groupIds.push(group.id)
            await testPrisma.$transaction(async (tx) => {
                await softDeleteNodeGroupDao(group.id, tx as any)
            })
            const found = await findNodeGroupByIdDao(group.id)
            expect(found).toBeNull()
        })

        it('findNodesByIdsDao 使用 tx 参数', async () => {
            const { model } = await createTestModel()
            const n1 = await createNodeDao({
                name: `test_node_${generateTestId()}`,
                type: 'analysis',
                modelId: model.id,
            })
            const n2 = await createNodeDao({
                name: `test_node_${generateTestId()}`,
                type: 'analysis',
                modelId: model.id,
            })
            testIds.nodeIds.push(n1.id, n2.id)
            const found = await testPrisma.$transaction(async (tx) => {
                return findNodesByIdsDao([n1.id, n2.id], tx as any)
            })
            expect(found.length).toBe(2)
        })

        it('findNodeByNameDao 使用 tx 参数', async () => {
            const { model } = await createTestModel()
            const name = `test_node_${generateTestId()}`
            const node = await createNodeDao({
                name,
                type: 'analysis',
                modelId: model.id,
            })
            testIds.nodeIds.push(node.id)
            const found = await testPrisma.$transaction(async (tx) => {
                return findNodeByNameDao(name, tx as any)
            })
            expect(found!.id).toBe(node.id)
        })

        it('findAllNodesDao 使用 tx 参数', async () => {
            const { model } = await createTestModel()
            const node = await createNodeDao({
                name: `test_node_${generateTestId()}`,
                type: 'analysis',
                modelId: model.id,
            })
            testIds.nodeIds.push(node.id)
            const nodes = await testPrisma.$transaction(async (tx) => {
                return findAllNodesDao({ type: 'analysis' }, tx as any)
            })
            expect(nodes.some((n) => n.id === node.id)).toBe(true)
        })

        it('findNodesByGroupIdDao 使用 tx 参数', async () => {
            const { model } = await createTestModel()
            const group = await createNodeGroupDao({
                name: `group_test_${generateTestId()}`,
            })
            testIds.groupIds.push(group.id)
            const node = await createNodeDao({
                name: `test_node_${generateTestId()}`,
                type: 'analysis',
                modelId: model.id,
                groupId: group.id,
            })
            testIds.nodeIds.push(node.id)
            const nodes = await testPrisma.$transaction(async (tx) => {
                return findNodesByGroupIdDao(group.id, tx as any)
            })
            expect(nodes.some((n) => n.id === node.id)).toBe(true)
        })

        it('updateNodeDao 使用 tx 参数', async () => {
            const { model } = await createTestModel()
            const node = await createNodeDao({
                name: `test_node_${generateTestId()}`,
                type: 'analysis',
                modelId: model.id,
            })
            testIds.nodeIds.push(node.id)
            const updated = await testPrisma.$transaction(async (tx) => {
                return updateNodeDao(
                    node.id,
                    { title: 'new title via tx' },
                    tx as any
                )
            })
            expect(updated.title).toBe('new title via tx')
        })

        it('updateNodeStatusDao 使用 tx 参数', async () => {
            const { model } = await createTestModel()
            const node = await createNodeDao({
                name: `test_node_${generateTestId()}`,
                type: 'analysis',
                modelId: model.id,
            })
            testIds.nodeIds.push(node.id)
            const updated = await testPrisma.$transaction(async (tx) => {
                return updateNodeStatusDao(node.id, 0, tx as any)
            })
            expect(updated.status).toBe(0)
        })

        it('softDeleteNodeDao 使用 tx 参数', async () => {
            const { model } = await createTestModel()
            const node = await createNodeDao({
                name: `test_node_${generateTestId()}`,
                type: 'analysis',
                modelId: model.id,
            })
            testIds.nodeIds.push(node.id)
            await testPrisma.$transaction(async (tx) => {
                await softDeleteNodeDao(node.id, tx as any)
            })
            const found = await findNodeByIdDao(node.id)
            expect(found).toBeNull()
        })

        it('batchUpdateNodeGroupDao 使用 tx 参数', async () => {
            const { model } = await createTestModel()
            const group = await createNodeGroupDao({
                name: `group_test_${generateTestId()}`,
            })
            testIds.groupIds.push(group.id)
            const node = await createNodeDao({
                name: `test_node_${generateTestId()}`,
                type: 'analysis',
                modelId: model.id,
            })
            testIds.nodeIds.push(node.id)
            await testPrisma.$transaction(async (tx) => {
                await batchUpdateNodeGroupDao(
                    [node.id],
                    group.id,
                    tx as any
                )
            })
            const found = await findNodeByIdDao(node.id)
            expect(found!.groupId).toBe(group.id)
        })

        it('getNodeConfigDao 使用 tx 参数', async () => {
            const { model } = await createTestModel()
            const name = `test_node_${generateTestId()}`
            const node = await createNodeDao({
                name,
                type: 'analysis',
                modelId: model.id,
                status: 1,
            })
            testIds.nodeIds.push(node.id)
            const config = await testPrisma.$transaction(async (tx) => {
                return getNodeConfigDao(name, tx as any)
            })
            expect(config!.id).toBe(node.id)
        })

        it('getNodeConfigByIdDao 使用 tx 参数', async () => {
            const { model } = await createTestModel()
            const node = await createNodeDao({
                name: `test_node_${generateTestId()}`,
                type: 'analysis',
                modelId: model.id,
                status: 1,
            })
            testIds.nodeIds.push(node.id)
            const config = await testPrisma.$transaction(async (tx) => {
                return getNodeConfigByIdDao(node.id, tx as any)
            })
            expect(config!.id).toBe(node.id)
        })
    })
})
