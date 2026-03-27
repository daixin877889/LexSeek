/**
 * 支付模块导出测试
 *
 * 测试支付模块的导出是否正确
 *
 * **Feature: payment-system**
 */

import { describe, it, expect } from 'vitest'

describe('支付模块导出', () => {
    it('应导出所有类型和类', async () => {
        const paymentModule = await import('../../../server/lib/payment')

        // 类型
        expect(paymentModule.BasePaymentAdapter).toBeDefined()
        expect(paymentModule.WechatPayAdapter).toBeDefined()

        // 工厂函数
        expect(paymentModule.getPaymentAdapter).toBeDefined()
        expect(paymentModule.clearPaymentAdapterCache).toBeDefined()
        expect(paymentModule.createPaymentAdapter).toBeDefined()

        // 错误类型
        expect(paymentModule.PaymentError).toBeDefined()
        expect(paymentModule.PaymentConfigError).toBeDefined()
        expect(paymentModule.PaymentSignatureError).toBeDefined()
        expect(paymentModule.PaymentRequestError).toBeDefined()
        expect(paymentModule.PaymentCallbackError).toBeDefined()
        expect(paymentModule.PaymentOrderNotFoundError).toBeDefined()
        expect(paymentModule.PaymentMethodNotSupportedError).toBeDefined()
    })

    it('BasePaymentAdapter 应是抽象类', async () => {
        const { BasePaymentAdapter } = await import('../../../server/lib/payment')
        expect(BasePaymentAdapter.prototype.constructor.name).toBe('BasePaymentAdapter')
    })

    it('错误类应继承自 Error', async () => {
        const { PaymentError, PaymentConfigError, PaymentRequestError } = await import('../../../server/lib/payment')
        expect(new PaymentError('test', 'TEST')).toBeInstanceOf(Error)
        expect(new PaymentConfigError('test')).toBeInstanceOf(PaymentError)
        expect(new PaymentRequestError('test')).toBeInstanceOf(PaymentError)
    })

    it('PaymentRequestError 应支持 statusCode 和 response 属性', async () => {
        const { PaymentRequestError } = await import('../../../server/lib/payment')
        const error = new PaymentRequestError('test', 500, { data: 'test' })
        expect(error.statusCode).toBe(500)
        expect(error.response).toEqual({ data: 'test' })
    })

    it('PaymentOrderNotFoundError 应包含订单号', async () => {
        const { PaymentOrderNotFoundError } = await import('../../../server/lib/payment')
        const error = new PaymentOrderNotFoundError('ORDER123')
        expect(error.message).toContain('ORDER123')
    })

    it('PaymentMethodNotSupportedError 应包含支付方式', async () => {
        const { PaymentMethodNotSupportedError } = await import('../../../server/lib/payment')
        const error = new PaymentMethodNotSupportedError('bitcoin')
        expect(error.message).toContain('bitcoin')
    })
})
