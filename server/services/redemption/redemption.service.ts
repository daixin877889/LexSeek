/**
 * 兑换码服务层
 *
 * 提供兑换码相关的业务逻辑
 */
import dayjs from 'dayjs'

// 显式导入 DAO 函数（测试环境需要）
import { findRedemptionCodeByCodeDao, updateRedemptionCodeStatusDao } from './redemptionCode.dao'
import { createRedemptionRecordDao } from './redemptionRecord.dao'

// 导入会员和积分服务
import { createMembershipService } from '../membership/userMembership.service'
import { createPointRecordService } from '../point/pointRecords.service'

// 显式导入常量
import { RedemptionCodeStatus, RedemptionCodeType } from '#shared/types/redemption'
import type { RedemptionCodeInfo, RedemptionResult } from '#shared/types/redemption'
import { UserMembershipSourceType } from '#shared/types/membership'
import { PointRecordSourceType } from '#shared/types/point.types'

// 显式导入 Prisma 客户端和日志工具
import { prisma } from '../../utils/db'
import { logger } from '../../../shared/utils/logger'

// 定义 Prisma 客户端类型（支持事务）
type PrismaClient = typeof prisma

/**
 * 获取兑换码信息
 * @param code 兑换码
 * @returns 兑换码信息或 null
 */
export const getRedemptionCodeInfoService = async (
    code: string
): Promise<RedemptionCodeInfo | null> => {
    const redemptionCode = await findRedemptionCodeByCodeDao(code)

    if (!redemptionCode) {
        return null
    }

    return {
        id: redemptionCode.id,
        code: redemptionCode.code,
        type: redemptionCode.type as RedemptionCodeType,
        levelId: redemptionCode.levelId,
        levelName: redemptionCode.level?.name || null,
        duration: redemptionCode.duration,
        pointAmount: redemptionCode.pointAmount,
        expiredAt: redemptionCode.expiredAt
            ? dayjs(redemptionCode.expiredAt).format('YYYY-MM-DD HH:mm:ss')
            : null,
        status: redemptionCode.status as RedemptionCodeStatus,
        remark: redemptionCode.remark,
    }
}

/**
 * 验证兑换码是否可用
 * @param code 兑换码
 * @returns 验证结果
 */
export const validateRedemptionCodeService = async (
    code: string
): Promise<{ valid: boolean; error?: string; codeInfo?: RedemptionCodeInfo }> => {
    const redemptionCode = await findRedemptionCodeByCodeDao(code)

    if (!redemptionCode) {
        return { valid: false, error: '兑换码不存在' }
    }

    // 检查状态
    if (redemptionCode.status === RedemptionCodeStatus.USED) {
        return { valid: false, error: '兑换码已被使用' }
    }

    if (redemptionCode.status === RedemptionCodeStatus.EXPIRED) {
        return { valid: false, error: '兑换码已过期' }
    }

    if (redemptionCode.status === RedemptionCodeStatus.INVALID) {
        return { valid: false, error: '兑换码已作废' }
    }

    // 检查过期时间
    if (redemptionCode.expiredAt && dayjs(redemptionCode.expiredAt).isBefore(dayjs())) {
        // 更新状态为已过期
        await updateRedemptionCodeStatusDao(redemptionCode.id, RedemptionCodeStatus.EXPIRED)
        return { valid: false, error: '兑换码已过期' }
    }

    const codeInfo: RedemptionCodeInfo = {
        id: redemptionCode.id,
        code: redemptionCode.code,
        type: redemptionCode.type as RedemptionCodeType,
        levelId: redemptionCode.levelId,
        levelName: redemptionCode.level?.name || null,
        duration: redemptionCode.duration,
        pointAmount: redemptionCode.pointAmount,
        expiredAt: redemptionCode.expiredAt
            ? dayjs(redemptionCode.expiredAt).format('YYYY-MM-DD HH:mm:ss')
            : null,
        status: redemptionCode.status as RedemptionCodeStatus,
        remark: redemptionCode.remark,
    }

    return { valid: true, codeInfo }
}

