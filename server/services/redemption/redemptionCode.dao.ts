/**
 * 兑换码数据访问层
 *
 * 提供兑换码的 CRUD 操作
 */

// 定义 Prisma 客户端类型（支持事务）
type PrismaClient = typeof prisma

/**
 * 创建兑换码
 * @param data 兑换码创建数据
 * @param tx 事务客户端（可选）
 * @returns 创建的兑换码
 */
export const createRedemptionCodeDao = async (
    data: Prisma.redemptionCodesCreateInput,
    tx?: PrismaClient
): Promise<redemptionCodes> => {
    try {
        const code = await (tx || prisma).redemptionCodes.create({
            data: {
                ...data,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })
        return code
    } catch (error) {
        logger.error('创建兑换码失败：', error)
        throw error
    }
}

/**
 * 通过兑换码查询
 * @param code 兑换码
 * @param tx 事务客户端（可选）
 * @returns 兑换码或 null
 */
export const findRedemptionCodeByCodeDao = async (
    code: string,
    tx?: PrismaClient
): Promise<(redemptionCodes & { level: membershipLevels | null }) | null> => {
    try {
        const redemptionCode = await (tx || prisma).redemptionCodes.findUnique({
            where: { code, deletedAt: null },
            include: { level: true },
        })
        return redemptionCode
    } catch (error) {
        logger.error('通过兑换码查询失败：', error)
        throw error
    }
}

/**
 * 通过 ID 查询兑换码
 * @param id 兑换码 ID
 * @param tx 事务客户端（可选）
 * @returns 兑换码或 null
 */
export const findRedemptionCodeByIdDao = async (
    id: number,
    tx?: PrismaClient
): Promise<(redemptionCodes & { level: membershipLevels | null }) | null> => {
    try {
        const redemptionCode = await (tx || prisma).redemptionCodes.findUnique({
            where: { id, deletedAt: null },
            include: { level: true },
        })
        return redemptionCode
    } catch (error) {
        logger.error('通过 ID 查询兑换码失败：', error)
        throw error
    }
}

/**
 * 更新兑换码状态
 * @param id 兑换码 ID
 * @param status 新状态
 * @param tx 事务客户端（可选）
 * @returns 更新后的兑换码
 */
export const updateRedemptionCodeStatusDao = async (
    id: number,
    status: RedemptionCodeStatus,
    tx?: PrismaClient
): Promise<redemptionCodes> => {
    try {
        const code = await (tx || prisma).redemptionCodes.update({
            where: { id },
            data: {
                status,
                updatedAt: new Date(),
            },
        })
        return code
    } catch (error) {
        logger.error('更新兑换码状态失败：', error)
        throw error
    }
}

/**
 * 查询所有兑换码（分页）
 * @param options 查询选项
 * @param tx 事务客户端（可选）
 * @returns 兑换码列表和总数
 */
export const findAllRedemptionCodesDao = async (
    options: {
        page?: number
        pageSize?: number
        status?: RedemptionCodeStatus
    } = {},
    tx?: PrismaClient
): Promise<{ list: (redemptionCodes & { level: membershipLevels | null })[]; total: number }> => {
    try {
        const { page = 1, pageSize = 10, status } = options
        const skip = (page - 1) * pageSize

        const where: Prisma.redemptionCodesWhereInput = {
            deletedAt: null,
            ...(status !== undefined && { status }),
        }

        const [list, total] = await Promise.all([
            (tx || prisma).redemptionCodes.findMany({
                where,
                include: { level: true },
                skip,
                take: pageSize,
                orderBy: { createdAt: 'desc' },
            }),
            (tx || prisma).redemptionCodes.count({ where }),
        ])

        return { list, total }
    } catch (error) {
        logger.error('查询所有兑换码失败：', error)
        throw error
    }
}


// ==================== 管理员专用 DAO 方法 ====================

/**
 * 批量创建兑换码
 * @param codes 兑换码数据数组
 * @param tx 事务客户端（可选）
 * @returns 创建的数量
 */
export const bulkCreateRedemptionCodesDao = async (
    codes: Prisma.redemptionCodesCreateManyInput[],
    tx?: PrismaClient
): Promise<number> => {
    try {
        const result = await (tx || prisma).redemptionCodes.createMany({
            data: codes,
        })
        return result.count
    } catch (error) {
        logger.error('批量创建兑换码失败：', error)
        throw error
    }
}

/**
 * 查询兑换码列表（支持更多筛选条件）
 * @param options 查询选项
 * @param tx 事务客户端（可选）
 * @returns 兑换码列表和总数
 */
export const findRedemptionCodesWithFiltersDao = async (
    options: {
        page?: number
        pageSize?: number
        status?: RedemptionCodeStatus
        type?: RedemptionCodeType
        code?: string
        remark?: string
    } = {},
    tx?: PrismaClient
): Promise<{ list: (redemptionCodes & { level: membershipLevels | null })[]; total: number }> => {
    try {
        const { page = 1, pageSize = 20, status, type, code, remark } = options
        const skip = (page - 1) * pageSize

        const where: Prisma.redemptionCodesWhereInput = {
            deletedAt: null,
            ...(status !== undefined && { status }),
            ...(type !== undefined && { type }),
            ...(code && { code: { contains: code } }),
            ...(remark && { remark: { contains: remark } }),
        }

        const [list, total] = await Promise.all([
            (tx || prisma).redemptionCodes.findMany({
                where,
                include: { level: true },
                skip,
                take: pageSize,
                orderBy: { createdAt: 'desc' },
            }),
            (tx || prisma).redemptionCodes.count({ where }),
        ])

        return { list, total }
    } catch (error) {
        logger.error('查询兑换码列表失败：', error)
        throw error
    }
}

/**
 * 查询兑换码列表（不分页，用于导出）
 * @param options 查询选项
 * @param tx 事务客户端（可选）
 * @returns 兑换码列表
 */
export const findRedemptionCodesForExportDao = async (
    options: {
        status?: RedemptionCodeStatus
        type?: RedemptionCodeType
        code?: string
        remark?: string
        ids?: number[]
        limit?: number
    } = {},
    tx?: PrismaClient
): Promise<(redemptionCodes & { level: membershipLevels | null })[]> => {
    try {
        const { status, type, code, remark, ids, limit = 10000 } = options

        const where: Prisma.redemptionCodesWhereInput = {
            deletedAt: null,
            ...(status !== undefined && { status }),
            ...(type !== undefined && { type }),
            ...(code && { code: { contains: code } }),
            ...(remark && { remark: { contains: remark } }),
            ...(ids && ids.length > 0 && { id: { in: ids } }),
        }

        const list = await (tx || prisma).redemptionCodes.findMany({
            where,
            include: { level: true },
            take: limit,
            orderBy: { createdAt: 'desc' },
        })

        return list
    } catch (error) {
        logger.error('查询兑换码列表（导出）失败：', error)
        throw error
    }
}
