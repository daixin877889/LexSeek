/**
 * 支付类型定义
 */

/** 支付渠道 */
export enum PaymentChannel {
    /** 微信支付 */
    WECHAT = 'wechat',
    /** 支付宝 */
    ALIPAY = 'alipay',
}

/** 支付方式 */
export enum PaymentMethod {
    /** 小程序支付（微信JSAPI/支付宝小程序） */
    MINI_PROGRAM = 'mini_program',
    /** 扫码支付（微信Native/支付宝当面付） */
    SCAN_CODE = 'scan_code',
    /** 手机网页支付（微信H5/支付宝手机网站） */
    WAP = 'wap',
    /** APP支付 */
    APP = 'app',
    /** PC网页支付 */
    PC = 'pc',
}

/** 订单状态 */
export enum OrderStatus {
    /** 待支付 */
    PENDING = 0,
    /** 已支付 */
    PAID = 1,
    /** 已取消 */
    CANCELLED = 2,
    /** 已退款 */
    REFUNDED = 3,
}

/** 支付单状态 */
export enum PaymentTransactionStatus {
    /** 待支付 */
    PENDING = 0,
    /** 支付成功 */
    SUCCESS = 1,
    /** 支付失败 */
    FAILED = 2,
    /** 已过期 */
    EXPIRED = 3,
    /** 已退款 */
    REFUNDED = 4,
}

/** 时长单位 */
export enum DurationUnit {
    /** 月 */
    MONTH = 'month',
    /** 年 */
    YEAR = 'year',
}

/** 订单类型 */
export enum OrderType {
    /** 新购 */
    PURCHASE = 'purchase',
    /** 升级 */
    UPGRADE = 'upgrade',
    /** 续费 */
    RENEW = 'renew',
}

/** 支付单位（用于会员商品） */
export enum PaymentUnit {
    /** 按月 */
    MONTH = 1,
    /** 按年 */
    YEAR = 2,
}

/** 订单信息 */
export interface OrderInfo {
    id: number
    orderNo: string
    userId: number
    productId: number
    productName: string
    amount: number
    duration: number
    durationUnit: DurationUnit
    status: OrderStatus
    paidAt: string | null
    expiredAt: string
    createdAt: string
}

/** 支付单信息 */
export interface PaymentTransactionInfo {
    id: number
    transactionNo: string
    orderId: number
    amount: number
    paymentChannel: PaymentChannel
    paymentMethod: PaymentMethod
    outTradeNo: string | null
    status: PaymentTransactionStatus
    paidAt: string | null
    expiredAt: string
    errorMessage: string | null
}

/** 创建订单参数 */
export interface CreateOrderParams {
    userId: number
    productId: number
    duration: number
    durationUnit: DurationUnit
}

/** 创建支付参数 */
export interface CreatePaymentParams {
    orderNo: string
    amount: number
    description: string
    method: PaymentMethod
    openid?: string
    notifyUrl: string
}

/** 支付结果 */
export interface PaymentResult {
    success: boolean
    paymentParams?: Record<string, unknown>
    errorMessage?: string
}

/** 回调验证结果 */
export interface CallbackVerifyResult {
    success: boolean
    orderNo?: string
    transactionId?: string
    amount?: number
    errorMessage?: string
}
