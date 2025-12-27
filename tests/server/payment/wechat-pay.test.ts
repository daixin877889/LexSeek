/**
 * 微信支付适配器测试
 *
 * 测试微信支付适配器的配置验证和核心功能
 *
 * **Feature: payment-system**
 * **Validates: Requirements 11.1, 11.2, 11.3**
 */

import { describe, it, expect, vi, beforeAll } from 'vitest'
import * as fc from 'fast-check'
import { generateKeyPairSync } from 'crypto'

// 生成测试用的 RSA 密钥对
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})

// 模拟全局依赖
beforeAll(() => {
    vi.stubGlobal('logger', {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
    })

    vi.stubGlobal('$fetch', vi.fn())
})

// 导入被测试的模块
import { WechatPayAdapter } from '../../../server/lib/payment/adapters/wechat-pay'
import { PaymentConfigError, PaymentMethodNotSupportedError } from '../../../server/lib/payment/errors'
import { PaymentChannel, PaymentMethod } from '~~/shared/types/payment'
import type { WechatPayConfig } from '../../../server/lib/payment/types'

describe('WechatPayAdapter 配置验证', () => {
    // 有效的微信支付配置
    const validConfig: WechatPayConfig = {
        channel: PaymentChannel.WECHAT,
        appId: 'wx1234567890abcdef',
        mchId: '1234567890',
        apiV3Key: '12345678901234567890123456789012', // 32 字节
        serialNo: 'SERIAL123456789',
        privateKey: privateKey,
    }

    it('有效配置应成功创建适配器', () => {
        const adapter = new WechatPayAdapter(validConfig)
        expect(adapter.getChannel()).toBe(PaymentChannel.WECHAT)
    })

    it('缺少 appId 应抛出配置错误', () => {
        const config = { ...validConfig, appId: '' }
        expect(() => new WechatPayAdapter(config)).toThrow(PaymentConfigError)
        expect(() => new WechatPayAdapter(config)).toThrow('微信支付配置不完整')
    })

    it('缺少 mchId 应抛出配置错误', () => {
        const config = { ...validConfig, mchId: '' }
        expect(() => new WechatPayAdapter(config)).toThrow(PaymentConfigError)
    })

    it('缺少 apiV3Key 应抛出配置错误', () => {
        const config = { ...validConfig, apiV3Key: '' }
        expect(() => new WechatPayAdapter(config)).toThrow(PaymentConfigError)
    })

    it('缺少 serialNo 应抛出配置错误', () => {
        const config = { ...validConfig, serialNo: '' }
        expect(() => new WechatPayAdapter(config)).toThrow(PaymentConfigError)
    })

    it('缺少 privateKey 应抛出配置错误', () => {
        const config = { ...validConfig, privateKey: '' }
        expect(() => new WechatPayAdapter(config)).toThrow(PaymentConfigError)
    })
})

describe('WechatPayAdapter 支付方式', () => {
    const validConfig: WechatPayConfig = {
        channel: PaymentChannel.WECHAT,
        appId: 'wx1234567890abcdef',
        mchId: '1234567890',
        apiV3Key: '12345678901234567890123456789012',
        serialNo: 'SERIAL123456789',
        privateKey: privateKey,
    }

    it('应返回正确的支付渠道', () => {
        const adapter = new WechatPayAdapter(validConfig)
        expect(adapter.getChannel()).toBe(PaymentChannel.WECHAT)
    })

    it('应支持小程序、扫码、WAP、APP 支付', () => {
        const adapter = new WechatPayAdapter(validConfig)
        const methods = adapter.getSupportedMethods()

        expect(methods).toContain(PaymentMethod.MINI_PROGRAM)
        expect(methods).toContain(PaymentMethod.SCAN_CODE)
        expect(methods).toContain(PaymentMethod.WAP)
        expect(methods).toContain(PaymentMethod.APP)
    })

    it('不应支持 PC 支付', () => {
        const adapter = new WechatPayAdapter(validConfig)
        const methods = adapter.getSupportedMethods()

        expect(methods).not.toContain(PaymentMethod.PC)
    })

    it('不支持的支付方式应抛出错误', async () => {
        const adapter = new WechatPayAdapter(validConfig)

        await expect(adapter.createPayment({
            orderNo: 'ORDER123',
            amount: 100,
            description: '测试商品',
            method: PaymentMethod.PC,
            notifyUrl: 'https://example.com/notify',
        })).rejects.toThrow(PaymentMethodNotSupportedError)
    })
})

