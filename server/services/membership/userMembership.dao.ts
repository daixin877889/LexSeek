/**
 * 用户会员记录数据访问层
 *
 * 提供用户会员记录的 CRUD 操作
 */

// 定义 Prisma 客户端类型（支持事务）
type PrismaClient = typeof prisma

/**
 * 创建用户会员记录
 * @param data 用户会员记录创建数据
 * @param tx 事务客户端（可选）
 * @returns 创建的用户会员记录
 */
export const createUserMembershipDao = async (
    data: Prisma.userMembershipsCreateInput,
    tx?: PrismaClient
): Promise<userMemberships> => {
    try {
        const membership = await (tx || prisma).userMemberships.create({
            data: {
                ...data,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })
        return membership
    } catch (error) {
        logger.error('创建用户会员记录失败：', error)
        throw error
    }
}

/**
 * 通过 ID 查询用户会员记录
 * @param id 用户会员记录 ID
 * @param tx 事务客户端（可选）
 * @returns 用户会员记录或 null
 */
export const findUserMembershipByIdDao = async (
    id: number,
    tx?: PrismaClient
): Promise<userMemberships | null> => {
    try {
        const membership = await (tx || prisma).userMemberships.findUnique({
            where: { id, deletedAt: null },
            include: { level: true },
        })
        return membership
    } catch (error) {
        logger.error('通过 ID 查询用户会员记录失败：', error)
        throw error
    }
}

/**
 * 查询用户当前有效的会员记录
 * 当前有效：startDate <= now AND endDate > now AND status = ACTIVE
 * @param userId 用户 ID
 * @param tx 事务客户端（可选）
 * @returns 用户当前有效的会员记录或 null
 */
export const findCurrentUserMembershipDao = async (
    userId: number,
    tx?: PrismaClient
): Promise<(userMemberships & { level: membershipLevels }) | null> => {
    try {
        const now = new Date()
        const membership = await (tx || prisma).userMemberships.findFirst({
            where: {
                userId,
                status: MembershipStatus.ACTIVE,
                startDate: { lte: now },  // 已开始生效
                endDate: { gt: now },      // 未过期
                deletedAt: null,
            },
            include: { level: true },
            orderBy: { level: { sortOrder: 'desc' } },  // 按级别排序，返回最高级别
        })
        return membership
    } catch (error) {
        logger.error('查询用户当前有效会员记录失败：', error)
        throw error
    }
}

/**
 * 查询用户会员历史记录（分页）
 * @param userId 用户 ID
 * @param options 查询选项
 * @param tx 事务客户端（可选）
 * @returns 用户会员历史记录列表和总数
 */
export const findUserMembershipHistoryDao = async (
    userId: number,
    options: {
        page?: number
        pageSize?: number
    } = {},
    tx?: PrismaClient
): Promise<{ list: (userMemberships & { level: membershipLevels })[]; total: number }> => {
    try {
        const { page = 1, pageSize = 10 } = options
        const skip = (page - 1) * pageSize

        const where: Prisma.userMembershipsWhereInput = {
            userId,
            deletedAt: null,
        }

        const [list, total] = await Promise.all([
            (tx || prisma).userMemberships.findMany({
                where,
                include: { level: true },
                skip,
                take: pageSize,
                orderBy: { createdAt: 'desc' },
            }),
            (tx || prisma).userMemberships.count({ where }),
        ])

        return { list, total }
    } catch (error) {
        logger.error('查询用户会员历史记录失败：', error)
        throw error
    }
}

/**
 * 更新用户会员记录
 * @param id 用户会员记录 ID
 * @param data 更新数据
 * @param tx 事务客户端（可选）
 * @returns 更新后的用户会员记录
 */
export const updateUserMembershipDao = async (
    id: number,
    data: Prisma.userMembershipsUpdateInput,
    tx?: PrismaClient
): Promise<userMemberships> => {
    try {
        const membership = await (tx || prisma).userMemberships.update({
            where: { id },
            data: {
                ...data,
                updatedAt: new Date(),
            },
        })
        return membership
    } catch (error) {
        logger.error('更新用户会员记录失败：', error)
        throw error
    }
}

/**
 * 使用户会员记录失效
 * @param id 用户会员记录 ID
 * @param tx 事务客户端（可选）
 */
export const invalidateUserMembershipDao = async (
    id: number,
    tx?: PrismaClient
): Promise<void> => {
    try {
        await (tx || prisma).userMemberships.update({
            where: { id },
            data: {
                status: MembershipStatus.INACTIVE,
                updatedAt: new Date(),
            },
        })
    } catch (error) {
        logger.error('使用户会员记录失效失败：', error)
        throw error
    }
}

/**
 * 查询用户所有有效的会员记录
 * @param userId 用户 ID
 * @param tx 事务客户端（可选）
 * @returns 用户所有有效的会员记录列表
 */
export const findAllActiveUserMembershipsDao = async (
    userId: number,
    tx?: PrismaClient
): Promise<(userMemberships & { level: membershipLevels })[]> => {
    try {
        const now = new Date()
        const memberships = await (tx || prisma).userMemberships.findMany({
            where: {
                userId,
                status: MembershipStatus.ACTIVE,
                endDate: { gt: now },
                deletedAt: null,
            },
            include: { level: true },
            orderBy: { level: { sortOrder: 'asc' } },
        })
        return memberships
    } catch (error) {
        logger.error('查询用户所有有效会员记录失败：', error)
        throw error
    }
}
