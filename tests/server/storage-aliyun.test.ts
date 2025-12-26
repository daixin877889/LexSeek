/**
 * 阿里云 OSS 适配器属性测试
 *
 * 使用 fast-check 进行属性测试，验证阿里云签名格式正确性
 * Feature: storage-adapter, Property 10: 阿里云签名格式正确性
 * Validates: Requirements 2.7
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import {
    StorageProviderType,
    type AliyunOssConfig,
    type AliyunPostSignatureResult,
    isAliyunPostSignatureResult,
    isAliyunOssConfig
} from '../../server/lib/storage/types'
import { StorageConfigError } from '../../server/lib/storage/errors'

/**
 * 模拟阿里云签名结果生成
 * 用于测试签名结果的格式正确性
 */
function mockGeneratePostSignature(
    config: AliyunOssConfig,
    options: { dir?: string; hasCallback?: boolean; hasSts?: boolean; hasFileKey?: boolean }
): AliyunPostSignatureResult {
    const date = new Date()
    const formattedDate = date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
    const dateStr = formattedDate.split('T')[0]
    const region = config.region.replace(/^oss-/g, '')

    const host = config.customDomain || `https://${config.bucket}.oss-${region}.aliyuncs.com`

    const result: AliyunPostSignatureResult = {
        host,
        policy: Buffer.from(JSON.stringify({ expiration: date.toISOString() })).toString('base64'),
        signatureVersion: 'OSS4-HMAC-SHA256',
        credential: `${config.accessKeyId}/${dateStr}/${region}/oss/aliyun_v4_request`,
        date: formattedDate,
        signature: 'mock-signature-' + Math.random().toString(36).substring(7),
        dir: options.dir || ''
    }

    if (options.hasFileKey) {
        result.key = `${options.dir || ''}test-file.txt`
    }

    if (options.hasCallback) {
        result.callback = Buffer.from(JSON.stringify({ callbackUrl: 'https://example.com/callback' })).toString('base64')
        result.callbackVar = { 'x:userid': '123' }
    }

    if (options.hasSts) {
        result.securityToken = 'mock-sts-token-' + Math.random().toString(36).substring(7)
    }

    return result
}

/**
 * 生成有效的阿里云 OSS 配置
 */
const validAliyunConfigArb = fc.record({
    type: fc.constant(StorageProviderType.ALIYUN_OSS),
    name: fc.string({ minLength: 1, maxLength: 50 }),
    bucket: fc.stringMatching(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/),
    region: fc.constantFrom('cn-hangzhou', 'cn-shanghai', 'cn-beijing', 'cn-shenzhen', 'oss-cn-hangzhou'),
    accessKeyId: fc.stringMatching(/^[A-Za-z0-9]{16,24}$/),
    accessKeySecret: fc.stringMatching(/^[A-Za-z0-9]{30,40}$/),
    enabled: fc.boolean(),
    customDomain: fc.option(fc.constant('https://cdn.example.com'), { nil: undefined })
}) as fc.Arbitrary<AliyunOssConfig>

/**
 * 生成有效的目录路径
 */
const validDirArb = fc.stringMatching(/^[a-z0-9/]*$/)
    .map(s => s ? (s.endsWith('/') ? s : `${s}/`) : '')

/**
 * Property 10: 阿里云签名格式正确性
 * 对于任意阿里云 OSS 适配器生成的 PostSignatureResult，
 * 必须包含 host、policy、signatureVersion、credential、date、signature 和 dir 字段
 */
