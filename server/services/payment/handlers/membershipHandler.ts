/**
 * 会员商品支付成功处理器
 *
 * 处理会员商品购买成功后的业务逻辑（仅处理新购订单，不处理升级订单）
 */
import type { IPaymentSuccessHandler, OrderWithProduct } from './types'
import { ProductType } from '#shared/types/product'
import { OrderType } from '#shared/types/payment'
import { UserMembershipSourceType } from '#shared/types/membership'
import { PointRecordSourceType } from '#shared/types/point.types'
import { createMembershipService } from '../../membership/userMembership.service'
import { createPointRecordService } from '../../point/pointRecords.service'

// 定义 Prisma 客户端类型（支持事务）
type PrismaClient = typeof prisma

/** 会员商品处理器（仅处理新购订单） */
export const membershipHandler: IPaymentSuccessHandler = {
    name: 'membership',

    /** 是否可以处理该订单（会员商品 + 非升级订单） */
    canHandle(order: OrderWithProduct): boolean {
        return (
            order.product?.type === ProductType.MEMBERSHIP &&
            order.orderType !== OrderType.UPGRADE
        )
    },

    /** 处理支付成功 */
    async handle(order: OrderWithProduct, tx: unknown): Promise<void> {
        const product = order.product
        const prismaClient = tx as PrismaClient

        if (!product.levelId) {
            throw new Error('会员商品未关联会员级别')
        }

        // 创建会员记录（传递时长和单位，由服务层计算正确的到期日期）
        const membership = await createMembershipService(
            {
                userId: order.userId,
                levelId: product.levelId,
                duration: order.duration,
                durationUnit: order.durationUnit as 'day' | 'month' | 'year',
                sourceType: UserMembershipSourceType.DIRECT_PURCHASE,
                sourceId: order.id,
                remark: `购买商品：${product.name}`,
            },
            prismaClient
        )

        logger.info(`会员记录创建成功：用户 ${order.userId}，会员 ID ${membership.id}`)

        // 处理赠送积分（生效时间与会员开始时间同步）
        if (product.giftPoint && product.giftPoint > 0) {
            // 复用积分创建的统一逻辑
            await createPointRecordService(
                {
                    userId: order.userId,
                    pointAmount: product.giftPoint,
                    sourceType: PointRecordSourceType.MEMBERSHIP_GIFT,
                    sourceId: membership.id,
                    userMembershipId: membership.id,
                    // 跟随会员日期
                    effectiveAt: membership.startDate,
                    expiredAt: membership.endDate,
                    remark: `购买会员赠送积分，订单号：${order.orderNo}`,
                },
                prismaClient
            )

            logger.info(`赠送积分成功：用户 ${order.userId}，积分 ${product.giftPoint}`)
        }
    },
}
