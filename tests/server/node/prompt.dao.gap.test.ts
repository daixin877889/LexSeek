/**
 * 提示词 DAO 覆盖率补齐测试（gap）
 *
 * 目标：覆盖 server/services/node/prompt.dao.ts 中未被现有
 * prompt.dao.test.ts 覆盖的路径（主要为 catch 分支）。
 *
 * - 通过替换全局 prisma 为 Proxy 注入故障，命中每个 DAO 的 catch 分支
 * - 同时覆盖正常路径的 tx 参数透传
 *
 * Phase 6 改造：prompts.nodeId 字段已删，节点维度查询通过 node_prompts 表 join；
 * 版本/激活/停用按 (name, type) 维度判定。
 *
 * **Feature: node-management**
 * **Validates: Requirements 14.9, 14.10, 14.11, 14.12, 14.13, 14.14**
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
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
    promptIds: [] as number[],
    nodeIds: [] as number[],
    modelIds: [] as number[],
    providerIds: [] as number[],
}

const generateTestId = () =>
    `promptgap_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`

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

/**
 * 把 prompt 关联到 node（多对多）。
 * 阶段 F 改造后，关联键改为业务身份 (name, type)。
 */
const linkPromptToNode = async (
    nodeId: number,
    prompt: { name: string; type: string },
    displayOrder = 100,
) => {
    await testPrisma.node_prompts.create({
        data: { nodeId, promptName: prompt.name, promptType: prompt.type, displayOrder },
    })
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

describe('提示词 DAO 覆盖率补齐（gap）', () => {
    beforeAll(async () => {
        await testPrisma.$connect()
    })

    afterAll(async () => {
        try {
            // 阶段 F 改造：node_prompts 不再绑定 promptId，按 nodeId 清理
            if (testIds.nodeIds.length > 0) {
                await testPrisma.node_prompts.deleteMany({
                    where: { nodeId: { in: testIds.nodeIds } },
                })
            }
            if (testIds.promptIds.length > 0) {
                await testPrisma.prompts.deleteMany({
                    where: { id: { in: testIds.promptIds } },
                })
            }
            if (testIds.nodeIds.length > 0) {
                await testPrisma.nodes.deleteMany({
                    where: { id: { in: testIds.nodeIds } },
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
            console.warn('[prompt.dao.gap] 清理异常：', err)
        }
        await testPrisma.$disconnect()
    })

    describe('catch 分支 - 注入故障后各 DAO 应抛出异常', () => {
        it('createPromptDao 异常应抛出', async () => {
            await withFaultInjection(async () => {
                await expect(
                    createPromptDao(
                        {
                            name: 'x',
                            title: 't',
                            content: 'c',
                            type: 'system',
                            nodeId: 0,
                        },
                        '1.0.0'
                    )
                ).rejects.toThrow('injected-fault')
            })
        })

        it('findPromptByIdDao 异常应抛出', async () => {
            await withFaultInjection(async () => {
                await expect(findPromptByIdDao(1)).rejects.toThrow(
                    'injected-fault'
                )
            })
        })

        it('findManyPromptsDao 异常应抛出', async () => {
            await withFaultInjection(async () => {
                await expect(findManyPromptsDao({})).rejects.toThrow(
                    'injected-fault'
                )
            })
        })

        it('findPromptsByNodeIdDao 异常应抛出', async () => {
            await withFaultInjection(async () => {
                await expect(findPromptsByNodeIdDao(1)).rejects.toThrow(
                    'injected-fault'
                )
            })
        })

        it('findActivePromptDao 异常应抛出', async () => {
            await withFaultInjection(async () => {
                await expect(
                    findActivePromptDao(1, 'system')
                ).rejects.toThrow('injected-fault')
            })
        })

        it('findPromptVersionsDao 异常应抛出', async () => {
            await withFaultInjection(async () => {
                await expect(
                    findPromptVersionsDao('x', 'system')
                ).rejects.toThrow('injected-fault')
            })
        })

        it('getLatestVersionDao 异常应抛出', async () => {
            await withFaultInjection(async () => {
                await expect(
                    getLatestVersionDao('x', 'system')
                ).rejects.toThrow('injected-fault')
            })
        })

        it('updatePromptDao 异常应抛出', async () => {
            await withFaultInjection(async () => {
                await expect(
                    updatePromptDao(1, { title: 'x' })
                ).rejects.toThrow('injected-fault')
            })
        })

        it('updatePromptStatusDao 异常应抛出', async () => {
            await withFaultInjection(async () => {
                await expect(updatePromptStatusDao(1, 1)).rejects.toThrow(
                    'injected-fault'
                )
            })
        })

        it('deactivatePromptsByTypeDao 异常应抛出', async () => {
            await withFaultInjection(async () => {
                await expect(
                    deactivatePromptsByTypeDao('x', 'system')
                ).rejects.toThrow('injected-fault')
            })
        })

        it('softDeletePromptDao 异常应抛出', async () => {
            await withFaultInjection(async () => {
                await expect(softDeletePromptDao(1)).rejects.toThrow(
                    'injected-fault'
                )
            })
        })
    })

    describe('正常路径 - tx 事务参数透传 & 边界', () => {
        it('createPromptDao 使用 tx 参数创建提示词', async () => {
            const prompt = await testPrisma.$transaction(async (tx) => {
                return createPromptDao(
                    {
                        name: `prompt_${generateTestId()}`,
                        title: '事务提示词',
                        content: '内容',
                        type: 'system',
                        nodeId: 0,
                    },
                    '1.0.0',
                    tx as any
                )
            })
            testIds.promptIds.push(prompt.id)
            expect(prompt.id).toBeDefined()
            expect(prompt.status).toBe(0)
        })

        it('findPromptByIdDao 使用 tx 参数查询', async () => {
            const prompt = await createPromptDao(
                {
                    name: `prompt_${generateTestId()}`,
                    title: 't',
                    content: 'c',
                    type: 'system',
                    nodeId: 0,
                },
                '1.0.0'
            )
            testIds.promptIds.push(prompt.id)
            const found = await testPrisma.$transaction(async (tx) => {
                return findPromptByIdDao(prompt.id, tx as any)
            })
            expect(found!.id).toBe(prompt.id)
        })

        it('findManyPromptsDao 使用 tx + 全字段选项 + desc 排序', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)
            const p = await createPromptDao(
                {
                    name: `unique_search_${generateTestId()}`,
                    title: `独特提示词_${generateTestId()}`,
                    content: 'c',
                    type: 'user',
                    nodeId: 0,
                },
                '1.0.0'
            )
            testIds.promptIds.push(p.id)
            await linkPromptToNode(node.id, p)
            await updatePromptStatusDao(p.id, 1)

            const result = await testPrisma.$transaction(async (tx) => {
                return findManyPromptsDao(
                    {
                        page: 1,
                        pageSize: 10,
                        nodeId: node.id,
                        type: 'user',
                        status: 1,
                        keyword: 'unique_search',
                        orderBy: 'updatedAt',
                        orderDir: 'desc',
                    },
                    tx as any
                )
            })
            expect(result.list.some((x) => x.id === p.id)).toBe(true)
        })

        it('findPromptsByNodeIdDao 使用 tx 参数', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)
            const p = await createPromptDao(
                {
                    name: `prompt_${generateTestId()}`,
                    title: 't',
                    content: 'c',
                    type: 'system',
                    nodeId: 0,
                },
                '1.0.0'
            )
            testIds.promptIds.push(p.id)
            await linkPromptToNode(node.id, p)

            const prompts = await testPrisma.$transaction(async (tx) => {
                return findPromptsByNodeIdDao(node.id, tx as any)
            })
            expect(prompts.some((x) => x.id === p.id)).toBe(true)
        })

        it('findActivePromptDao 使用 tx 参数', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)
            const p = await createPromptDao(
                {
                    name: `prompt_${generateTestId()}`,
                    title: 't',
                    content: 'c',
                    type: 'system',
                    nodeId: 0,
                },
                '1.0.0'
            )
            testIds.promptIds.push(p.id)
            await linkPromptToNode(node.id, p)
            await updatePromptStatusDao(p.id, 1)

            const found = await testPrisma.$transaction(async (tx) => {
                return findActivePromptDao(node.id, 'system', tx as any)
            })
            expect(found!.id).toBe(p.id)
        })

        it('findPromptVersionsDao 使用 tx 参数', async () => {
            const name = `prompt_${generateTestId()}`
            const p1 = await createPromptDao(
                {
                    name,
                    title: 't1',
                    content: 'c1',
                    type: 'system',
                    nodeId: 0,
                },
                '1.0.0'
            )
            const p2 = await createPromptDao(
                {
                    name,
                    title: 't2',
                    content: 'c2',
                    type: 'system',
                    nodeId: 0,
                },
                '2.0.0'
            )
            testIds.promptIds.push(p1.id, p2.id)

            const versions = await testPrisma.$transaction(async (tx) => {
                return findPromptVersionsDao(name, 'system', tx as any)
            })
            expect(versions.length).toBe(2)
        })

        it('getLatestVersionDao 无记录时返回 null（空记录路径）', async () => {
            const version = await getLatestVersionDao(
                `nonexistent_${generateTestId()}`,
                'system'
            )
            expect(version).toBeNull()
        })

        it('getLatestVersionDao 使用 tx 参数返回最新版本', async () => {
            const name = `prompt_${generateTestId()}`
            const p1 = await createPromptDao(
                {
                    name,
                    title: 't1',
                    content: 'c1',
                    type: 'system',
                    nodeId: 0,
                },
                '1.0.0'
            )
            const p2 = await createPromptDao(
                {
                    name,
                    title: 't2',
                    content: 'c2',
                    type: 'system',
                    nodeId: 0,
                },
                '2.0.0'
            )
            testIds.promptIds.push(p1.id, p2.id)

            const version = await testPrisma.$transaction(async (tx) => {
                return getLatestVersionDao(name, 'system', tx as any)
            })
            expect(version).toBe('2.0.0')
        })

        it('updatePromptDao 使用 tx 参数并只传 content/variables', async () => {
            const prompt = await createPromptDao(
                {
                    name: `prompt_${generateTestId()}`,
                    title: 't',
                    content: 'old',
                    type: 'system',
                    nodeId: 0,
                },
                '1.0.0'
            )
            testIds.promptIds.push(prompt.id)

            const updated = await testPrisma.$transaction(async (tx) => {
                return updatePromptDao(
                    prompt.id,
                    { content: 'new', variables: ['a'] },
                    tx as any
                )
            })
            expect(updated.content).toBe('new')
            expect(updated.variables).toEqual(['a'])
        })

        it('updatePromptStatusDao 使用 tx 参数', async () => {
            const prompt = await createPromptDao(
                {
                    name: `prompt_${generateTestId()}`,
                    title: 't',
                    content: 'c',
                    type: 'system',
                    nodeId: 0,
                },
                '1.0.0'
            )
            testIds.promptIds.push(prompt.id)
            const updated = await testPrisma.$transaction(async (tx) => {
                return updatePromptStatusDao(prompt.id, 1, tx as any)
            })
            expect(updated.status).toBe(1)
        })

        it('deactivatePromptsByTypeDao 使用 tx 参数（按 name+type 范围）', async () => {
            const sharedName = `prompt_${generateTestId()}`
            const p1 = await createPromptDao(
                {
                    name: sharedName,
                    title: 't',
                    content: 'c',
                    type: 'system',
                    nodeId: 0,
                },
                '1.0.0'
            )
            testIds.promptIds.push(p1.id)
            await updatePromptStatusDao(p1.id, 1)
            await testPrisma.$transaction(async (tx) => {
                await deactivatePromptsByTypeDao(sharedName, 'system', tx as any)
            })
            const after = await findPromptByIdDao(p1.id)
            expect(after?.status).toBe(0)
        })

        it('softDeletePromptDao 使用 tx 参数', async () => {
            const prompt = await createPromptDao(
                {
                    name: `prompt_${generateTestId()}`,
                    title: 't',
                    content: 'c',
                    type: 'system',
                    nodeId: 0,
                },
                '1.0.0'
            )
            testIds.promptIds.push(prompt.id)
            await testPrisma.$transaction(async (tx) => {
                await softDeletePromptDao(prompt.id, tx as any)
            })
            const found = await findPromptByIdDao(prompt.id)
            expect(found).toBeNull()
        })
    })
})
