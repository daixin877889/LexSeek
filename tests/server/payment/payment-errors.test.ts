/**
 * 支付错误类测试
 *
 * 测试支付模块的错误类定义和行为
 *
 * **Feature: payment-system**
 * **Validates: Requirements 11.1**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import {
    PaymentError,
    PaymentConfigError,
    PaymentSignatureError,
    PaymentRequestError,
    PaymentCallbackError,
    PaymentOrderNotFoundError,
    PaymentMethodNotSupportedError,
} from '../../../server/lib/payment/errors'

describe('PaymentError 基类', () => {
    it('应正确设置错误属性', () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 1, maxLength: 100 }),
                fc.string({ minLength: 1, maxLength: 20 }),
                (message, code) => {
                    const error = new PaymentError(message, code)

                    expect(error.message).toBe(message)
                    expect(error.code).toBe(code)
                    expect(error.name).toBe('PaymentError')
                    expect(error.cause).toBeUndefined()
                    expect(error instanceof Error).toBe(true)
                }
            ),
            { numRuns: 100 }
        )
    })

    it('应正确设置原因错误', () => {
        const cause = new Error('原始错误')
        const error = new PaymentError('支付错误', 'PAY_ERROR', cause)

        expect(error.cause).toBe(cause)
    })
})

describe('PaymentConfigError 配置错误', () => {
    it('应正确设置错误码为 CONFIG_ERROR', () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 1, maxLength: 100 }),
                (message) => {
                    const error = new PaymentConfigError(message)

                    expect(error.message).toBe(message)
                    expect(error.code).toBe('CONFIG_ERROR')
                    expect(error.name).toBe('PaymentConfigError')
                    expect(error instanceof PaymentError).toBe(true)
                }
            ),
            { numRuns: 100 }
        )
    })

    it('应支持原因错误', () => {
        const cause = new Error('配置解析失败')
        const error = new PaymentConfigError('配置错误', cause)

        expect(error.cause).toBe(cause)
    })
})

describe('PaymentSignatureError 签名错误', () => {
    it('应正确设置错误码为 SIGNATURE_ERROR', () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 1, maxLength: 100 }),
                (message) => {
                    const error = new PaymentSignatureError(message)

                    expect(error.message).toBe(message)
                    expect(error.code).toBe('SIGNATURE_ERROR')
                    expect(error.name).toBe('PaymentSignatureError')
                    expect(error instanceof PaymentError).toBe(true)
                }
            ),
            { numRuns: 100 }
        )
    })
})

describe('PaymentRequestError 请求错误', () => {
    it('应正确设置错误码为 REQUEST_ERROR', () => {
        const error = new PaymentRequestError('请求失败')

        expect(error.code).toBe('REQUEST_ERROR')
        expect(error.name).toBe('PaymentRequestError')
        expect(error.statusCode).toBeUndefined()
        expect(error.response).toBeUndefined()
    })

    it('应正确设置 HTTP 状态码和响应', () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 1, maxLength: 100 }),
                fc.integer({ min: 400, max: 599 }),
                fc.record({
                    error: fc.string(),
                    message: fc.string(),
                }),
                (message, statusCode, response) => {
                    const error = new PaymentRequestError(message, statusCode, response)

                    expect(error.message).toBe(message)
                    expect(error.statusCode).toBe(statusCode)
                    expect(error.response).toEqual(response)
                }
            ),
            { numRuns: 100 }
        )
    })
})

describe('PaymentCallbackError 回调错误', () => {
    it('应正确设置错误码为 CALLBACK_ERROR', () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 1, maxLength: 100 }),
                (message) => {
                    const error = new PaymentCallbackError(message)

                    expect(error.message).toBe(message)
                    expect(error.code).toBe('CALLBACK_ERROR')
                    expect(error.name).toBe('PaymentCallbackError')
                    expect(error instanceof PaymentError).toBe(true)
                }
            ),
            { numRuns: 100 }
        )
    })
})

describe('PaymentOrderNotFoundError 订单不存在错误', () => {
    it('应正确设置错误码为 ORDER_NOT_FOUND', () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 10, maxLength: 32 }),
                (orderNo) => {
                    const error = new PaymentOrderNotFoundError(orderNo)

                    expect(error.message).toBe(`订单不存在: ${orderNo}`)
                    expect(error.code).toBe('ORDER_NOT_FOUND')
                    expect(error.name).toBe('PaymentOrderNotFoundError')
                    expect(error instanceof PaymentError).toBe(true)
                }
            ),
            { numRuns: 100 }
        )
    })
})

describe('PaymentMethodNotSupportedError 不支持的支付方式错误', () => {
    it('应正确设置错误码为 METHOD_NOT_SUPPORTED', () => {
        fc.assert(
            fc.property(
                fc.constantFrom('unknown', 'bitcoin', 'paypal', 'stripe'),
                (method) => {
                    const error = new PaymentMethodNotSupportedError(method)

                    expect(error.message).toBe(`不支持的支付方式: ${method}`)
                    expect(error.code).toBe('METHOD_NOT_SUPPORTED')
                    expect(error.name).toBe('PaymentMethodNotSupportedError')
                    expect(error instanceof PaymentError).toBe(true)
                }
            ),
            { numRuns: 50 }
        )
    })
})

describe('Property: 错误继承链正确性', () => {
    it('所有支付错误都应继承自 PaymentError', () => {
        const errors = [
            new PaymentConfigError('配置错误'),
            new PaymentSignatureError('签名错误'),
            new PaymentRequestError('请求错误'),
            new PaymentCallbackError('回调错误'),
            new PaymentOrderNotFoundError('ORDER123'),
            new PaymentMethodNotSupportedError('unknown'),
        ]

        for (const error of errors) {
            expect(error instanceof PaymentError).toBe(true)
            expect(error instanceof Error).toBe(true)
        }
    })

    it('所有支付错误都应有 code 属性', () => {
        const errors = [
            new PaymentConfigError('配置错误'),
            new PaymentSignatureError('签名错误'),
            new PaymentRequestError('请求错误'),
            new PaymentCallbackError('回调错误'),
            new PaymentOrderNotFoundError('ORDER123'),
            new PaymentMethodNotSupportedError('unknown'),
        ]

        for (const error of errors) {
            expect(typeof error.code).toBe('string')
            expect(error.code.length).toBeGreaterThan(0)
        }
    })
})
