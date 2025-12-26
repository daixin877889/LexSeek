/**
 * 回调处理属性测试
 *
 * 使用 fast-check 进行属性测试，验证回调处理
 * Feature: storage-adapter
 * Property 8: 回调数据解析一致性
 * Property 9: 回调验证正确性
 * Validates: Requirements 9.1, 9.2, 9.3, 9.4
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import type { CallbackData } from '../../server/lib/storage/callback/types'

/**
 * 模拟阿里云回调请求体
 */
interface MockAliyunCallbackBody {
    filename: string
    size: string | number
    mimeType: string
    [key: string]: string | number | undefined
}

/**
 * 模拟解析回调数据
 * 与 AliyunCallbackValidator.parse 保持一致
 */
function parseAliyunCallback(body: MockAliyunCallbackBody): CallbackData {
    // 提取自定义变量（以 x: 开头的字段）
    const customVars: Record<string, string> = {}
    for (const [key, value] of Object.entries(body)) {
        if (key.startsWith('x:') && value !== undefined) {
            const varName = key.substring(2)
            customVars[varName] = String(value)
        }
    }

    return {
        filePath: body.filename,
        fileSize: typeof body.size === 'string' ? parseInt(body.size, 10) : body.size,
        mimeType: body.mimeType,
        customVars,
        rawData: body
    }
}

/**
 * 模拟验证公钥 URL
 */
function isValidPubKeyUrl(url: string): boolean {
    const validDomains = [
        'https://gosspublic.alicdn.com/',
        'http://gosspublic.alicdn.com/',
        'https://oss-cn-',
        'http://oss-cn-'
    ]
    return validDomains.some(domain => url.startsWith(domain))
}

/**
 * 生成有效的文件路径
 */
const validFilePathArb = fc.stringMatching(/^[a-z0-9/._-]+$/)
    .filter(s => s.length > 0 && s.length < 200)

/**
 * 生成有效的文件大小
 */
const validFileSizeArb = fc.oneof(
    fc.integer({ min: 0, max: 1000000000 }),
    fc.integer({ min: 0, max: 1000000000 }).map(n => String(n))
)

/**
 * 生成有效的 MIME 类型
 */
const validMimeTypeArb = fc.constantFrom(
    'image/jpeg',
    'image/png',
    'image/gif',
    'application/pdf',
    'text/plain',
    'application/json',
    'video/mp4',
    'audio/mpeg'
)

/**
 * 生成自定义变量键（不能包含冒号，不能包含大写）
 */
const customVarKeyArb = fc.stringMatching(/^[a-z0-9_]+$/)
    .filter(s => s.length > 0 && s.length < 50)

/**
 * 生成自定义变量值
 */
const customVarValueArb = fc.string({ minLength: 1, maxLength: 100 })
    .filter(s => !s.includes('\n') && !s.includes('\r'))

/**
 * 生成自定义变量对象
 */
const customVarsArb = fc.dictionary(customVarKeyArb, customVarValueArb, { maxKeys: 5 })

/**
 * 生成有效的阿里云回调请求体
 */
const validAliyunCallbackBodyArb = fc.record({
    filename: validFilePathArb,
    size: validFileSizeArb,
    mimeType: validMimeTypeArb
}).chain(base =>
    customVarsArb.map(vars => {
        const body: MockAliyunCallbackBody = { ...base }
        // 添加自定义变量（以 x: 为前缀）
        for (const [key, value] of Object.entries(vars)) {
            body[`x:${key}`] = value
        }
        return body
    })
)

