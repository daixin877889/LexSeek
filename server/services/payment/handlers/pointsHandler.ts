/**
 * 积分商品支付成功处理器
 *
 * 处理积分商品购买成功后的业务逻辑
 */
import type { IPaymentSuccessHandler, OrderWithProduct } from './types'
import { ProductType } from '#shared/types/product'
import { PointRecordSourceType } from '#shared/types/point.types'
import { createPointRecordService } from '../../point/pointRecords.service'

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

        // 复用积分创建的统一逻辑
        await createPointRecordService(
            {
                userId: order.userId,
                pointAmount: totalPoints,
                sourceType: PointRecordSourceType.DIRECT_PURCHASE,
                sourceId: order.id,
                duration: order.duration,
                durationUnit: order.durationUnit as 'day' | 'month' | 'year',
                remark: `购买积分商品：${product.name}`,
            },
            prismaClient
        )

        logger.info(`积分购买成功：用户 ${order.userId}，积分 ${totalPoints}`)
    },
}
