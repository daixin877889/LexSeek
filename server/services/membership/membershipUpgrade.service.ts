/**
 * 会员升级服务
 *
 * 提供会员升级相关的业务逻辑
 */
import dayjs from 'dayjs'

// 显式导入（测试环境需要）
import { findCurrentUserMembershipDao, createUserMembershipDao, updateUserMembershipDao } from './userMembership.dao'
import { findMembershipLevelByIdDao, findAllActiveMembershipLevelsDao } from './membershipLevel.dao'
import { createMembershipUpgradeRecordDao, findUserUpgradeRecordsDao } from './membershipUpgrade.dao'

// 显式导入常量
import { MembershipStatus, UserMembershipSourceType } from '#shared/types/membership'
import { ProductType } from '#shared/types/product'

// 显式导入 Prisma 客户端和日志工具
import { prisma } from '../../utils/db'
import { logger } from '../../../shared/utils/logger'

// 定义 Prisma 客户端类型（支持事务）
type PrismaClient = typeof prisma

/** 升级选项 */
export interface UpgradeOption {
    levelId: number
    levelName: string
    productId: number
    productName: string
    priceMonthly: number | null
    priceYearly: number | null
    upgradePrice: number
    pointCompensation: number
    remainingDays: number
}

/**
 * 获取可升级的目标级别列表
 * @param userId 用户 ID
 * @returns 可升级的目标级别列表
 */
export const getUpgradeOptionsService = async (
    userId: number
) => {
    // 获取用户当前有效会员
    const currentMembership = await findCurrentUserMembershipDao(userId)

    if (!currentMembership) {
        return { options: [], currentMembership: null }
    }

    // 获取所有启用的会员级别
    const allLevels = await findAllActiveMembershipLevelsDao()

    // 筛选比当前级别更高的级别（sortOrder 更小）
    const higherLevels = allLevels.filter(
        (level) => level.sortOrder < currentMembership.level.sortOrder
    )

    if (higherLevels.length === 0) {
        return { options: [], currentMembership }
    }

    // 计算剩余天数
    const remainingDays = dayjs(currentMembership.endDate).diff(dayjs(), 'day')

    // 为每个更高级别计算升级价格
    const options: UpgradeOption[] = []

    for (const level of higherLevels) {
        // 查找该级别对应的商品
        const products = await prisma.products.findMany({
            where: {
                levelId: level.id,
                type: ProductType.MEMBERSHIP,
                status: 1,
                deletedAt: null,
            },
            orderBy: { sortOrder: 'asc' },
        })

        if (products.length === 0) continue

        const product = products[0]

        // 计算升级价格
        const priceResult = calculateUpgradePrice(
            currentMembership,
            level,
            product,
            remainingDays
        )

        options.push({
            levelId: level.id,
            levelName: level.name,
            productId: product.id,
            productName: product.name,
            priceMonthly: product.priceMonthly ? Number(product.priceMonthly) : null,
            priceYearly: product.priceYearly ? Number(product.priceYearly) : null,
            upgradePrice: priceResult.upgradePrice,
            pointCompensation: priceResult.pointCompensation,
            remainingDays,
        })
    }

    return { options, currentMembership }
}

/**
 * 计算升级价格
 * @param currentMembership 当前会员记录
 * @param targetLevel 目标级别
 * @param targetProduct 目标商品
 * @param remainingDays 剩余天数
 * @returns 升级价格计算结果
 */
export const calculateUpgradePrice = (
    currentMembership: userMemberships & { level: membershipLevels },
    targetLevel: membershipLevels,
    targetProduct: products,
    remainingDays: number
): UpgradePriceResult => {
    // 获取当前级别的日均价格（假设按年计算）
    // 需要查找当前级别对应的商品价格
    const currentDailyPrice = 0 // 简化处理，实际应查询商品价格

    // 获取目标级别的日均价格
    const targetYearlyPrice = targetProduct.priceYearly
        ? Number(targetProduct.priceYearly)
        : (targetProduct.priceMonthly ? Number(targetProduct.priceMonthly) * 12 : 0)
    const targetDailyPrice = targetYearlyPrice / 365

    // 计算原级别剩余价值
    const originalRemainingValue = currentDailyPrice * remainingDays

    // 计算目标级别剩余价值
    const targetRemainingValue = targetDailyPrice * remainingDays

    // 升级价格 = 目标级别剩余价值 - 原级别剩余价值
    const upgradePrice = Math.max(0, Math.round((targetRemainingValue - originalRemainingValue) * 100) / 100)

    // 积分补偿 = 升级价格 × 10
    const pointCompensation = Math.round(upgradePrice * 10)

    return {
        originalRemainingValue: Math.round(originalRemainingValue * 100) / 100,
        targetRemainingValue: Math.round(targetRemainingValue * 100) / 100,
        upgradePrice,
        pointCompensation,
    }
}

/**
 * 计算指定升级的价格
 * @param userId 用户 ID
 * @param targetLevelId 目标级别 ID
 * @returns 升级价格计算结果
 */
