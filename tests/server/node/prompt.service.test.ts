/**
 * 提示词服务测试
 *
 * **Feature: node-management**
 * **Validates: Requirements 14.9, 14.10, 14.11, 14.12, 14.13, 14.14**
 *
 * - 纯单元测试：generateNextVersion, extractVariables, renderContent
 * - 数据库集成测试：所有服务层方法
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import * as fc from 'fast-check'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../../generated/prisma/client'
import { config } from 'dotenv'
import { resolve } from 'node:path'
import {
    generateNextVersion,
    extractVariables,
    renderContent,
    createPromptService,
    getPromptByIdService,
    getPromptsService,
    updatePromptService,
    activatePromptService,
    deactivatePromptService,
    deletePromptService,
    renderPromptService,
    previewPromptService,
    getActivePromptsForNodeService,
} from '../../../server/services/node/prompt.service'

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
    nodeIds: [] as number[],
    promptIds: [] as number[],
    modelIds: [] as number[],
    providerIds: [] as number[],
}

// 生成唯一的测试标识
const generateTestId = () => `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

// 创建测试模型（每个测试使用独立的 provider）
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

/**
 * 把 prompt 关联到 node（多对多）。Phase 6 改造后，"节点维度"的查询
 * 必须通过 node_prompts 关联表实现。
 */
const linkPromptToNode = async (
    nodeId: number,
    promptId: number,
    displayOrder = 100,
) => {
    await testPrisma.node_prompts.create({
        data: { nodeId, promptId, displayOrder },
    })
}

