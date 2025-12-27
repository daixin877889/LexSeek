/**
 * 会员商品支付成功处理器
 *
 * 处理会员商品购买成功后的业务逻辑
 */
import dayjs from 'dayjs'
import type { IPaymentSuccessHandler } from './types'
import { ProductType } from '#shared/types/product'
import { UserMembershipSourceType } from '#shared/types/membership'
import { createMembershipService } from '../../membership/userMembership.service'

/** 积分来源类型 */
const PointSourceType = {
    /** 购买赠送 */
    PURCHASE_GIFT: 2,
} as const

// 定义 Prisma 客户端类型（支持事务）
type PrismaClient = typeof prisma

/** 会员商品处理器 */
export const membershipHandler: IPaymentSuccessHandler = {
    name: 'membership',

    /** 是否可以处理该订单 */
    canHandle(order: orders): boolean {
        // 需要关联查询商品信息
        const product = (order as orders & { product?: products }).product
        return product?.type === ProductType.MEMBERSHIP
    },

    /** 处理支付成功 */
    async handle(order: orders, tx: unknown): Promise<void> {
        const product = (order as orders & { product: products }).product

        if (!product.levelId) {
            throw new Error('会员商品未关联会员级别')
        }

        // 计算会员时长（天数）
        let durationDays: number
        if (order.durationUnit === 'month') {
            durationDays = order.duration * 30
        } else if (order.durationUnit === 'year') {
            durationDays = order.duration * 365
        } else {
            durationDays = order.duration
        }

        // 创建会员记录
        const membership = await createMembershipService(
            {
                userId: order.userId,
                levelId: product.levelId,
                duration: durationDays,
                sourceType: UserMembershipSourceType.DIRECT_PURCHASE,
                sourceId: order.id,
                remark: `购买商品：${product.name}`,
            },
            tx as PrismaClient
        )

        logger.info(`会员记录创建成功：用户 ${order.userId}，会员 ID ${membership.id}`)

        // 处理赠送积分
        if (product.giftPoint && product.giftPoint > 0) {
            await handleGiftPoints(
                order.userId,
                membership.id,
                product.giftPoint,
                membership.endDate,
                tx as PrismaClient
            )
        }
    },
}

/**
 * 处理赠送积分
 * @param userId 用户 ID
 * @param membershipId 会员记录 ID
 * @param points 积分数量
 * @param expiredAt 过期时间
 * @param tx 事务客户端
 */
async function handleGiftPoints(
    userId: number,
    membershipId: number,
    points: number,
    expiredAt: Date,
    tx: PrismaClient
): Promise<void> {
    try {
        // 创建积分记录
        await tx.pointRecords.create({
            data: {
                userId,
                userMembershipId: membershipId,
                pointAmount: points,
                used: 0,
                remaining: points,
                sourceType: PointSourceType.PURCHASE_GIFT,
                sourceId: membershipId,
                effectiveAt: new Date(),
                expiredAt,
                status: 1,
                remark: '购买会员赠送积分',
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })

        logger.info(`赠送积分成功：用户 ${userId}，积分 ${points}`)
    } catch (error) {
        logger.error('赠送积分失败：', error)
        throw error
    }
}