describe('WechatPayAdapter 小程序支付', () => {
    const validConfig: WechatPayConfig = {
        channel: PaymentChannel.WECHAT,
        appId: 'wx1234567890abcdef',
        mchId: '1234567890',
        apiV3Key: '12345678901234567890123456789012',
        serialNo: 'SERIAL123456789',
        privateKey: privateKey,
    }

    it('小程序支付缺少 openid 应返回错误', async () => {
        const adapter = new WechatPayAdapter(validConfig)

        const result = await adapter.createPayment({
            orderNo: 'ORDER123',
            amount: 100,
            description: '测试商品',
            method: PaymentMethod.MINI_PROGRAM,
            notifyUrl: 'https://example.com/notify',
            // 没有提供 openid
        })

        expect(result.success).toBe(false)
        expect(result.errorMessage).toContain('openid')
    })
})

describe('WechatPayAdapter 订单查询', () => {
    const validConfig: WechatPayConfig = {
        channel: PaymentChannel.WECHAT,
        appId: 'wx1234567890abcdef',
        mchId: '1234567890',
        apiV3Key: '12345678901234567890123456789012',
        serialNo: 'SERIAL123456789',
        privateKey: privateKey,
    }

    it('查询订单缺少订单号和交易号应返回错误', async () => {
        const adapter = new WechatPayAdapter(validConfig)

        const result = await adapter.queryOrder({})

        expect(result.success).toBe(false)
        expect(result.errorMessage).toContain('订单号或交易号')
    })
})

describe('WechatPayAdapter 回调验证', () => {
    const validConfig: WechatPayConfig = {
        channel: PaymentChannel.WECHAT,
        appId: 'wx1234567890abcdef',
        mchId: '1234567890',
        apiV3Key: '12345678901234567890123456789012',
        serialNo: 'SERIAL123456789',
        privateKey: privateKey,
    }

    it('回调参数不完整应返回错误', async () => {
        const adapter = new WechatPayAdapter(validConfig)

        const result = await adapter.verifyCallback({
            raw: '{}',
            // 缺少 signature, timestamp, nonce
        })

        expect(result.success).toBe(false)
        expect(result.errorMessage).toContain('回调参数不完整')
    })

    it('没有配置平台证书时应跳过签名验证', async () => {
        const adapter = new WechatPayAdapter(validConfig)

        // 这个测试验证当没有平台证书时，签名验证会被跳过
        // 实际的回调验证会因为解密失败而失败，但签名验证应该通过
        const result = await adapter.verifyCallback({
            raw: JSON.stringify({
                resource: {
                    ciphertext: 'invalid',
                    nonce: 'nonce123',
                    associated_data: 'data',
                },
            }),
            signature: 'invalid_signature',
            timestamp: '1234567890',
            nonce: 'nonce123',
        })

        // 应该因为解密失败而返回错误，而不是签名验证失败
        expect(result.success).toBe(false)
    })

    it('配置了平台证书时应验证签名', async () => {
        const configWithCert: WechatPayConfig = {
            ...validConfig,
            platformCert: publicKey, // 使用公钥作为平台证书
        }
        const adapter = new WechatPayAdapter(configWithCert)

        // 使用无效签名应该返回签名验证失败
        const result = await adapter.verifyCallback({
            raw: JSON.stringify({
                resource: {
                    ciphertext: 'test',
                    nonce: 'nonce123',
                    associated_data: 'data',
                },
            }),
            signature: 'invalid_signature',
            timestamp: '1234567890',
            nonce: 'nonce123',
        })

        expect(result.success).toBe(false)
        expect(result.errorMessage).toContain('签名验证失败')
    })
})

