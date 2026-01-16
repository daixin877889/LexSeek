/**
 * 模型管理测试数据库辅助模块
 *
 * 提供真实数据库操作的测试数据管理功能
 *
 * **Feature: model-management**
 * **Validates: Requirements 1.1, 2.1, 3.1**
 */

import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, Prisma } from '../../../generated/prisma/client'
import { config } from 'dotenv'

// 加载环境变量
config()

// 创建 Prisma 客户端实例
const createTestPrismaClient = () => {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) {
        throw new Error('DATABASE_URL 环境变量未设置')
    }
    const pool = new PrismaPg({ connectionString })
    return new PrismaClient({ adapter: pool })
}

// 延迟初始化
let _testPrisma: ReturnType<typeof createTestPrismaClient> | null = null

export const getTestPrisma = () => {
    if (!_testPrisma) {
        _testPrisma = createTestPrismaClient()
    }
    return _testPrisma
}

// ==================== 测试数据标记前缀 ====================

/** 测试提供商名称前缀 */
export const TEST_PROVIDER_NAME_PREFIX = '测试提供商_'

/** 测试 API 密钥名称前缀 */
export const TEST_API_KEY_NAME_PREFIX = '测试密钥_'

/** 测试模型名称前缀 */
export const TEST_MODEL_NAME_PREFIX = '测试模型_'

// ==================== 测试数据 ID 追踪 ====================

/** 测试数据 ID 追踪接口 */
export interface ModelTestIds {
    providerIds: number[]
    apiKeyIds: number[]
    modelIds: number[]
}

/** 创建空的测试 ID 追踪对象 */
export const createEmptyModelTestIds = (): ModelTestIds => ({
    providerIds: [],
    apiKeyIds: [],
    modelIds: [],
})

// ==================== 状态常量 ====================

/** 模型状态 */
export const ModelStatus = {
    DISABLED: 0,
    ENABLED: 1,
} as const

/** 模型类型 */
export const ModelType = {
    CHAT: 'chat',
    EMBEDDING: 'embedding',
    ASR: 'asr',
} as const

// ==================== 测试数据创建函数 ====================

/** 提供商创建输入类型 */
export interface TestProviderInput {
    name?: string
    baseUrl?: string
    description?: string | null
}

/**
 * 创建测试模型提供商
 * @param data 提供商数据（可选）
 * @returns 创建的提供商记录
 */
export const createTestModelProvider = async (
    data: TestProviderInput = {}
): Promise<Prisma.modelProvidersGetPayload<{}>> => {
    const timestamp = Date.now()
    const random = Math.floor(Math.random() * 10000)

    const provider = await getTestPrisma().modelProviders.create({
        data: {
            name: data.name || `${TEST_PROVIDER_NAME_PREFIX}${timestamp}_${random}`,
            baseUrl: data.baseUrl || `https://api.test-${timestamp}.com`,
            description: data.description ?? '测试提供商描述',
        },
    })
    return provider
}

/** API 密钥创建输入类型 */
export interface TestApiKeyInput {
    name?: string
    apiKey?: string
    isDefault?: boolean
    status?: number
    dailyLimit?: number | null
    monthlyLimit?: number | null
}

/**
 * 创建测试 API 密钥
 * @param providerId 提供商 ID
 * @param data 密钥数据（可选）
 * @returns 创建的密钥记录
 */
export const createTestModelApiKey = async (
    providerId: number,
    data: TestApiKeyInput = {}
): Promise<Prisma.modelApiKeysGetPayload<{}>> => {
    const timestamp = Date.now()
    const random = Math.floor(Math.random() * 10000)

    const apiKey = await getTestPrisma().modelApiKeys.create({
        data: {
            providerId,
            name: data.name || `${TEST_API_KEY_NAME_PREFIX}${timestamp}_${random}`,
            apiKey: data.apiKey || `sk-test-${timestamp}-${random}`,
            isDefault: data.isDefault ?? false,
            status: data.status ?? ModelStatus.ENABLED,
            dailyLimit: data.dailyLimit,
            monthlyLimit: data.monthlyLimit,
        },
    })
    return apiKey
}

/** SDK 类型常量 */
export const SdkType = {
    OPENAI: 'openai',
    DEEPSEEK: 'deepseek',
    GEMINI: 'gemini',
    ANTHROPIC: 'anthropic',
} as const

/** 模型创建输入类型 */
export interface TestModelInput {
    name?: string
    displayName?: string
    modelType?: string
    /** LangChain SDK 类型 */
    sdkType?: string
    modelVersion?: string | null
    contextWindow?: number | null
    dimensions?: number | null
    batchSize?: number | null
    isDefault?: boolean
    status?: number
    priority?: number
    inputCostPerMillionTokens?: number | null
    outputCostPerMillionTokens?: number | null
}

