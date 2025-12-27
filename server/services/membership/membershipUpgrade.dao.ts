/**
 * 会员升级记录数据访问层
 *
 * 提供会员升级记录的 CRUD 操作
 */
import { Prisma } from '#shared/types/prisma'

// 定义 Prisma 客户端类型（支持事务）
type PrismaClient = typeof prisma

/** 升级记录包含关联 */
const upgradeRecordInclude = {
    fromMembership: {
        include: { level: true },
    },
    toMembership: {
        include: { level: true },
    },
    order: true,
} as const

/**
 * 创建会员升级记录
 * @param data 升级记录数据
 * @param tx 事务客户端（可选）
 * @returns 创建的升级记录
 */
export const createMembershipUpgradeRecordDao = async (
    data: {
        userId: number
        fromMembershipId: number
        toMembershipId: number
        orderId: number
        upgradePrice: number
        pointCompensation: number
    },
    tx?: PrismaClient
): Promise<membershipUpgradeRecords> => {
    try {
        const record = await (tx || prisma).membershipUpgradeRecords.create({
            data: {
                userId: data.userId,
                fromMembershipId: data.fromMembershipId,
                toMembershipId: data.toMembershipId,
                orderId: data.orderId,
                upgradePrice: data.upgradePrice,
                pointCompensation: data.pointCompensation,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })
        return record
    } catch (error) {
        logger.error('创建会员升级记录失败：', error)
        throw error
    }
}

/**
 * 通过 ID 查询升级记录
 * @param id 升级记录 ID
 * @param tx 事务客户端（可选）
 * @returns 升级记录或 null
 */
export const findMembershipUpgradeRecordByIdDao = async (
    id: number,
    tx?: PrismaClient
): Promise<(membershipUpgradeRecords & {
    fromMembership: userMemberships & { level: membershipLevels }
    toMembership: userMemberships & { level: membershipLevels }
    order: orders
}) | null> => {
    try {
        const record = await (tx || prisma).membershipUpgradeRecords.findUnique({
            where: { id, deletedAt: null },
            include: upgradeRecordInclude,
        })
        return record
    } catch (error) {
        logger.error('通过 ID 查询升级记录失败：', error)
        throw error
    }
}

/**
 * 查询用户的升级记录列表
 * @param userId 用户 ID
 * @param options 查询选项
 * @param tx 事务客户端（可选）
 * @returns 升级记录列表和总数
 */
export const findUserUpgradeRecordsDao = async (
    userId: number,
    options: {
        page?: number
        pageSize?: number
    } = {},
    tx?: PrismaClient
): Promise<{
    list: (membershipUpgradeRecords & {
        fromMembership: userMemberships & { level: membershipLevels }
        toMembership: userMemberships & { level: membershipLevels }
        order: orders
    })[]
    total: number
}> => {
    try {
        const { page = 1, pageSize = 10 } = options
        const skip = (page - 1) * pageSize

        const where: Prisma.membershipUpgradeRecordsWhereInput = {
            userId,
            deletedAt: null,
        }

        const [list, total] = await Promise.all([
            (tx || prisma).membershipUpgradeRecords.findMany({
                where,
                include: upgradeRecordInclude,
                skip,
                take: pageSize,
                orderBy: { createdAt: 'desc' },
            }),
            (tx || prisma).membershipUpgradeRecords.count({ where }),
        ])

        return { list, total }
    } catch (error) {
        logger.error('查询用户升级记录列表失败：', error)
        throw error
    }
}

/**
 * 通过订单 ID 查询升级记录
 * @param orderId 订单 ID
 * @param tx 事务客户端（可选）
 * @returns 升级记录或 null
 */
export const findUpgradeRecordByOrderIdDao = async (
    orderId: number,
    tx?: PrismaClient
): Promise<membershipUpgradeRecords | null> => {
    try {
        const record = await (tx || prisma).membershipUpgradeRecords.findFirst({
            where: { orderId, deletedAt: null },
        })
        return record
    } catch (error) {
        logger.error('通过订单 ID 查询升级记录失败：', error)
        throw error
    }
}
