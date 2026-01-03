/**
 * 会员升级服务
 *
 * 提供会员升级相关的业务逻辑
 */
import dayjs from 'dayjs'

// 显式导入（测试环境需要）
import { findCurrentUserMembershipDao, createUserMembershipDao, updateUserMembershipDao, findUserMembershipByIdDao } from './userMembership.dao'
import { findMembershipLevelByIdDao, findAllActiveMembershipLevelsDao } from './membershipLevel.dao'
import { createMembershipUpgradeRecordDao, findUserUpgradeRecordsDao } from './membershipUpgrade.dao'
import { grantMembershipBenefitsService, expireMembershipBenefitsService } from './userBenefit.service'

// 显式导入常量
import { MembershipStatus, UserMembershipSourceType } from '#shared/types/membership'
import type { UpgradeDetails, UpgradeDetailsOldPointRecord } from '#shared/types/membership'
import { ProductType } from '#shared/types/product'
import { PointRecordStatus, PointRecordSourceType } from '#shared/types/point.types'

// 显式导入 Prisma 客户端和日志工具
import { prisma } from '../../utils/db'
import { logger } from '../../../shared/utils/logger'

// 导入 Decimal 转换工具
import { decimalToNumberUtils } from '../../../shared/utils/decimalToNumber'

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
    currentPrice: number // 当前级别商品价格
    upgradePrice: number
    pointCompensation: number
    remainingDays: number
    /** 计算详情（用于 UI 展示） */
    calculationDetails: {
        paidAmount: number
        totalDays: number
        remainingDays: number
        dailyValue: number
        targetYearlyPrice: number
        targetDailyValue: number
        originalRemainingValue: number
        targetRemainingValue: number
    }
}

/**
 * 获取可升级的目标级别列表
 * @param userId 用户 ID
 * @param membershipId 指定的会员记录 ID（可选，不传则使用当前生效的会员）
 * @returns 可升级的目标级别列表
 */
export const getUpgradeOptionsService = async (
    userId: number,
    membershipId?: number
) => {
    // 获取要升级的会员记录
    let currentMembership: (userMemberships & { level: membershipLevels }) | null = null

    if (membershipId) {
        // 如果指定了会员记录 ID，则查询该记录
        const membership = await findUserMembershipByIdDao(membershipId)
        if (membership && membership.userId === userId && membership.status === MembershipStatus.ACTIVE) {
            currentMembership = membership as (userMemberships & { level: membershipLevels })
        }
    } else {
        // 否则获取用户当前生效的会员
        currentMembership = await findCurrentUserMembershipDao(userId)
    }

    if (!currentMembership) {
        return { options: [], currentMembership: null }
    }

    // 获取所有启用的会员级别
    const allLevels = await findAllActiveMembershipLevelsDao()

    // 筛选比当前级别更高的级别（sortOrder 越大级别越高）
    // 只筛选有关联商品的会员级别（通过后续查询商品来过滤）
    const higherLevels = allLevels.filter(
        (level) => level.sortOrder > currentMembership.level.sortOrder
    )

    if (higherLevels.length === 0) {
        return { options: [], currentMembership }
    }

    // 计算剩余天数
    const remainingDays = dayjs(currentMembership.endDate).diff(dayjs(), 'day')

    // 获取当前会员记录的累计实付金额和原始总天数
    const { paidAmount, originalTotalDays } = await getMembershipPaidAmountAndDays(currentMembership)

    // 查找当前级别对应的商品（用于获取当前价格，显示用）
    const currentProducts = await prisma.products.findMany({
        where: {
            levelId: currentMembership.levelId,
            type: ProductType.MEMBERSHIP,
            status: 1,
            deletedAt: null,
        },
        orderBy: { sortOrder: 'asc' },
    })

    // 获取当前级别的商品和年价（显示用）
    const currentProduct = currentProducts.length > 0 ? currentProducts[0] : null
    const currentYearlyPrice = decimalToNumberUtils(currentProduct?.priceYearly)

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

        // 计算升级价格（传入累计实付金额和原始总天数）
        const priceResult = calculateUpgradePrice(
            currentMembership,
            level,
            currentProduct,
            product,
            remainingDays,
            paidAmount,
            originalTotalDays
        )

        // 转换价格（Decimal -> number）
        const monthlyPrice = product.priceMonthly !== null ? decimalToNumberUtils(product.priceMonthly) : null
        const yearlyPrice = product.priceYearly !== null ? decimalToNumberUtils(product.priceYearly) : null

        options.push({
            levelId: level.id,
            levelName: level.name,
            productId: product.id,
            productName: product.name,
            priceMonthly: monthlyPrice,
            priceYearly: yearlyPrice,
            currentPrice: currentYearlyPrice, // 当前级别的年价
            upgradePrice: priceResult.upgradePrice,
            pointCompensation: priceResult.pointCompensation,
            remainingDays,
            calculationDetails: {
                ...priceResult.calculationDetails,
                originalRemainingValue: priceResult.originalRemainingValue,
                targetRemainingValue: priceResult.targetRemainingValue,
            },
        })
    }

    return { options, currentMembership }
}

