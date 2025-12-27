/**
 * 会员级别数据访问层
 *
 * 提供会员级别的 CRUD 操作
 */

// 定义 Prisma 客户端类型（支持事务）
type PrismaClient = typeof prisma

/**
 * 创建会员级别
 * @param data 会员级别创建数据
 * @param tx 事务客户端（可选）
 * @returns 创建的会员级别
 */
export const createMembershipLevelDao = async (
    data: Prisma.membershipLevelsCreateInput,
    tx?: PrismaClient
): Promise<membershipLevels> => {
    try {
        const level = await (tx || prisma).membershipLevels.create({
            data: {
                ...data,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })
        return level
    } catch (error) {
        logger.error('创建会员级别失败：', error)
        throw error
    }
}

/**
 * 通过 ID 查询会员级别
 * @param id 会员级别 ID
 * @param tx 事务客户端（可选）
 * @returns 会员级别或 null
 */
export const findMembershipLevelByIdDao = async (
    id: number,
    tx?: PrismaClient
): Promise<membershipLevels | null> => {
    try {
        const level = await (tx || prisma).membershipLevels.findUnique({
            where: { id, deletedAt: null },
        })
        return level
    } catch (error) {
        logger.error('通过 ID 查询会员级别失败：', error)
        throw error
    }
}

/**
 * 查询所有启用的会员级别（按 sortOrder 升序排列）
 * @param tx 事务客户端（可选）
 * @returns 会员级别列表
 */
export const findAllActiveMembershipLevelsDao = async (
    tx?: PrismaClient
): Promise<membershipLevels[]> => {
    try {
        const levels = await (tx || prisma).membershipLevels.findMany({
            where: {
                status: MembershipLevelStatus.ENABLED,
                deletedAt: null,
            },
            orderBy: { sortOrder: 'asc' },
        })
        return levels
    } catch (error) {
        logger.error('查询所有启用的会员级别失败：', error)
        throw error
    }
}

/**
 * 查询所有会员级别（按 sortOrder 升序排列）
 * @param options 查询选项
 * @param tx 事务客户端（可选）
 * @returns 会员级别列表和总数
 */
export const findAllMembershipLevelsDao = async (
    options: {
        page?: number
        pageSize?: number
        status?: MembershipLevelStatus
    } = {},
    tx?: PrismaClient
): Promise<{ list: membershipLevels[]; total: number }> => {
    try {
        const { page = 1, pageSize = 10, status } = options
        const skip = (page - 1) * pageSize

        // 构建查询条件
        const where: Prisma.membershipLevelsWhereInput = {
            deletedAt: null,
            ...(status !== undefined && { status }),
        }

        // 并行查询列表和总数
        const [list, total] = await Promise.all([
            (tx || prisma).membershipLevels.findMany({
                where,
                skip,
                take: pageSize,
                orderBy: { sortOrder: 'asc' },
            }),
            (tx || prisma).membershipLevels.count({ where }),
        ])

        return { list, total }
    } catch (error) {
        logger.error('查询所有会员级别失败：', error)
        throw error
    }
}

/**
 * 更新会员级别
 * @param id 会员级别 ID
 * @param data 更新数据
 * @param tx 事务客户端（可选）
 * @returns 更新后的会员级别
 */
export const updateMembershipLevelDao = async (
    id: number,
    data: Prisma.membershipLevelsUpdateInput,
    tx?: PrismaClient
): Promise<membershipLevels> => {
    try {
        const level = await (tx || prisma).membershipLevels.update({
            where: { id },
            data: {
                ...data,
                updatedAt: new Date(),
            },
        })
        return level
    } catch (error) {
        logger.error('更新会员级别失败：', error)
        throw error
    }
}

/**
 * 软删除会员级别
 * @param id 会员级别 ID
 * @param tx 事务客户端（可选）
 */
export const deleteMembershipLevelDao = async (
    id: number,
    tx?: PrismaClient
): Promise<void> => {
    try {
        await (tx || prisma).membershipLevels.update({
            where: { id },
            data: {
                deletedAt: new Date(),
                updatedAt: new Date(),
            },
        })
    } catch (error) {
        logger.error('删除会员级别失败：', error)
        throw error
    }
}

/**
 * 查询比指定级别更高的级别（sortOrder 更小）
 * @param sortOrder 当前级别的排序值
 * @param tx 事务客户端（可选）
 * @returns 更高级别的会员级别列表
 */
export const findHigherMembershipLevelsDao = async (
    sortOrder: number,
    tx?: PrismaClient
): Promise<membershipLevels[]> => {
    try {
        const levels = await (tx || prisma).membershipLevels.findMany({
            where: {
                sortOrder: { lt: sortOrder },
                status: MembershipLevelStatus.ENABLED,
                deletedAt: null,
            },
            orderBy: { sortOrder: 'asc' },
        })
        return levels
    } catch (error) {
        logger.error('查询更高级别的会员级别失败：', error)
        throw error
    }
}
