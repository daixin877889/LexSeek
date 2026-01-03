/**
 * 权益数据访问层
 *
 * 提供权益的 CRUD 操作
 */

// 定义 Prisma 客户端类型（支持事务）
type PrismaClient = typeof prisma

/**
 * 创建权益
 * @param data 权益创建数据
 * @param tx 事务客户端（可选）
 * @returns 创建的权益
 */
export const createBenefitDao = async (
    data: Prisma.benefitsCreateInput,
    tx?: PrismaClient
): Promise<benefits> => {
    try {
        const benefit = await (tx || prisma).benefits.create({
            data: {
                ...data,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })
        return benefit
    } catch (error) {
        logger.error('创建权益失败：', error)
        throw error
    }
}

/**
 * 通过 ID 查询权益
 * @param id 权益 ID
 * @param tx 事务客户端（可选）
 * @returns 权益或 null
 */
export const findBenefitByIdDao = async (
    id: number,
    tx?: PrismaClient
): Promise<benefits | null> => {
    try {
        const benefit = await (tx || prisma).benefits.findUnique({
            where: { id, deletedAt: null },
        })
        return benefit
    } catch (error) {
        logger.error('通过 ID 查询权益失败：', error)
        throw error
    }
}

/**
 * 查询所有启用的权益
 * @param tx 事务客户端（可选）
 * @returns 权益列表
 */
export const findAllActiveBenefitsDao = async (
    tx?: PrismaClient
): Promise<benefits[]> => {
    try {
        const benefits = await (tx || prisma).benefits.findMany({
            where: {
                status: BenefitStatus.ENABLED,
                deletedAt: null,
            },
            orderBy: { id: 'asc' },
        })
        return benefits
    } catch (error) {
        logger.error('查询所有启用的权益失败：', error)
        throw error
    }
}

/**
 * 查询所有权益（分页）
 * @param options 查询选项
 * @param tx 事务客户端（可选）
 * @returns 权益列表和总数
 */
export const findAllBenefitsDao = async (
    options: {
        page?: number
        pageSize?: number
        status?: BenefitStatus
        type?: string
    } = {},
    tx?: PrismaClient
): Promise<{ list: benefits[]; total: number }> => {
    try {
        const { page = 1, pageSize = 10, status, type } = options
        const skip = (page - 1) * pageSize

        const where: Prisma.benefitsWhereInput = {
            deletedAt: null,
            ...(status !== undefined && { status }),
            ...(type && { type }),
        }

        const [list, total] = await Promise.all([
            (tx || prisma).benefits.findMany({
                where,
                skip,
                take: pageSize,
                orderBy: { id: 'asc' },
            }),
            (tx || prisma).benefits.count({ where }),
        ])

        return { list, total }
    } catch (error) {
        logger.error('查询所有权益失败：', error)
        throw error
    }
}

/**
 * 更新权益
 * @param id 权益 ID
 * @param data 更新数据
 * @param tx 事务客户端（可选）
 * @returns 更新后的权益
 */
export const updateBenefitDao = async (
    id: number,
    data: Prisma.benefitsUpdateInput,
    tx?: PrismaClient
): Promise<benefits> => {
    try {
        const benefit = await (tx || prisma).benefits.update({
            where: { id },
            data: {
                ...data,
                updatedAt: new Date(),
            },
        })
        return benefit
    } catch (error) {
        logger.error('更新权益失败：', error)
        throw error
    }
}

/**
 * 软删除权益
 * @param id 权益 ID
 * @param tx 事务客户端（可选）
 */
export const deleteBenefitDao = async (
    id: number,
    tx?: PrismaClient
): Promise<void> => {
    try {
        await (tx || prisma).benefits.update({
            where: { id },
            data: {
                deletedAt: new Date(),
                updatedAt: new Date(),
            },
        })
    } catch (error) {
        logger.error('删除权益失败：', error)
        throw error
    }
}

/**
 * 通过权益标识码查询权益
 * @param code 权益标识码
 * @param tx 事务客户端（可选）
 * @returns 权益或 null
 */
export const findBenefitByCodeDao = async (
    code: string,
    tx?: PrismaClient
): Promise<benefits | null> => {
    try {
        const benefit = await (tx || prisma).benefits.findFirst({
            where: { code, deletedAt: null },
        })
        return benefit
    } catch (error) {
        logger.error('通过权益标识码查询权益失败：', error)
        throw error
    }
}

/**
 * 查询会员级别的所有权益配置
 * @param levelId 会员级别 ID
 * @param tx 事务客户端（可选）
 * @returns 会员权益配置列表
 */
export const findMembershipBenefitsByLevelIdDao = async (
    levelId: number,
    tx?: PrismaClient
): Promise<(membershipBenefits & { benefit: benefits })[]> => {
    try {
        const membershipBenefits = await (tx || prisma).membershipBenefits.findMany({
            where: {
                levelId,
                deletedAt: null,
            },
            include: {
                benefit: true,
            },
        })
        return membershipBenefits
    } catch (error) {
        logger.error('查询会员级别权益配置失败：', error)
        throw error
    }
}
