/**
 * 案件模块测试数据库辅助模块
 *
 * 提供真实数据库操作的测试数据管理功能
 * 所有测试数据使用特定前缀标记，便于清理
 *
 * **Feature: server-test-coverage**
 * **Validates: Requirements 1.1, 2.1**
 */

import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, Prisma } from '../../../generated/prisma/client'
import { config } from 'dotenv'
import { v7 as uuidv7 } from 'uuid'
import { CaseStatus, SessionStatus, CaseMaterialType } from '../../../shared/types/case'
import { MaterialStatus } from '../../../shared/types/material'

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

// 兼容性导出
export const testPrisma = new Proxy({} as ReturnType<typeof createTestPrismaClient>, {
    get(_, prop) {
        return (getTestPrisma() as any)[prop]
    },
})

// ==================== 测试数据标记前缀 ====================

/** 测试用户手机号前缀 */
export const TEST_USER_PHONE_PREFIX = '199'

/** 测试案件标题前缀 */
export const TEST_CASE_TITLE_PREFIX = '测试案件_'

/** 测试案件类型名称前缀 */
export const TEST_CASE_TYPE_PREFIX = '测试类型_'

/** 测试材料名称前缀 */
export const TEST_MATERIAL_PREFIX = '测试材料_'

// ==================== 测试数据 ID 追踪 ====================

/** 测试数据 ID 追踪接口 */
export interface CaseTestIds {
    userIds: number[]
    caseIds: number[]
    sessionIds: string[]
    caseTypeIds: number[]
    materialIds: number[]
    analysisIds: number[]
    ossFileIds: number[]
    nodeIds: number[]
    modelIds: number[]
    modelProviderIds: number[]
}

/** 创建空的测试 ID 追踪对象 */
export const createEmptyTestIds = (): CaseTestIds => ({
    userIds: [],
    caseIds: [],
    sessionIds: [],
    caseTypeIds: [],
    materialIds: [],
    analysisIds: [],
    ossFileIds: [],
    nodeIds: [],
    modelIds: [],
    modelProviderIds: [],
})

/** 重置测试 ID 追踪对象 */
export const resetTestIds = (testIds: CaseTestIds): void => {
    testIds.userIds = []
    testIds.caseIds = []
    testIds.sessionIds = []
    testIds.caseTypeIds = []
    testIds.materialIds = []
    testIds.analysisIds = []
    testIds.ossFileIds = []
    testIds.nodeIds = []
    testIds.modelIds = []
    testIds.modelProviderIds = []
}

// ==================== 测试数据创建函数 ====================

/** 用户创建输入类型 */
export interface TestUserInput {
    name?: string
    phone?: string
    password?: string
    status?: number
}

/**
 * 创建测试用户
 */
