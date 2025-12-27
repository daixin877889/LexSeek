/**
 * 积分记录数据访问层
 * 
 * 提供积分记录的 CRUD 操作
 */
import { Prisma } from '#shared/types/prisma'

// 定义 Prisma 客户端类型（支持事务）
type PrismaClient = typeof prisma

/**
 * 创建积分记录
 * @param data 积分记录创建数据
 * @param tx 事务客户端（可选）
 * @returns 创建的积分记录
 */
export const createPointRecordDao = async (
    data: Prisma.pointRecordsCreateInput,
    tx?: PrismaClient
): Promise<pointRecords> => {
    try {
        const record = await (tx || prisma).pointRecords.create({
            data: {
                ...data,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })
        return record
    } catch (error) {
        logger.error('创建积分记录失败：', error)
        throw error
    }
}

/**
 * 通过 ID 查询积分记录
 * @param id 积分记录 ID
 * @param tx 事务客户端（可选）
 * @returns 积分记录或 null
 */
export const findPointRecordByIdDao = async (
    id: number,
    tx?: PrismaClient
): Promise<pointRecords | null> => {
    try {
        const record = await (tx || prisma).pointRecords.findUnique({
            where: { id, deletedAt: null },
        })
        return record
    } catch (error) {
        logger.error('通过 ID 查询积分记录失败：', error)
        throw error
    }
}


/**
 * 查询用户积分记录列表（分页）
 * @param userId 用户 ID
 * @param options 查询选项
 * @param tx 事务客户端（可选）
 * @returns 积分记录列表和总数
 */
export const findPointRecordsByUserIdDao = async (
    userId: number,
    options: {
        page?: number
        pageSize?: number
        sourceType?: number
    },
    tx?: PrismaClient
): Promise<{ list: pointRecords[]; total: number }> => {
    try {
        const { page = 1, pageSize = 10, sourceType } = options
        const skip = (page - 1) * pageSize

        // 构建查询条件
        const where: Prisma.pointRecordsWhereInput = {
            userId,
            deletedAt: null,
            ...(sourceType !== undefined && { sourceType }),
        }

        // 并行查询列表和总数
        const [list, total] = await Promise.all([
            (tx || prisma).pointRecords.findMany({
                where,
                skip,
                take: pageSize,
                orderBy: { createdAt: 'desc' },
            }),
            (tx || prisma).pointRecords.count({ where }),
        ])

        return { list, total }
    } catch (error) {
        logger.error('查询用户积分记录列表失败：', error)
        throw error
    }
}

/**
 * 查询用户有效积分记录（按过期时间升序，用于 FIFO 消耗）
 * @param userId 用户 ID
 * @param tx 事务客户端（可选）
 * @returns 有效积分记录列表
 */
export const findValidPointRecordsByUserIdDao = async (
    userId: number,
    tx?: PrismaClient
): Promise<pointRecords[]> => {
    try {
        const now = new Date()
        const records = await (tx || prisma).pointRecords.findMany({
            where: {
                userId,
                status: PointRecordStatus.VALID,
                remaining: { gt: 0 },
                expiredAt: { gt: now },
                deletedAt: null,
            },
            orderBy: { expiredAt: 'asc' }, // 按过期时间升序，先到期的先消耗
        })
        return records
    } catch (error) {
        logger.error('查询用户有效积分记录失败：', error)
        throw error
    }
}

/**
 * 更新积分记录
 * @param id 积分记录 ID
 * @param data 更新数据
 * @param tx 事务客户端（可选）
 * @returns 更新后的积分记录
 */
export const updatePointRecordDao = async (
    id: number,
    data: Prisma.pointRecordsUpdateInput,
    tx?: PrismaClient
): Promise<pointRecords> => {
    try {
        const record = await (tx || prisma).pointRecords.update({
            where: { id },
            data: {
                ...data,
                updatedAt: new Date(),
            },
        })
        return record
    } catch (error) {
        logger.error('更新积分记录失败：', error)
        throw error
    }
}

/**
 * 作废积分记录（根据来源类型和来源 ID）
 * @param userId 用户 ID
 * @param sourceType 来源类型
 * @param sourceId 来源 ID
 * @param tx 事务客户端（可选）
 */
export const invalidatePointRecordsDao = async (
    userId: number,
    sourceType: number,
    sourceId: number,
    tx?: PrismaClient
): Promise<void> => {
    try {
        await (tx || prisma).pointRecords.updateMany({
            where: {
                userId,
                sourceType,
                sourceId,
                deletedAt: null,
            },
            data: {
                status: PointRecordStatus.CANCELLED,
                updatedAt: new Date(),
            },
        })
    } catch (error) {
        logger.error('作废积分记录失败：', error)
        throw error
    }
}

/**
 * 统计用户有效积分汇总
 * @param userId 用户 ID
 * @param tx 事务客户端（可选）
 * @returns 积分汇总信息
 */
export const sumUserValidPointsDao = async (
    userId: number,
    tx?: PrismaClient
): Promise<{
    pointAmount: number
    used: number
    remaining: number
    purchasePoint: number
    otherPoint: number
}> => {
    try {
        const now = new Date()

        // 查询所有有效且未过期的积分记录
        const records = await (tx || prisma).pointRecords.findMany({
            where: {
                userId,
                status: PointRecordStatus.VALID,
                expiredAt: { gt: now },
                deletedAt: null,
            },
            select: {
                pointAmount: true,
                used: true,
                remaining: true,
                sourceType: true,
            },
        })

        // 汇总计算
        let pointAmount = 0
        let used = 0
        let remaining = 0
        let purchasePoint = 0
        let otherPoint = 0

        for (const record of records) {
            pointAmount += record.pointAmount
            used += record.used
            remaining += record.remaining

            // 购买获得的积分（来源类型 1-购买会员赠送，2-直接购买）
            if (record.sourceType === 1 || record.sourceType === 2) {
                purchasePoint += record.remaining
            } else {
                otherPoint += record.remaining
            }
        }

        return { pointAmount, used, remaining, purchasePoint, otherPoint }
    } catch (error) {
        logger.error('统计用户有效积分汇总失败：', error)
        throw error
    }
}

/**
 * 查询用户会员关联的积分记录
 * @param userMembershipId 用户会员记录 ID
 * @param tx 事务客户端（可选）
 * @returns 积分记录列表
 */
export const findPointRecordsByMembershipIdDao = async (
    userMembershipId: number,
    tx?: PrismaClient
): Promise<pointRecords[]> => {
    try {
        const records = await (tx || prisma).pointRecords.findMany({
            where: {
                userMembershipId,
                deletedAt: null,
            },
            orderBy: { expiredAt: 'asc' },
        })
        return records
    } catch (error) {
        logger.error('查询用户会员关联的积分记录失败：', error)
        throw error
    }
}

/**
 * 转移积分记录到新会员
 * @param fromMembershipId 原会员记录 ID
 * @param toMembershipId 新会员记录 ID
 * @param tx 事务客户端（可选）
 * @returns 转移的记录数量
 */
export const transferPointRecordsDao = async (
    fromMembershipId: number,
    toMembershipId: number,
    tx?: PrismaClient
): Promise<number> => {
    try {
        const result = await (tx || prisma).pointRecords.updateMany({
            where: {
                userMembershipId: fromMembershipId,
                deletedAt: null,
            },
            data: {
                userMembershipId: toMembershipId,
                updatedAt: new Date(),
            },
        })
        return result.count
    } catch (error) {
        logger.error('转移积分记录失败：', error)
        throw error
    }
}

/**
 * 按来源类型查询用户积分记录
 * @param userId 用户 ID
 * @param sourceTypes 来源类型数组
 * @param tx 事务客户端（可选）
 * @returns 积分记录列表
 */
export const findPointRecordsBySourceTypesDao = async (
    userId: number,
    sourceTypes: number[],
    tx?: PrismaClient
): Promise<pointRecords[]> => {
    try {
        const now = new Date()
        const records = await (tx || prisma).pointRecords.findMany({
            where: {
                userId,
                sourceType: { in: sourceTypes },
                status: PointRecordStatus.VALID,
                remaining: { gt: 0 },
                expiredAt: { gt: now },
                deletedAt: null,
            },
            orderBy: { expiredAt: 'asc' },
        })
        return records
    } catch (error) {
        logger.error('按来源类型查询用户积分记录失败：', error)
        throw error
    }
}

/**
 * 统计用户会员关联的积分汇总
 * @param userMembershipId 用户会员记录 ID
 * @param tx 事务客户端（可选）
 * @returns 积分汇总
 */
export const sumPointsByMembershipIdDao = async (
    userMembershipId: number,
    tx?: PrismaClient
): Promise<{ total: number; remaining: number }> => {
    try {
        const now = new Date()
        const records = await (tx || prisma).pointRecords.findMany({
            where: {
                userMembershipId,
                status: PointRecordStatus.VALID,
                expiredAt: { gt: now },
                deletedAt: null,
            },
            select: {
                pointAmount: true,
                remaining: true,
            },
        })

        const total = records.reduce((sum, r) => sum + r.pointAmount, 0)
        const remaining = records.reduce((sum, r) => sum + r.remaining, 0)

        return { total, remaining }
    } catch (error) {
        logger.error('统计用户会员关联的积分汇总失败：', error)
        throw error
    }
}
