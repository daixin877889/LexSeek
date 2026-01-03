/**
 * 用户权益服务层
 *
 * 提供用户权益相关的业务逻辑
 */

import {
    BenefitCode,
    BenefitConsumptionMode,
    BenefitSourceType,
    BenefitSourceTypeName,
    BenefitUnitType,
    type StorageQuotaCheckResult,
    type StorageQuotaInfo,
    type UserBenefitDetailResponse,
    type UserBenefitRecord,
    type UserBenefitSummary,
} from '#shared/types/benefit'
import { formatByteSize } from '#shared/utils/unitConverision'
import { findBenefitsByLevelIdDao } from './membershipBenefit.dao'
import { expireUserBenefitsBySourceDao } from './userBenefit.dao'
import { prisma } from '../../utils/db'

// 定义 Prisma 客户端类型（支持事务）
type PrismaClient = typeof prisma

/**
 * 获取用户权益汇总
 * @param userId 用户 ID
 * @returns 用户所有权益的汇总信息
 */
export const getUserBenefitSummaryService = async (
    userId: number
): Promise<UserBenefitSummary[]> => {
    try {
        // 查询所有启用的权益类型
        const allBenefits = await findAllActiveBenefitsDao()
        const summaries: UserBenefitSummary[] = []

        for (const benefit of allBenefits) {
            // 计算用户该权益的总值
            const totalValue = await sumUserBenefitValueDao(
                userId,
                benefit.code,
                benefit.consumptionMode
            )

            // 如果用户没有该权益记录，使用默认值
            const finalTotalValue = totalValue > 0 ? totalValue : benefit.defaultValue

            // 计算已使用量（目前只支持云盘空间）
            let usedValue = BigInt(0)
            if (benefit.code === BenefitCode.STORAGE_SPACE) {
                const ossUsage = await ossUsageDao(userId)
                usedValue = BigInt(ossUsage.fileSize || 0)
            }

            // 计算剩余量
            const remainingValue = finalTotalValue - usedValue
            const remaining = remainingValue > 0 ? remainingValue : BigInt(0)

            // 计算使用率百分比
            const percentage = finalTotalValue > 0
                ? Math.round(Number(usedValue * BigInt(100) / finalTotalValue))
                : 0

            // 格式化展示值
            const formatted = formatBenefitValues(
                Number(finalTotalValue),
                Number(usedValue),
                Number(remaining),
                benefit.unitType
            )

            summaries.push({
                code: benefit.code,
                name: benefit.name,
                totalValue: Number(finalTotalValue),
                usedValue: Number(usedValue),
                remainingValue: Number(remaining),
                unitType: benefit.unitType,
                formatted: {
                    ...formatted,
                    percentage,
                },
            })
        }

        return summaries
    } catch (error) {
        logger.error('获取用户权益汇总失败：', error)
        throw error
    }
}

/**
 * 获取用户云盘空间配额
 * @param userId 用户 ID
 * @returns 云盘空间配额信息
 */
export const getUserStorageQuotaService = async (
    userId: number
): Promise<StorageQuotaInfo> => {
    try {
        // 查询云盘空间权益定义
        const storageBenefit = await findBenefitByCodeDao(BenefitCode.STORAGE_SPACE)
        if (!storageBenefit) {
            throw new Error('云盘空间权益未定义')
        }

        // 计算用户云盘空间权益总值
        const totalValue = await sumUserBenefitValueDao(
            userId,
            BenefitCode.STORAGE_SPACE,
            storageBenefit.consumptionMode
        )

        // 如果用户没有权益记录，使用默认值
        const totalBytes = totalValue > 0 ? Number(totalValue) : Number(storageBenefit.defaultValue)

        // 获取用户已使用的存储空间
        const ossUsage = await ossUsageDao(userId)
        const usedBytes = ossUsage.fileSize || 0

        // 计算剩余空间
        const remainingBytes = Math.max(0, totalBytes - usedBytes)

        // 计算使用率百分比
        const percentage = totalBytes > 0
            ? Math.round((usedBytes / totalBytes) * 100)
            : 0

        return {
            totalBytes,
            usedBytes,
            remainingBytes,
            formatted: {
                total: formatByteSize(totalBytes, 2),
                used: formatByteSize(usedBytes, 2),
                remaining: formatByteSize(remainingBytes, 2),
                percentage,
            },
        }
    } catch (error) {
        logger.error('获取用户云盘空间配额失败：', error)
        throw error
    }
}

/**
 * 校验用户云盘空间是否足够
 * @param userId 用户 ID
 * @param requiredSize 需要的空间大小（字节）
 * @returns 校验结果
 */
export const checkStorageQuotaService = async (
    userId: number,
    requiredSize: number
): Promise<StorageQuotaCheckResult> => {
    try {
        // 获取用户云盘空间配额
        const quota = await getUserStorageQuotaService(userId)

        // 判断是否有足够空间
        const allowed = quota.remainingBytes >= requiredSize

        // 构建结果
        const result: StorageQuotaCheckResult = {
            allowed,
            quota,
            requiredSize,
            requiredFormatted: formatByteSize(requiredSize, 2),
        }

        // 如果空间不足，添加错误信息
        if (!allowed) {
            result.message = `云盘空间不足，已使用 ${quota.formatted.used} / 总共 ${quota.formatted.total}，剩余 ${quota.formatted.remaining}，待上传文件 ${result.requiredFormatted}`
        }

        return result
    } catch (error) {
        logger.error('校验云盘空间失败：', error)
        throw error
    }
}

