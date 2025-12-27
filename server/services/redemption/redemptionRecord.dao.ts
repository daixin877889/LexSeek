/**
 * 兑换记录数据访问层
 *
 * 提供兑换记录的 CRUD 操作
 */

// 定义 Prisma 客户端类型（支持事务）
type PrismaClient = typeof prisma

/**
 * 创建兑换记录
 * @param userId 用户 ID
 * @param codeId 兑换码 ID
 * @param tx 事务客户端（可选）
 * @returns 创建的兑换记录
 */
export const createRedemptionRecordDao = async (
    userId: number,
    codeId: number,
    tx?: PrismaClient
): Promise<redemptionRecords> => {
    try {
        const record = await (tx || prisma).redemptionRecords.create({
            data: {
                user: { connect: { id: userId } },
                code: { connect: { id: codeId } },
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })
        return record
    } catch (error) {
        logger.error('创建兑换记录失败：', error)
        throw error
    }
}

/**
 * 查询用户兑换记录（分页）
 * @param userId 用户 ID
 * @param options 查询选项
 * @param tx 事务客户端（可选）
 * @returns 兑换记录列表和总数
 */
export const findRedemptionRecordsByUserIdDao = async (
    userId: number,
    options: {
        page?: number
        pageSize?: number
    } = {},
    tx?: PrismaClient
): Promise<{
    list: (redemptionRecords & {
        code: redemptionCodes & { level: membershipLevels | null }
    })[]
    total: number
}> => {
    try {
        const { page = 1, pageSize = 10 } = options
        const skip = (page - 1) * pageSize

        const where: Prisma.redemptionRecordsWhereInput = {
            userId,
            deletedAt: null,
        }

        const [list, total] = await Promise.all([
            (tx || prisma).redemptionRecords.findMany({
                where,
                include: {
                    code: {
                        include: { level: true },
                    },
                },
                skip,
                take: pageSize,
                orderBy: { createdAt: 'desc' },
            }),
            (tx || prisma).redemptionRecords.count({ where }),
        ])

        return { list, total }
    } catch (error) {
        logger.error('查询用户兑换记录失败：', error)
        throw error
    }
}

/**
 * 检查用户是否已使用过某兑换码
 * @param userId 用户 ID
 * @param codeId 兑换码 ID
 * @param tx 事务客户端（可选）
 * @returns 是否已使用
 */
export const checkUserRedemptionRecordExistsDao = async (
    userId: number,
    codeId: number,
    tx?: PrismaClient
): Promise<boolean> => {
    try {
        const record = await (tx || prisma).redemptionRecords.findFirst({
            where: {
                userId,
                codeId,
                deletedAt: null,
            },
        })
        return !!record
    } catch (error) {
        logger.error('检查用户兑换记录失败：', error)
        throw error
    }
}