/**
 * 获取会员记录的实付金额和原始总天数
 * 
 * 支持多种来源类型：
 * 1. 直接购买（DIRECT_PURCHASE）：从订单获取实付金额，总天数为当前记录的天数
 * 2. 会员升级（MEMBERSHIP_UPGRADE）：累计计算（原会员实付金额 + 升级差价），总天数追溯到原始记录
 * 
 * @param membership 会员记录
 * @returns { paidAmount: 实付金额, originalTotalDays: 原始总天数 }
 */
const getMembershipPaidAmountAndDays = async (
    membership: userMemberships & { level: membershipLevels }
): Promise<{ paidAmount: number; originalTotalDays: number }> => {
    // 计算当前记录的天数
    const currentTotalDays = dayjs(membership.endDate).diff(dayjs(membership.startDate), 'day')

    // 直接购买的会员：从订单获取实付金额
    if (membership.sourceType === UserMembershipSourceType.DIRECT_PURCHASE && membership.sourceId) {
        const order = await prisma.orders.findUnique({
            where: { id: membership.sourceId },
            select: { amount: true, status: true },
        })

        if (order && order.status === 1) {
            const paidAmount = decimalToNumberUtils(order.amount)
            logger.debug(`会员 ${membership.id} 直接购买，订单 ${membership.sourceId} 实付金额: ${paidAmount}，总天数: ${currentTotalDays}`)
            return { paidAmount, originalTotalDays: currentTotalDays }
        }
        logger.debug(`会员 ${membership.id} 直接购买，订单 ${membership.sourceId} 不存在或未支付，实付金额为 0`)
        return { paidAmount: 0, originalTotalDays: currentTotalDays }
    }

    // 会员升级的会员：累计计算（原会员实付金额 + 升级差价），总天数追溯到原始记录
    if (membership.sourceType === UserMembershipSourceType.MEMBERSHIP_UPGRADE && membership.sourceId) {
        // 查询升级记录，获取原会员信息和升级差价
        const upgradeRecord = await prisma.membershipUpgradeRecords.findFirst({
            where: { toMembershipId: membership.id },
            include: {
                fromMembership: {
                    include: { level: true },
                },
            },
        })

        if (upgradeRecord) {
            // 递归获取原会员的实付金额和原始总天数
            const { paidAmount: originalPaidAmount, originalTotalDays } = await getMembershipPaidAmountAndDays(upgradeRecord.fromMembership)
            // 升级差价
            const upgradePrice = decimalToNumberUtils(upgradeRecord.upgradePrice)
            // 累计实付金额 = 原会员实付金额 + 升级差价
            const totalPaidAmount = originalPaidAmount + upgradePrice
            logger.debug(`会员 ${membership.id} 升级而来，原会员 ${upgradeRecord.fromMembershipId} 实付 ${originalPaidAmount}，升级差价 ${upgradePrice}，累计实付: ${totalPaidAmount}，原始总天数: ${originalTotalDays}`)
            return { paidAmount: totalPaidAmount, originalTotalDays }
        }

        // 如果找不到升级记录，尝试从订单获取
        const order = await prisma.orders.findUnique({
            where: { id: membership.sourceId },
            select: { amount: true, status: true },
        })

        if (order && order.status === 1) {
            const paidAmount = decimalToNumberUtils(order.amount)
            logger.debug(`会员 ${membership.id} 升级，从订单 ${membership.sourceId} 获取实付金额: ${paidAmount}，总天数: ${currentTotalDays}`)
            return { paidAmount, originalTotalDays: currentTotalDays }
        }
    }

    logger.debug(`会员 ${membership.id} 来源类型 ${membership.sourceType}，实付金额为 0`)
    return { paidAmount: 0, originalTotalDays: currentTotalDays }
}