/**
 * 发放会员权益
 * @param userId 用户 ID
 * @param membershipId 会员记录 ID
 * @param levelId 会员级别 ID
 * @param startDate 开始日期
 * @param endDate 结束日期
 * @param tx 事务客户端（可选）
 */
export const grantMembershipBenefitsService = async (
    userId: number,
    membershipId: number,
    levelId: number,
    startDate: Date,
    endDate: Date,
    tx?: PrismaClient
): Promise<void> => {
    try {
        // 查询该会员级别的所有权益配置
        const membershipBenefits = await findBenefitsByLevelIdDao(levelId, tx)

        if (membershipBenefits.length === 0) {
            logger.warn(`会员级别 ${levelId} 没有配置权益`)
            return
        }

        // 批量创建用户权益记录
        const benefitDataList = membershipBenefits.map(mb => ({
            userId,
            benefitId: mb.benefitId,
            benefitValue: mb.benefitValue,
            sourceType: BenefitSourceType.MEMBERSHIP_GIFT,
            sourceId: membershipId,
            effectiveAt: startDate,
            expiredAt: endDate,
            remark: `会员级别 ${levelId} 赠送`,
        }))

        await createUserBenefitsDao(benefitDataList, tx)

        logger.info(`为用户 ${userId} 发放会员权益成功，共 ${benefitDataList.length} 项`)
    } catch (error) {
        logger.error('发放会员权益失败：', error)
        throw error
    }
}

/**
 * 获取用户指定权益的详细信息
 * @param userId 用户 ID
 * @param benefitCode 权益标识码
 * @returns 权益详细信息
 */
export const getUserBenefitDetailService = async (
    userId: number,
    benefitCode: string
): Promise<UserBenefitDetailResponse | null> => {
    try {
        // 查询权益定义
        const benefit = await findBenefitByCodeDao(benefitCode)
        if (!benefit) {
            return null
        }

        // 计算用户该权益的总值
        const totalValue = await sumUserBenefitValueDao(
            userId,
            benefitCode,
            benefit.consumptionMode
        )

        // 如果用户没有该权益记录，使用默认值
        const finalTotalValue = totalValue > 0 ? totalValue : benefit.defaultValue

        // 计算已使用量
        let usedValue = BigInt(0)
        if (benefitCode === BenefitCode.STORAGE_SPACE) {
            const ossUsage = await ossUsageDao(userId)
            usedValue = BigInt(ossUsage.fileSize || 0)
        }

        // 计算剩余量
        const remainingValue = finalTotalValue - usedValue
        const remaining = remainingValue > 0 ? remainingValue : BigInt(0)

        // 计算使用率百分比
        const percentage = finalTotalValue > 0
            ? Math.round(Number(usedValue * BigInt(100) / finalTotalValue))
            : 0

        // 格式化展示值
        const formatted = formatBenefitValues(
            Number(finalTotalValue),
            Number(usedValue),
            Number(remaining),
            benefit.unitType
        )

        // 查询用户该权益的所有记录
        const userBenefits = await findUserBenefitsByCodeDao(userId, benefitCode)
        const records: UserBenefitRecord[] = userBenefits.map(ub => ({
            id: ub.id,
            benefitValue: Number(ub.benefitValue),
            sourceType: ub.sourceType,
            sourceTypeName: BenefitSourceTypeName[ub.sourceType] || ub.sourceType,
            effectiveAt: ub.effectiveAt.toISOString(),
            expiredAt: ub.expiredAt.toISOString(),
            status: ub.status,
        }))

        return {
            code: benefit.code,
            name: benefit.name,
            totalValue: Number(finalTotalValue),
            usedValue: Number(usedValue),
            remainingValue: Number(remaining),
            unitType: benefit.unitType,
            formatted: {
                ...formatted,
                percentage,
            },
            records,
        }
    } catch (error) {
        logger.error('获取用户权益详情失败：', error)
        throw error
    }
}

/**
 * 格式化权益值
 * @param total 总值
 * @param used 已使用
 * @param remaining 剩余
 * @param unitType 单位类型
 */
function formatBenefitValues(
    total: number,
    used: number,
    remaining: number,
    unitType: string
): { total: string; used: string; remaining: string } {
    if (unitType === BenefitUnitType.BYTE) {
        return {
            total: formatByteSize(total, 2),
            used: formatByteSize(used, 2),
            remaining: formatByteSize(remaining, 2),
        }
    }

    // 次数类型直接返回数字
    return {
        total: `${total} 次`,
        used: `${used} 次`,
        remaining: `${remaining} 次`,
    }
}

/**
 * 作废会员权益（会员升级时使用）
 * @param userId 用户 ID
 * @param membershipId 会员记录 ID
 * @param tx 事务客户端（可选）
 */
export const expireMembershipBenefitsService = async (
    userId: number,
    membershipId: number,
    tx?: PrismaClient
): Promise<void> => {
    try {
        await expireUserBenefitsBySourceDao(
            userId,
            BenefitSourceType.MEMBERSHIP_GIFT,
            membershipId,
            tx
        )
        logger.info(`已作废用户 ${userId} 会员 ${membershipId} 的权益`)
    } catch (error) {
        logger.error('作废会员权益失败：', error)
        throw error
    }
}
