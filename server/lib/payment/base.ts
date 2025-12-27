/**
 * 支付适配器基类
 */
import type { PaymentChannel, PaymentMethod } from '#shared/types/payment'
import type {
    PaymentConfig,
    CreatePaymentParams,
    PaymentResult,
    CallbackData,
    CallbackVerifyResult,
    QueryOrderParams,
    QueryOrderResult,
    CloseOrderParams,
    CloseOrderResult,
} from './types'

/** 支付适配器接口 */
export interface IPaymentAdapter {
    /** 获取支付渠道 */
    getChannel(): PaymentChannel

    /** 获取支持的支付方式 */
    getSupportedMethods(): PaymentMethod[]

    /** 创建支付 */
    createPayment(params: CreatePaymentParams): Promise<PaymentResult>

    /** 验证回调 */
    verifyCallback(data: CallbackData): Promise<CallbackVerifyResult>

    /** 查询订单 */
    queryOrder(params: QueryOrderParams): Promise<QueryOrderResult>

    /** 关闭订单 */
    closeOrder(params: CloseOrderParams): Promise<CloseOrderResult>
}

/** 支付适配器基类 */
export abstract class BasePaymentAdapter<T extends PaymentConfig> implements IPaymentAdapter {
    protected config: T

    constructor(config: T) {
        this.config = config
        this.validateConfig()
    }

    /** 验证配置 */
    protected abstract validateConfig(): void

    /** 获取支付渠道 */
    abstract getChannel(): PaymentChannel

    /** 获取支持的支付方式 */
    abstract getSupportedMethods(): PaymentMethod[]

    /** 创建支付 */
    abstract createPayment(params: CreatePaymentParams): Promise<PaymentResult>

    /** 验证回调 */
    abstract verifyCallback(data: CallbackData): Promise<CallbackVerifyResult>

    /** 查询订单 */
    abstract queryOrder(params: QueryOrderParams): Promise<QueryOrderResult>

    /** 关闭订单 */
    abstract closeOrder(params: CloseOrderParams): Promise<CloseOrderResult>

    /** 生成随机字符串 */
    protected generateNonceStr(length: number = 32): string {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
        let result = ''
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length))
        }
        return result
    }

    /** 获取当前时间戳（秒） */
    protected getTimestamp(): number {
        return Math.floor(Date.now() / 1000)
    }
}