/**
 * 计算升级价格
 * 
 * 计算逻辑（按实际剩余天数）：
 * 1. 日均价值 = 累计实付金额 / 原始套餐总天数
 * 2. 当前剩余价值 = 日均价值 × 剩余天数
 * 3. 目标日均价值 = 目标级别年价 / 365
 * 4. 目标剩余价值 = 目标日均价值 × 剩余天数
 * 5. 升级价格 = 目标剩余价值 - 当前剩余价值
 * 
 * 举例：用户花 365 元购买基础版（365天），剩余 100 天，升级到专业版（680元/年）
 * - 日均价值 = 365 / 365 = 1 元/天
 * - 当前剩余价值 = 1 × 100 = 100 元
 * - 目标日均价值 = 680 / 365 ≈ 1.863 元/天
 * - 目标剩余价值 = 1.863 × 100 ≈ 186.30 元
 * - 升级价格 = 186.30 - 100 = 86.30 元
 * 
 * @param currentMembership 当前会员记录
 * @param _targetLevel 目标级别（未使用，保留参数兼容性）
 * @param _currentProduct 当前级别商品（未使用，保留参数兼容性）
 * @param targetProduct 目标商品
 * @param remainingDays 剩余天数（从今天到结束时间）
 * @param paidAmount 当前会员记录的累计实付金额
 * @param originalTotalDays 原始套餐总天数（追溯到最初购买时的天数）
 * @returns 升级价格计算结果
 */
export const calculateUpgradePrice = (
    currentMembership: userMemberships & { level: membershipLevels },
    _targetLevel: membershipLevels,
    _currentProduct: products | null,
    targetProduct: products,
    remainingDays: number,
    paidAmount: number = 0,
    originalTotalDays?: number
): UpgradePriceResult => {
    // 使用原始总天数，如果没有传入则使用当前会员记录的天数
    const totalDays = originalTotalDays ?? dayjs(currentMembership.endDate).diff(dayjs(currentMembership.startDate), 'day')

    // 计算实际剩余天数：确保不超过总天数，且不为负数
    const actualRemainingDays = Math.max(0, Math.min(remainingDays, totalDays))

    // 计算日均价值（累计实付金额 / 原始总天数）
    const dailyValue = totalDays > 0 ? paidAmount / totalDays : 0

    // 当前剩余价值 = 日均价值 × 实际剩余天数
    const originalRemainingValue = dailyValue * actualRemainingDays

    // 获取目标级别的年价
    let targetYearlyPrice = 0
    if (targetProduct.priceYearly !== null && targetProduct.priceYearly !== undefined) {
        targetYearlyPrice = decimalToNumberUtils(targetProduct.priceYearly)
    } else if (targetProduct.priceMonthly !== null && targetProduct.priceMonthly !== undefined) {
        targetYearlyPrice = decimalToNumberUtils(targetProduct.priceMonthly) * 12
    }

    // 目标日均价值 = 目标年价 / 365
    const targetDailyValue = targetYearlyPrice / 365

    // 目标剩余价值 = 目标日均价值 × 实际剩余天数
    const targetRemainingValue = targetDailyValue * actualRemainingDays

    // 升级价格 = 目标剩余价值 - 当前剩余价值（不能为负数，四舍五入到分）
    const upgradePrice = Math.max(0, Math.round((targetRemainingValue - originalRemainingValue) * 100) / 100)

    // 积分补偿 = 升级价格 × 10
    const pointCompensation = Math.round(upgradePrice * 10)

    // 调试日志
    logger.debug(`升级价格计算: 累计实付金额=${paidAmount}, 原始总天数=${totalDays}, 剩余天数=${remainingDays}, 实际剩余天数=${actualRemainingDays}, 日均价值=${dailyValue.toFixed(4)}, 当前剩余价值=${originalRemainingValue.toFixed(2)}, 目标年价=${targetYearlyPrice}, 目标日均价值=${targetDailyValue.toFixed(4)}, 目标剩余价值=${targetRemainingValue.toFixed(2)}, 升级价格=${upgradePrice}`)

    return {
        originalRemainingValue: Math.round(originalRemainingValue * 100) / 100,
        targetRemainingValue: Math.round(targetRemainingValue * 100) / 100,
        upgradePrice,
        pointCompensation,
        calculationDetails: {
            paidAmount,
            totalDays,
            remainingDays: actualRemainingDays,
            dailyValue: Math.round(dailyValue * 10000) / 10000,
            targetYearlyPrice,
            targetDailyValue: Math.round(targetDailyValue * 10000) / 10000,
        },
    }
}