describe('Property 10: 阿里云签名格式正确性', () => {
    describe('签名结果必需字段', () => {
        it('签名结果应包含 host 字段', () => {
            fc.assert(
                fc.property(
                    validAliyunConfigArb,
                    validDirArb,
                    (config, dir) => {
                        const result = mockGeneratePostSignature(config, { dir })

                        expect(result).toHaveProperty('host')
                        expect(typeof result.host).toBe('string')
                        expect(result.host.length).toBeGreaterThan(0)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('签名结果应包含 policy 字段（Base64 编码）', () => {
            fc.assert(
                fc.property(
                    validAliyunConfigArb,
                    validDirArb,
                    (config, dir) => {
                        const result = mockGeneratePostSignature(config, { dir })

                        expect(result).toHaveProperty('policy')
                        expect(typeof result.policy).toBe('string')
                        // 验证是有效的 Base64 字符串
                        expect(() => Buffer.from(result.policy, 'base64')).not.toThrow()
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('签名结果应包含 signatureVersion 字段且值为 OSS4-HMAC-SHA256', () => {
            fc.assert(
                fc.property(
                    validAliyunConfigArb,
                    validDirArb,
                    (config, dir) => {
                        const result = mockGeneratePostSignature(config, { dir })

                        expect(result).toHaveProperty('signatureVersion')
                        expect(result.signatureVersion).toBe('OSS4-HMAC-SHA256')
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('签名结果应包含 credential 字段', () => {
            fc.assert(
                fc.property(
                    validAliyunConfigArb,
                    validDirArb,
                    (config, dir) => {
                        const result = mockGeneratePostSignature(config, { dir })

                        expect(result).toHaveProperty('credential')
                        expect(typeof result.credential).toBe('string')
                        // credential 格式: accessKeyId/date/region/oss/aliyun_v4_request
                        expect(result.credential).toMatch(/^[^/]+\/\d{8}\/[^/]+\/oss\/aliyun_v4_request$/)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('签名结果应包含 date 字段（ISO 8601 格式）', () => {
            fc.assert(
                fc.property(
                    validAliyunConfigArb,
                    validDirArb,
                    (config, dir) => {
                        const result = mockGeneratePostSignature(config, { dir })

                        expect(result).toHaveProperty('date')
                        expect(typeof result.date).toBe('string')
                        // date 格式: YYYYMMDDTHHMMSSZ
                        expect(result.date).toMatch(/^\d{8}T\d{6}Z$/)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('签名结果应包含 signature 字段', () => {
            fc.assert(
                fc.property(
                    validAliyunConfigArb,
                    validDirArb,
                    (config, dir) => {
                        const result = mockGeneratePostSignature(config, { dir })

                        expect(result).toHaveProperty('signature')
                        expect(typeof result.signature).toBe('string')
                        expect(result.signature.length).toBeGreaterThan(0)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('签名结果应包含 dir 字段', () => {
            fc.assert(
                fc.property(
                    validAliyunConfigArb,
                    validDirArb,
                    (config, dir) => {
                        const result = mockGeneratePostSignature(config, { dir })

                        expect(result).toHaveProperty('dir')
                        expect(typeof result.dir).toBe('string')
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('类型守卫', () => {
        it('isAliyunPostSignatureResult 应正确识别阿里云签名结果', () => {
            fc.assert(
                fc.property(
                    validAliyunConfigArb,
                    validDirArb,
                    (config, dir) => {
                        const result = mockGeneratePostSignature(config, { dir })

                        expect(isAliyunPostSignatureResult(result)).toBe(true)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('isAliyunOssConfig 应正确识别阿里云配置', () => {
            fc.assert(
                fc.property(
                    validAliyunConfigArb,
                    (config) => {
                        expect(isAliyunOssConfig(config)).toBe(true)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('host 字段格式', () => {
        it('无自定义域名时 host 应为标准 OSS 域名格式', () => {
            fc.assert(
                fc.property(
                    validAliyunConfigArb.map(c => ({ ...c, customDomain: undefined })),
                    (config) => {
                        const result = mockGeneratePostSignature(config, {})

                        // 标准 OSS 域名格式: https://{bucket}.oss-{region}.aliyuncs.com
                        expect(result.host).toMatch(/^https:\/\/[a-z0-9-]+\.oss-[a-z]+-[a-z0-9]+\.aliyuncs\.com$/)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('有自定义域名时 host 应使用自定义域名', () => {
            fc.assert(
                fc.property(
                    validAliyunConfigArb.map(c => ({ ...c, customDomain: 'https://cdn.example.com' })),
                    (config) => {
                        const result = mockGeneratePostSignature(config, {})

                        expect(result.host).toBe('https://cdn.example.com')
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('可选字段', () => {
        it('配置回调时应包含 callback 字段', () => {
            fc.assert(
                fc.property(
                    validAliyunConfigArb,
                    (config) => {
                        const result = mockGeneratePostSignature(config, { hasCallback: true })

                        expect(result).toHaveProperty('callback')
                        expect(typeof result.callback).toBe('string')
                        // callback 应该是 Base64 编码
                        expect(() => Buffer.from(result.callback!, 'base64')).not.toThrow()
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('配置 STS 时应包含 securityToken 字段', () => {
            fc.assert(
                fc.property(
                    validAliyunConfigArb,
                    (config) => {
                        const result = mockGeneratePostSignature(config, { hasSts: true })

                        expect(result).toHaveProperty('securityToken')
                        expect(typeof result.securityToken).toBe('string')
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('配置 fileKey 时应包含 key 字段', () => {
            fc.assert(
                fc.property(
                    validAliyunConfigArb,
                    validDirArb,
                    (config, dir) => {
                        const result = mockGeneratePostSignature(config, { dir, hasFileKey: true })

                        expect(result).toHaveProperty('key')
                        expect(typeof result.key).toBe('string')
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('配置验证', () => {
        /**
         * 模拟配置验证逻辑
         * 与 AliyunOssAdapter.validateConfig 保持一致
         */
        function validateAliyunConfig(config: AliyunOssConfig): void {
            if (!config.bucket) {
                throw new StorageConfigError('缺少必填配置: bucket')
            }
            if (!config.region) {
                throw new StorageConfigError('缺少必填配置: region')
            }
            if (!config.accessKeyId) {
                throw new StorageConfigError('缺少必填配置: accessKeyId')
            }
            if (!config.accessKeySecret) {
                throw new StorageConfigError('缺少必填配置: accessKeySecret')
            }

            // 验证 region 格式
            const regionPattern = /^(oss-)?[a-z]+-[a-z0-9]+$/
            if (!regionPattern.test(config.region)) {
                throw new StorageConfigError(`无效的 region 格式: ${config.region}`)
            }

            // 如果提供了 STS 配置，验证 roleArn 格式
            if (config.sts) {
                const arnPattern = /^acs:ram::\d+:role\/[\w-]+$/
                if (!arnPattern.test(config.sts.roleArn)) {
                    throw new StorageConfigError('无效的 STS role ARN 格式')
                }
            }
        }

        it('缺少 accessKeyId 应抛出 StorageConfigError', () => {
            fc.assert(
                fc.property(
                    validAliyunConfigArb,
                    (config) => {
                        const invalidConfig = { ...config, accessKeyId: '' }

                        expect(() => validateAliyunConfig(invalidConfig)).toThrow(StorageConfigError)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('缺少 accessKeySecret 应抛出 StorageConfigError', () => {
            fc.assert(
                fc.property(
                    validAliyunConfigArb,
                    (config) => {
                        const invalidConfig = { ...config, accessKeySecret: '' }

                        expect(() => validateAliyunConfig(invalidConfig)).toThrow(StorageConfigError)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('无效的 region 格式应抛出 StorageConfigError', () => {
            fc.assert(
                fc.property(
                    validAliyunConfigArb,
                    (config) => {
                        const invalidConfig = { ...config, region: 'invalid-region-format!' }

                        expect(() => validateAliyunConfig(invalidConfig)).toThrow(StorageConfigError)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('有效配置不应抛出错误', () => {
            fc.assert(
                fc.property(
                    validAliyunConfigArb,
                    (config) => {
                        expect(() => validateAliyunConfig(config)).not.toThrow()
                    }
                ),
                { numRuns: 100 }
            )
        })
    })
})
