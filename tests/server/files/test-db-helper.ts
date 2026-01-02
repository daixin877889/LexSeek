/**
 * 文件服务测试数据库辅助模块
 *
 * 提供文件服务测试所需的数据库操作和测试数据管理
 *
 * **Feature: files-test-infrastructure**
 * **Validates: Requirements 6.1**
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

// 测试数据前缀
export const TEST_FILE_PREFIX = 'test_file_'
export const TEST_USER_PHONE_PREFIX = '199'

// 文件来源类型
export const FileSource = {
    UPLOAD: 'upload',
    SYSTEM: 'system',
} as const

// 文件状态
export const OssFileStatus = {
    PENDING: 0,
    UPLOADED: 1,
    FAILED: 2,
} as const

// 测试数据 ID 追踪
export interface TestIds {
    userIds: number[]
    ossFileIds: number[]
}

export const createEmptyTestIds = (): TestIds => ({
    userIds: [],
    ossFileIds: [],
})

/**
 * 创建测试用户
 */
export const createTestUser = async (): Promise<Prisma.usersGetPayload<{}>> => {
    const timestamp = Date.now()
    const random = Math.floor(Math.random() * 10000)
    const suffix = String(timestamp).slice(-4) + String(random).padStart(4, '0')
    const phone = `199${suffix}`

    const user = await getTestPrisma().users.create({
        data: {
            name: `测试用户_${timestamp}`,
            phone,
            password: 'test_password_hash',
            status: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    return user
}

/**
 * 创建测试 OSS 文件记录
 */
export interface TestOssFileInput {
    fileName?: string
    filePath?: string
    fileType?: string
    fileSize?: number
    bucketName?: string
    source?: string
    status?: number
    encrypted?: boolean
}

export const createTestOssFile = async (
    userId: number,
    data: TestOssFileInput = {}
): Promise<Prisma.ossFilesGetPayload<{}>> => {
    const timestamp = Date.now()
    const random = Math.random().toString(36).substring(2, 8)

    const file = await getTestPrisma().ossFiles.create({
        data: {
            userId,
            fileName: data.fileName || `${TEST_FILE_PREFIX}${timestamp}_${random}.pdf`,
            filePath: data.filePath || `uploads/${timestamp}/${random}.pdf`,
            fileType: data.fileType || 'application/pdf',
            fileSize: data.fileSize ?? 1024,
            bucketName: data.bucketName || 'test-bucket',
            source: data.source || FileSource.UPLOAD,
            status: typeof data.status === 'number' ? data.status : OssFileStatus.UPLOADED,
            encrypted: data.encrypted ?? false,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    return file
}

/**
 * 清理测试数据
 */
export const cleanupTestData = async (testIds: TestIds): Promise<void> => {
    try {
        if (testIds.ossFileIds.length > 0) {
            await getTestPrisma().ossFiles.deleteMany({
                where: { id: { in: testIds.ossFileIds } },
            })
        }
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
 * 断开数据库连接
 */
export const disconnectTestDb = async (): Promise<void> => {
    if (_testPrisma) {
        await _testPrisma.$disconnect()
        _testPrisma = null
    }
}