// 清理测试数据（按外键依赖顺序，每个步骤独立处理错误）
const cleanupTestData = async () => {
    // 先删除提示词关联，再删除提示词
    try {
        if (testIds.promptIds.length > 0) {
            await testPrisma.node_prompts.deleteMany({ where: { promptId: { in: testIds.promptIds } } })
            await testPrisma.prompts.deleteMany({ where: { id: { in: testIds.promptIds } } })
        }
    } catch { /* 忽略提示词删除错误 */ }
    testIds.promptIds = []
    // 再删除节点（解除 modelId 外键引用）
    try {
        if (testIds.nodeIds.length > 0) {
            await testPrisma.node_prompts.deleteMany({ where: { nodeId: { in: testIds.nodeIds } } })
            await testPrisma.nodes.deleteMany({ where: { id: { in: testIds.nodeIds } } })
        }
    } catch { /* 忽略节点删除错误 */ }
    testIds.nodeIds = []
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

describe('generateNextVersion 工具函数', () => {
    it('null 版本号应返回 v1', () => {
        expect(generateNextVersion(null as any)).toBe('v1')
    })

    it('空字符串应返回 v1', () => {
        expect(generateNextVersion('')).toBe('v1')
    })

    it('undefined 应返回 v1', () => {
        expect(generateNextVersion(undefined as any)).toBe('v1')
    })

    it('v1 应返回 v2', () => {
        expect(generateNextVersion('v1')).toBe('v2')
    })

    it('v99 应返回 v100', () => {
        expect(generateNextVersion('v99')).toBe('v100')
    })

    it('无效格式应返回 v1', () => {
        expect(generateNextVersion('version1')).toBe('v1')
        expect(generateNextVersion('1.0')).toBe('v1')
        expect(generateNextVersion('v')).toBe('v1')
    })

    it('属性测试：任意版本号递增正确', () => {
        fc.assert(
            fc.property(fc.integer({ min: 1, max: 9999 }), (num) => {
                const result = generateNextVersion(`v${num}`)
                expect(result).toBe(`v${num + 1}`)
            }),
            { numRuns: 100, seed: 42 }
        )
    })
})

describe('extractVariables 工具函数', () => {
    it('空字符串应返回空数组', () => {
        expect(extractVariables('')).toEqual([])
    })

    it('无变量的内容应返回空数组', () => {
        expect(extractVariables('这是普通文本')).toEqual([])
    })

    it('单个变量应正确提取', () => {
        expect(extractVariables('Hello {{name}}')).toEqual(['name'])
    })

    it('多个变量应正确提取', () => {
        expect(extractVariables('Hello {{name}}, your age is {{age}}')).toEqual(['name', 'age'])
    })

    it('重复变量应去重', () => {
        expect(extractVariables('{{name}} and {{name}} again')).toEqual(['name'])
    })

    it('变量应正确处理下划线', () => {
        expect(extractVariables('Hello {{user_name}}')).toEqual(['user_name'])
    })

    it('变量应正确处理数字', () => {
        expect(extractVariables('Hello {{user1}} and {{user2}}')).toEqual(['user1', 'user2'])
    })

    it('混合内容应正确提取', () => {
        expect(extractVariables('Hello {{name}}, today is {{date}}. Your score is {{score}}')).toEqual([
            'name',
            'date',
            'score',
        ])
    })

    it('属性测试：任意变量提取正确', () => {
        // 生成有效的 JavaScript 变量名：首字符为字母或下划线，后续为字母数字下划线
        const letter = fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_'.split(''))
        const alphanum = fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789'.split(''))
        const validVarName = fc.tuple(letter, fc.array(alphanum, { minLength: 0, maxLength: 8 })).map(([first, rest]) => first + rest.join(''))
        fc.assert(
            fc.property(
                fc.uniqueArray(validVarName, { minLength: 1, maxLength: 5 }),
                (varNames) => {
                    const content = `Hello ${varNames.map((v) => `{{${v}}}`).join(' ')}`
                    const extracted = extractVariables(content)
                    expect(extracted.length).toBe(varNames.length)
                    for (const name of varNames) {
                        expect(extracted).toContain(name)
                    }
                }
            ),
            { numRuns: 100, seed: 42 }
        )
    })
})

describe('renderContent 工具函数', () => {
    it('空字符串应返回空字符串', () => {
        expect(renderContent('', {})).toBe('')
    })

    it('无变量的内容应保持不变', () => {
        expect(renderContent('Hello World', { name: 'Alice' })).toBe('Hello World')
    })

    it('单变量应正确替换', () => {
        expect(renderContent('Hello {{name}}', { name: 'Alice' })).toBe('Hello Alice')
    })

    it('多变量应全部替换', () => {
        expect(renderContent('Hello {{name}}, today is {{date}}', { name: 'Alice', date: 'Monday' })).toBe(
            'Hello Alice, today is Monday'
        )
    })

    it('未提供的变量应保持原样', () => {
        expect(renderContent('Hello {{name}}, your age is {{age}}', { name: 'Alice' })).toBe(
            'Hello Alice, your age is {{age}}'
        )
    })

    it('空值变量应替换为空字符串', () => {
        expect(renderContent('Hello {{name}}', { name: '' })).toBe('Hello ')
    })

    it('属性测试：变量渲染一致性', () => {
        // 生成有效的 JavaScript 变量名
        const letter = fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_'.split(''))
        const alphanum = fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789'.split(''))
        const validVarName = fc.tuple(letter, fc.array(alphanum, { minLength: 0, maxLength: 4 })).map(([first, rest]) => first + rest.join(''))
        fc.assert(
            fc.property(
                fc.uniqueArray(validVarName, { minLength: 1, maxLength: 5 }),
                (varNames) => {
                    const vars: Record<string, string> = {}
                    for (const name of varNames) {
                        vars[name] = `val_${name}`
                    }
                    const content = Object.keys(vars)
                        .map((k) => `{{${k}}}`)
                        .join(' ')
                    const rendered = renderContent(content, vars)
                    for (const [key, value] of Object.entries(vars)) {
                        expect(rendered).toContain(value)
                        expect(rendered).not.toContain(`{{${key}}}`)
                    }
                }
            ),
            { numRuns: 100, seed: 42 }
        )
    })
})

// ==================== 数据库集成测试：服务层 ====================

describe('提示词服务集成测试', () => {
    beforeAll(async () => {
        try {
            await testPrisma.$connect()
            await testPrisma.$executeRaw`SELECT setval('nodes_id_seq', GREATEST((SELECT MAX(id) FROM nodes), 1000))`
            await testPrisma.$executeRaw`SELECT setval('prompts_id_seq', GREATEST((SELECT MAX(id) FROM prompts), 1000))`
            await testPrisma.$executeRaw`SELECT setval('models_id_seq', GREATEST((SELECT MAX(id) FROM models), 1000))`
        } catch {
            console.warn('数据库连接失败，跳过集成测试')
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
                await testPrisma.node_prompts.deleteMany({ where: { nodeId: { in: testNodeIds } } })
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

    describe('createPromptService', () => {
        it('创建提示词时应正确生成版本号', async () => {
            const prompt = await createPromptService({
                name: `prompt_${generateTestId()}`,
                content: 'Hello {{name}}',
                type: 'system',
                nodeId: 0, // ★ Phase 6 已废弃：service 不再使用此字段
            })

            testIds.promptIds.push(prompt.id)
            expect(prompt.version).toBe('v1')
            expect(prompt.status).toBe(0)
        })

        it('创建提示词时应自动提取变量', async () => {
            const prompt = await createPromptService({
                name: `prompt_${generateTestId()}`,
                content: 'Hello {{name}}, your age is {{age}}',
                type: 'system',
                nodeId: 0,
            })

            testIds.promptIds.push(prompt.id)
            expect(prompt.variables).toContain('name')
            expect(prompt.variables).toContain('age')
        })
    })

    describe('getPromptByIdService', () => {
        it('应返回存在的提示词', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)

            const created = await createPromptService({
                name: `prompt_${generateTestId()}`,
                content: 'Test content',
                type: 'user',
                nodeId: 0,
            })
            testIds.promptIds.push(created.id)

            const found = await getPromptByIdService(created.id)
            expect(found).not.toBeNull()
            expect(found!.id).toBe(created.id)
        })

        it('不存在的 ID 应返回 null', async () => {
            const found = await getPromptByIdService(999999)
            expect(found).toBeNull()
        })
    })

    describe('getPromptsService', () => {
        it('应返回分页的提示词列表', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)

            // 创建多个提示词
            for (let i = 0; i < 3; i++) {
                const prompt = await createPromptService({
                    name: `prompt_${generateTestId()}`,
                    content: `Content ${i}`,
                    type: 'system',
                    nodeId: 0,
                })
                testIds.promptIds.push(prompt.id)
            }

            const result = await getPromptsService({ page: 1, pageSize: 10 })
            expect(result.total).toBeGreaterThanOrEqual(3)
            expect(result.list.length).toBeGreaterThanOrEqual(3)
        })
    })

    describe('updatePromptService', () => {
        it('内容变化时应创建新版本', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)

            const prompt = await createPromptService({
                name: `prompt_${generateTestId()}`,
                content: 'Original content',
                type: 'system',
                nodeId: 0,
            })
            testIds.promptIds.push(prompt.id)

            const updated = await updatePromptService(prompt.id, {
                content: 'Updated content',
            })
            testIds.promptIds.push(updated.id)

            expect(updated.version).toBe('v2')
            expect(updated.content).toBe('Updated content')
        })

        it('只更新标题时不应创建新版本', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)

            const prompt = await createPromptService({
                name: `prompt_${generateTestId()}`,
                content: 'Content',
                title: 'Original Title',
                type: 'system',
                nodeId: 0,
            })
            testIds.promptIds.push(prompt.id)

            const updated = await updatePromptService(prompt.id, {
                title: 'New Title',
            })

            expect(updated.version).toBe('v1')
            expect(updated.title).toBe('New Title')
        })

        it('不存在的提示词应抛出错误', async () => {
            await expect(updatePromptService(999999, { content: 'test' })).rejects.toThrow('提示词不存在')
        })
    })

    describe('activatePromptService', () => {
        it('激活提示词应设置状态为 1', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)

            const prompt = await createPromptService({
                name: `prompt_${generateTestId()}`,
                content: 'Test',
                type: 'system',
                nodeId: 0,
            })
            testIds.promptIds.push(prompt.id)

            const activated = await activatePromptService(prompt.id)
            expect(activated.status).toBe(1)
        })

        it('重复激活应返回同一记录', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)

            const prompt = await createPromptService({
                name: `prompt_${generateTestId()}`,
                content: 'Test',
                type: 'system',
                nodeId: 0,
            })
            testIds.promptIds.push(prompt.id)

            await activatePromptService(prompt.id)
            const again = await activatePromptService(prompt.id)
            expect(again.status).toBe(1)
        })

        it('不存在的提示词应抛出错误', async () => {
            await expect(activatePromptService(999999)).rejects.toThrow('提示词不存在')
        })
    })

    describe('deactivatePromptService', () => {
        it('停用提示词应设置状态为 0', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)

            const prompt = await createPromptService({
                name: `prompt_${generateTestId()}`,
                content: 'Test',
                type: 'system',
                nodeId: 0,
            })
            testIds.promptIds.push(prompt.id)

            await activatePromptService(prompt.id)
            const deactivated = await deactivatePromptService(prompt.id)
            expect(deactivated.status).toBe(0)
        })
    })

    describe('deletePromptService', () => {
        it('删除提示词应设置 deletedAt', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)

            const prompt = await createPromptService({
                name: `prompt_${generateTestId()}`,
                content: 'Test',
                type: 'system',
                nodeId: 0,
            })
            testIds.promptIds.push(prompt.id)

            await deletePromptService(prompt.id)
            const found = await getPromptByIdService(prompt.id)
            expect(found).toBeNull()
        })
    })

    describe('renderPromptService', () => {
        it('应正确渲染变量', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)

            const prompt = await createPromptService({
                name: `prompt_${generateTestId()}`,
                content: 'Hello {{name}}, today is {{date}}',
                type: 'system',
                nodeId: 0,
            })
            testIds.promptIds.push(prompt.id)

            const result = await renderPromptService({
                promptId: prompt.id,
                variables: { name: 'Alice', date: 'Monday' },
            })

            expect(result.renderedContent).toBe('Hello Alice, today is Monday')
            expect(result.variables).toContain('name')
            expect(result.variables).toContain('date')
        })

        it('不存在的提示词应抛出错误', async () => {
            await expect(
                renderPromptService({ promptId: 999999, variables: {} })
            ).rejects.toThrow('提示词不存在')
        })
    })

    describe('previewPromptService', () => {
        it('应正确预览渲染结果', async () => {
            const result = previewPromptService({
                content: 'Hello {{name}}',
                variables: { name: 'Alice' },
            })

            expect(result.renderedContent).toBe('Hello Alice')
            expect(result.extractedVariables).toContain('name')
            expect(result.providedVariables).toContain('name')
        })
    })

    describe('getActivePromptsForNodeService', () => {
        it('应返回所有类型的生效提示词', async () => {
            const model = await createTestModel()
            const node = await createTestNode(model.id)
            const testId = generateTestId()

            const systemPrompt = await createPromptService({
                name: `system_${testId}`,
                content: 'System prompt',
                type: 'system',
                nodeId: 0,
            })
            testIds.promptIds.push(systemPrompt.id)

            const userPrompt = await createPromptService({
                name: `user_${testId}`,
                content: 'User prompt',
                type: 'user',
                nodeId: 0,
            })
            testIds.promptIds.push(userPrompt.id)

            await activatePromptService(systemPrompt.id)
            await activatePromptService(userPrompt.id)

            // ★ Phase 6：节点维度查询通过 node_prompts 关联表 join，
            // 必须显式建立关联，否则 findActivePromptDao(nodeId, type) 返回 null。
            await linkPromptToNode(node.id, systemPrompt.id, 100)
            await linkPromptToNode(node.id, userPrompt.id, 200)

            const result = await getActivePromptsForNodeService(node.id)
            expect(result.system).not.toBeNull()
            expect(result.user).not.toBeNull()
        })

        it('不存在的节点应抛出错误', async () => {
            await expect(getActivePromptsForNodeService(999999)).rejects.toThrow('节点不存在')
        })
    })
})