export const createTestUser = async (
    data: TestUserInput = {}
): Promise<Prisma.usersGetPayload<{}>> => {
    const timestamp = Date.now()
    const random = Math.floor(Math.random() * 10000)
    const suffix = String(timestamp).slice(-4) + String(random).padStart(4, '0')
    const phone = data.phone || `199${suffix}`

    const user = await getTestPrisma().users.create({
        data: {
            name: data.name || `测试用户_${timestamp}`,
            phone,
            password: data.password || 'test_password_hash',
            status: data.status ?? 1,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    return user
}

/** 案件类型创建输入类型 */
export interface TestCaseTypeInput {
    name?: string
    description?: string | null
    icon?: string | null
    priority?: number
    status?: number
}

/**
 * 创建测试案件类型
 */
export const createTestCaseType = async (
    data: TestCaseTypeInput = {}
): Promise<Prisma.caseTypesGetPayload<{}>> => {
    const timestamp = Date.now()

    const caseType = await getTestPrisma().caseTypes.create({
        data: {
            name: data.name || `${TEST_CASE_TYPE_PREFIX}${timestamp}`,
            description: 'description' in data ? data.description : '测试案件类型描述',
            icon: data.icon ?? null,
            priority: data.priority ?? Math.floor(Math.random() * 100) + 1,
            status: data.status ?? 1,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    return caseType
}

/** 案件创建输入类型 */
export interface TestCaseInput {
    title?: string
    content?: string | null
    caseTypeId: number
    userId: number
    plaintiff?: any
    defendant?: any
    isDemo?: boolean
    status?: number
}

/**
 * 创建测试案件
 */
export const createTestCase = async (
    data: TestCaseInput
): Promise<Prisma.casesGetPayload<{}>> => {
    const timestamp = Date.now()

    const caseRecord = await getTestPrisma().cases.create({
        data: {
            title: data.title || `${TEST_CASE_TITLE_PREFIX}${timestamp}`,
            content: data.content ?? '测试案件内容',
            caseTypeId: data.caseTypeId,
            userId: data.userId,
            plaintiff: data.plaintiff ?? null,
            defendant: data.defendant ?? null,
            isDemo: data.isDemo ?? false,
            status: data.status ?? CaseStatus.IN_PROGRESS,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    return caseRecord
}

/** 会话创建输入类型 */
export interface TestSessionInput {
    sessionId?: string
    caseId: number
    status?: number
}

/**
 * 创建测试会话
 */
export const createTestSession = async (
    data: TestSessionInput
): Promise<Prisma.caseSessionsGetPayload<{}>> => {
    const session = await getTestPrisma().caseSessions.create({
        data: {
            sessionId: data.sessionId || uuidv7(),
            caseId: data.caseId,
            status: data.status ?? SessionStatus.IN_PROGRESS,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    return session
}

/** 材料创建输入类型 */
export interface TestMaterialInput {
    caseId: number
    name?: string
    type?: number
    content?: string | null
    originalContent?: string | null
    ossFileId?: number | null
    isEncrypted?: boolean
    status?: number
}

/**
 * 创建测试材料
 */
export const createTestMaterial = async (
    data: TestMaterialInput
): Promise<Prisma.caseMaterialsGetPayload<{}>> => {
    const timestamp = Date.now()

    const material = await getTestPrisma().caseMaterials.create({
        data: {
            caseId: data.caseId,
            name: data.name || `${TEST_MATERIAL_PREFIX}${timestamp}`,
            type: data.type ?? CaseMaterialType.CASE_CONTENT,
            content: data.content ?? '测试材料内容',
            originalContent: data.originalContent ?? null,
            ossFileId: data.ossFileId ?? null,
            isEncrypted: data.isEncrypted ?? false,
            status: data.status ?? MaterialStatus.PENDING,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    return material
}

/** OSS 文件创建输入类型 */
export interface TestOssFileInput {
    fileName?: string
    filePath?: string
    fileSize?: number
    fileType?: string
    bucketName?: string
    userId?: number
}

/**
 * 创建测试 OSS 文件
 */
export const createTestOssFile = async (
    data: TestOssFileInput = {},
    testIds?: CaseTestIds
): Promise<Prisma.ossFilesGetPayload<{}>> => {
    const timestamp = Date.now()

    // 如果没有提供 userId，需要创建一个测试用户
    let userId = data.userId
    if (!userId) {
        const testUser = await createTestUser()
        userId = testUser.id
        // 如果提供了 testIds，记录用户 ID 以便清理
        if (testIds) {
            testIds.userIds.push(testUser.id)
        }
    }

    const ossFile = await getTestPrisma().ossFiles.create({
        data: {
            fileName: data.fileName || `test_file_${timestamp}.txt`,
            filePath: data.filePath || `test/files/${timestamp}.txt`,
            fileSize: data.fileSize ?? 1024,
            fileType: data.fileType || 'text/plain',
            bucketName: data.bucketName || 'test-bucket',
            userId: userId,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    return ossFile
}

/** 节点创建输入类型 */
export interface TestNodeInput {
    name?: string
    title?: string | null
    type?: string
    description?: string | null
    modelId: number
    status?: number
}

/**
 * 创建测试节点
 */
export const createTestNode = async (
    data: TestNodeInput
): Promise<Prisma.nodesGetPayload<{}>> => {
    const timestamp = Date.now()
    const random = Math.random().toString(36).substring(2, 8)

    const node = await getTestPrisma().nodes.create({
        data: {
            name: data.name || `test_node_${timestamp}_${random}`,
            title: data.title ?? `测试节点_${timestamp}`,
            type: data.type || 'analysis',
            description: data.description ?? '测试节点描述',
            modelId: data.modelId,
            status: data.status ?? 1,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    return node
}

/** 模型提供商创建输入类型 */
export interface TestModelProviderInput {
    name?: string
    baseUrl?: string
    description?: string | null
}

/**
 * 创建测试模型提供商
 */
export const createTestModelProvider = async (
    data: TestModelProviderInput = {}
): Promise<Prisma.modelProvidersGetPayload<{}>> => {
    const timestamp = Date.now()
    const random = Math.random().toString(36).substring(2, 8)

    const provider = await getTestPrisma().modelProviders.create({
        data: {
            name: data.name || `test_provider_${timestamp}_${random}`,
            baseUrl: data.baseUrl || 'https://api.test.com',
            description: data.description ?? '测试模型提供商',
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    return provider
}

/** 模型创建输入类型 */
export interface TestModelInput {
    providerId: number
    name?: string
    displayName?: string
    modelType?: string
    status?: number
}

/**
 * 创建测试模型
 */
export const createTestModel = async (
    data: TestModelInput
): Promise<Prisma.modelsGetPayload<{}>> => {
    const timestamp = Date.now()
    const random = Math.random().toString(36).substring(2, 8)

    const model = await getTestPrisma().models.create({
        data: {
            providerId: data.providerId,
            name: data.name || `test_model_${timestamp}_${random}`,
            displayName: data.displayName || `测试模型_${timestamp}`,
            modelType: data.modelType || 'chat',
            status: data.status ?? 1,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    return model
}

/** 分析结果创建输入类型 */
export interface TestAnalysisInput {
    caseId: number
    sessionId: string
    nodeId: number
    analysisType?: string
    analysisResult?: string | null
    originalResult?: string | null
    version?: number
    status?: number
}

/**
 * 创建测试分析结果
 */
export const createTestAnalysis = async (
    data: TestAnalysisInput
): Promise<Prisma.caseAnalysesGetPayload<{}>> => {
    const analysis = await getTestPrisma().caseAnalyses.create({
        data: {
            caseId: data.caseId,
            sessionId: data.sessionId,
            nodeId: data.nodeId,
            analysisType: data.analysisType || 'test_analysis',
            analysisResult: data.analysisResult ?? '测试分析结果',
            originalResult: data.originalResult ?? null,
            version: data.version ?? 1,
            status: data.status ?? 2, // COMPLETED
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    return analysis
}

// ==================== 测试数据清理函数 ====================

/**
 * 清理测试数据（按外键顺序删除）
 */
export const cleanupTestData = async (testIds: CaseTestIds): Promise<void> => {
    try {
        // 1. 删除分析结果
        if (testIds.analysisIds.length > 0) {
            await getTestPrisma().caseAnalyses.deleteMany({
                where: { id: { in: testIds.analysisIds } },
            })
        }

        // 2. 删除材料
        if (testIds.materialIds.length > 0) {
            await getTestPrisma().caseMaterials.deleteMany({
                where: { id: { in: testIds.materialIds } },
            })
        }

        // 3. 删除会话
        if (testIds.sessionIds.length > 0) {
            await getTestPrisma().caseSessions.deleteMany({
                where: { sessionId: { in: testIds.sessionIds } },
            })
        }

        // 4. 删除案件
        if (testIds.caseIds.length > 0) {
            await getTestPrisma().cases.deleteMany({
                where: { id: { in: testIds.caseIds } },
            })
        }

        // 5. 删除 OSS 文件
        if (testIds.ossFileIds.length > 0) {
            await getTestPrisma().ossFiles.deleteMany({
                where: { id: { in: testIds.ossFileIds } },
            })
        }

        // 6. 删除节点
        if (testIds.nodeIds.length > 0) {
            await getTestPrisma().nodes.deleteMany({
                where: { id: { in: testIds.nodeIds } },
            })
        }

        // 7. 删除模型
        if (testIds.modelIds.length > 0) {
            await getTestPrisma().models.deleteMany({
                where: { id: { in: testIds.modelIds } },
            })
        }

        // 8. 删除模型提供商
        if (testIds.modelProviderIds.length > 0) {
            await getTestPrisma().modelProviders.deleteMany({
                where: { id: { in: testIds.modelProviderIds } },
            })
        }

        // 9. 删除案件类型
        if (testIds.caseTypeIds.length > 0) {
            await getTestPrisma().caseTypes.deleteMany({
                where: { id: { in: testIds.caseTypeIds } },
            })
        }

        // 10. 删除用户
        if (testIds.userIds.length > 0) {
            await getTestPrisma().users.deleteMany({
                where: { id: { in: testIds.userIds } },
            })
        }
    } catch (error) {
        console.warn('清理测试数据时出错：', error)
    }
}

/**
 * 清理所有测试数据（使用测试标记前缀）
 */
export const cleanupAllTestData = async (): Promise<void> => {
    try {
        // 1. 删除测试案件相关的分析结果
        const testCases = await getTestPrisma().cases.findMany({
            where: { title: { startsWith: TEST_CASE_TITLE_PREFIX } },
            select: { id: true },
        })
        if (testCases.length > 0) {
            const caseIds = testCases.map(c => c.id)
            await getTestPrisma().caseAnalyses.deleteMany({
                where: { caseId: { in: caseIds } },
            })
            await getTestPrisma().caseMaterials.deleteMany({
                where: { caseId: { in: caseIds } },
            })
            await getTestPrisma().caseSessions.deleteMany({
                where: { caseId: { in: caseIds } },
            })
        }

        // 2. 删除测试案件
        await getTestPrisma().cases.deleteMany({
            where: { title: { startsWith: TEST_CASE_TITLE_PREFIX } },
        })

        // 3. 删除测试案件类型
        await getTestPrisma().caseTypes.deleteMany({
            where: { name: { startsWith: TEST_CASE_TYPE_PREFIX } },
        })

        // 4. 删除测试用户
        await getTestPrisma().users.deleteMany({
            where: { phone: { startsWith: TEST_USER_PHONE_PREFIX } },
        })

        console.log('已清理所有案件模块测试数据')
    } catch (error) {
        console.warn('清理所有测试数据时出错：', error)
    }
}

// ==================== 数据库连接管理 ====================

/**
 * 连接数据库
 */
export const connectTestDb = async (): Promise<void> => {
    await getTestPrisma().$connect()
}

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
export const resetDatabaseSequences = async (): Promise<void> => {
    try {
        const prisma = getTestPrisma()
        await prisma.$executeRaw`SELECT setval('cases_id_seq', GREATEST((SELECT MAX(id) FROM cases), 1000))`
        await prisma.$executeRaw`SELECT setval('case_types_id_seq', GREATEST((SELECT MAX(id) FROM case_types), 1000))`
        await prisma.$executeRaw`SELECT setval('case_materials_id_seq', GREATEST((SELECT MAX(id) FROM case_materials), 1000))`
        await prisma.$executeRaw`SELECT setval('case_analyses_id_seq', GREATEST((SELECT MAX(id) FROM case_analyses), 1000))`
        await prisma.$executeRaw`SELECT setval('oss_files_id_seq', GREATEST((SELECT MAX(id) FROM oss_files), 1000))`
        await prisma.$executeRaw`SELECT setval('nodes_id_seq', GREATEST((SELECT MAX(id) FROM nodes), 1000))`
        await prisma.$executeRaw`SELECT setval('users_id_seq', GREATEST((SELECT MAX(id) FROM users), 1000))`
    } catch (error) {
        console.warn('重置数据库序列时出错：', error)
    }
}
