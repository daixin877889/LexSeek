/**
 * 积分商品支付成功处理器
 *
 * 处理积分商品购买成功后的业务逻辑
 */
import dayjs from 'dayjs'
import type { IPaymentSuccessHandler } from './types'
import { ProductType } from '#shared/types/product'

/** 积分来源类型 */
const PointSourceType = {
    /** 购买 */
    PURCHASE: 1,
} as const

// 定义 Prisma 客户端类型（支持事务）
type PrismaClient = typeof prisma

/** 积分商品处理器 */
export const pointsHandler: IPaymentSuccessHandler = {
    name: 'points',

    /** 是否可以处理该订单 */
    canHandle(order: orders): boolean {
        const product = (order as orders & { product?: products }).product
        return product?.type === ProductType.POINTS
    },

    /** 处理支付成功 */
    async handle(order: orders, tx: unknown): Promise<void> {
        const product = (order as orders & { product: products }).product
        const prismaClient = tx as PrismaClient

        if (!product.pointAmount) {
            throw new Error('积分商品未设置积分数量')
        }

        // 计算总积分
        const totalPoints = product.pointAmount * order.duration

        // 积分有效期默认1年
        const expiredAt = dayjs().add(1, 'year').toDate()

        // 创建积分记录
        await prismaClient.pointRecords.create({
            data: {
                userId: order.userId,
                pointAmount: totalPoints,
                used: 0,
                remaining: totalPoints,
                sourceType: PointSourceType.PURCHASE,
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
