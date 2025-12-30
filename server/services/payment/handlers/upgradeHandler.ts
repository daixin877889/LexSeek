/**
 * 会员升级支付成功处理器
 *
 * 处理会员升级订单支付成功后的业务逻辑
 */
import type { IPaymentSuccessHandler, OrderWithProduct } from './types'
import { ProductType } from '#shared/types/product'
import { OrderType } from '#shared/types/payment'
import { executeMembershipUpgradeService } from '../../membership/membershipUpgrade.service'

// 定义 Prisma 客户端类型（支持事务）
type PrismaClient = typeof prisma

/**
 * 从订单备注中解析 membershipId
 * @param remark 订单备注（JSON 格式或普通字符串）
 * @returns membershipId 或 undefined
 */
const parseMembershipIdFromRemark = (remark: string | null): number | undefined => {
    if (!remark) return undefined

    try {
        const data = JSON.parse(remark)
        if (data && typeof data.membershipId === 'number') {
            return data.membershipId
        }
    } catch {
        // 不是 JSON 格式，忽略
    }

    return undefined
}

/** 会员升级处理器 */
export const upgradeHandler: IPaymentSuccessHandler = {
    name: 'membership-upgrade',

    /** 是否可以处理该订单（会员商品 + 升级订单类型） */
    canHandle(order: OrderWithProduct): boolean {
        return (
            order.product?.type === ProductType.MEMBERSHIP &&
            order.orderType === OrderType.UPGRADE
        )
    },

    /** 处理支付成功 */
    async handle(order: OrderWithProduct, tx: unknown): Promise<void> {
        const product = order.product

        if (!product.levelId) {
            throw new Error('会员商品未关联会员级别')
        }

        // 从订单备注中解析 membershipId
        const membershipId = parseMembershipIdFromRemark(order.remark)

        // 执行会员升级逻辑（传入 membershipId）
        const result = await executeMembershipUpgradeService(
            order.userId,
            product.levelId,
            order.id,
            order.orderNo,
            membershipId,
            tx as PrismaClient
        )

        if (!result.success) {
            throw new Error(result.errorMessage || '会员升级失败')
        }

        logger.info(`会员升级成功：用户 ${order.userId}，订单 ${order.orderNo}，新会员 ID ${result.newMembership?.id}，指定会员记录 ${membershipId || '无'}`)
    },
}
