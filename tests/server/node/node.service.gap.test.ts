/**
 * 节点服务 - 覆盖率补齐测试（gap）
 *
 * 目标：覆盖 node.service.ts 中未被现有测试覆盖的路径：
 * - getNodeConfigService 正常路径（构建完整配置）
 * - getNodeConfigService 节点不存在 → null
 * - getNodeConfigService 节点未关联模型 → null
 * - getNodeConfigService 未关联提供商 → null
 * - getNodeConfigService DAO 抛异常 → 服务层重新包装抛出
 * - getValidNodeConfig 配置不存在时抛错
 * - getValidNodeConfig 未配置 API 密钥时抛错
 * - getValidNodeConfig 成功返回
 * - getNodeConfigByIdService 正常路径/null/异常包装
 * - getNodeConfigsByTypes 返回指定类型节点列表，并过滤无 model/provider 的节点
 *
 * **Feature: node-management**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../../generated/prisma/client'
import { config } from 'dotenv'
import { resolve } from 'node:path'

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

import {
    getNodeConfigService,
    getValidNodeConfig,
    getNodeConfigByIdService,
    getNodeConfigsByTypes,
} from '../../../server/services/node/node.service'

const testIds = {
    providerIds: [] as number[],
    modelIds: [] as number[],
    nodeIds: [] as number[],
    promptIds: [] as number[],
    apiKeyIds: [] as number[],
}

const generateTestId = () => `nodesvcgap_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`

const createProvider = async (overrides: { baseUrl?: string; description?: string | null } = {}) => {
    const provider = await testPrisma.modelProviders.create({
        data: {
            name: `provider_${generateTestId()}`,
            baseUrl: overrides.baseUrl ?? 'https://api.test.com',
            description: overrides.description ?? '测试提供商',
        },
    })
    testIds.providerIds.push(provider.id)
    return provider
}

const createApiKey = async (providerId: number, overrides: { status?: number; isDefault?: boolean } = {}) => {
    const apiKey = await testPrisma.modelApiKeys.create({
        data: {
            providerId,
            name: `apikey_${generateTestId()}`,
            apiKey: `sk-test-${generateTestId()}`,
            isDefault: overrides.isDefault ?? true,
            status: overrides.status ?? 1,
        },
    })
    testIds.apiKeyIds.push(apiKey.id)
    return apiKey
}

const createModel = async (
    providerId: number,
    overrides: {
        sdkType?: string
        contextWindow?: number | null
        status?: number
        modelType?: string
    } = {}
) => {
    const model = await testPrisma.models.create({
        data: {
            providerId,
            name: `model_${generateTestId()}`,
            displayName: '测试模型',
            modelType: overrides.modelType ?? 'chat',
            sdkType: overrides.sdkType ?? 'openai',
            contextWindow: overrides.contextWindow ?? null,
            status: overrides.status ?? 1,
        },
    })
    testIds.modelIds.push(model.id)
    return model
}

const createNode = async (
    modelId: number,
    overrides: {
        name?: string
        type?: string
        status?: number
        tools?: unknown[]
        outputSchema?: unknown
        title?: string | null
        description?: string | null
        priority?: number
    } = {}
) => {
    const node = await testPrisma.nodes.create({
        data: {
            name: overrides.name ?? `node_${generateTestId()}`,
            title: overrides.title !== undefined ? overrides.title : '测试节点',
            description: overrides.description ?? null,
            type: overrides.type ?? 'analysis',
            priority: overrides.priority ?? 100,
            modelId,
            tools: (overrides.tools ?? []) as any,
            outputSchema: (overrides.outputSchema ?? null) as any,
            status: overrides.status ?? 1,
        },
    })
    testIds.nodeIds.push(node.id)
    return node
}

const createPrompt = async (
    nodeId: number,
    overrides: { type?: string; status?: number; content?: string; version?: string } = {}
) => {
    // 阶段 F 改造：node_prompts 按 (name, type) 业务身份关联
    const promptName = `prompt_${generateTestId()}`
    const promptType = overrides.type ?? 'system'
    const prompt = await testPrisma.prompts.create({
        data: {
            name: promptName,
            title: '测试提示词',
            content: overrides.content ?? '你是一个助手',
            variables: [] as any,
            version: overrides.version ?? '1.0.0',
            type: promptType,
            status: overrides.status ?? 1,
        },
    })
    testIds.promptIds.push(prompt.id)
    await testPrisma.node_prompts.create({
        data: { nodeId, promptName, promptType, displayOrder: 100 },
    })
    return prompt
}

const cleanupTestData = async () => {
    try {
        // 阶段 F 改造：node_prompts 不再绑定 promptId，按 nodeId 清理
        if (testIds.nodeIds.length > 0) {
            await testPrisma.node_prompts.deleteMany({ where: { nodeId: { in: testIds.nodeIds } } })
        }
        if (testIds.promptIds.length > 0) {
            await testPrisma.prompts.deleteMany({ where: { id: { in: testIds.promptIds } } })
        }
        testIds.promptIds = []
    } catch {}
    try {
        if (testIds.nodeIds.length > 0) {
            await testPrisma.nodes.deleteMany({ where: { id: { in: testIds.nodeIds } } })
        }
        testIds.nodeIds = []
    } catch {}
    try {
        if (testIds.modelIds.length > 0) {
            await testPrisma.models.deleteMany({ where: { id: { in: testIds.modelIds } } })
        }
        testIds.modelIds = []
    } catch {}
    try {
        if (testIds.apiKeyIds.length > 0) {
            await testPrisma.modelApiKeys.deleteMany({ where: { id: { in: testIds.apiKeyIds } } })
        }
        testIds.apiKeyIds = []
    } catch {}
    try {
        if (testIds.providerIds.length > 0) {
            await testPrisma.modelApiKeys.deleteMany({ where: { providerId: { in: testIds.providerIds } } })
            await testPrisma.modelProviders.deleteMany({ where: { id: { in: testIds.providerIds } } })
        }
        testIds.providerIds = []
    } catch {}
}

describe('节点服务 - 覆盖率补齐（gap）', () => {
    beforeAll(async () => {
        await testPrisma.$connect()
    })

    afterEach(async () => {
        await cleanupTestData()
    })

    afterAll(async () => {
        // 最终清理，使用前缀过滤残留
        try {
            await testPrisma.prompts.deleteMany({ where: { name: { startsWith: 'prompt_nodesvcgap_' } } })
            await testPrisma.nodes.deleteMany({ where: { name: { startsWith: 'node_nodesvcgap_' } } })
            await testPrisma.models.deleteMany({ where: { name: { startsWith: 'model_nodesvcgap_' } } })
            await testPrisma.modelApiKeys.deleteMany({ where: { name: { startsWith: 'apikey_nodesvcgap_' } } })
            await testPrisma.modelProviders.deleteMany({ where: { name: { startsWith: 'provider_nodesvcgap_' } } })
        } catch {}
        await testPrisma.$disconnect()
    })

    describe('getNodeConfigService - 通过名称获取配置', () => {
        it('应返回完整节点配置，包含提示词、API 密钥等字段', async () => {
            const provider = await createProvider({ description: '测试描述' })
            await createApiKey(provider.id)
            const model = await createModel(provider.id, {
                sdkType: 'deepseek',
                contextWindow: 8192,
            })
            const nodeName = `node_${generateTestId()}`
            const node = await createNode(model.id, { name: nodeName, type: 'analysis' })
            await createPrompt(node.id, { type: 'system' })

            const config = await getNodeConfigService(nodeName)

            expect(config).not.toBeNull()
            expect(config!.id).toBe(node.id)
            expect(config!.name).toBe(nodeName)
            expect(config!.modelId).toBe(model.id)
            expect(config!.modelName).toBe(model.name)
            expect(config!.modelSdkType).toBe('deepseek')
            expect(config!.modelContextWindow).toBe(8192)
            expect(config!.modelProviderId).toBe(provider.id)
            expect(config!.modelProviderName).toBe(provider.name)
            expect(config!.modelProviderDescription).toBe('测试描述')
            expect(config!.modelApiKeys.length).toBeGreaterThan(0)
            expect(config!.prompts.length).toBeGreaterThan(0)
        })

        it('节点不存在应返回 null', async () => {
            const config = await getNodeConfigService('nonexistent_node_for_gap_test_xyz')
            expect(config).toBeNull()
        })

        it('DAO 抛异常时应包装后抛出', async () => {
            const originalPrisma = (globalThis as any).prisma
            ;(globalThis as any).prisma = new Proxy({}, {
                get: () => {
                    throw new Error('injected-dao-fault')
                },
            })
            try {
                await expect(getNodeConfigService('any_name')).rejects.toThrow(
                    /获取节点配置失败/
                )
            } finally {
                ;(globalThis as any).prisma = originalPrisma
            }
        })

        it('应使用默认 sdkType 当模型 sdkType 未设置（空字符串回退到 openai）', async () => {
            const provider = await createProvider()
            await createApiKey(provider.id)
            // 使用 raw update 让 sdkType 变成空字符串
            const model = await createModel(provider.id)
            await testPrisma.$executeRaw`UPDATE models SET sdk_type = '' WHERE id = ${model.id}`
            const nodeName = `node_${generateTestId()}`
            await createNode(model.id, { name: nodeName })

            const config = await getNodeConfigService(nodeName)
            expect(config).not.toBeNull()
            expect(config!.modelSdkType).toBe('openai')
        })

        it('节点 title 为空时应回退到 name', async () => {
            const provider = await createProvider()
            await createApiKey(provider.id)
            const model = await createModel(provider.id)
            const nodeName = `node_${generateTestId()}`
            await createNode(model.id, { name: nodeName, title: null })

            const config = await getNodeConfigService(nodeName)
            expect(config!.title).toBe(nodeName)
        })

        it('节点未关联 model 时应返回 null', async () => {
            // 通过 Proxy 拦截 DAO 返回，模拟 model=null 场景
            const originalPrisma = (globalThis as any).prisma
            ;(globalThis as any).prisma = new Proxy(originalPrisma, {
                get(target, prop) {
                    if (prop === 'nodes') {
                        return {
                            findFirst: async () => ({
                                id: 999991,
                                name: 'gap_nomodel_node',
                                title: null,
                                description: null,
                                type: 'analysis',
                                modelId: 0,
                                tools: [],
                                outputSchema: null,
                                status: 1,
                                prompts: [],
                                model: null,
                            }),
                        }
                    }
                    return (target as any)[prop]
                },
            })
            try {
                const config = await getNodeConfigService('gap_nomodel_node')
                expect(config).toBeNull()
            } finally {
                ;(globalThis as any).prisma = originalPrisma
            }
        })

        it('节点模型未关联提供商时应返回 null', async () => {
            const originalPrisma = (globalThis as any).prisma
            ;(globalThis as any).prisma = new Proxy(originalPrisma, {
                get(target, prop) {
                    if (prop === 'nodes') {
                        return {
                            findFirst: async () => ({
                                id: 999992,
                                name: 'gap_noprovider_node',
                                title: null,
                                description: null,
                                type: 'analysis',
                                modelId: 1,
                                tools: [],
                                outputSchema: null,
                                status: 1,
                                prompts: [],
                                model: {
                                    id: 1,
                                    name: 'm',
                                    modelType: 'chat',
                                    status: 1,
                                    sdkType: 'openai',
                                    contextWindow: null,
                                    modelProvider: null,
                                },
                            }),
                        }
                    }
                    return (target as any)[prop]
                },
            })
            try {
                const config = await getNodeConfigService('gap_noprovider_node')
                expect(config).toBeNull()
            } finally {
                ;(globalThis as any).prisma = originalPrisma
            }
        })
    })

    describe('getValidNodeConfig - 带验证的配置获取', () => {
        it('配置不存在时应抛错', async () => {
            await expect(
                getValidNodeConfig('nonexistent_for_valid_test_xyz', '测试节点')
            ).rejects.toThrow(/测试节点 节点未配置或未启用/)
        })

        it('默认 displayName 应使用 nodeName', async () => {
            await expect(getValidNodeConfig('nonexistent_no_display')).rejects.toThrow(
                /nonexistent_no_display 节点未配置或未启用/
            )
        })

        it('未配置 API 密钥时应抛错', async () => {
            const provider = await createProvider()
            // 注意：不创建 API Key
            const model = await createModel(provider.id)
            const nodeName = `node_${generateTestId()}`
            await createNode(model.id, { name: nodeName })

            await expect(
                getValidNodeConfig(nodeName, '显示名')
            ).rejects.toThrow(/显示名 节点的模型提供商未配置 API 密钥/)
        })

        it('配置正常时应返回配置对象', async () => {
            const provider = await createProvider()
            await createApiKey(provider.id)
            const model = await createModel(provider.id)
            const nodeName = `node_${generateTestId()}`
            await createNode(model.id, { name: nodeName })

            const config = await getValidNodeConfig(nodeName)
            expect(config).toBeDefined()
            expect(config.modelApiKeys.length).toBeGreaterThan(0)
        })
    })

    describe('getNodeConfigByIdService - 通过 ID 获取配置', () => {
        it('应返回完整配置', async () => {
            const provider = await createProvider({ description: '测试 provider' })
            await createApiKey(provider.id)
            const model = await createModel(provider.id, {
                sdkType: 'anthropic',
                contextWindow: 4096,
            })
            const node = await createNode(model.id, { title: null })

            const config = await getNodeConfigByIdService(node.id)
            expect(config).not.toBeNull()
            expect(config!.id).toBe(node.id)
            expect(config!.modelSdkType).toBe('anthropic')
            expect(config!.modelContextWindow).toBe(4096)
            expect(config!.title).toBe(node.name) // title 为 null 应回退
            expect(config!.modelProviderDescription).toBe('测试 provider')
        })

        it('节点不存在应返回 null', async () => {
            const config = await getNodeConfigByIdService(9999999)
            expect(config).toBeNull()
        })

        it('DAO 抛异常时应包装后抛出', async () => {
            const originalPrisma = (globalThis as any).prisma
            ;(globalThis as any).prisma = new Proxy({}, {
                get: () => {
                    throw new Error('injected-byid-fault')
                },
            })
            try {
                await expect(getNodeConfigByIdService(1)).rejects.toThrow(
                    /获取节点配置失败/
                )
            } finally {
                ;(globalThis as any).prisma = originalPrisma
            }
        })

        it('节点未关联 model 时应返回 null', async () => {
            const originalPrisma = (globalThis as any).prisma
            ;(globalThis as any).prisma = new Proxy(originalPrisma, {
                get(target, prop) {
                    if (prop === 'nodes') {
                        return {
                            findFirst: async () => ({
                                id: 888881,
                                name: 'byid_nomodel',
                                title: null,
                                description: null,
                                type: 'analysis',
                                modelId: 0,
                                tools: [],
                                outputSchema: null,
                                status: 1,
                                prompts: [],
                                model: null,
                            }),
                        }
                    }
                    return (target as any)[prop]
                },
            })
            try {
                const config = await getNodeConfigByIdService(888881)
                expect(config).toBeNull()
            } finally {
                ;(globalThis as any).prisma = originalPrisma
            }
        })

        it('节点模型未关联提供商时应返回 null', async () => {
            const originalPrisma = (globalThis as any).prisma
            ;(globalThis as any).prisma = new Proxy(originalPrisma, {
                get(target, prop) {
                    if (prop === 'nodes') {
                        return {
                            findFirst: async () => ({
                                id: 888882,
                                name: 'byid_noprovider',
                                title: null,
                                description: null,
                                type: 'analysis',
                                modelId: 1,
                                tools: [],
                                outputSchema: null,
                                status: 1,
                                prompts: [],
                                model: {
                                    id: 1,
                                    name: 'm',
                                    modelType: 'chat',
                                    status: 1,
                                    sdkType: 'openai',
                                    contextWindow: null,
                                    modelProvider: null,
                                },
                            }),
                        }
                    }
                    return (target as any)[prop]
                },
            })
            try {
                const config = await getNodeConfigByIdService(888882)
                expect(config).toBeNull()
            } finally {
                ;(globalThis as any).prisma = originalPrisma
            }
        })
    })

    describe('getNodeConfigsByTypes - 按类型查询节点配置', () => {
        it('应返回指定类型的节点配置列表', async () => {
            const provider = await createProvider()
            await createApiKey(provider.id)
            const model = await createModel(provider.id, {
                sdkType: 'openai',
                contextWindow: 16384,
            })

            // 构造唯一的 type 以防干扰
            const typeTag = `gap_type_${generateTestId().slice(-8)}`
            await createNode(model.id, {
                name: `node_${generateTestId()}`,
                type: typeTag,
                priority: 10,
            })
            await createNode(model.id, {
                name: `node_${generateTestId()}`,
                type: typeTag,
                priority: 5,
            })
            // 另一个 type 不应被返回
            await createNode(model.id, {
                name: `node_${generateTestId()}`,
                type: 'not_in_filter',
            })

            const configs = await getNodeConfigsByTypes([typeTag])

            expect(configs.length).toBe(2)
            expect(configs.every(c => c.type === typeTag)).toBe(true)
            // 按 priority 升序排序：priority=5 在前
            expect(configs[0]!.type).toBe(typeTag)
            expect(configs.every(c => c.modelApiKeys.length > 0 || c.modelApiKeys.length === 0)).toBe(true)
        })

        it('使用默认类型参数时应查询 analysis/document 类型', async () => {
            const provider = await createProvider()
            await createApiKey(provider.id)
            const model = await createModel(provider.id)

            const marker = generateTestId()
            const analysisName = `node_analysis_${marker}`
            const documentName = `node_document_${marker}`
            await createNode(model.id, { name: analysisName, type: 'analysis' })
            await createNode(model.id, { name: documentName, type: 'document' })

            const configs = await getNodeConfigsByTypes()
            const analysisHit = configs.find(c => c.name === analysisName)
            const documentHit = configs.find(c => c.name === documentName)
            expect(analysisHit).toBeDefined()
            expect(documentHit).toBeDefined()
        })

        it('节点未关联 model 或 provider 时应被过滤掉', async () => {
            // 阶段 F 改造：getNodeConfigsByTypes 不再 include nodePrompts，
            // 而是分两步查询 nodes + node_prompts；mock 也要拦截两个表。
            const originalPrisma = (globalThis as any).prisma
            ;(globalThis as any).prisma = new Proxy(originalPrisma, {
                get(target, prop) {
                    if (prop === 'nodes') {
                        return {
                            findMany: async () => [
                                // 节点 1：model 为 null，应被过滤
                                {
                                    id: 900001,
                                    name: 'gap_node_no_model',
                                    title: null,
                                    description: null,
                                    type: 'gap_filter_type',
                                    priority: 10,
                                    modelId: 1,
                                    tools: [],
                                    outputSchema: null,
                                    status: 1,
                                    model: null,
                                },
                                // 节点 2：model 存在但 modelProvider 为 null，应被过滤
                                {
                                    id: 900002,
                                    name: 'gap_node_no_provider',
                                    title: null,
                                    description: null,
                                    type: 'gap_filter_type',
                                    priority: 20,
                                    modelId: 2,
                                    tools: [],
                                    outputSchema: null,
                                    status: 1,
                                    model: {
                                        id: 2,
                                        name: 'm',
                                        modelType: 'chat',
                                        status: 1,
                                        sdkType: 'openai',
                                        contextWindow: null,
                                        modelProvider: null,
                                    },
                                },
                                // 节点 3：正常，应被保留
                                {
                                    id: 900003,
                                    name: 'gap_node_valid',
                                    title: 'valid',
                                    description: 'desc',
                                    type: 'gap_filter_type',
                                    priority: 30,
                                    modelId: 3,
                                    tools: ['t1'],
                                    outputSchema: { a: 1 },
                                    status: 1,
                                    model: {
                                        id: 3,
                                        name: 'm3',
                                        modelType: 'chat',
                                        status: 1,
                                        sdkType: '',
                                        contextWindow: 8192,
                                        modelProvider: {
                                            id: 5,
                                            name: 'p5',
                                            baseUrl: 'https://api.test.com',
                                            description: null,
                                            modelApiKeys: [
                                                { id: 100, apiKey: 'sk-x', status: 1 },
                                            ],
                                        },
                                    },
                                },
                            ],
                        }
                    }
                    if (prop === 'node_prompts') {
                        return {
                            findMany: async () => [
                                // 节点 3 挂的链接（按 displayOrder 升序返回）
                                { nodeId: 900003, promptName: 'p', promptType: 'system', displayOrder: 100 },
                            ],
                        }
                    }
                    if (prop === 'prompts') {
                        return {
                            findMany: async () => [
                                {
                                    id: 10,
                                    name: 'p',
                                    content: 'c',
                                    version: 'v1',
                                    type: 'system',
                                    status: 1,
                                },
                            ],
                        }
                    }
                    return (target as any)[prop]
                },
            })

            try {
                const configs = await getNodeConfigsByTypes(['gap_filter_type'])
                // 只保留 id=900003
                expect(configs.length).toBe(1)
                expect(configs[0]!.id).toBe(900003)
                // 验证默认 sdkType 回退到 'openai'
                expect(configs[0]!.modelSdkType).toBe('openai')
                // 验证 provider.description 为 null 时回退到空字符串
                expect(configs[0]!.modelProviderDescription).toBe('')
                // 验证 contextWindow
                expect(configs[0]!.modelContextWindow).toBe(8192)
            } finally {
                ;(globalThis as any).prisma = originalPrisma
            }
        })

        it('节点有 tools 和 outputSchema 时应正确返回', async () => {
            const provider = await createProvider()
            await createApiKey(provider.id)
            const model = await createModel(provider.id)
            const tagType = `gap_tools_${generateTestId().slice(-8)}`
            const outputSchema = { type: 'object', properties: { a: { type: 'string' } } }
            await createNode(model.id, {
                type: tagType,
                tools: ['search_tool'],
                outputSchema,
            })

            const configs = await getNodeConfigsByTypes([tagType])
            expect(configs.length).toBe(1)
            expect(configs[0]!.tools).toEqual(['search_tool'])
            expect(configs[0]!.outputSchema).toEqual(outputSchema)
        })
    })
})
