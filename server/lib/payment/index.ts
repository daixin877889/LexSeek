/**
 * 支付模块导出
 */

// 类型导出
export * from './types'
export * from './errors'

// 基类导出
export { BasePaymentAdapter, type IPaymentAdapter } from './base'

// 适配器导出
export { WechatPayAdapter } from './adapters/wechat-pay'

// 工厂导出
export { getPaymentAdapter, clearPaymentAdapterCache, createPaymentAdapter } from './factory'