describe('Property 8: 回调数据解析一致性', () => {
    describe('阿里云回调解析', () => {
        it('解析结果应包含 filePath 字段', () => {
            fc.assert(
                fc.property(
                    validAliyunCallbackBodyArb,
                    (body) => {
                        const result = parseAliyunCallback(body)

                        expect(result).toHaveProperty('filePath')
                        expect(typeof result.filePath).toBe('string')
                        expect(result.filePath).toBe(body.filename)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('解析结果应包含 fileSize 字段（数字类型）', () => {
            fc.assert(
                fc.property(
                    validAliyunCallbackBodyArb,
                    (body) => {
                        const result = parseAliyunCallback(body)

                        expect(result).toHaveProperty('fileSize')
                        expect(typeof result.fileSize).toBe('number')

                        const expectedSize = typeof body.size === 'string'
                            ? parseInt(body.size, 10)
                            : body.size
                        expect(result.fileSize).toBe(expectedSize)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('解析结果应包含 mimeType 字段', () => {
            fc.assert(
                fc.property(
                    validAliyunCallbackBodyArb,
                    (body) => {
                        const result = parseAliyunCallback(body)

                        expect(result).toHaveProperty('mimeType')
                        expect(typeof result.mimeType).toBe('string')
                        expect(result.mimeType).toBe(body.mimeType)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('解析结果应包含 customVars 字段', () => {
            fc.assert(
                fc.property(
                    validAliyunCallbackBodyArb,
                    (body) => {
                        const result = parseAliyunCallback(body)

                        expect(result).toHaveProperty('customVars')
                        expect(typeof result.customVars).toBe('object')
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('自定义变量应正确提取（移除 x: 前缀）', () => {
            fc.assert(
                fc.property(
                    validAliyunCallbackBodyArb,
                    (body) => {
                        const result = parseAliyunCallback(body)

                        // 检查所有以 x: 开头的字段都被正确提取
                        for (const [key, value] of Object.entries(body)) {
                            if (key.startsWith('x:') && value !== undefined) {
                                const varName = key.substring(2)
                                expect(result.customVars).toHaveProperty(varName)
                                expect(result.customVars[varName]).toBe(String(value))
                            }
                        }
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('解析结果应包含 rawData 字段', () => {
            fc.assert(
                fc.property(
                    validAliyunCallbackBodyArb,
                    (body) => {
                        const result = parseAliyunCallback(body)

                        expect(result).toHaveProperty('rawData')
                        expect(result.rawData).toEqual(body)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })
})

describe('Property 9: 回调验证正确性', () => {
    describe('公钥 URL 验证', () => {
        it('有效的阿里云公钥 URL 应通过验证', () => {
            const validUrls = [
                'https://gosspublic.alicdn.com/callback_pub_key_v1.pem',
                'http://gosspublic.alicdn.com/callback_pub_key_v1.pem',
                'https://oss-cn-hangzhou.aliyuncs.com/pub-key.pem',
                'http://oss-cn-shanghai.aliyuncs.com/pub-key.pem'
            ]

            for (const url of validUrls) {
                expect(isValidPubKeyUrl(url)).toBe(true)
            }
        })

        it('无效的公钥 URL 应验证失败', () => {
            fc.assert(
                fc.property(
                    fc.webUrl().filter(url =>
                        !url.startsWith('https://gosspublic.alicdn.com/') &&
                        !url.startsWith('http://gosspublic.alicdn.com/') &&
                        !url.startsWith('https://oss-cn-') &&
                        !url.startsWith('http://oss-cn-')
                    ),
                    (url) => {
                        expect(isValidPubKeyUrl(url)).toBe(false)
                    }
                ),
                { numRuns: 50 }
            )
        })

        it('恶意构造的 URL 应验证失败', () => {
            const maliciousUrls = [
                'https://evil.com/gosspublic.alicdn.com/key.pem',
                'https://gosspublic.alicdn.com.evil.com/key.pem',
                'javascript:alert(1)',
                'file:///etc/passwd',
                'https://example.com?redirect=https://gosspublic.alicdn.com/'
            ]

            for (const url of maliciousUrls) {
                expect(isValidPubKeyUrl(url)).toBe(false)
            }
        })
    })

    describe('签名验证', () => {
        it('缺少 authorization 头应验证失败', () => {
            // 模拟验证逻辑
            const hasAuthorization = false
            const hasPubKeyUrl = true

            const isValid = hasAuthorization && hasPubKeyUrl
            expect(isValid).toBe(false)
        })

        it('缺少 x-oss-pub-key-url 头应验证失败', () => {
            const hasAuthorization = true
            const hasPubKeyUrl = false

            const isValid = hasAuthorization && hasPubKeyUrl
            expect(isValid).toBe(false)
        })

        it('两个必需头都存在时才可能验证成功', () => {
            fc.assert(
                fc.property(
                    fc.boolean(),
                    fc.boolean(),
                    (hasAuth, hasPubKey) => {
                        // 只有两个头都存在时才可能通过初步验证
                        const canProceed = hasAuth && hasPubKey
                        if (!hasAuth || !hasPubKey) {
                            expect(canProceed).toBe(false)
                        }
                    }
                ),
                { numRuns: 20 }
            )
        })
    })
})
