/**
 * 用户会员服务层
 *
 * 提供用户会员相关的业务逻辑
 */
import dayjs from 'dayjs'

// 定义 Prisma 客户端类型（支持事务）
type PrismaClient = typeof prisma

/**
 * 获取会员来源类型名称
 * @param sourceType 来源类型枚举值
 * @returns 来源类型中文名称
 */
const getSourceTypeName = (sourceType: number): string => {
    const sourceTypeNames: Record<number, string> = {
        [UserMembershipSourceType.REDEMPTION_CODE]: '兑换码兑换',
        [UserMembershipSourceType.DIRECT_PURCHASE]: '直接购买',
        [UserMembershipSourceType.ADMIN_GIFT]: '管理员赠送',
        [UserMembershipSourceType.ACTIVITY_AWARD]: '活动奖励',
        [UserMembershipSourceType.TRIAL]: '试用',
        [UserMembershipSourceType.REGISTRATION_AWARD]: '注册赠送',
        [UserMembershipSourceType.INVITATION_TO_REGISTER]: '邀请注册赠送',
        [UserMembershipSourceType.MEMBERSHIP_UPGRADE]: '会员升级',
        [UserMembershipSourceType.OTHER]: '其他',
    }
    return sourceTypeNames[sourceType] || '未知'
}

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
        sourceTypeName: getSourceTypeName(membership.sourceType),
        sourceId: membership.sourceId,
        remark: membership.remark,
        createdAt: dayjs(membership.createdAt).format('YYYY-MM-DD HH:mm:ss'),
        settlementAt: membership.settlementAt ? dayjs(membership.settlementAt).format('YYYY-MM-DD HH:mm:ss') : null,
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
        sourceTypeName: getSourceTypeName(membership.sourceType),
        sourceId: membership.sourceId,
        remark: membership.remark,
        createdAt: dayjs(membership.createdAt).format('YYYY-MM-DD HH:mm:ss'),
        settlementAt: membership.settlementAt ? dayjs(membership.settlementAt).format('YYYY-MM-DD HH:mm:ss') : null,
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
    const { userId, levelId, duration, durationUnit = 'day', sourceType, sourceId, remark } = params

    // 验证会员级别是否存在
    const level = await findMembershipLevelByIdDao(levelId, tx)
    if (!level) {
        throw new Error('会员级别不存在')
    }

    // 查询用户所有有效的会员记录
    const allValidMemberships = await findAllActiveUserMembershipsDao(userId, tx)

    // 计算开始和结束日期
    let startDate: Date

    if (allValidMemberships.length > 0) {
        // 找出结束日期最晚的会员记录
        const latestMembership = allValidMemberships.reduce(
            (latest, current) => {
                return dayjs(current.endDate).isAfter(dayjs(latest.endDate)) ? current : latest
            },
            allValidMemberships[0]
        )

        const latestEndDate = dayjs(latestMembership.endDate)
        const today = dayjs().startOf('day')

        if (latestEndDate.isAfter(today)) {
            // 从最晚会员到期日的第二天开始
            startDate = latestEndDate.add(1, 'day').startOf('day').toDate()
        } else {
            // 如果最晚的会员已经过期，从今天开始
            startDate = today.toDate()
        }
    } else {
        // 没有有效会员记录，从今天开始
        startDate = dayjs().startOf('day').toDate()
    }

    // 计算结束日期
    // 规则：购买日期的次月/次年相同日期的前一天
    // 例如：2025-01-15 购买 1 个月 → 到期 2025-02-14
    // 例如：2025-01-15 购买 1 年 → 到期 2026-01-14
    let endDate: Date
    const startDayjs = dayjs(startDate)

    if (durationUnit === 'month') {
        // 按月计算：加 N 个月后减 1 天
        endDate = startDayjs.add(duration, 'month').subtract(1, 'day').endOf('day').toDate()
    } else if (durationUnit === 'year') {
        // 按年计算：加 N 年后减 1 天
        endDate = startDayjs.add(duration, 'year').subtract(1, 'day').endOf('day').toDate()
    } else {
        // 按天计算（兼容旧逻辑）
        endDate = startDayjs.add(duration, 'day').subtract(1, 'day').endOf('day').toDate()
    }

    logger.info(`创建会员记录：用户 ${userId}，开始日期 ${dayjs(startDate).format('YYYY-MM-DD HH:mm:ss')}，结束日期 ${dayjs(endDate).format('YYYY-MM-DD HH:mm:ss')}`)

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
        sourceTypeName: getSourceTypeName(membership.sourceType),
        sourceId: membership.sourceId,
        remark: membership.remark,
        createdAt: dayjs(membership.createdAt).format('YYYY-MM-DD HH:mm:ss'),
        settlementAt: membership.settlementAt ? dayjs(membership.settlementAt).format('YYYY-MM-DD HH:mm:ss') : null,
    }
}