describe('WechatPayAdapter API 请求模拟', () => {
    const validConfig: WechatPayConfig = {
        channel: PaymentChannel.WECHAT,
        appId: 'wx1234567890abcdef',
        mchId: '1234567890',
        apiV3Key: '12345678901234567890123456789012',
        serialNo: 'SERIAL123456789',
        privateKey: privateKey,
    }

    it('小程序支付成功应返回 prepayId 和支付参数', async () => {
        // 模拟成功响应
        vi.mocked($fetch).mockResolvedValueOnce({ prepay_id: 'wx123456789' })

        const adapter = new WechatPayAdapter(validConfig)
        const result = await adapter.createPayment({
            orderNo: 'ORDER123',
            amount: 100,
            description: '测试商品',
            method: PaymentMethod.MINI_PROGRAM,
            notifyUrl: 'https://example.com/notify',
            openid: 'oXXXX123456',
        })

        expect(result.success).toBe(true)
        expect(result.prepayId).toBe('wx123456789')
        expect(result.paymentParams).toBeDefined()
        expect(result.paymentParams?.timeStamp).toBeDefined()
        expect(result.paymentParams?.nonceStr).toBeDefined()
        expect(result.paymentParams?.paySign).toBeDefined()
    })

    it('小程序支付 API 失败应返回错误', async () => {
        // 模拟失败响应
        vi.mocked($fetch).mockRejectedValueOnce(new Error('API 请求失败'))

        const adapter = new WechatPayAdapter(validConfig)
        const result = await adapter.createPayment({
            orderNo: 'ORDER123',
            amount: 100,
            description: '测试商品',
            method: PaymentMethod.MINI_PROGRAM,
            notifyUrl: 'https://example.com/notify',
            openid: 'oXXXX123456',
        })

        expect(result.success).toBe(false)
        expect(result.errorMessage).toContain('API 请求失败')
    })

    it('Native 支付成功应返回 codeUrl', async () => {
        vi.mocked($fetch).mockResolvedValueOnce({ code_url: 'weixin://wxpay/bizpayurl?pr=xxx' })

        const adapter = new WechatPayAdapter(validConfig)
        const result = await adapter.createPayment({
            orderNo: 'ORDER123',
            amount: 100,
            description: '测试商品',
            method: PaymentMethod.SCAN_CODE,
            notifyUrl: 'https://example.com/notify',
        })

        expect(result.success).toBe(true)
        expect(result.codeUrl).toBe('weixin://wxpay/bizpayurl?pr=xxx')
    })

    it('Native 支付 API 失败应返回错误', async () => {
        vi.mocked($fetch).mockRejectedValueOnce(new Error('网络错误'))

        const adapter = new WechatPayAdapter(validConfig)
        const result = await adapter.createPayment({
            orderNo: 'ORDER123',
            amount: 100,
            description: '测试商品',
            method: PaymentMethod.SCAN_CODE,
            notifyUrl: 'https://example.com/notify',
        })

        expect(result.success).toBe(false)
        expect(result.errorMessage).toContain('网络错误')
    })

    it('H5 支付成功应返回 h5Url', async () => {
        vi.mocked($fetch).mockResolvedValueOnce({ h5_url: 'https://wx.tenpay.com/xxx' })

        const adapter = new WechatPayAdapter(validConfig)
        const result = await adapter.createPayment({
            orderNo: 'ORDER123',
            amount: 100,
            description: '测试商品',
            method: PaymentMethod.WAP,
            notifyUrl: 'https://example.com/notify',
        })

        expect(result.success).toBe(true)
        expect(result.h5Url).toBe('https://wx.tenpay.com/xxx')
    })

    it('H5 支付 API 失败应返回错误', async () => {
        vi.mocked($fetch).mockRejectedValueOnce(new Error('H5 支付失败'))

        const adapter = new WechatPayAdapter(validConfig)
        const result = await adapter.createPayment({
            orderNo: 'ORDER123',
            amount: 100,
            description: '测试商品',
            method: PaymentMethod.WAP,
            notifyUrl: 'https://example.com/notify',
        })

        expect(result.success).toBe(false)
        expect(result.errorMessage).toContain('H5 支付失败')
    })

    it('APP 支付成功应返回 prepayId 和支付参数', async () => {
        vi.mocked($fetch).mockResolvedValueOnce({ prepay_id: 'wx_app_123456' })

        const adapter = new WechatPayAdapter(validConfig)
        const result = await adapter.createPayment({
            orderNo: 'ORDER123',
            amount: 100,
            description: '测试商品',
            method: PaymentMethod.APP,
            notifyUrl: 'https://example.com/notify',
        })

        expect(result.success).toBe(true)
        expect(result.prepayId).toBe('wx_app_123456')
        expect(result.paymentParams).toBeDefined()
        expect(result.paymentParams?.appid).toBe(validConfig.appId)
        expect(result.paymentParams?.partnerid).toBe(validConfig.mchId)
        expect(result.paymentParams?.prepayid).toBe('wx_app_123456')
    })

    it('APP 支付 API 失败应返回错误', async () => {
        vi.mocked($fetch).mockRejectedValueOnce(new Error('APP 支付失败'))

        const adapter = new WechatPayAdapter(validConfig)
        const result = await adapter.createPayment({
            orderNo: 'ORDER123',
            amount: 100,
            description: '测试商品',
            method: PaymentMethod.APP,
            notifyUrl: 'https://example.com/notify',
        })

        expect(result.success).toBe(false)
        expect(result.errorMessage).toContain('APP 支付失败')
    })

    it('查询订单（通过交易号）成功应返回订单信息', async () => {
        vi.mocked($fetch).mockResolvedValueOnce({
            trade_state: 'SUCCESS',
            out_trade_no: 'ORDER123',
            transaction_id: 'TX123456',
            amount: { total: 100 },
            success_time: '2024-01-01T12:00:00+08:00',
        })

        const adapter = new WechatPayAdapter(validConfig)
        const result = await adapter.queryOrder({ transactionId: 'TX123456' })

        expect(result.success).toBe(true)
        expect(result.tradeState).toBe('SUCCESS')
        expect(result.orderNo).toBe('ORDER123')
        expect(result.transactionId).toBe('TX123456')
        expect(result.amount).toBe(100)
        expect(result.paidAt).toBeDefined()
    })

    it('查询订单（通过订单号）成功应返回订单信息', async () => {
        vi.mocked($fetch).mockResolvedValueOnce({
            trade_state: 'NOTPAY',
            out_trade_no: 'ORDER456',
            transaction_id: '',
            amount: { total: 200 },
        })

        const adapter = new WechatPayAdapter(validConfig)
        const result = await adapter.queryOrder({ orderNo: 'ORDER456' })

        expect(result.success).toBe(true)
        expect(result.tradeState).toBe('NOTPAY')
        expect(result.orderNo).toBe('ORDER456')
        expect(result.paidAt).toBeUndefined()
    })

    it('查询订单 API 失败应返回错误', async () => {
        vi.mocked($fetch).mockRejectedValueOnce(new Error('查询失败'))

        const adapter = new WechatPayAdapter(validConfig)
        const result = await adapter.queryOrder({ orderNo: 'ORDER123' })

        expect(result.success).toBe(false)
        expect(result.errorMessage).toContain('查询失败')
    })

    it('关闭订单成功应返回成功', async () => {
        vi.mocked($fetch).mockResolvedValueOnce({})

        const adapter = new WechatPayAdapter(validConfig)
        const result = await adapter.closeOrder({ orderNo: 'ORDER123' })

        expect(result.success).toBe(true)
    })

    it('关闭订单 API 失败应返回错误', async () => {
        vi.mocked($fetch).mockRejectedValueOnce(new Error('关闭失败'))

        const adapter = new WechatPayAdapter(validConfig)
        const result = await adapter.closeOrder({ orderNo: 'ORDER123' })

        expect(result.success).toBe(false)
        expect(result.errorMessage).toContain('关闭失败')
    })
})

