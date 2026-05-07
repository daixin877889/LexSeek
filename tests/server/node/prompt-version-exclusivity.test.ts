/**
 * 提示词版本互斥性属性测试
 *
 * **Feature: case-analysis, Property 6: 提示词版本互斥性**
 * **Validates: Requirements 14.12**
 *
 * Phase 6 改造：原"同节点 + 同名 + 同类型互斥"放宽为"同名 + 同类型全局互斥"。
 * 因 prompts 不再绑定 nodeId，一段提示词可被多节点引用，但同 (name, type) 下
 * 仅允许一条 status=1，激活新版本时其他版本自动设为未生效。
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import * as fc from 'fast-check'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../../generated/prisma/client'
import { config } from 'dotenv'
import { resolve } from 'node:path'
import { activatePromptService } from '../../../server/services/node/prompt.service'
import type { PromptType } from '#shared/types/node'

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
    promptIds: [] as number[],
}

// 生成唯一的测试标识
const generateTestId = () => `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

// 创建测试提示词（直接使用数据库，不通过服务层）
const createTestPromptDirect = async (
    name: string,
    type: PromptType,
    version: string,
    status: number = 0
) => {
    const prompt = await testPrisma.prompts.create({
        data: {
            name,
            title: `测试提示词_${name}_${version}`,
            content: `这是测试提示词内容 {{variable}}`,
            variables: ['variable'],
            version,
            type,
            status,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    testIds.promptIds.push(prompt.id)
    return prompt
}

// 清理测试数据
const cleanupTestData = async () => {
    if (testIds.promptIds.length > 0) {
        await testPrisma.node_prompts.deleteMany({
            where: { promptId: { in: testIds.promptIds } },
        })
        await testPrisma.prompts.deleteMany({
            where: { id: { in: testIds.promptIds } },
        })
        testIds.promptIds = []
    }
}

describe('提示词版本互斥性属性测试', () => {
    beforeAll(async () => {
        try {
            await testPrisma.$connect()
            // 重置序列以避免冲突
            await testPrisma.$executeRaw`SELECT setval('prompts_id_seq', GREATEST((SELECT MAX(id) FROM prompts), 1000))`
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
            const remainingPromptIds = (await testPrisma.prompts.findMany({
                where: { name: { startsWith: 'prompt_' } },
                select: { id: true },
            })).map(p => p.id)
            if (remainingPromptIds.length > 0) {
                await testPrisma.node_prompts.deleteMany({ where: { promptId: { in: remainingPromptIds } } })
                await testPrisma.prompts.deleteMany({ where: { id: { in: remainingPromptIds } } })
            }
        } catch { /* 最终清理忽略错误 */ }
        await testPrisma.$disconnect()
    })

    describe('Property 6: 提示词版本互斥性', () => {
        /**
         * 属性测试：激活提示词后，同名 + 同类型下只能有一个版本处于生效状态
         *
         * **Feature: case-analysis, Property 6: 提示词版本互斥性**
         * **Validates: Requirements 14.12**
         */
        it('属性测试：激活任意提示词后，同名同类型下只有一个生效版本', async () => {
            // 提示词类型生成器
            const promptTypeArb = fc.constantFrom<PromptType>('system', 'user', 'assistant')

            // 版本数量生成器（2-5个版本）
            const versionCountArb = fc.integer({ min: 2, max: 5 })

            await fc.assert(
                fc.asyncProperty(
                    promptTypeArb,
                    versionCountArb,
                    fc.integer({ min: 0, max: 4 }), // 要激活的版本索引
                    async (promptType, versionCount, activateIndex) => {
                        const promptName = `prompt_${generateTestId()}`
                        const createdPrompts: { id: number; version: string }[] = []

                        // 创建多个版本的提示词
                        for (let i = 1; i <= versionCount; i++) {
                            const prompt = await createTestPromptDirect(
                                promptName,
                                promptType,
                                `v${i}`,
                                0 // 初始状态为未生效
                            )
                            createdPrompts.push({ id: prompt.id, version: prompt.version })
                        }

                        // 确保激活索引在有效范围内
                        const safeActivateIndex = activateIndex % createdPrompts.length

                        // 激活指定版本
                        const promptToActivate = createdPrompts[safeActivateIndex]!
                        await activatePromptService(promptToActivate.id)

                        // 验证：查询所有同名同类型的提示词
                        const allPrompts = await testPrisma.prompts.findMany({
                            where: {
                                name: promptName,
                                type: promptType,
                                deletedAt: null,
                            },
                        })

                        // 统计生效状态的提示词数量
                        const activePrompts = allPrompts.filter(p => p.status === 1)

                        // 属性断言：只有一个生效版本
                        expect(activePrompts.length).toBe(1)

                        // 属性断言：生效的是我们激活的那个
                        expect(activePrompts[0]!.id).toBe(promptToActivate.id)

                        // 属性断言：其他版本都是未生效状态
                        const inactivePrompts = allPrompts.filter(p => p.status === 0)
                        expect(inactivePrompts.length).toBe(versionCount - 1)

                        // 清理本次迭代创建的提示词
                        await testPrisma.prompts.deleteMany({
                            where: { id: { in: createdPrompts.map(p => p.id) } },
                        })
                        testIds.promptIds = testIds.promptIds.filter(
                            id => !createdPrompts.map(p => p.id).includes(id)
                        )
                    }
                ),
                { numRuns: 100, seed: 42 }
            )
        })

        /**
         * 属性测试：连续激活不同版本，始终保持只有一个生效
         *
         * **Feature: case-analysis, Property 6: 提示词版本互斥性**
         * **Validates: Requirements 14.12**
         */
        it('属性测试：连续激活不同版本，始终保持只有一个生效', async () => {
            // 激活序列生成器（随机激活顺序）
            const activationSequenceArb = fc.array(
                fc.integer({ min: 0, max: 3 }),
                { minLength: 2, maxLength: 5 }
            )

            await fc.assert(
                fc.asyncProperty(
                    fc.constantFrom<PromptType>('system', 'user', 'assistant'),
                    activationSequenceArb,
                    async (promptType, activationSequence) => {
                        const promptName = `prompt_seq_${generateTestId()}`
                        const createdPrompts: { id: number; version: string }[] = []

                        // 创建 4 个版本的提示词
                        for (let i = 1; i <= 4; i++) {
                            const prompt = await createTestPromptDirect(
                                promptName,
                                promptType,
                                `v${i}`,
                                0
                            )
                            createdPrompts.push({ id: prompt.id, version: prompt.version })
                        }

                        // 按序列激活不同版本
                        for (const index of activationSequence) {
                            const safeIndex = index % createdPrompts.length
                            await activatePromptService(createdPrompts[safeIndex]!.id)

                            // 每次激活后验证只有一个生效（按 name + type 维度）
                            const allPrompts = await testPrisma.prompts.findMany({
                                where: {
                                    name: promptName,
                                    type: promptType,
                                    deletedAt: null,
                                },
                            })

                            const activeCount = allPrompts.filter(p => p.status === 1).length
                            expect(activeCount).toBe(1)
                        }

                        // 清理
                        await testPrisma.prompts.deleteMany({
                            where: { id: { in: createdPrompts.map(p => p.id) } },
                        })
                        testIds.promptIds = testIds.promptIds.filter(
                            id => !createdPrompts.map(p => p.id).includes(id)
                        )
                    }
                ),
                { numRuns: 100, seed: 42 }
            )
        })

        /**
         * 属性测试：不同类型的提示词互不影响
         *
         * **Feature: case-analysis, Property 6: 提示词版本互斥性**
         * **Validates: Requirements 14.12**
         */
        it('属性测试：不同类型的提示词激活互不影响', async () => {
            const promptTypes: PromptType[] = ['system', 'user', 'assistant']

            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 3 }), // 每种类型的版本数
                    async (versionsPerType) => {
                        const promptName = `prompt_multi_${generateTestId()}`
                        const createdPrompts: Map<PromptType, { id: number; version: string }[]> = new Map()

                        // 为每种类型创建多个版本
                        for (const type of promptTypes) {
                            const prompts: { id: number; version: string }[] = []
                            for (let i = 1; i <= versionsPerType; i++) {
                                const prompt = await createTestPromptDirect(
                                    promptName,
                                    type,
                                    `v${i}`,
                                    0
                                )
                                prompts.push({ id: prompt.id, version: prompt.version })
                            }
                            createdPrompts.set(type, prompts)
                        }

                        // 激活每种类型的第一个版本
                        for (const type of promptTypes) {
                            const prompts = createdPrompts.get(type)!
                            await activatePromptService(prompts[0]!.id)
                        }

                        // 验证每种类型都有且只有一个生效版本（按 name + type 维度）
                        for (const type of promptTypes) {
                            const activePrompts = await testPrisma.prompts.findMany({
                                where: {
                                    name: promptName,
                                    type,
                                    status: 1,
                                    deletedAt: null,
                                },
                            })
                            expect(activePrompts.length).toBe(1)
                            expect(activePrompts[0]!.type).toBe(type)
                        }

                        // 验证总共有 3 个生效的提示词（每种类型一个）
                        const allActivePrompts = await testPrisma.prompts.findMany({
                            where: {
                                name: promptName,
                                status: 1,
                                deletedAt: null,
                            },
                        })
                        expect(allActivePrompts.length).toBe(3)

                        // 清理
                        const allIds = Array.from(createdPrompts.values()).flat().map(p => p.id)
                        await testPrisma.prompts.deleteMany({
                            where: { id: { in: allIds } },
                        })
                        testIds.promptIds = testIds.promptIds.filter(id => !allIds.includes(id))
                    }
                ),
                { numRuns: 100, seed: 42 }
            )
        })
    })
})
