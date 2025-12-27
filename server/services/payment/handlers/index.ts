/**
 * 支付成功处理器索引
 */
import type { IPaymentSuccessHandler } from './types'
import { membershipHandler } from './membershipHandler'
import { pointsHandler } from './pointsHandler'

export * from './types'

/** 所有处理器列表 */
const handlers: IPaymentSuccessHandler[] = [
    membershipHandler,
    pointsHandler,
]

/**
 * 处理支付成功
 * @param order 订单（需包含商品信息）
 * @param tx 事务客户端
 */
export async function handlePaymentSuccess(order: orders, tx: unknown): Promise<void> {
    // 查找可以处理该订单的处理器
    const handler = handlers.find((h) => h.canHandle(order))

    if (!handler) {
        logger.warn(`未找到订单 ${order.orderNo} 的处理器`)
        return
    }

    logger.info(`使用处理器 ${handler.name} 处理订单 ${order.orderNo}`)

    await handler.handle(order, tx)
}
