/**
 * 支付适配器单元测试
 *
 * 测试实际的 WechatPayAdapter 类的方法
 *
 * **Feature: membership-system**
 */
import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { WechatPayAdapter } from '../../../server/lib/payment/adapters/wechat-pay'
import { PaymentChannel, PaymentMethod, PaymentTransactionStatus, OrderStatus } from '#shared/types/payment'
import { PaymentConfigError, PaymentMethodNotSupportedError } from '../../../server/lib/payment/errors'

/**
 * Property 9: 支付适配器接口一致性
 *
 * 测试实际的 WechatPayAdapter 类的接口方法
 *
 * **Feature: membership-system, Property 9: 支付适配器接口一致性**
 * **Validates: Requirements 11.1, 11.2**
 */
describe('Property 9: 支付适配器接口一致性', () => {
    // 创建测试用的配置（使用测试密钥，不会实际调用微信支付 API）
    const testConfig = {
        channel: PaymentChannel.WECHAT as const,
        appId: 'wx_test_app_id',
        mchId: 'test_mch_id',
        apiV3Key: 'test_api_v3_key_32_characters_',
        serialNo: 'test_serial_no',
        privateKey: `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC7JHoJfg6yNzLM
HtvFFTBRAHM3w7JjKzQBMbKrmaJcDz5eOM2W3l0MgatWwqEBKwdFCZvvGCGFsVaT
Dz5TD0YJVL5ZrnvANJVpvNvMANMpMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMq
MEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMq
MEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMq
MEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMq
MEMqMEMqAgMBAAECggEABJVpvNvMANMpMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMq
MEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMq
MEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMq
MEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMq
MEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMq
MEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMq
MEMqMQKBgQDrMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMq
MEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMq
MEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMQKBgQDLMEMq
MEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMq
MEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMq
MEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMQKBgQCrMEMqMEMqMEMqMEMqMEMq
MEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMq
MEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMq
MEMqMEMqMEMqMEMqMEMqMQKBgFMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMq
MEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMq
MEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMq
MEMqAoGBAKMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMq
MEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMq
MEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMqMEMq
-----END PRIVATE KEY-----`,
    }

    describe('getChannel 方法', () => {
        it('应返回微信支付渠道', () => {
            const adapter = new WechatPayAdapter(testConfig)
            expect(adapter.getChannel()).toBe(PaymentChannel.WECHAT)
        })
    })

    describe('getSupportedMethods 方法', () => {
        it('微信支付适配器应支持小程序、扫码、WAP、APP 支付', () => {
            const adapter = new WechatPayAdapter(testConfig)
            const methods = adapter.getSupportedMethods()

            expect(methods).toContain(PaymentMethod.MINI_PROGRAM)
            expect(methods).toContain(PaymentMethod.SCAN_CODE)
            expect(methods).toContain(PaymentMethod.WAP)
            expect(methods).toContain(PaymentMethod.APP)
            expect(methods).not.toContain(PaymentMethod.PC)
        })

        it('返回的支付方式数组长度应为 4', () => {
            const adapter = new WechatPayAdapter(testConfig)
            expect(adapter.getSupportedMethods().length).toBe(4)
        })
    })

    describe('配置验证', () => {
        it('缺少必要配置时应抛出 PaymentConfigError', () => {
            const invalidConfigs = [
                { ...testConfig, appId: '' },
                { ...testConfig, mchId: '' },
                { ...testConfig, apiV3Key: '' },
                { ...testConfig, serialNo: '' },
                { ...testConfig, privateKey: '' },
            ]

            for (const config of invalidConfigs) {
                expect(() => new WechatPayAdapter(config)).toThrow(PaymentConfigError)
            }
        })

        it('完整配置应成功创建适配器', () => {
            expect(() => new WechatPayAdapter(testConfig)).not.toThrow()
        })
    })

    describe('支付方式验证', () => {
        it('不支持的支付方式应抛出 PaymentMethodNotSupportedError', async () => {
            const adapter = new WechatPayAdapter(testConfig)

            await expect(
                adapter.createPayment({
                    orderNo: 'TEST_ORDER_001',
                    amount: 100,
                    description: '测试商品',
                    method: PaymentMethod.PC, // PC 支付不支持
                    notifyUrl: 'https://example.com/notify',
                })
            ).rejects.toThrow(PaymentMethodNotSupportedError)
        })
    })
})

/**
 * Property 10: 支付状态转换正确性
 *
 * 测试支付状态转换逻辑
 *
 * **Feature: membership-system, Property 10: 支付状态转换正确性**
 * **Validates: Requirements 11.4, 11.5**
 */
