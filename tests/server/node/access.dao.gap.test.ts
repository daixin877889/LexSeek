/**
 * 会员节点权限 DAO 覆盖率补齐测试（gap）
 *
 * 目标：覆盖 server/services/node/access.dao.ts 中未被现有
 * access.dao.test.ts 覆盖的路径（主要为 catch 分支）。
 *
 * - 通过替换全局 prisma 为 Proxy 注入故障，命中每个 DAO 的 catch 分支
 * - 同时覆盖正常路径的 tx 参数透传
 *
 * **Feature: node-management**
 * **Validates: Requirements 14.15, 14.16, 14.17, 14.18, 14.19**
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
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
    restoreAccessDao,
    softDeleteAccessDao,
    softDeleteAccessByLevelAndNodeDao,
    softDeleteAccessByLevelAndNodesDao,
    softDeleteAccessByLevelIdDao,
    findDeletedAccessDao,
} from '../../../server/services/node/access.dao'

config({ path: resolve(__dirname, '../../../.env.testing') })

const createTestPrisma = () => {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) throw new Error('DATABASE_URL 环境变量未设置')
    const pool = new PrismaPg({ connectionString })
    return new PrismaClient({ adapter: pool })
}

const testPrisma = createTestPrisma()

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
    accessIds: [] as number[],
    levelIds: [] as number[],
    nodeIds: [] as number[],
    modelIds: [] as number[],
    providerIds: [] as number[],
}

const generateTestId = () =>
    `accessgap_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`

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

describe('会员节点权限 DAO 覆盖率补齐（gap）', () => {
    beforeAll(async () => {
        await testPrisma.$connect()
    })

    afterAll(async () => {
        try {
            if (testIds.accessIds.length > 0) {
                await testPrisma.levelNodeAccess.deleteMany({
                    where: { id: { in: testIds.accessIds } },
                })
            }
            if (testIds.nodeIds.length > 0) {
                await testPrisma.levelNodeAccess.deleteMany({
                    where: { nodeId: { in: testIds.nodeIds } },
                })
                await testPrisma.nodes.deleteMany({
                    where: { id: { in: testIds.nodeIds } },
                })
            }
            if (testIds.levelIds.length > 0) {
                await testPrisma.levelNodeAccess.deleteMany({
                    where: { levelId: { in: testIds.levelIds } },
                })
                await testPrisma.membershipLevels.deleteMany({
                    where: { id: { in: testIds.levelIds } },
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
            console.warn('[access.dao.gap] 清理异常：', err)
        }
        await testPrisma.$disconnect()
    })

    describe('catch 分支 - 注入故障后各 DAO 应抛出异常', () => {
        it('findAccessByIdDao 异常应抛出', async () => {
            await withFaultInjection(async () => {
                await expect(findAccessByIdDao(1)).rejects.toThrow(
                    'injected-fault'
                )
            })
        })

        it('findAccessByLevelAndNodeDao 异常应抛出', async () => {
            await withFaultInjection(async () => {
                await expect(
                    findAccessByLevelAndNodeDao(1, 2)
                ).rejects.toThrow('injected-fault')
            })
        })

        it('findAccessByLevelIdDao 异常应抛出', async () => {
            await withFaultInjection(async () => {
                await expect(findAccessByLevelIdDao(1)).rejects.toThrow(
                    'injected-fault'
                )
            })
        })

        it('findAccessByNodeIdDao 异常应抛出', async () => {
            await withFaultInjection(async () => {
                await expect(findAccessByNodeIdDao(1)).rejects.toThrow(
                    'injected-fault'
                )
            })
        })

        it('findAllAccessMatrixDao 异常应抛出', async () => {
            await withFaultInjection(async () => {
                await expect(findAllAccessMatrixDao()).rejects.toThrow(
                    'injected-fault'
                )
            })
        })

        it('createAccessDao 异常应抛出', async () => {
            await withFaultInjection(async () => {
                await expect(
                    createAccessDao({ levelId: 1, nodeId: 2 })
                ).rejects.toThrow('injected-fault')
            })
        })

        it('createManyAccessDao 异常应抛出', async () => {
            await withFaultInjection(async () => {
                await expect(
                    createManyAccessDao([{ levelId: 1, nodeId: 2 }])
                ).rejects.toThrow('injected-fault')
            })
        })

        it('restoreAccessDao 异常应抛出', async () => {
            await withFaultInjection(async () => {
                await expect(restoreAccessDao(1)).rejects.toThrow(
                    'injected-fault'
                )
            })
        })

        it('softDeleteAccessDao 异常应抛出', async () => {
            await withFaultInjection(async () => {
                await expect(softDeleteAccessDao(1)).rejects.toThrow(
                    'injected-fault'
                )
            })
        })

        it('softDeleteAccessByLevelAndNodeDao 异常应抛出', async () => {
            await withFaultInjection(async () => {
                await expect(
                    softDeleteAccessByLevelAndNodeDao(1, 2)
                ).rejects.toThrow('injected-fault')
            })
        })

        it('softDeleteAccessByLevelAndNodesDao 异常应抛出', async () => {
            await withFaultInjection(async () => {
                await expect(
                    softDeleteAccessByLevelAndNodesDao(1, [2, 3])
                ).rejects.toThrow('injected-fault')
            })
        })

        it('softDeleteAccessByLevelIdDao 异常应抛出', async () => {
            await withFaultInjection(async () => {
                await expect(softDeleteAccessByLevelIdDao(1)).rejects.toThrow(
                    'injected-fault'
                )
            })
        })

        it('findDeletedAccessDao 异常应抛出', async () => {
            await withFaultInjection(async () => {
                await expect(findDeletedAccessDao(1, 2)).rejects.toThrow(
                    'injected-fault'
                )
            })
        })
    })

    describe('正常路径 - tx 事务参数透传', () => {
        it('createAccessDao 使用 tx 参数', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)
            const level = await createTestLevel()

            const access = await testPrisma.$transaction(async (tx) => {
                return createAccessDao(
                    { levelId: level.id, nodeId: node.id },
                    tx as any
                )
            })
            testIds.accessIds.push(access.id)
            expect(access.id).toBeDefined()
            expect(access.levelId).toBe(level.id)
            expect(access.nodeId).toBe(node.id)
        })

        it('createManyAccessDao 使用 tx 参数 + skipDuplicates', async () => {
            const model = await createTestModel()
            const node1 = await createTestNode(model.id)
            const node2 = await createTestNode(model.id)
            const level = await createTestLevel()

            const count = await testPrisma.$transaction(async (tx) => {
                return createManyAccessDao(
                    [
                        { levelId: level.id, nodeId: node1.id },
                        { levelId: level.id, nodeId: node2.id },
                    ],
                    tx as any
                )
            })
            expect(count).toBe(2)
        })

        it('findAccessByIdDao 使用 tx 参数', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)
            const level = await createTestLevel()
            const access = await createAccessDao({
                levelId: level.id,
                nodeId: node.id,
            })
            testIds.accessIds.push(access.id)

            const found = await testPrisma.$transaction(async (tx) => {
                return findAccessByIdDao(access.id, tx as any)
            })
            expect(found!.id).toBe(access.id)
        })

        it('findAccessByLevelAndNodeDao 使用 tx 参数', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)
            const level = await createTestLevel()
            const access = await createAccessDao({
                levelId: level.id,
                nodeId: node.id,
            })
            testIds.accessIds.push(access.id)

            const found = await testPrisma.$transaction(async (tx) => {
                return findAccessByLevelAndNodeDao(
                    level.id,
                    node.id,
                    tx as any
                )
            })
            expect(found!.id).toBe(access.id)
        })

        it('findAccessByLevelIdDao 使用 tx 参数', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)
            const level = await createTestLevel()
            const access = await createAccessDao({
                levelId: level.id,
                nodeId: node.id,
            })
            testIds.accessIds.push(access.id)

            const list = await testPrisma.$transaction(async (tx) => {
                return findAccessByLevelIdDao(level.id, tx as any)
            })
            expect(list.some((x) => x.id === access.id)).toBe(true)
        })

        it('findAccessByNodeIdDao 使用 tx 参数', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)
            const level = await createTestLevel()
            const access = await createAccessDao({
                levelId: level.id,
                nodeId: node.id,
            })
            testIds.accessIds.push(access.id)

            const list = await testPrisma.$transaction(async (tx) => {
                return findAccessByNodeIdDao(node.id, tx as any)
            })
            expect(list.some((x) => x.id === access.id)).toBe(true)
        })

        it('findAllAccessMatrixDao 使用 tx 参数', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)
            const level = await createTestLevel()
            const access = await createAccessDao({
                levelId: level.id,
                nodeId: node.id,
            })
            testIds.accessIds.push(access.id)

            const list = await testPrisma.$transaction(async (tx) => {
                return findAllAccessMatrixDao(tx as any)
            })
            expect(list.some((x) => x.id === access.id)).toBe(true)
        })

        it('softDeleteAccessDao 使用 tx 参数', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)
            const level = await createTestLevel()
            const access = await createAccessDao({
                levelId: level.id,
                nodeId: node.id,
            })
            testIds.accessIds.push(access.id)

            await testPrisma.$transaction(async (tx) => {
                await softDeleteAccessDao(access.id, tx as any)
            })
            const row = await testPrisma.levelNodeAccess.findUnique({
                where: { id: access.id },
            })
            expect(row!.deletedAt).not.toBeNull()
        })

        it('softDeleteAccessByLevelAndNodeDao 使用 tx 参数', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)
            const level = await createTestLevel()
            const access = await createAccessDao({
                levelId: level.id,
                nodeId: node.id,
            })
            testIds.accessIds.push(access.id)

            await testPrisma.$transaction(async (tx) => {
                await softDeleteAccessByLevelAndNodeDao(
                    level.id,
                    node.id,
                    tx as any
                )
            })
            const found = await findAccessByLevelAndNodeDao(
                level.id,
                node.id
            )
            expect(found).toBeNull()
        })

        it('softDeleteAccessByLevelAndNodesDao 使用 tx 参数', async () => {
            const model = await createTestModel()
            const node1 = await createTestNode(model.id)
            const node2 = await createTestNode(model.id)
            const level = await createTestLevel()
            const a1 = await createAccessDao({
                levelId: level.id,
                nodeId: node1.id,
            })
            const a2 = await createAccessDao({
                levelId: level.id,
                nodeId: node2.id,
            })
            testIds.accessIds.push(a1.id, a2.id)

            await testPrisma.$transaction(async (tx) => {
                await softDeleteAccessByLevelAndNodesDao(
                    level.id,
                    [node1.id, node2.id],
                    tx as any
                )
            })

            const remaining = await findAccessByLevelIdDao(level.id)
            expect(remaining.length).toBe(0)
        })

        it('softDeleteAccessByLevelIdDao 使用 tx 参数', async () => {
            const model = await createTestModel()
            const node1 = await createTestNode(model.id)
            const node2 = await createTestNode(model.id)
            const level = await createTestLevel()
            const a1 = await createAccessDao({
                levelId: level.id,
                nodeId: node1.id,
            })
            const a2 = await createAccessDao({
                levelId: level.id,
                nodeId: node2.id,
            })
            testIds.accessIds.push(a1.id, a2.id)

            await testPrisma.$transaction(async (tx) => {
                await softDeleteAccessByLevelIdDao(level.id, tx as any)
            })
            const remaining = await findAccessByLevelIdDao(level.id)
            expect(remaining.length).toBe(0)
        })

        it('findDeletedAccessDao 使用 tx 参数', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)
            const level = await createTestLevel()
            const access = await createAccessDao({
                levelId: level.id,
                nodeId: node.id,
            })
            testIds.accessIds.push(access.id)
            await softDeleteAccessDao(access.id)

            const found = await testPrisma.$transaction(async (tx) => {
                return findDeletedAccessDao(level.id, node.id, tx as any)
            })
            expect(found!.id).toBe(access.id)
        })

        it('restoreAccessDao 使用 tx 参数', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)
            const level = await createTestLevel()
            const access = await createAccessDao({
                levelId: level.id,
                nodeId: node.id,
            })
            testIds.accessIds.push(access.id)
            await softDeleteAccessDao(access.id)

            const restored = await testPrisma.$transaction(async (tx) => {
                return restoreAccessDao(access.id, tx as any)
            })
            expect(restored.deletedAt).toBeNull()
        })
    })
})
