/**
 * 支付成功处理器类型定义
 */

/** 支付成功处理器接口 */
export interface IPaymentSuccessHandler {
    /** 处理器名称 */
    name: string

    /** 是否可以处理该订单 */
    canHandle(order: orders): boolean

    /** 处理支付成功 */
    handle(order: orders, tx: unknown): Promise<void>
}
