/**
 * 营销活动服务层
 *
 * 提供营销活动相关的业务逻辑，包括注册赠送和邀请奖励
 */
import dayjs from 'dayjs'

// 显式导入 DAO 函数（测试环境需要）
import {
    findActiveCampaignByTypeDao,
    findAllCampaignsDao,
    findCampaignByIdDao,
    createCampaignDao,
    updateCampaignDao,
    deleteCampaignDao,
} from './campaign.dao'
import { createUserMembershipDao } from '../membership/userMembership.dao'
import { createPointRecordDao } from '../point/pointRecords.dao'
import { findUserByIdDao } from '../users/users.dao'

// 显式导入类型和常量（测试环境需要）
import {
    CampaignType,
    CampaignStatus,
    type CampaignInfo,
    type CreateCampaignParams,
    type UpdateCampaignParams,
} from '#shared/types/campaign'
import { MembershipStatus, UserMembershipSourceType } from '#shared/types/membership'
import { PointRecordSourceType, PointRecordStatus } from '#shared/types/point.types'

// 显式导入 prisma 和 logger（测试环境需要）
import { prisma } from '../../utils/db'
import { logger } from '../../../shared/utils/logger'

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


/**
 * 将营销活动数据库记录转换为 CampaignInfo
 */
const toCampaignInfo = (campaign: any): CampaignInfo => ({
    id: campaign.id,
    name: campaign.name,
    type: campaign.type as CampaignType,
    levelId: campaign.levelId,
    levelName: campaign.level?.name || null,
    duration: campaign.duration,
    giftPoint: campaign.giftPoint,
    startAt: dayjs(campaign.startAt).format('YYYY-MM-DD HH:mm:ss'),
    endAt: campaign.endAt ? dayjs(campaign.endAt).format('YYYY-MM-DD HH:mm:ss') : null,
    status: campaign.status as CampaignStatus,
    remark: campaign.remark,
})

/**
 * 获取营销活动列表（管理后台用）
 * @param options 查询选项
 * @returns 营销活动列表和总数
 */
export const getCampaignsForAdminService = async (
    options: {
        page?: number
        pageSize?: number
        type?: CampaignType
        status?: CampaignStatus
    } = {}
): Promise<{ list: CampaignInfo[]; total: number }> => {
    const { list, total } = await findAllCampaignsDao(options)
    return {
        list: list.map(toCampaignInfo),
        total,
    }
}

/**
 * 获取营销活动详情
 * @param id 营销活动 ID
 * @returns 营销活动信息或 null
 */
export const getCampaignByIdService = async (
    id: number
): Promise<CampaignInfo | null> => {
    const campaign = await findCampaignByIdDao(id)
    if (!campaign) {
        return null
    }
    return toCampaignInfo(campaign)
}

/**
 * 创建营销活动
 * @param data 创建参数
 * @returns 创建的营销活动信息
 */
export const createCampaignService = async (
    data: CreateCampaignParams
): Promise<CampaignInfo> => {
    const campaign = await createCampaignDao({
        name: data.name,
        type: data.type,
        ...(data.levelId && { level: { connect: { id: data.levelId } } }),
        duration: data.duration ?? null,
        giftPoint: data.giftPoint ?? null,
        startAt: data.startAt,
        ...(data.endAt !== undefined && data.endAt !== null && { endAt: data.endAt }),
        status: data.status ?? CampaignStatus.ENABLED,
        remark: data.remark ?? null,
    })

    // 重新查询以获取关联数据
    const result = await findCampaignByIdDao(campaign.id)
    return toCampaignInfo(result!)
}

/**
 * 更新营销活动
 * @param id 营销活动 ID
 * @param data 更新参数
 * @returns 更新后的营销活动信息
 */
export const updateCampaignService = async (
    id: number,
    data: UpdateCampaignParams
): Promise<CampaignInfo> => {
    // 检查营销活动是否存在
    const existing = await findCampaignByIdDao(id)
    if (!existing) {
        throw new Error('营销活动不存在')
    }

    // 构建更新数据
    const updateData: any = {}
    if (data.name !== undefined) updateData.name = data.name
    if (data.type !== undefined) updateData.type = data.type
    if (data.levelId !== undefined) {
        if (data.levelId === null) {
            updateData.level = { disconnect: true }
        } else {
            updateData.level = { connect: { id: data.levelId } }
        }
    }
    if (data.duration !== undefined) updateData.duration = data.duration
    if (data.giftPoint !== undefined) updateData.giftPoint = data.giftPoint
    if (data.startAt !== undefined) updateData.startAt = data.startAt
    if (data.endAt !== undefined) updateData.endAt = data.endAt
    if (data.status !== undefined) updateData.status = data.status
    if (data.remark !== undefined) updateData.remark = data.remark

    await updateCampaignDao(id, updateData)

    // 重新查询以获取关联数据
    const result = await findCampaignByIdDao(id)
    return toCampaignInfo(result!)
}

/**
 * 切换营销活动状态
 * @param id 营销活动 ID
 * @returns 更新后的营销活动信息
 */
export const toggleCampaignStatusService = async (
    id: number
): Promise<CampaignInfo> => {
    // 检查营销活动是否存在
    const existing = await findCampaignByIdDao(id)
    if (!existing) {
        throw new Error('营销活动不存在')
    }

    // 切换状态
    const newStatus = existing.status === CampaignStatus.ENABLED
        ? CampaignStatus.DISABLED
        : CampaignStatus.ENABLED

    await updateCampaignDao(id, { status: newStatus })

    // 重新查询以获取关联数据
    const result = await findCampaignByIdDao(id)
    return toCampaignInfo(result!)
}

/**
 * 删除营销活动（软删除）
 * @param id 营销活动 ID
 */
export const deleteCampaignService = async (id: number): Promise<void> => {
    // 检查营销活动是否存在
    const existing = await findCampaignByIdDao(id)
    if (!existing) {
        throw new Error('营销活动不存在')
    }

    await deleteCampaignDao(id)
}
