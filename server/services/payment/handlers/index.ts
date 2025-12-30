/**
 * 支付成功处理器索引
 */
import type { IPaymentSuccessHandler, OrderWithProduct } from './types'
import { upgradeHandler } from './upgradeHandler'
import { membershipHandler } from './membershipHandler'
import { pointsHandler } from './pointsHandler'

export * from './types'

/** 所有处理器列表（注意顺序：更具体的处理器放在前面） */
const handlers: IPaymentSuccessHandler[] = [
    upgradeHandler,      // 升级处理器（最具体，优先匹配）
    membershipHandler,   // 会员新购处理器
    pointsHandler,       // 积分包处理器
]

/**
 * 处理支付成功
 * @param order 订单（需包含商品信息）
 * @param tx 事务客户端
 */
export async function handlePaymentSuccess(order: OrderWithProduct, tx: unknown): Promise<void> {
    // 调试日志：打印订单和商品信息
    logger.info(`处理支付成功：订单 ${order.orderNo}，商品类型 ${order.product?.type}，商品名称 ${order.product?.name}`)

    // 查找可以处理该订单的处理器
    const handler = handlers.find((h) => h.canHandle(order))

    if (!handler) {
        logger.warn(`未找到订单 ${order.orderNo} 的处理器，商品类型：${order.product?.type}`)
        return
    }

    logger.info(`使用处理器 ${handler.name} 处理订单 ${order.orderNo}`)

    await handler.handle(order, tx)
}