/**
 * 创建测试模型
 * @param providerId 提供商 ID
 * @param data 模型数据（可选）
 * @returns 创建的模型记录
 */
export const createTestModel = async (
    providerId: number,
    data: TestModelInput = {}
): Promise<Prisma.modelsGetPayload<{}>> => {
    const timestamp = Date.now()
    const random = Math.floor(Math.random() * 10000)

    const model = await getTestPrisma().models.create({
        data: {
            providerId,
            name: data.name || `${TEST_MODEL_NAME_PREFIX}${timestamp}_${random}`,
            displayName: data.displayName || `测试模型显示名_${timestamp}`,
            modelType: data.modelType || ModelType.CHAT,
            sdkType: data.sdkType || SdkType.OPENAI,
            modelVersion: data.modelVersion,
            contextWindow: data.contextWindow,
            dimensions: data.dimensions,
            batchSize: data.batchSize,
            isDefault: data.isDefault ?? false,
            status: data.status ?? ModelStatus.ENABLED,
            priority: data.priority ?? 10,
            inputCostPerMillionTokens: data.inputCostPerMillionTokens,
            outputCostPerMillionTokens: data.outputCostPerMillionTokens,
        },
    })
    return model
}

// ==================== 测试数据清理函数 ====================

/**
 * 清理测试数据（按外键顺序删除）
 * @param testIds 测试数据 ID 追踪对象
 */
export const cleanupModelTestData = async (testIds: ModelTestIds): Promise<void> => {
    try {
        // 1. 删除模型
        if (testIds.modelIds.length > 0) {
            await getTestPrisma().models.deleteMany({
                where: { id: { in: testIds.modelIds } },
            })
        }

        // 2. 删除 API 密钥
        if (testIds.apiKeyIds.length > 0) {
            await getTestPrisma().modelApiKeys.deleteMany({
                where: { id: { in: testIds.apiKeyIds } },
            })
        }

        // 3. 删除提供商
        if (testIds.providerIds.length > 0) {
            await getTestPrisma().modelProviders.deleteMany({
                where: { id: { in: testIds.providerIds } },
            })
        }
    } catch (error) {
        console.warn('清理测试数据时出错：', error)
    }
}

/**
 * 清理所有测试数据（使用测试标记前缀）
 */
export const cleanupAllModelTestData = async (): Promise<void> => {
    try {
        // 1. 删除测试模型
        await getTestPrisma().models.deleteMany({
            where: { name: { startsWith: TEST_MODEL_NAME_PREFIX } },
        })

        // 2. 删除测试 API 密钥
        await getTestPrisma().modelApiKeys.deleteMany({
            where: { name: { startsWith: TEST_API_KEY_NAME_PREFIX } },
        })

        // 3. 删除测试提供商
        await getTestPrisma().modelProviders.deleteMany({
            where: { name: { startsWith: TEST_PROVIDER_NAME_PREFIX } },
        })

        console.log('已清理所有模型管理测试数据')
    } catch (error) {
        console.warn('清理所有测试数据时出错：', error)
    }
}

// ==================== 数据库连接管理 ====================

/**
 * 断开数据库连接
 */
export const disconnectTestDb = async (): Promise<void> => {
    if (_testPrisma) {
        await _testPrisma.$disconnect()
        _testPrisma = null
    }
}

/**
 * 检查数据库连接是否可用
 * @returns 是否可用
 */
export const isTestDbAvailable = async (): Promise<boolean> => {
    try {
        const prisma = getTestPrisma()
        await prisma.$queryRaw`SELECT 1`
        return true
    } catch (error) {
        console.warn('数据库连接检查失败：', error)
        return false
    }
}

/**
 * 重置数据库序列
 */
export const resetModelDatabaseSequences = async (): Promise<void> => {
    try {
        const prisma = getTestPrisma()
        await prisma.$executeRaw`SELECT setval('model_providers_id_seq', GREATEST((SELECT COALESCE(MAX(id), 0) FROM model_providers), 1000))`
        await prisma.$executeRaw`SELECT setval('model_api_keys_id_seq', GREATEST((SELECT COALESCE(MAX(id), 0) FROM model_api_keys), 1000))`
        await prisma.$executeRaw`SELECT setval('models_id_seq', GREATEST((SELECT COALESCE(MAX(id), 0) FROM models), 1000))`
    } catch (error) {
        console.warn('重置数据库序列时出错：', error)
    }
}
