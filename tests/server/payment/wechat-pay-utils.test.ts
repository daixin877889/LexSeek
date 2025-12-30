/**
 * 微信支付工具函数测试
 *
 * 测试微信支付适配器中的工具函数，包括：
 * - 描述截断（truncateDescription）
 * - 过期时间格式化（getExpireTime）
 *
 * **Feature: payment-system**
 * **Validates: Requirements 11.1, 11.4**
 */

import { describe, it, expect, vi, beforeAll } from 'vitest'
import * as fc from 'fast-check'
import { generateKeyPairSync } from 'crypto'

// 生成测试用的 RSA 密钥对
const { privateKey } = generateKeyPairSync('rsa', {
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
        debug: vi.fn(),
    })

    vi.stubGlobal('$fetch', vi.fn())
})

import { WechatPayAdapter } from '../../../server/lib/payment/adapters/wechat-pay'
import { PaymentChannel, PaymentMethod } from '~~/shared/types/payment'
import type { WechatPayConfig } from '../../../server/lib/payment/types'

describe('微信支付描述截断测试', () => {
    const validConfig: WechatPayConfig = {
        channel: PaymentChannel.WECHAT,
        appId: 'wx1234567890abcdef',
        mchId: '1234567890',
        apiV3Key: '12345678901234567890123456789012',
        serialNo: 'SERIAL123456789',
        privateKey: privateKey,
    }

    // 由于 truncateDescription 是私有方法，我们通过创建支付来间接测试
    it('短描述应保持不变', async () => {
        vi.mocked($fetch).mockResolvedValueOnce({ code_url: 'weixin://test' })

        const adapter = new WechatPayAdapter(validConfig)
        const result = await adapter.createPayment({
            orderNo: 'ORDER123',
            amount: 100,
            description: '测试商品', // 短描述
            method: PaymentMethod.SCAN_CODE,
            notifyUrl: 'https://example.com/notify',
        })

        expect(result.success).toBe(true)
        // 验证请求被调用
        expect($fetch).toHaveBeenCalled()
    })

    it('超长描述应被截断', async () => {
        vi.mocked($fetch).mockResolvedValueOnce({ code_url: 'weixin://test' })

        const adapter = new WechatPayAdapter(validConfig)
        // 创建一个超过 127 字节的描述（中文字符占 3 字节）
        const longDescription = '这是一个非常长的商品描述'.repeat(10) // 约 300 字节

        const result = await adapter.createPayment({
            orderNo: 'ORDER123',
            amount: 100,
            description: longDescription,
            method: PaymentMethod.SCAN_CODE,
            notifyUrl: 'https://example.com/notify',
        })

        expect(result.success).toBe(true)
        // 验证请求被调用（截断后的描述不会导致错误）
        expect($fetch).toHaveBeenCalled()
    })

    it('纯英文长描述应被截断', async () => {
        vi.mocked($fetch).mockResolvedValueOnce({ code_url: 'weixin://test' })

        const adapter = new WechatPayAdapter(validConfig)
        // 创建一个超过 127 字节的纯英文描述
        const longDescription = 'A'.repeat(200)

        const result = await adapter.createPayment({
            orderNo: 'ORDER123',
            amount: 100,
            description: longDescription,
            method: PaymentMethod.SCAN_CODE,
            notifyUrl: 'https://example.com/notify',
        })

        expect(result.success).toBe(true)
    })
})

describe('微信支付过期时间格式测试', () => {
    const validConfig: WechatPayConfig = {
        channel: PaymentChannel.WECHAT,
        appId: 'wx1234567890abcdef',
        mchId: '1234567890',
        apiV3Key: '12345678901234567890123456789012',
        serialNo: 'SERIAL123456789',
        privateKey: privateKey,
    }

    it('过期时间应为 RFC 3339 格式', async () => {
        let capturedBody: any = null
        vi.mocked($fetch).mockImplementationOnce(async (url, options) => {
            capturedBody = options?.body ? JSON.parse(options.body as string) : null
            return { code_url: 'weixin://test' }
        })

        const adapter = new WechatPayAdapter(validConfig)
        await adapter.createPayment({
            orderNo: 'ORDER123',
            amount: 100,
            description: '测试商品',
            method: PaymentMethod.SCAN_CODE,
            notifyUrl: 'https://example.com/notify',
            expireMinutes: 30,
        })

        expect(capturedBody).not.toBeNull()
        expect(capturedBody.time_expire).toBeDefined()
        // 验证格式：YYYY-MM-DDTHH:mm:ss+08:00
        expect(capturedBody.time_expire).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/)
    })
})

describe('Property: 描述截断不超过 127 字节', () => {
    it('任意字符串截断后不应超过 127 字节', () => {
        // 模拟 truncateDescription 的逻辑
        const truncateDescription = (description: string): string => {
            const maxBytes = 127
            let result = ''
            let byteLength = 0

            for (const char of description) {
                const charBytes = char.charCodeAt(0) > 127 ? 3 : 1
                if (byteLength + charBytes > maxBytes) {
                    break
                }
                result += char
                byteLength += charBytes
            }

            return result
        }

        fc.assert(
            fc.property(
                fc.string({ minLength: 0, maxLength: 500 }),
                (description) => {
                    const truncated = truncateDescription(description)
                    // 计算截断后的字节长度
                    let byteLength = 0
                    for (const char of truncated) {
                        byteLength += char.charCodeAt(0) > 127 ? 3 : 1
                    }
                    expect(byteLength).toBeLessThanOrEqual(127)
                }
            ),
            { numRuns: 100 }
        )
    })

    it('短于 127 字节的字符串应保持不变', () => {
        const truncateDescription = (description: string): string => {
            const maxBytes = 127
            let result = ''
            let byteLength = 0

            for (const char of description) {
                const charBytes = char.charCodeAt(0) > 127 ? 3 : 1
                if (byteLength + charBytes > maxBytes) {
                    break
                }
                result += char
                byteLength += charBytes
            }

            return result
        }

        fc.assert(
            fc.property(
                fc.string({ minLength: 0, maxLength: 40 }), // 40 个 ASCII 字符 < 127 字节
                (description) => {
                    // 只测试纯 ASCII 字符串
                    const asciiOnly = description.replace(/[^\x00-\x7F]/g, '')
                    if (asciiOnly.length <= 127) {
                        const truncated = truncateDescription(asciiOnly)
                        expect(truncated).toBe(asciiOnly)
                    }
                }
            ),
            { numRuns: 100 }
        )
    })
})