/**
 * 执行兑换码兑换
 * @param userId 用户 ID
 * @param code 兑换码
 * @returns 兑换结果
 */
export const redeemCodeService = async (
    userId: number,
    code: string
): Promise<RedemptionResult> => {
    // 验证兑换码
    const validation = await validateRedemptionCodeService(code)
    if (!validation.valid || !validation.codeInfo) {
        return { success: false, message: validation.error }
    }

    const codeInfo = validation.codeInfo

    // 使用事务执行兑换
    return await prisma.$transaction(async (tx) => {
        let membershipId: number | undefined
        let pointRecordId: number | undefined

        // 根据兑换类型处理
        const codeType = codeInfo.type

        logger.info(`兑换码兑换开始`, {
            userId,
            code,
            codeType,
            levelId: codeInfo.levelId,
            duration: codeInfo.duration,
            pointAmount: codeInfo.pointAmount,
        })

        // 会员开始和结束日期（用于积分跟随）
        let membershipStartDate: Date | undefined
        let membershipEndDate: Date | undefined

        // 处理会员兑换（仅会员 或 会员和积分）
        if (
            (codeType === RedemptionCodeType.MEMBERSHIP_ONLY ||
                codeType === RedemptionCodeType.MEMBERSHIP_AND_POINTS) &&
            codeInfo.levelId &&
            codeInfo.duration
        ) {
            logger.info(`创建会员记录`, { userId, levelId: codeInfo.levelId, duration: codeInfo.duration })

            // 复用会员购买的创建逻辑
            const membership = await createMembershipService(
                {
                    userId,
                    levelId: codeInfo.levelId,
                    duration: codeInfo.duration,
                    durationUnit: 'day', // 兑换码按天计算
                    sourceType: UserMembershipSourceType.REDEMPTION_CODE,
                    sourceId: codeInfo.id,
                    remark: `兑换码兑换：${code}`,
                },
                tx as unknown as PrismaClient
            )

            membershipId = membership.id
            membershipStartDate = membership.startDate
            membershipEndDate = membership.endDate
            logger.info(`会员记录创建成功`, {
                membershipId,
                startDate: dayjs(membershipStartDate).format('YYYY-MM-DD'),
                endDate: dayjs(membershipEndDate).format('YYYY-MM-DD'),
            })
        }

        // 处理积分兑换（仅积分 或 会员和积分）
        const shouldCreatePointRecord = (
            (codeType === RedemptionCodeType.POINTS_ONLY ||
                codeType === RedemptionCodeType.MEMBERSHIP_AND_POINTS) &&
            codeInfo.pointAmount &&
            codeInfo.pointAmount > 0
        )

        if (shouldCreatePointRecord) {
            logger.info(`创建积分记录`, { userId, pointAmount: codeInfo.pointAmount })

            // 复用积分创建的统一逻辑
            // - 会员和积分：跟随会员日期
            // - 仅积分：当天生效，1 年后过期
            const pointRecord = await createPointRecordService(
                {
                    userId,
                    pointAmount: codeInfo.pointAmount!,
                    sourceType: PointRecordSourceType.EXCHANGE_CODE_GIFT,
                    sourceId: codeInfo.id,
                    userMembershipId: membershipId,
                    // 会员和积分时跟随会员日期，仅积分时使用默认值（当天生效，1年后过期）
                    effectiveAt: membershipStartDate,
                    expiredAt: membershipEndDate,
                    remark: `兑换码兑换：${code}`,
                },
                tx as unknown as PrismaClient
            )

            pointRecordId = pointRecord.id
            logger.info(`积分记录创建成功`, { pointRecordId })
        }

        // 创建兑换记录
        await createRedemptionRecordDao(userId, codeInfo.id, tx as unknown as PrismaClient)

        // 更新兑换码状态为已使用
        await updateRedemptionCodeStatusDao(
            codeInfo.id,
            RedemptionCodeStatus.USED,
            tx as unknown as PrismaClient
        )

        logger.info(`用户 ${userId} 成功兑换码 ${code}`)

        return {
            success: true,
            membershipId,
            pointRecordId,
            message: '兑换成功',
        }
    })
}
