/**
 * 用户权益数据访问层
 *
 * 提供用户权益记录的 CRUD 操作
 */

import { BenefitConsumptionMode, UserBenefitStatus } from '#shared/types/benefit'

// 定义 Prisma 客户端类型（支持事务）
type PrismaClient = typeof prisma

/** 创建用户权益记录的输入参数 */
export interface CreateUserBenefitInput {
    userId: number
    benefitId: number
    benefitValue: bigint | number
    sourceType: string
    sourceId?: number
    effectiveAt: Date
    expiredAt: Date
    remark?: string
}

/**
 * 查询用户生效中的权益记录
 * @param userId 用户 ID
 * @param benefitCode 权益标识码（可选）
 * @param tx 事务客户端（可选）
 * @returns 用户权益记录列表
 */
export const findUserActiveBenefitsDao = async (
    userId: number,
    benefitCode?: string,
    tx?: PrismaClient
): Promise<(userBenefits & { benefit: benefits })[]> => {
    try {
        const now = new Date()
        const where: Prisma.userBenefitsWhereInput = {
            userId,
            status: UserBenefitStatus.ACTIVE,
            effectiveAt: { lte: now },
            expiredAt: { gte: now },
            deletedAt: null,
        }

        // 如果指定了权益标识码，添加关联查询条件
        if (benefitCode) {
            where.benefit = { code: benefitCode, deletedAt: null }
        }

        const userBenefits = await (tx || prisma).userBenefits.findMany({
            where,
            include: {
                benefit: true,
            },
            orderBy: { effectiveAt: 'desc' },
        })

        return userBenefits
    } catch (error) {
        logger.error('查询用户生效中的权益记录失败：', error)
        throw error
    }
}

/**
 * 汇总用户指定权益的总值
 * @param userId 用户 ID
 * @param benefitCode 权益标识码
 * @param consumptionMode 计算模式（sum/max）
 * @param tx 事务客户端（可选）
 * @returns 权益总值
 */
export const sumUserBenefitValueDao = async (
    userId: number,
    benefitCode: string,
    consumptionMode: string,
    tx?: PrismaClient
): Promise<bigint> => {
    try {
        const now = new Date()

        // 先查询符合条件的权益记录
        const userBenefits = await (tx || prisma).userBenefits.findMany({
            where: {
                userId,
                status: UserBenefitStatus.ACTIVE,
                effectiveAt: { lte: now },
                expiredAt: { gte: now },
                deletedAt: null,
                benefit: { code: benefitCode, deletedAt: null },
            },
            select: {
                benefitValue: true,
            },
        })

        if (userBenefits.length === 0) {
            return BigInt(0)
        }

        // 根据计算模式计算总值
        if (consumptionMode === BenefitConsumptionMode.MAX) {
            // 取最大值
            let maxValue = BigInt(0)
            for (const ub of userBenefits) {
                if (ub.benefitValue > maxValue) {
                    maxValue = ub.benefitValue
                }
            }
            return maxValue
        } else {
            // 累加（默认 SUM 模式）
            let sumValue = BigInt(0)
            for (const ub of userBenefits) {
                sumValue += ub.benefitValue
            }
            return sumValue
        }
    } catch (error) {
        logger.error('汇总用户权益总值失败：', error)
        throw error
    }
}

/**
 * 创建用户权益记录
 * @param data 创建数据
 * @param tx 事务客户端（可选）
 * @returns 创建的用户权益记录
 */
export const createUserBenefitDao = async (
    data: CreateUserBenefitInput,
    tx?: PrismaClient
): Promise<userBenefits> => {
    try {
        const userBenefit = await (tx || prisma).userBenefits.create({
            data: {
                userId: data.userId,
                benefitId: data.benefitId,
                benefitValue: BigInt(data.benefitValue),
                sourceType: data.sourceType,
                sourceId: data.sourceId,
                effectiveAt: data.effectiveAt,
                expiredAt: data.expiredAt,
                remark: data.remark,
                status: UserBenefitStatus.ACTIVE,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })
        return userBenefit
    } catch (error) {
        logger.error('创建用户权益记录失败：', error)
        throw error
    }
}

/**
 * 批量创建用户权益记录
 * @param dataList 创建数据列表
 * @param tx 事务客户端（可选）
 * @returns 创建的用户权益记录列表
 */
export const createUserBenefitsDao = async (
    dataList: CreateUserBenefitInput[],
    tx?: PrismaClient
): Promise<userBenefits[]> => {
    try {
        const results: userBenefits[] = []
        for (const data of dataList) {
            const userBenefit = await createUserBenefitDao(data, tx)
            results.push(userBenefit)
        }
        return results
    } catch (error) {
        logger.error('批量创建用户权益记录失败：', error)
        throw error
    }
}

/**
 * 过期用户权益记录（根据来源）
 * @param userId 用户 ID
 * @param sourceType 来源类型
 * @param sourceId 来源 ID
 * @param tx 事务客户端（可选）
 */
export const expireUserBenefitsBySourceDao = async (
    userId: number,
    sourceType: string,
    sourceId: number,
    tx?: PrismaClient
): Promise<void> => {
    try {
        await (tx || prisma).userBenefits.updateMany({
            where: {
                userId,
                sourceType,
                sourceId,
                status: UserBenefitStatus.ACTIVE,
                deletedAt: null,
            },
            data: {
                status: UserBenefitStatus.INACTIVE,
                updatedAt: new Date(),
            },
        })
    } catch (error) {
        logger.error('过期用户权益记录失败：', error)
        throw error
    }
}

/**
 * 查询用户指定权益的所有记录（包括已过期）
 * @param userId 用户 ID
 * @param benefitCode 权益标识码
 * @param tx 事务客户端（可选）
 * @returns 用户权益记录列表
 */
export const findUserBenefitsByCodeDao = async (
    userId: number,
    benefitCode: string,
    tx?: PrismaClient
): Promise<(userBenefits & { benefit: benefits })[]> => {
    try {
        const userBenefits = await (tx || prisma).userBenefits.findMany({
            where: {
                userId,
                deletedAt: null,
                benefit: { code: benefitCode, deletedAt: null },
            },
            include: {
                benefit: true,
            },
            orderBy: { effectiveAt: 'desc' },
        })

        return userBenefits
    } catch (error) {
        logger.error('查询用户权益记录失败：', error)
        throw error
    }
}
