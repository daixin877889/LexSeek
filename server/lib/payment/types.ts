/**
 * 支付适配器类型定义
 */
import type { PaymentChannel, PaymentMethod } from '#shared/types/payment'

/** 支付配置基类 */
export interface PaymentConfig {
    /** 支付渠道 */
    channel: PaymentChannel
    /** 是否沙箱环境 */
    sandbox?: boolean
}

/** 微信支付配置 */
export interface WechatPayConfig extends PaymentConfig {
    channel: PaymentChannel.WECHAT
    /** 应用ID */
    appId: string
    /** 商户号 */
    mchId: string
    /** API v3 密钥 */
    apiV3Key: string
    /** 商户证书序列号 */
    serialNo: string
    /** 商户私钥 */
    privateKey: string
    /** 微信支付平台证书 */
    platformCert?: string
}

/** 支付宝配置 */
export interface AlipayConfig extends PaymentConfig {
    channel: PaymentChannel.ALIPAY
    /** 应用ID */
    appId: string
    /** 应用私钥 */
    privateKey: string
    /** 支付宝公钥 */
    alipayPublicKey: string
}

/** 创建支付参数 */
export interface CreatePaymentParams {
    /** 商户订单号 */
    orderNo: string
    /** 支付金额（分） */
    amount: number
    /** 商品描述 */
    description: string
    /** 支付方式 */
    method: PaymentMethod
    /** 用户标识（小程序支付必填） */
    openid?: string
    /** 回调地址 */
    notifyUrl: string
    /** 附加数据 */
    attach?: string
    /** 过期时间（分钟） */
    expireMinutes?: number
}

/** 支付结果 */
export interface PaymentResult {
    /** 是否成功 */
    success: boolean
    /** 预支付ID（微信） */
    prepayId?: string
    /** 支付参数（用于前端调起支付） */
    paymentParams?: Record<string, unknown>
    /** 二维码链接（扫码支付） */
    codeUrl?: string
    /** H5支付链接 */
    h5Url?: string
    /** 错误信息 */
    errorMessage?: string
}

/** 回调数据 */
export interface CallbackData {
    /** 原始数据 */
    raw: string | Record<string, unknown>
    /** 签名 */
    signature?: string
    /** 时间戳 */
    timestamp?: string
    /** 随机串 */
    nonce?: string
    /** 证书序列号 */
    serial?: string
}

/** 回调验证结果 */
export interface CallbackVerifyResult {
    /** 是否验证成功 */
    success: boolean
    /** 商户订单号 */
    orderNo?: string
    /** 第三方交易号 */
    transactionId?: string
    /** 支付金额（分） */
    amount?: number
    /** 支付时间 */
    paidAt?: Date
    /** 用户标识 */
    openid?: string
    /** 附加数据 */
    attach?: string
    /** 错误信息 */
    errorMessage?: string
}

/** 查询订单参数 */
export interface QueryOrderParams {
    /** 商户订单号 */
    orderNo?: string
    /** 第三方交易号 */
    transactionId?: string
}

/** 查询订单结果 */
export interface QueryOrderResult {
    /** 是否成功 */
    success: boolean
    /** 交易状态 */
    tradeState?: 'SUCCESS' | 'NOTPAY' | 'CLOSED' | 'REFUND' | 'PAYERROR'
    /** 商户订单号 */
    orderNo?: string
    /** 第三方交易号 */
    transactionId?: string
    /** 支付金额（分） */
    amount?: number
    /** 支付时间 */
    paidAt?: Date
    /** 错误信息 */
    errorMessage?: string
}

/** 关闭订单参数 */
export interface CloseOrderParams {
    /** 商户订单号 */
    orderNo: string
}

/** 关闭订单结果 */
export interface CloseOrderResult {
    /** 是否成功 */
    success: boolean
    /** 错误信息 */
    errorMessage?: string
}
