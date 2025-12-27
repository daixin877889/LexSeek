/**
 * 营销活动服务层
 *
 * 提供营销活动相关的业务逻辑，包括注册赠送和邀请奖励
 */
import dayjs from 'dayjs'

// 定义 Prisma 客户端类型（支持事务）
type PrismaClient = typeof prisma

/**
 * 获取指定类型的有效营销活动
 * @param type 活动类型
 * @returns 有效的营销活动信息或 null
 */
export const getActiveCampaignService = async (
    type: CampaignType
): Promise<CampaignInfo | null> => {
    const campaign = await findActiveCampaignByTypeDao(type)

    if (!campaign) {
        return null
    }

    return {
        id: campaign.id,
        name: campaign.name,
        type: campaign.type as CampaignType,
        levelId: campaign.levelId,
        levelName: campaign.level?.name || null,
        duration: campaign.duration,
        giftPoint: campaign.giftPoint,
        startAt: dayjs(campaign.startAt).format('YYYY-MM-DD HH:mm:ss'),
        endAt: dayjs(campaign.endAt).format('YYYY-MM-DD HH:mm:ss'),
        status: campaign.status as CampaignStatus,
        remark: campaign.remark,
    }
}

/**
 * 执行注册赠送
 * @param userId 新注册用户 ID
 * @param tx 事务客户端（可选）
 * @returns 是否执行成功
 */
export const executeRegisterGiftService = async (
    userId: number,
    tx?: PrismaClient
): Promise<boolean> => {
    // 查询有效的注册赠送活动
    const campaign = await findActiveCampaignByTypeDao(CampaignType.REGISTER_GIFT, tx)

    if (!campaign) {
        logger.info(`用户 ${userId} 注册时没有有效的注册赠送活动`)
        return false
    }

    let membershipId: number | null = null

    // 如果配置了会员赠送
    if (campaign.levelId && campaign.duration) {
        const startDate = dayjs().toDate()
        const endDate = dayjs().add(campaign.duration, 'day').toDate()

        const membership = await createUserMembershipDao(
            {
                user: { connect: { id: userId } },
                level: { connect: { id: campaign.levelId } },
                startDate,
                endDate,
                status: MembershipStatus.ACTIVE,
                sourceType: UserMembershipSourceType.REGISTRATION_AWARD,
                sourceId: campaign.id,
                remark: campaign.name,
            },
            tx
        )
        membershipId = membership.id
        logger.info(`用户 ${userId} 获得注册赠送会员，级别 ${campaign.levelId}，时长 ${campaign.duration} 天`)
    }

    // 如果配置了积分赠送
    if (campaign.giftPoint && campaign.giftPoint > 0) {
        // 计算积分有效期：如果有会员则跟随会员有效期，否则1年
        const effectiveAt = dayjs().toDate()
        let expiredAt: Date

        if (membershipId && campaign.duration) {
            expiredAt = dayjs().add(campaign.duration, 'day').toDate()
        } else {
            expiredAt = dayjs().add(1, 'year').toDate()
        }

        await createPointRecordDao(
            {
                users: { connect: { id: userId } },
                pointAmount: campaign.giftPoint,
                used: 0,
                remaining: campaign.giftPoint,
                sourceType: PointRecordSourceType.REGISTER_GIFT,
                sourceId: campaign.id,
                effectiveAt,
                expiredAt,
                status: PointRecordStatus.VALID,
                remark: campaign.name,
                ...(membershipId && { userMembership: { connect: { id: membershipId } } }),
            },
            tx
        )
        logger.info(`用户 ${userId} 获得注册赠送积分 ${campaign.giftPoint}`)
    }

    return true
}

/**
 * 执行邀请奖励
 * @param inviterId 邀请人用户 ID
 * @param inviteeId 被邀请人用户 ID
 * @param tx 事务客户端（可选）
 * @returns 是否执行成功
 */
export const executeInvitationRewardService = async (
    inviterId: number,
    inviteeId: number,
    tx?: PrismaClient
): Promise<boolean> => {
    // 查询有效的邀请奖励活动
    const campaign = await findActiveCampaignByTypeDao(CampaignType.INVITATION_REWARD, tx)

    if (!campaign) {
        logger.info(`邀请人 ${inviterId} 邀请用户 ${inviteeId} 时没有有效的邀请奖励活动`)
        return false
    }

    // 查询被邀请人信息，用于生成备注
    const invitee = await findUserByIdDao(inviteeId, tx)
    const inviteeLabel = invitee ? `${invitee.name}(${invitee.phone.slice(-4)})` : `用户${inviteeId}`
    const remark = `邀请 ${inviteeLabel} 注册`

    let membershipId: number | null = null

    // 如果配置了会员赠送
    if (campaign.levelId && campaign.duration) {
        const startDate = dayjs().toDate()
        const endDate = dayjs().add(campaign.duration, 'day').toDate()

        const membership = await createUserMembershipDao(
            {
                user: { connect: { id: inviterId } },
                level: { connect: { id: campaign.levelId } },
                startDate,
                endDate,
                status: MembershipStatus.ACTIVE,
                sourceType: UserMembershipSourceType.INVITATION_TO_REGISTER,
                sourceId: campaign.id,
                remark,
            },
            tx
        )
        membershipId = membership.id
        logger.info(`邀请人 ${inviterId} 获得邀请奖励会员，级别 ${campaign.levelId}，时长 ${campaign.duration} 天`)
    }

    // 如果配置了积分赠送
    if (campaign.giftPoint && campaign.giftPoint > 0) {
        // 计算积分有效期：如果有会员则跟随会员有效期，否则1年
        const effectiveAt = dayjs().toDate()
        let expiredAt: Date

        if (membershipId && campaign.duration) {
            expiredAt = dayjs().add(campaign.duration, 'day').toDate()
        } else {
            expiredAt = dayjs().add(1, 'year').toDate()
        }

        await createPointRecordDao(
            {
                users: { connect: { id: inviterId } },
                pointAmount: campaign.giftPoint,
                used: 0,
                remaining: campaign.giftPoint,
                sourceType: PointRecordSourceType.INVITATION_TO_REGISTER,
                sourceId: campaign.id,
                effectiveAt,
                expiredAt,
                status: PointRecordStatus.VALID,
                remark,
                ...(membershipId && { userMembership: { connect: { id: membershipId } } }),
            },
            tx
        )
        logger.info(`邀请人 ${inviterId} 获得邀请奖励积分 ${campaign.giftPoint}`)
    }

    return true
}