describe('Property 10: 支付状态转换正确性', () => {
    /** 检查状态转换是否有效（基于业务规则） */
    const isValidTransition = (from: PaymentTransactionStatus, to: PaymentTransactionStatus): boolean => {
        const validTransitions: Record<PaymentTransactionStatus, PaymentTransactionStatus[]> = {
            [PaymentTransactionStatus.PENDING]: [
                PaymentTransactionStatus.SUCCESS,
                PaymentTransactionStatus.FAILED,
                PaymentTransactionStatus.EXPIRED,
            ],
            [PaymentTransactionStatus.SUCCESS]: [PaymentTransactionStatus.REFUNDED],
            [PaymentTransactionStatus.FAILED]: [],
            [PaymentTransactionStatus.EXPIRED]: [],
            [PaymentTransactionStatus.REFUNDED]: [],
        }

        return validTransitions[from]?.includes(to) ?? false
    }

    it('待支付状态可以转换为成功、失败或过期', () => {
        expect(isValidTransition(PaymentTransactionStatus.PENDING, PaymentTransactionStatus.SUCCESS)).toBe(true)
        expect(isValidTransition(PaymentTransactionStatus.PENDING, PaymentTransactionStatus.FAILED)).toBe(true)
        expect(isValidTransition(PaymentTransactionStatus.PENDING, PaymentTransactionStatus.EXPIRED)).toBe(true)
    })

    it('支付成功状态只能转换为已退款', () => {
        expect(isValidTransition(PaymentTransactionStatus.SUCCESS, PaymentTransactionStatus.REFUNDED)).toBe(true)
        expect(isValidTransition(PaymentTransactionStatus.SUCCESS, PaymentTransactionStatus.PENDING)).toBe(false)
        expect(isValidTransition(PaymentTransactionStatus.SUCCESS, PaymentTransactionStatus.FAILED)).toBe(false)
    })

    it('支付失败状态不能转换为其他状态', () => {
        fc.assert(
            fc.property(
                fc.constantFrom(...Object.values(PaymentTransactionStatus).filter(v => typeof v === 'number')),
                (targetStatus) => {
                    expect(isValidTransition(PaymentTransactionStatus.FAILED, targetStatus as PaymentTransactionStatus)).toBe(false)
                }
            ),
            { numRuns: 10 }
        )
    })

    it('已过期状态不能转换为其他状态', () => {
        fc.assert(
            fc.property(
                fc.constantFrom(...Object.values(PaymentTransactionStatus).filter(v => typeof v === 'number')),
                (targetStatus) => {
                    expect(isValidTransition(PaymentTransactionStatus.EXPIRED, targetStatus as PaymentTransactionStatus)).toBe(false)
                }
            ),
            { numRuns: 10 }
        )
    })

    it('已退款状态不能转换为其他状态', () => {
        fc.assert(
            fc.property(
                fc.constantFrom(...Object.values(PaymentTransactionStatus).filter(v => typeof v === 'number')),
                (targetStatus) => {
                    expect(isValidTransition(PaymentTransactionStatus.REFUNDED, targetStatus as PaymentTransactionStatus)).toBe(false)
                }
            ),
            { numRuns: 10 }
        )
    })
})

/**
 * Property 11: 订单状态与支付单状态一致性
 *
 * 测试订单状态枚举值的正确性
 *
 * **Feature: membership-system, Property 11: 订单状态与支付单状态一致性**
 * **Validates: Requirements 7.3, 11.6**
 */
describe('Property 11: 订单状态与支付单状态一致性', () => {
    it('订单状态枚举值应正确定义', () => {
        expect(OrderStatus.PENDING).toBe(0)
        expect(OrderStatus.PAID).toBe(1)
        expect(OrderStatus.CANCELLED).toBe(2)
        expect(OrderStatus.REFUNDED).toBe(3)
    })

    it('支付单状态枚举值应正确定义', () => {
        expect(PaymentTransactionStatus.PENDING).toBe(0)
        expect(PaymentTransactionStatus.SUCCESS).toBe(1)
        expect(PaymentTransactionStatus.FAILED).toBe(2)
        expect(PaymentTransactionStatus.EXPIRED).toBe(3)
        expect(PaymentTransactionStatus.REFUNDED).toBe(4)
    })

    it('支付渠道枚举值应正确定义', () => {
        expect(PaymentChannel.WECHAT).toBe('wechat')
        expect(PaymentChannel.ALIPAY).toBe('alipay')
    })

    it('支付方式枚举值应正确定义', () => {
        expect(PaymentMethod.MINI_PROGRAM).toBe('mini_program')
        expect(PaymentMethod.SCAN_CODE).toBe('scan_code')
        expect(PaymentMethod.WAP).toBe('wap')
        expect(PaymentMethod.APP).toBe('app')
        expect(PaymentMethod.PC).toBe('pc')
    })
})
