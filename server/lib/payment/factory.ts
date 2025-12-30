/**
 * 支付适配器工厂
 *
 * 根据配置创建对应的支付适配器实例
 */
import { PaymentChannel } from '#shared/types/payment'
import type { IPaymentAdapter } from './base'
import type { WechatPayConfig, AlipayConfig } from './types'
import { WechatPayAdapter } from './adapters/wechat-pay'
import { PaymentConfigError } from './errors'

/** 适配器缓存 */
const adapterCache = new Map<PaymentChannel, IPaymentAdapter>()

/** 获取微信支付配置 */
const getWechatPayConfig = (): WechatPayConfig => {
    const config = useRuntimeConfig()
    return {
        channel: PaymentChannel.WECHAT,
        appId: config.wechatPay?.appId || '',
        mchId: config.wechatPay?.mchId || '',
        apiV3Key: config.wechatPay?.apiV3Key || '',
        serialNo: config.wechatPay?.serialNo || '',
        privateKey: config.wechatPay?.privateKey || '',
        platformCert: config.wechatPay?.platformCert || '',
    }
}

/**
 * 获取支付适配器
 * @param channel 支付渠道
 * @returns 支付适配器实例
 */
export const getPaymentAdapter = (channel: PaymentChannel): IPaymentAdapter => {
    // 检查缓存
    if (adapterCache.has(channel)) {
        return adapterCache.get(channel)!
    }

    let adapter: IPaymentAdapter

    switch (channel) {
        case PaymentChannel.WECHAT:
            adapter = new WechatPayAdapter(getWechatPayConfig())
            break
        case PaymentChannel.ALIPAY:
            // TODO: 实现支付宝适配器
            throw new PaymentConfigError('支付宝支付暂未实现')
        default:
            throw new PaymentConfigError(`不支持的支付渠道: ${channel}`)
    }

    // 缓存适配器
    adapterCache.set(channel, adapter)

    return adapter
}

/**
 * 清除适配器缓存
 */
export const clearPaymentAdapterCache = (): void => {
    adapterCache.clear()
}

/**
 * 创建支付适配器（不使用缓存）
 * @param channel 支付渠道
 * @param config 自定义配置
 * @returns 支付适配器实例
 */
export const createPaymentAdapter = (
    channel: PaymentChannel,
    config?: WechatPayConfig | AlipayConfig
): IPaymentAdapter => {
    switch (channel) {
        case PaymentChannel.WECHAT:
            return new WechatPayAdapter(config as WechatPayConfig || getWechatPayConfig())
        case PaymentChannel.ALIPAY:
            throw new PaymentConfigError('支付宝支付暂未实现')
        default:
            throw new PaymentConfigError(`不支持的支付渠道: ${channel}`)
    }
}