export const calculateUpgradePriceService = async (
    userId: number,
    targetLevelId: number
): Promise<{ success: boolean; result?: UpgradePriceResult; errorMessage?: string }> => {
    // 获取用户当前有效会员
    const currentMembership = await findCurrentUserMembershipDao(userId)

    if (!currentMembership) {
        return { success: false, errorMessage: '用户没有有效会员' }
    }

    // 获取目标级别
    const targetLevel = await findMembershipLevelByIdDao(targetLevelId)

    if (!targetLevel) {
        return { success: false, errorMessage: '目标级别不存在' }
    }

    // 检查目标级别是否比当前级别高
    if (targetLevel.sortOrder >= currentMembership.level.sortOrder) {
        return { success: false, errorMessage: '目标级别必须高于当前级别' }
    }

    // 查找目标级别对应的商品
    const products = await prisma.products.findMany({
        where: {
            levelId: targetLevelId,
            type: ProductType.MEMBERSHIP,
            status: 1,
            deletedAt: null,
        },
        orderBy: { sortOrder: 'asc' },
    })

    if (products.length === 0) {
        return { success: false, errorMessage: '目标级别没有可用商品' }
    }

    const product = products[0]
    const remainingDays = dayjs(currentMembership.endDate).diff(dayjs(), 'day')

    const result = calculateUpgradePrice(
        currentMembership,
        targetLevel,
        product,
        remainingDays
    )

    return { success: true, result }
}

/**
 * 执行会员升级
 * @param userId 用户 ID
 * @param targetLevelId 目标级别 ID
 * @param orderId 订单 ID
 * @param tx 事务客户端（可选）
 * @returns 升级结果
 */
export const executeMembershipUpgradeService = async (
    userId: number,
    targetLevelId: number,
    orderId: number,
    tx?: PrismaClient
): Promise<{ success: boolean; newMembership?: userMemberships; errorMessage?: string }> => {
    const client = tx || prisma

    try {
        // 获取用户当前有效会员
        const currentMembership = await findCurrentUserMembershipDao(userId, client)

        if (!currentMembership) {
            return { success: false, errorMessage: '用户没有有效会员' }
        }

        // 获取目标级别
        const targetLevel = await findMembershipLevelByIdDao(targetLevelId, client)

        if (!targetLevel) {
            return { success: false, errorMessage: '目标级别不存在' }
        }

        // 检查目标级别是否比当前级别高
        if (targetLevel.sortOrder >= currentMembership.level.sortOrder) {
            return { success: false, errorMessage: '目标级别必须高于当前级别' }
        }

        // 查找目标级别对应的商品
        const products = await client.products.findMany({
            where: {
                levelId: targetLevelId,
                type: ProductType.MEMBERSHIP,
                status: 1,
                deletedAt: null,
            },
            orderBy: { sortOrder: 'asc' },
        })

        if (products.length === 0) {
            return { success: false, errorMessage: '目标级别没有可用商品' }
        }

        const product = products[0]
        const remainingDays = dayjs(currentMembership.endDate).diff(dayjs(), 'day')

        // 计算升级价格
        const priceResult = calculateUpgradePrice(
            currentMembership,
            targetLevel,
            product,
            remainingDays
        )

        // 1. 将原会员记录标记为无效
        await updateUserMembershipDao(
            currentMembership.id,
            { status: MembershipStatus.INACTIVE },
            client
        )

        // 2. 创建新会员记录（继承原会员的结束时间）
        const newMembership = await createUserMembershipDao(
            {
                user: { connect: { id: userId } },
                level: { connect: { id: targetLevelId } },
                startDate: new Date(),
                endDate: currentMembership.endDate,
                status: MembershipStatus.ACTIVE,
                sourceType: UserMembershipSourceType.MEMBERSHIP_UPGRADE,
                sourceId: orderId,
                remark: `从 ${currentMembership.level.name} 升级到 ${targetLevel.name}`,
            },
            client
        )

        // 3. 转移积分记录到新会员
        await client.pointRecords.updateMany({
            where: {
                userMembershipId: currentMembership.id,
                deletedAt: null,
            },
            data: {
                userMembershipId: newMembership.id,
                updatedAt: new Date(),
            },
        })

        // 4. 发放积分补偿
        if (priceResult.pointCompensation > 0) {
            await client.pointRecords.create({
                data: {
                    userId,
                    userMembershipId: newMembership.id,
                    pointAmount: priceResult.pointCompensation,
                    used: 0,
                    remaining: priceResult.pointCompensation,
                    sourceType: 8, // 会员升级补偿
                    sourceId: orderId,
                    effectiveAt: new Date(),
                    expiredAt: currentMembership.endDate,
                    status: 1,
                    remark: '会员升级积分补偿',
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
        }

        // 5. 创建升级记录
        await createMembershipUpgradeRecordDao(
            {
                userId,
                fromMembershipId: currentMembership.id,
                toMembershipId: newMembership.id,
                orderId,
                upgradePrice: priceResult.upgradePrice,
                pointCompensation: priceResult.pointCompensation,
            },
            client
        )

        logger.info(`会员升级成功：用户 ${userId}，从 ${currentMembership.level.name} 升级到 ${targetLevel.name}`)

        return { success: true, newMembership }
    } catch (error) {
        logger.error('执行会员升级失败：', error)
        return {
            success: false,
            errorMessage: error instanceof Error ? error.message : '升级失败',
        }
    }
}

/**
 * 获取用户升级记录列表
 * @param userId 用户 ID
 * @param options 查询选项
 * @returns 升级记录列表和总数
 */
export const getUserUpgradeRecordsService = async (
    userId: number,
    options: { page?: number; pageSize?: number } = {}
): Promise<{
    list: {
        id: number
        fromLevelName: string
        toLevelName: string
        upgradePrice: number
        pointCompensation: number
        createdAt: string
    }[]
    total: number
}> => {
    const { list, total } = await findUserUpgradeRecordsDao(userId, options)

    const formattedList = list.map((record) => ({
        id: record.id,
        fromLevelName: record.fromMembership.level.name,
        toLevelName: record.toMembership.level.name,
        upgradePrice: Number(record.upgradePrice),
        pointCompensation: record.pointCompensation,
        createdAt: dayjs(record.createdAt).format('YYYY-MM-DD HH:mm:ss'),
    }))

    return { list: formattedList, total }
}
