/**
 * 会员权益关联数据访问层
 *
 * 提供会员级别与权益关联的 CRUD 操作
 */
import { Prisma } from '#shared/types/prisma'

// 定义 Prisma 客户端类型（支持事务）
type PrismaClient = typeof prisma

/**
 * 创建会员权益关联
 * @param levelId 会员级别 ID
 * @param benefitId 权益 ID
 * @param tx 事务客户端（可选）
 * @returns 创建的会员权益关联
 */
export const createMembershipBenefitDao = async (
    levelId: number,
    benefitId: number,
    tx?: PrismaClient
): Promise<membershipBenefits> => {
    try {
        const membershipBenefit = await (tx || prisma).membershipBenefits.create({
            data: {
                level: { connect: { id: levelId } },
                benefit: { connect: { id: benefitId } },
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })
        return membershipBenefit
    } catch (error) {
        logger.error('创建会员权益关联失败：', error)
        throw error
    }
}

/**
 * 查询会员级别的所有权益
 * @param levelId 会员级别 ID
 * @param tx 事务客户端（可选）
 * @returns 权益列表
 */
export const findBenefitsByLevelIdDao = async (
    levelId: number,
    tx?: PrismaClient
): Promise<(membershipBenefits & { benefit: benefits })[]> => {
    try {
        const membershipBenefits = await (tx || prisma).membershipBenefits.findMany({
            where: {
                levelId,
                deletedAt: null,
                benefit: {
                    status: 1, // 只返回启用的权益
                    deletedAt: null,
                },
            },
            include: { benefit: true },
        })
        return membershipBenefits
    } catch (error) {
        logger.error('查询会员级别权益失败：', error)
        throw error
    }
}

/**
 * 删除会员权益关联
 * @param levelId 会员级别 ID
 * @param benefitId 权益 ID
 * @param tx 事务客户端（可选）
 */
export const deleteMembershipBenefitDao = async (
    levelId: number,
    benefitId: number,
    tx?: PrismaClient
): Promise<void> => {
    try {
        await (tx || prisma).membershipBenefits.updateMany({
            where: {
                levelId,
                benefitId,
                deletedAt: null,
            },
            data: {
                deletedAt: new Date(),
                updatedAt: new Date(),
            },
        })
    } catch (error) {
        logger.error('删除会员权益关联失败：', error)
        throw error
    }
}

/**
 * 批量创建会员权益关联
 * @param levelId 会员级别 ID
 * @param benefitIds 权益 ID 列表
 * @param tx 事务客户端（可选）
 */
export const batchCreateMembershipBenefitsDao = async (
    levelId: number,
    benefitIds: number[],
    tx?: PrismaClient
): Promise<void> => {
    try {
        const data = benefitIds.map((benefitId) => ({
            levelId,
            benefitId,
            createdAt: new Date(),
            updatedAt: new Date(),
        }))

        await (tx || prisma).membershipBenefits.createMany({
            data,
            skipDuplicates: true,
        })
    } catch (error) {
        logger.error('批量创建会员权益关联失败：', error)
        throw error
    }
}

/**
 * 删除会员级别的所有权益关联
 * @param levelId 会员级别 ID
 * @param tx 事务客户端（可选）
 */
export const deleteAllMembershipBenefitsByLevelIdDao = async (
    levelId: number,
    tx?: PrismaClient
): Promise<void> => {
    try {
        await (tx || prisma).membershipBenefits.updateMany({
            where: {
                levelId,
                deletedAt: null,
            },
            data: {
                deletedAt: new Date(),
                updatedAt: new Date(),
            },
        })
    } catch (error) {
        logger.error('删除会员级别所有权益关联失败：', error)
        throw error
    }
}
