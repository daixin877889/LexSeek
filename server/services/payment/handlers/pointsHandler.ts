/**
 * 积分商品支付成功处理器
 *
 * 处理积分商品购买成功后的业务逻辑
 */
import dayjs from 'dayjs'
import type { IPaymentSuccessHandler, OrderWithProduct } from './types'
import { ProductType } from '#shared/types/product'

/** 积分来源类型 */
const PointSourceType = {
    /** 直接购买 */
    DIRECT_PURCHASE: 2,
} as const

// 定义 Prisma 客户端类型（支持事务）
type PrismaClient = typeof prisma

/** 积分商品处理器 */
export const pointsHandler: IPaymentSuccessHandler = {
    name: 'points',

    /** 是否可以处理该订单 */
    canHandle(order: OrderWithProduct): boolean {
        return order.product?.type === ProductType.POINTS
    },

    /** 处理支付成功 */
    async handle(order: OrderWithProduct, tx: unknown): Promise<void> {
        const product = order.product
        const prismaClient = tx as PrismaClient

        if (!product.pointAmount) {
            throw new Error('积分商品未设置积分数量')
        }

        // 计算总积分
        const totalPoints = product.pointAmount * order.duration

        // 积分有效期：根据购买时长计算
        // 规则：购买日期的次月/次年相同日期的前一天
        // 例如：2025-01-15 购买 1 年积分 → 到期 2026-01-14
        const now = dayjs()
        let expiredAt: Date

        if (order.durationUnit === 'month') {
            // 按月计算
            expiredAt = now.add(order.duration, 'month').subtract(1, 'day').endOf('day').toDate()
        } else if (order.durationUnit === 'year') {
            // 按年计算
            expiredAt = now.add(order.duration, 'year').subtract(1, 'day').endOf('day').toDate()
        } else {
            // 按天计算（兼容旧逻辑）
            expiredAt = now.add(order.duration, 'day').subtract(1, 'day').endOf('day').toDate()
        }

        // 创建积分记录
        await prismaClient.pointRecords.create({
            data: {
                userId: order.userId,
                pointAmount: totalPoints,
                used: 0,
                remaining: totalPoints,
                sourceType: PointSourceType.DIRECT_PURCHASE,
                sourceId: order.id,
                effectiveAt: new Date(),
                expiredAt,
                status: 1,
                remark: `购买积分商品：${product.name}`,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })

        logger.info(`积分购买成功：用户 ${order.userId}，积分 ${totalPoints}`)
    },
}
