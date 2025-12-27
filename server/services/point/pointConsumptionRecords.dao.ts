/**
 * 积分消耗记录数据访问层
 * 
 * 提供积分消耗记录的 CRUD 操作
 */

// 定义 Prisma 客户端类型（支持事务）
type PrismaClient = typeof prisma

/**
 * 创建积分消耗记录
 * @param data 积分消耗记录创建数据
 * @param tx 事务客户端（可选）
 * @returns 创建的积分消耗记录
 */
export const createPointConsumptionRecordDao = async (
    data: Prisma.pointConsumptionRecordsCreateInput,
    tx?: PrismaClient
): Promise<pointConsumptionRecords> => {
    try {
        const record = await (tx || prisma).pointConsumptionRecords.create({
            data: {
                ...data,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })
        return record
    } catch (error) {
        logger.error('创建积分消耗记录失败：', error)
        throw error
    }
}

/**
 * 查询用户积分消耗记录列表（分页，关联消耗项目）
 * @param userId 用户 ID
 * @param options 查询选项
 * @param tx 事务客户端（可选）
 * @returns 积分消耗记录列表和总数
 */
export const findPointConsumptionRecordsByUserIdDao = async (
    userId: number,
    options: {
        page?: number
        pageSize?: number
    },
    tx?: PrismaClient
): Promise<{
    list: (pointConsumptionRecords & { pointConsumptionItems: pointConsumptionItems })[]
    total: number
}> => {
    try {
        const { page = 1, pageSize = 10 } = options
        const skip = (page - 1) * pageSize

        const where: Prisma.pointConsumptionRecordsWhereInput = {
            userId,
            deletedAt: null,
        }

        // 并行查询列表和总数
        const [list, total] = await Promise.all([
            (tx || prisma).pointConsumptionRecords.findMany({
                where,
                skip,
                take: pageSize,
                orderBy: { createdAt: 'desc' },
                include: {
                    pointConsumptionItems: true,
                },
            }),
            (tx || prisma).pointConsumptionRecords.count({ where }),
        ])

        return { list, total }
    } catch (error) {
        logger.error('查询用户积分消耗记录列表失败：', error)
        throw error
    }
}

/**
 * 统计积分记录关联的消耗记录总量
 * @param pointRecordId 积分记录 ID
 * @param tx 事务客户端（可选）
 * @returns 消耗积分总量
 */
export const sumConsumptionByPointRecordIdDao = async (
    pointRecordId: number,
    tx?: PrismaClient
): Promise<number> => {
    try {
        const result = await (tx || prisma).pointConsumptionRecords.aggregate({
            where: {
                pointRecordId,
                deletedAt: null,
            },
            _sum: {
                pointAmount: true,
            },
        })
        return result._sum.pointAmount || 0
    } catch (error) {
        logger.error('统计积分记录关联的消耗记录总量失败：', error)
        throw error
    }
}
