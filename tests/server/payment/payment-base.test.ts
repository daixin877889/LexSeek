/**
 * 支付适配器基类测试
 *
 * 测试支付适配器基类的通用方法
 *
 * **Feature: payment-system**
 * **Validates: Requirements 11.2**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { PaymentChannel, PaymentMethod } from '~~/shared/types/payment'
import { BasePaymentAdapter } from '../../../server/lib/payment/base'
import type { PaymentConfig, CreatePaymentParams, PaymentResult, CallbackData, CallbackVerifyResult, QueryOrderParams, QueryOrderResult, CloseOrderParams, CloseOrderResult } from '../../../server/lib/payment/types'

/** 测试用的具体适配器实现 */
class TestPaymentAdapter extends BasePaymentAdapter<PaymentConfig> {
    protected validateConfig(): void {
        // 测试用，不做验证
    }

    getChannel(): PaymentChannel {
        return this.config.channel
    }

    getSupportedMethods(): PaymentMethod[] {
        return [PaymentMethod.MINI_PROGRAM, PaymentMethod.SCAN_CODE]
    }

    async createPayment(_params: CreatePaymentParams): Promise<PaymentResult> {
        return { success: true, prepayId: 'test_prepay_id' }
    }

    async verifyCallback(_data: CallbackData): Promise<CallbackVerifyResult> {
        return { success: true, orderNo: 'test_order' }
    }

    async queryOrder(_params: QueryOrderParams): Promise<QueryOrderResult> {
        return { success: true, tradeState: 'SUCCESS' }
    }

    async closeOrder(_params: CloseOrderParams): Promise<CloseOrderResult> {
        return { success: true }
    }

    // 暴露 protected 方法用于测试
    public testGenerateNonceStr(length?: number): string {
        return this.generateNonceStr(length)
    }

    public testGetTimestamp(): number {
        return this.getTimestamp()
    }
}

describe('BasePaymentAdapter 基类', () => {
    const createAdapter = (channel: PaymentChannel = PaymentChannel.WECHAT) => {
        return new TestPaymentAdapter({ channel })
    }

    describe('generateNonceStr 随机字符串生成', () => {
        it('默认生成 32 位随机字符串', () => {
            const adapter = createAdapter()
            const nonceStr = adapter.testGenerateNonceStr()

            expect(nonceStr.length).toBe(32)
            expect(/^[A-Za-z0-9]+$/.test(nonceStr)).toBe(true)
        })

        it('应生成指定长度的随机字符串', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 64 }),
                    (length) => {
                        const adapter = createAdapter()
                        const nonceStr = adapter.testGenerateNonceStr(length)

                        expect(nonceStr.length).toBe(length)
                        expect(/^[A-Za-z0-9]+$/.test(nonceStr)).toBe(true)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('每次生成的随机字符串应不同', () => {
            const adapter = createAdapter()
            const results = new Set<string>()

            // 生成 100 个随机字符串
            for (let i = 0; i < 100; i++) {
                results.add(adapter.testGenerateNonceStr())
            }

            // 应该都是唯一的（极小概率重复）
            expect(results.size).toBe(100)
        })
    })

    describe('getTimestamp 时间戳生成', () => {
        it('应返回当前时间戳（秒）', () => {
            const adapter = createAdapter()
            const before = Math.floor(Date.now() / 1000)
            const timestamp = adapter.testGetTimestamp()
            const after = Math.floor(Date.now() / 1000)

            expect(timestamp).toBeGreaterThanOrEqual(before)
            expect(timestamp).toBeLessThanOrEqual(after)
        })

        it('时间戳应为整数', () => {
            const adapter = createAdapter()
            const timestamp = adapter.testGetTimestamp()

            expect(Number.isInteger(timestamp)).toBe(true)
        })
    })

    describe('getChannel 获取支付渠道', () => {
        it('应返回配置的支付渠道', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(PaymentChannel.WECHAT, PaymentChannel.ALIPAY),
                    (channel) => {
                        const adapter = createAdapter(channel)
                        expect(adapter.getChannel()).toBe(channel)
                    }
                ),
                { numRuns: 10 }
            )
        })
    })

    describe('getSupportedMethods 获取支持的支付方式', () => {
        it('应返回支持的支付方式列表', () => {
            const adapter = createAdapter()
            const methods = adapter.getSupportedMethods()

            expect(Array.isArray(methods)).toBe(true)
            expect(methods.length).toBeGreaterThan(0)
            expect(methods).toContain(PaymentMethod.MINI_PROGRAM)
            expect(methods).toContain(PaymentMethod.SCAN_CODE)
        })
    })
})

describe('Property: 随机字符串唯一性', () => {
    it('大量生成的随机字符串应具有高唯一性', () => {
        const adapter = new TestPaymentAdapter({ channel: PaymentChannel.WECHAT })

        fc.assert(
            fc.property(
                fc.integer({ min: 16, max: 32 }),
                (length) => {
                    const results = new Set<string>()
                    const count = 50

                    for (let i = 0; i < count; i++) {
                        results.add(adapter.testGenerateNonceStr(length))
                    }

                    // 允许极小概率的重复（但实际上不应该发生）
                    expect(results.size).toBeGreaterThanOrEqual(count - 1)
                }
            ),
            { numRuns: 20 }
        )
    })
})