/**
 * 计算指定升级的价格
 * @param userId 用户 ID
 * @param targetLevelId 目标级别 ID
 * @param membershipId 指定的会员记录 ID（可选，不传则使用当前生效的会员）
 * @returns 升级价格计算结果
 */
export const calculateUpgradePriceService = async (
    userId: number,
    targetLevelId: number,
    membershipId?: number
): Promise<{ success: boolean; result?: UpgradePriceResult & { targetProduct: products }; errorMessage?: string }> => {
    // 获取要升级的会员记录
    let currentMembership: (userMemberships & { level: membershipLevels }) | null = null

    if (membershipId) {
        // 如果指定了会员记录 ID，则查询该记录
        const membership = await findUserMembershipByIdDao(membershipId)
        if (membership && membership.userId === userId && membership.status === MembershipStatus.ACTIVE) {
            currentMembership = membership as (userMemberships & { level: membershipLevels })
        }
    } else {
        // 否则获取用户当前生效的会员
        currentMembership = await findCurrentUserMembershipDao(userId)
    }

    if (!currentMembership) {
        return { success: false, errorMessage: '用户没有有效会员' }
    }

    // 获取目标级别
    const targetLevel = await findMembershipLevelByIdDao(targetLevelId)

    if (!targetLevel) {
        return { success: false, errorMessage: '目标级别不存在' }
    }

    // 检查目标级别是否比当前级别高（sortOrder 越大级别越高）
    if (targetLevel.sortOrder <= currentMembership.level.sortOrder) {
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

    // 查找当前级别对应的商品
    const currentProducts = await prisma.products.findMany({
        where: {
            levelId: currentMembership.levelId,
            type: ProductType.MEMBERSHIP,
            status: 1,
            deletedAt: null,
        },
        orderBy: { sortOrder: 'asc' },
    })

    const currentProduct = currentProducts.length > 0 ? currentProducts[0] : null
    const product = products[0]
    const remainingDays = dayjs(currentMembership.endDate).diff(dayjs(), 'day')

    // 获取当前会员记录的累计实付金额和原始总天数
    const { paidAmount, originalTotalDays } = await getMembershipPaidAmountAndDays(currentMembership)

    const result = calculateUpgradePrice(
        currentMembership,
        targetLevel,
        currentProduct,
        product,
        remainingDays,
        paidAmount,
        originalTotalDays
    )

    return { success: true, result: { ...result, targetProduct: product } }
}

/**
 * 执行会员升级
 * 
 * 完整的结算逻辑（根据结算日期与原会员开始日期的关系分两种情况）：
 * 
 * 案例 1：结算日期在原会员开始日期之前（预购场景）
 * - 旧会员：endDate 保持不变，添加 settlementAt，status=2
 * - 新会员：startDate = 原 startDate，endDate = 原 endDate
 * - 新积分：effectiveAt = 原 startDate，expiredAt = 原 endDate
 * 
 * 案例 2：结算日期在原会员有效期内（正常升级）
 * - 旧会员：endDate = 结算日期 - 1 天，添加 settlementAt，status=2
 * - 新会员：startDate = 结算日期，endDate = 原 endDate
 * - 新积分：effectiveAt = 结算日期，expiredAt = 原 endDate
 * 
 * @param userId 用户 ID
 * @param targetLevelId 目标级别 ID
 * @param orderId 订单 ID
 * @param orderNo 订单号（用于补偿积分备注）
 * @param membershipId 指定的会员记录 ID（可选，不传则使用当前生效的会员）
 * @param tx 事务客户端（可选）
 * @returns 升级结果
 */
export const executeMembershipUpgradeService = async (
    userId: number,
    targetLevelId: number,
    orderId: number,
    orderNo: string,
    membershipId?: number,
    tx?: PrismaClient
): Promise<{ success: boolean; newMembership?: userMemberships; errorMessage?: string }> => {
    const client = tx || prisma

    try {
        // 获取要升级的会员记录
        let currentMembership: (userMemberships & { level: membershipLevels }) | null = null

        if (membershipId) {
            // 如果指定了会员记录 ID，则查询该记录
            const membership = await findUserMembershipByIdDao(membershipId, client)
            if (membership && membership.userId === userId && membership.status === MembershipStatus.ACTIVE) {
                currentMembership = membership as (userMemberships & { level: membershipLevels })
            }
        } else {
            // 否则获取用户当前生效的会员
            currentMembership = await findCurrentUserMembershipDao(userId, client)
        }

        if (!currentMembership) {
            return { success: false, errorMessage: '用户没有有效会员' }
        }

        // 获取目标级别
        const targetLevel = await findMembershipLevelByIdDao(targetLevelId, client)

        if (!targetLevel) {
            return { success: false, errorMessage: '目标级别不存在' }
        }

        // 检查目标级别是否比当前级别高（sortOrder 越大级别越高）
        if (targetLevel.sortOrder <= currentMembership.level.sortOrder) {
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

        // 查找当前级别对应的商品
        const currentProducts = await client.products.findMany({
            where: {
                levelId: currentMembership.levelId,
                type: ProductType.MEMBERSHIP,
                status: 1,
                deletedAt: null,
            },
            orderBy: { sortOrder: 'asc' },
        })

        const currentProduct = currentProducts.length > 0 ? currentProducts[0] : null
        const product = products[0]
        const remainingDays = dayjs(currentMembership.endDate).diff(dayjs(), 'day')

        // 获取当前会员记录的累计实付金额和原始总天数
        const { paidAmount, originalTotalDays } = await getMembershipPaidAmountAndDays(currentMembership)

        // 计算升级价格（传入累计实付金额和原始总天数）
        const priceResult = calculateUpgradePrice(
            currentMembership,
            targetLevel,
            currentProduct,
            product,
            remainingDays,
            paidAmount,
            originalTotalDays
        )

        // 结算日期（当前时间）
        const settlementDate = new Date()
        // 保存旧会员原来的开始日期和结束日期
        const originalStartDate = currentMembership.startDate
        const originalEndDate = currentMembership.endDate

        // 判断结算场景：结算日期是否在原会员开始日期之前
        const isPrePurchase = dayjs(settlementDate).isBefore(dayjs(originalStartDate), 'day')

        // 根据场景计算新会员的开始日期和旧会员的结束日期
        let newMembershipStartDate: Date
        let oldMembershipEndDate: Date
        let pointEffectiveAt: Date

        if (isPrePurchase) {
            // 案例 1：预购场景 - 结算日期在原会员开始日期之前
            // 新会员继承原会员的开始日期和结束日期
            newMembershipStartDate = originalStartDate
            oldMembershipEndDate = originalEndDate // 旧会员 endDate 保持不变
            pointEffectiveAt = originalStartDate
            logger.info(`会员升级（预购场景）：结算日期 ${dayjs(settlementDate).format('YYYY-MM-DD')} 在原会员开始日期 ${dayjs(originalStartDate).format('YYYY-MM-DD')} 之前`)
        } else {
            // 案例 2：正常升级场景 - 结算日期在原会员有效期内
            // 新会员从结算日期开始，旧会员在结算日期前一天结束
            newMembershipStartDate = settlementDate
            oldMembershipEndDate = dayjs(settlementDate).subtract(1, 'day').toDate()
            pointEffectiveAt = settlementDate
            logger.info(`会员升级（正常场景）：结算日期 ${dayjs(settlementDate).format('YYYY-MM-DD')} 在原会员有效期内`)
        }

        // 1. 结算旧会员记录（更新 endDate、settlementAt、status）
        await updateUserMembershipDao(
            currentMembership.id,
            {
                endDate: oldMembershipEndDate,
                settlementAt: settlementDate,
                status: MembershipStatus.SETTLED,
            },
            client
        )

        // 1.1 作废旧会员的权益
        await expireMembershipBenefitsService(userId, currentMembership.id, client)

        // 2. 创建新会员记录
        const newMembership = await createUserMembershipDao(
            {
                user: { connect: { id: userId } },
                level: { connect: { id: targetLevelId } },
                startDate: newMembershipStartDate,
                endDate: originalEndDate,
                status: MembershipStatus.ACTIVE,
                sourceType: UserMembershipSourceType.MEMBERSHIP_UPGRADE,
                sourceId: orderId,
                remark: `从 ${currentMembership.level.name} 升级到 ${targetLevel.name}`,
            },
            client
        )

        // 2.1 发放新会员级别的权益
        await grantMembershipBenefitsService(userId, newMembership.id, targetLevelId, newMembershipStartDate, originalEndDate, client)

        // 3. 查询旧会员关联的积分记录（只查询有效的，status = 1）
        const oldPointRecords = await client.pointRecords.findMany({
            where: {
                userMembershipId: currentMembership.id,
                status: PointRecordStatus.VALID,
                deletedAt: null,
            },
        })

        // 计算旧积分记录的 remaining 之和
        const totalTransferPoints = oldPointRecords.reduce((sum, record) => sum + record.remaining, 0)

        // 用于记录旧积分记录的详情
        const oldPointRecordsDetails: UpgradeDetailsOldPointRecord[] = []

        // 转入积分记录 ID
        let transferRecordId: number | null = null

        // 4. 如果有剩余积分，创建转入积分记录
        if (totalTransferPoints > 0) {
            const transferRecord = await client.pointRecords.create({
                data: {
                    userId,
                    userMembershipId: newMembership.id,
                    pointAmount: totalTransferPoints,
                    used: 0,
                    remaining: totalTransferPoints,
                    sourceType: PointRecordSourceType.MEMBERSHIP_UPGRADE_TRANSFER,
                    sourceId: orderId,
                    effectiveAt: pointEffectiveAt,
                    expiredAt: originalEndDate,
                    status: PointRecordStatus.VALID,
                    remark: '会员升级转入积分',
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            transferRecordId = transferRecord.id

            // 5. 结算旧积分记录（status 更新为 2，remaining 更新为 0，记录 transferOut 和 transferToRecordId）
            for (const oldRecord of oldPointRecords) {
                await client.pointRecords.update({
                    where: { id: oldRecord.id },
                    data: {
                        status: PointRecordStatus.MEMBERSHIP_UPGRADE_SETTLEMENT,
                        transferOut: oldRecord.remaining,
                        transferToRecordId: transferRecord.id,
                        remaining: 0,
                        settlementAt: settlementDate,
                        updatedAt: new Date(),
                    },
                })

                // 记录旧积分记录详情
                oldPointRecordsDetails.push({
                    id: oldRecord.id,
                    remaining: oldRecord.remaining,
                    transferOut: oldRecord.remaining,
                    transferToRecordId: transferRecord.id,
                })
            }
        }

        // 6. 创建补偿积分记录（如果补偿积分 > 0）
        let compensationRecordId: number | null = null
        if (priceResult.pointCompensation > 0) {
            const compensationRecord = await client.pointRecords.create({
                data: {
                    userId,
                    userMembershipId: newMembership.id,
                    pointAmount: priceResult.pointCompensation,
                    used: 0,
                    remaining: priceResult.pointCompensation,
                    sourceType: PointRecordSourceType.MEMBERSHIP_UPGRADE_COMPENSATION,
                    sourceId: orderId,
                    effectiveAt: pointEffectiveAt,
                    expiredAt: originalEndDate,
                    status: PointRecordStatus.VALID,
                    remark: `会员升级补偿积分，订单号：${orderNo}`,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            compensationRecordId = compensationRecord.id
        }

        // 7. 构建升级详情 JSON
        const upgradeDetails: UpgradeDetails = {
            oldMembership: {
                id: currentMembership.id,
                levelId: currentMembership.levelId,
                levelName: currentMembership.level.name,
                startDate: dayjs(originalStartDate).format('YYYY-MM-DD HH:mm:ss'),
                endDate: dayjs(oldMembershipEndDate).format('YYYY-MM-DD HH:mm:ss'),
                settlementDate: dayjs(settlementDate).format('YYYY-MM-DD HH:mm:ss'),
            },
            newMembership: {
                id: newMembership.id,
                levelId: newMembership.levelId,
                levelName: targetLevel.name,
                startDate: dayjs(newMembershipStartDate).format('YYYY-MM-DD HH:mm:ss'),
                endDate: dayjs(originalEndDate).format('YYYY-MM-DD HH:mm:ss'),
            },
            oldPointRecords: oldPointRecordsDetails,
            newPointRecords: {
                transferRecordId,
                compensationRecordId,
            },
        }

        // 8. 创建升级记录
        await createMembershipUpgradeRecordDao(
            {
                userId,
                fromMembershipId: currentMembership.id,
                toMembershipId: newMembership.id,
                orderId,
                upgradePrice: priceResult.upgradePrice,
                pointCompensation: priceResult.pointCompensation,
                transferPoints: totalTransferPoints,
                details: upgradeDetails,
            },
            client
        )

        logger.info(`会员升级成功：用户 ${userId}，从 ${currentMembership.level.name} 升级到 ${targetLevel.name}，转入积分 ${totalTransferPoints}，补偿积分 ${priceResult.pointCompensation}`)

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