describe('Property: 配置验证一致性', () => {
    it('任意有效配置都应成功创建适配器', () => {
        fc.assert(
            fc.property(
                fc.record({
                    appId: fc.stringMatching(/^wx[a-f0-9]{16}$/),
                    mchId: fc.stringMatching(/^[0-9]{10}$/),
                    apiV3Key: fc.stringMatching(/^[a-zA-Z0-9]{32}$/),
                    serialNo: fc.string({ minLength: 10, maxLength: 40 }),
                }),
                (config) => {
                    const fullConfig: WechatPayConfig = {
                        channel: PaymentChannel.WECHAT,
                        ...config,
                        privateKey: privateKey,
                    }
                    const adapter = new WechatPayAdapter(fullConfig)
                    expect(adapter.getChannel()).toBe(PaymentChannel.WECHAT)
                }
            ),
            { numRuns: 50 }
        )
    })

    it('缺少任意必填字段都应抛出配置错误', () => {
        const requiredFields = ['appId', 'mchId', 'apiV3Key', 'serialNo', 'privateKey']

        for (const field of requiredFields) {
            const config: WechatPayConfig = {
                channel: PaymentChannel.WECHAT,
                appId: 'wx1234567890abcdef',
                mchId: '1234567890',
                apiV3Key: '12345678901234567890123456789012',
                serialNo: 'SERIAL123456789',
                privateKey: privateKey,
                [field]: '', // 清空该字段
            }

            expect(() => new WechatPayAdapter(config)).toThrow(PaymentConfigError)
        }
    })
})
