/**
 * 支付适配器工厂测试
 *
 * 测试支付适配器的创建、缓存和管理
 *
 * **Feature: payment-system**
 * **Validates: Requirements 11.1, 11.2**
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
    getPaymentAdapter,
    clearPaymentAdapterCache,
    createPaymentAdapter,
} from '../../../server/lib/payment/factory'
import { PaymentChannel } from '#shared/types/payment'
import { PaymentConfigError } from '../../../server/lib/payment/errors'

// Mock useRuntimeConfig
vi.mock('nuxt/app', () => ({
    useRuntimeConfig: vi.fn(() => ({
        public: {
            wechatAppId: 'mock_app_id',
        },
        wechatPay: {
            mchId: 'mock_mch_id',
            apiV3Key: 'mock_api_v3_key_32_characters___',
            serialNo: 'mock_serial_no',
            privateKey: 'mock_private_key',
            platformCert: '',
        },
    })),
}))

// Mock logger
vi.stubGlobal('logger', {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
})

describe('支付适配器工厂', () => {
    beforeEach(() => {
        clearPaymentAdapterCache()
    })

    afterEach(() => {
        clearPaymentAdapterCache()
    })

    describe('getPaymentAdapter - 获取支付适配器', () => {
        it('应成功获取微信支付适配器', () => {
            const adapter = getPaymentAdapter(PaymentChannel.WECHAT)
            expect(adapter).toBeDefined()
            expect(adapter.getChannel()).toBe(PaymentChannel.WECHAT)
        })

        it('多次调用应返回相同实例（缓存）', () => {
            const adapter1 = getPaymentAdapter(PaymentChannel.WECHAT)
            const adapter2 = getPaymentAdapter(PaymentChannel.WECHAT)
            expect(adapter1).toBe(adapter2)
        })

        it('支付宝适配器应抛出错误（未实现）', () => {
            expect(() => getPaymentAdapter(PaymentChannel.ALIPAY)).toThrow(PaymentConfigError)
            expect(() => getPaymentAdapter(PaymentChannel.ALIPAY)).toThrow('支付宝支付暂未实现')
        })

        it('不支持的支付渠道应抛出错误', () => {
            expect(() => getPaymentAdapter('unknown' as PaymentChannel)).toThrow(PaymentConfigError)
            expect(() => getPaymentAdapter('unknown' as PaymentChannel)).toThrow('不支持的支付渠道')
        })
    })

    describe('clearPaymentAdapterCache - 清除缓存', () => {
        it('清除缓存后应返回新实例', () => {
            const adapter1 = getPaymentAdapter(PaymentChannel.WECHAT)
            clearPaymentAdapterCache()
            const adapter2 = getPaymentAdapter(PaymentChannel.WECHAT)
            // 应该是不同的实例
            expect(adapter1).not.toBe(adapter2)
        })

        it('连续清除缓存应正常工作', () => {
            getPaymentAdapter(PaymentChannel.WECHAT)
            clearPaymentAdapterCache()
            clearPaymentAdapterCache()
            const adapter = getPaymentAdapter(PaymentChannel.WECHAT)
            expect(adapter).toBeDefined()
        })
    })

    describe('createPaymentAdapter - 创建支付适配器（无缓存）', () => {
        it('应创建新的微信支付适配器实例', () => {
            const adapter = createPaymentAdapter(PaymentChannel.WECHAT)
            expect(adapter).toBeDefined()
            expect(adapter.getChannel()).toBe(PaymentChannel.WECHAT)
        })

        it('每次调用应返回新实例（不使用缓存）', () => {
            const adapter1 = createPaymentAdapter(PaymentChannel.WECHAT)
            const adapter2 = createPaymentAdapter(PaymentChannel.WECHAT)
            expect(adapter1).not.toBe(adapter2)
        })

        it('应能传入自定义配置', () => {
            const customConfig = {
                channel: PaymentChannel.WECHAT,
                appId: 'custom_app_id',
                mchId: 'custom_mch_id',
                apiV3Key: 'custom_api_v3_key_32_characters___',
                serialNo: 'custom_serial_no',
                privateKey: 'custom_private_key',
            }

            const adapter = createPaymentAdapter(PaymentChannel.WECHAT, customConfig)
            expect(adapter).toBeDefined()
        })

        it('支付宝适配器应抛出错误（未实现）', () => {
            expect(() => createPaymentAdapter(PaymentChannel.ALIPAY)).toThrow(PaymentConfigError)
            expect(() => createPaymentAdapter(PaymentChannel.ALIPAY)).toThrow('支付宝支付暂未实现')
        })

        it('不支持的支付渠道应抛出错误', () => {
            expect(() => createPaymentAdapter('unknown' as PaymentChannel)).toThrow(PaymentConfigError)
        })
    })

    describe('getPaymentAdapter vs createPaymentAdapter', () => {
        it('getPaymentAdapter 使用缓存，createPaymentAdapter 不使用缓存', () => {
            const cachedAdapter = getPaymentAdapter(PaymentChannel.WECHAT)
            const newAdapter = createPaymentAdapter(PaymentChannel.WECHAT)
            expect(cachedAdapter).not.toBe(newAdapter)
        })

        it('两者返回的适配器都应正常工作', () => {
            const cached = getPaymentAdapter(PaymentChannel.WECHAT)
            const fresh = createPaymentAdapter(PaymentChannel.WECHAT)

            expect(cached.getChannel()).toBe(PaymentChannel.WECHAT)
            expect(fresh.getChannel()).toBe(PaymentChannel.WECHAT)

            expect(cached.getSupportedMethods()).toEqual(fresh.getSupportedMethods())
        })
    })
})
