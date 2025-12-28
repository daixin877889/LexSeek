/**
 * 用户会员服务层
 *
 * 提供用户会员相关的业务逻辑
 */
import dayjs from 'dayjs'

// 定义 Prisma 客户端类型（支持事务）
type PrismaClient = typeof prisma

/**
 * 获取用户当前有效会员信息
 * @param userId 用户 ID
 * @returns 用户当前有效会员信息或 null
 */
export const getCurrentMembershipService = async (
    userId: number
): Promise<UserMembershipInfo | null> => {
    const membership = await findCurrentUserMembershipDao(userId)

    if (!membership) {
        return null
    }

    return {
        id: membership.id,
        userId: membership.userId,
        levelId: membership.levelId,
        levelName: membership.level.name,
        startDate: dayjs(membership.startDate).format('YYYY-MM-DD HH:mm:ss'),
        endDate: dayjs(membership.endDate).format('YYYY-MM-DD HH:mm:ss'),
        autoRenew: membership.autoRenew,
        status: membership.status as MembershipStatus,
        sourceType: membership.sourceType as UserMembershipSourceType,
        sourceId: membership.sourceId,
        remark: membership.remark,
    }
}

/**
 * 获取用户会员历史记录
 * @param userId 用户 ID
 * @param options 分页选项
 * @returns 用户会员历史记录列表和总数
 */
export const getMembershipHistoryService = async (
    userId: number,
    options: { page?: number; pageSize?: number } = {}
): Promise<{ list: UserMembershipInfo[]; total: number }> => {
    const { list, total } = await findUserMembershipHistoryDao(userId, options)

    const formattedList: UserMembershipInfo[] = list.map((membership) => ({
        id: membership.id,
        userId: membership.userId,
        levelId: membership.levelId,
        levelName: membership.level.name,
        startDate: dayjs(membership.startDate).format('YYYY-MM-DD HH:mm:ss'),
        endDate: dayjs(membership.endDate).format('YYYY-MM-DD HH:mm:ss'),
        autoRenew: membership.autoRenew,
        status: membership.status as MembershipStatus,
        sourceType: membership.sourceType as UserMembershipSourceType,
        sourceId: membership.sourceId,
        remark: membership.remark,
    }))

    return { list: formattedList, total }
}

/**
 * 创建用户会员记录
 * @param params 创建参数
 * @param tx 事务客户端（可选）
 * @returns 创建的用户会员记录
 */
export const createMembershipService = async (
    params: CreateMembershipParams,
    tx?: PrismaClient
): Promise<userMemberships> => {
    const { userId, levelId, duration, sourceType, sourceId, remark } = params

    // 验证会员级别是否存在
    const level = await findMembershipLevelByIdDao(levelId, tx)
    if (!level) {
        throw new Error('会员级别不存在')
    }

    // 计算开始和结束日期
    const startDate = dayjs().toDate()
    const endDate = dayjs().add(duration, 'day').toDate()

    // 创建会员记录
    const membership = await createUserMembershipDao(
        {
            user: { connect: { id: userId } },
            level: { connect: { id: levelId } },
            startDate,
            endDate,
            status: MembershipStatus.ACTIVE,
            sourceType,
            sourceId,
            remark,
        },
        tx
    )

    return membership
}

/**
 * 获取用户会员记录详情
 * @param id 会员记录 ID
 * @returns 用户会员记录详情或 null
 */
export const getMembershipByIdService = async (
    id: number
): Promise<UserMembershipInfo | null> => {
    const membership = await findUserMembershipByIdDao(id)

    if (!membership) {
        return null
    }

    // 需要获取级别信息
    const level = await findMembershipLevelByIdDao(membership.levelId)

    return {
        id: membership.id,
        userId: membership.userId,
        levelId: membership.levelId,
        levelName: level?.name || '',
        startDate: dayjs(membership.startDate).format('YYYY-MM-DD HH:mm:ss'),
        endDate: dayjs(membership.endDate).format('YYYY-MM-DD HH:mm:ss'),
        autoRenew: membership.autoRenew,
        status: membership.status as MembershipStatus,
        sourceType: membership.sourceType as UserMembershipSourceType,
        sourceId: membership.sourceId,
        remark: membership.remark,
    }
}
