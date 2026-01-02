/**
 * 兑换码测试数据库辅助函数
 *
 * 提供测试数据创建、清理和数据库连接管理
 *
 * **Feature: redemption-admin**
 * **Validates: Requirements 2.1-2.8, 3.1-3.4**
 */

import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../../generated/prisma/client'
import { config } from 'dotenv'
import { RedemptionCodeStatus, RedemptionCodeType } from '../../../shared/types/redemption'

// 加载环境变量
config()

// 导出类型和常量
export { RedemptionCodeStatus, RedemptionCodeType }

// 创建 Prisma 客户端实例（使用 pg 适配器）
const createTestPrismaClient = () => {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) {
        throw new Error('DATABASE_URL 环境变量未设置')
    }
    const pool = new PrismaPg({ connectionString })
    return new PrismaClient({ adapter: pool })
}

// 延迟初始化，避免在导入时就创建连接
let _testPrisma: ReturnType<typeof createTestPrismaClient> | null = null

/**
 * 获取测试用 Prisma 客户端
 */


/**
 * 检查数据库是否可用
 */
export const isTestDbAvailable = async (): Promise<boolean> => {
    try {
        const prisma = getTestPrisma()
        await prisma.$queryRaw`SELECT 1`
        return true
    } catch {
        return false
    }
}

/**
 * 测试数据 ID 集合
 */
export interface TestIds {
    redemptionCodeIds: number[]
    redemptionRecordIds: number[]
    userIds: number[]
    membershipLevelIds: number[]
}

/**
 * 创建空的测试 ID 集合
 */
export const createEmptyTestIds = (): TestIds => ({
    redemptionCodeIds: [],
    redemptionRecordIds: [],
    userIds: [],
    membershipLevelIds: [],
})

/**
 * 清理测试数据
 */
export const cleanupTestData = async (testIds: TestIds): Promise<void> => {
    const prisma = getTestPrisma()

    // 按依赖顺序删除
    if (testIds.redemptionRecordIds.length > 0) {
        await prisma.redemptionRecords.deleteMany({
            where: { id: { in: testIds.redemptionRecordIds } },
        })
    }

    if (testIds.redemptionCodeIds.length > 0) {
        await prisma.redemptionCodes.deleteMany({
            where: { id: { in: testIds.redemptionCodeIds } },
        })
    }

    if (testIds.userIds.length > 0) {
        await prisma.users.deleteMany({
            where: { id: { in: testIds.userIds } },
        })
    }

    if (testIds.membershipLevelIds.length > 0) {
        await prisma.membershipLevels.deleteMany({
            where: { id: { in: testIds.membershipLevelIds } },
        })
    }
}

/**
 * 创建测试用会员级别
 */
export const createTestMembershipLevel = async (
    data?: Partial<{
        name: string
        sortOrder: number
        status: number
    }>
): Promise<{ id: number; name: string; sortOrder: number }> => {
    const prisma = getTestPrisma()
    const level = await prisma.membershipLevels.create({
        data: {
            name: data?.name || `测试级别_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            sortOrder: data?.sortOrder || Math.floor(Math.random() * 1000) + 1000,
            status: data?.status ?? 1,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    return { id: level.id, name: level.name, sortOrder: level.sortOrder }
}

/**
 * 创建测试用户
 */
export const createTestUser = async (
    data?: Partial<{
        name: string
        phone: string
    }>
): Promise<{ id: number; name: string; phone: string }> => {
    const prisma = getTestPrisma()
    const phone = data?.phone || `1${Date.now().toString().slice(-10)}`
    const user = await prisma.users.create({
        data: {
            name: data?.name || `测试用户_${Date.now()}`,
            phone,
            password: 'test_password_hash',
            status: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    return { id: user.id, name: user.name || '', phone: user.phone }
}

/**
 * 创建测试兑换码
 */
export const createTestRedemptionCode = async (
    data?: Partial<{
        code: string
        type: RedemptionCodeType
        levelId: number
        duration: number
        pointAmount: number
        status: RedemptionCodeStatus
        expiredAt: Date
        remark: string
    }>
): Promise<{
    id: number
    code: string
    type: number
    status: number
    levelId: number | null
    duration: number | null
    pointAmount: number | null
}> => {
    const prisma = getTestPrisma()
    const code = await prisma.redemptionCodes.create({
        data: {
            code: data?.code || `TEST-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
            type: data?.type ?? RedemptionCodeType.MEMBERSHIP_ONLY,
            levelId: data?.levelId || null,
            duration: data?.duration || null,
            pointAmount: data?.pointAmount || null,
            status: data?.status ?? RedemptionCodeStatus.ACTIVE,
            expiredAt: data?.expiredAt || null,
            remark: data?.remark || null,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    return {
        id: code.id,
        code: code.code,
        type: code.type,
        status: code.status,
        levelId: code.levelId,
        duration: code.duration,
        pointAmount: code.pointAmount,
    }
}

/**
 * 创建测试兑换记录
 */
export const createTestRedemptionRecord = async (
    userId: number,
    codeId: number
): Promise<{ id: number; userId: number; codeId: number }> => {
    const prisma = getTestPrisma()
    const record = await prisma.redemptionRecords.create({
        data: {
            userId,
            codeId,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    return { id: record.id, userId: record.userId, codeId: record.codeId }
}
