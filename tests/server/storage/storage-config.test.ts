/**
 * 存储配置属性测试
 *
 * 使用 fast-check 进行属性测试，验证配置验证完整性
 * Feature: storage-adapter
 * Property 6: 配置验证完整性
 * Validates: Requirements 6.3
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { StorageProviderType } from '../../../server/lib/storage/types'
import { StorageConfigError } from '../../../server/lib/storage/errors'

/**
 * 模拟配置验证逻辑
 * 与 storage-config.dao.ts 中的 validateStorageConfig 保持一致
 */
function validateStorageConfig(type: string, config: Record<string, unknown>): void {
    switch (type) {
        case StorageProviderType.ALIYUN_OSS:
            if (!config.accessKeyId || !config.accessKeySecret) {
                throw new StorageConfigError('阿里云 OSS 配置缺少 accessKeyId 或 accessKeySecret')
            }
            if (!config.bucket || !config.region) {
                throw new StorageConfigError('阿里云 OSS 配置缺少 bucket 或 region')
            }
            break
        case StorageProviderType.QINIU:
            if (!config.accessKey || !config.secretKey) {
                throw new StorageConfigError('七牛云配置缺少 accessKey 或 secretKey')
            }
            if (!config.bucket) {
                throw new StorageConfigError('七牛云配置缺少 bucket')
            }
            break
        case StorageProviderType.TENCENT_COS:
            if (!config.secretId || !config.secretKey) {
                throw new StorageConfigError('腾讯云 COS 配置缺少 secretId 或 secretKey')
            }
            if (!config.bucket || !config.region || !config.appId) {
                throw new StorageConfigError('腾讯云 COS 配置缺少 bucket、region 或 appId')
            }
            break
        default:
            throw new StorageConfigError(`不支持的存储类型: ${type}`)
    }
}

/**
 * 生成有效的阿里云配置
 */
const validAliyunConfigArb = fc.record({
    accessKeyId: fc.string({ minLength: 1 }),
    accessKeySecret: fc.string({ minLength: 1 }),
    bucket: fc.string({ minLength: 1 }),
    region: fc.string({ minLength: 1 })
})

/**
 * 生成有效的七牛云配置
 */
const validQiniuConfigArb = fc.record({
    accessKey: fc.string({ minLength: 1 }),
    secretKey: fc.string({ minLength: 1 }),
    bucket: fc.string({ minLength: 1 })
})

/**
 * 生成有效的腾讯云配置
 */
const validTencentConfigArb = fc.record({
    secretId: fc.string({ minLength: 1 }),
    secretKey: fc.string({ minLength: 1 }),
    bucket: fc.string({ minLength: 1 }),
    region: fc.string({ minLength: 1 }),
    appId: fc.string({ minLength: 1 })
})

describe('Property 6: 配置验证完整性', () => {
    describe('阿里云 OSS 配置验证', () => {
        it('有效配置不应抛出错误', () => {
            fc.assert(
                fc.property(
                    validAliyunConfigArb,
                    (config) => {
                        expect(() => validateStorageConfig(StorageProviderType.ALIYUN_OSS, config))
                            .not.toThrow()
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('缺少 accessKeyId 应抛出 StorageConfigError', () => {
            fc.assert(
                fc.property(
                    validAliyunConfigArb,
                    (config) => {
                        const invalidConfig = { ...config, accessKeyId: '' }
                        expect(() => validateStorageConfig(StorageProviderType.ALIYUN_OSS, invalidConfig))
                            .toThrow(StorageConfigError)
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
                        expect(() => validateStorageConfig(StorageProviderType.ALIYUN_OSS, invalidConfig))
                            .toThrow(StorageConfigError)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('缺少 bucket 应抛出 StorageConfigError', () => {
            fc.assert(
                fc.property(
                    validAliyunConfigArb,
                    (config) => {
                        const invalidConfig = { ...config, bucket: '' }
                        expect(() => validateStorageConfig(StorageProviderType.ALIYUN_OSS, invalidConfig))
                            .toThrow(StorageConfigError)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('缺少 region 应抛出 StorageConfigError', () => {
            fc.assert(
                fc.property(
                    validAliyunConfigArb,
                    (config) => {
                        const invalidConfig = { ...config, region: '' }
                        expect(() => validateStorageConfig(StorageProviderType.ALIYUN_OSS, invalidConfig))
                            .toThrow(StorageConfigError)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('七牛云配置验证', () => {
        it('有效配置不应抛出错误', () => {
            fc.assert(
                fc.property(
                    validQiniuConfigArb,
                    (config) => {
                        expect(() => validateStorageConfig(StorageProviderType.QINIU, config))
                            .not.toThrow()
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('缺少 accessKey 应抛出 StorageConfigError', () => {
            fc.assert(
                fc.property(
                    validQiniuConfigArb,
                    (config) => {
                        const invalidConfig = { ...config, accessKey: '' }
                        expect(() => validateStorageConfig(StorageProviderType.QINIU, invalidConfig))
                            .toThrow(StorageConfigError)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('缺少 secretKey 应抛出 StorageConfigError', () => {
            fc.assert(
                fc.property(
                    validQiniuConfigArb,
                    (config) => {
                        const invalidConfig = { ...config, secretKey: '' }
                        expect(() => validateStorageConfig(StorageProviderType.QINIU, invalidConfig))
                            .toThrow(StorageConfigError)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('缺少 bucket 应抛出 StorageConfigError', () => {
            fc.assert(
                fc.property(
                    validQiniuConfigArb,
                    (config) => {
                        const invalidConfig = { ...config, bucket: '' }
                        expect(() => validateStorageConfig(StorageProviderType.QINIU, invalidConfig))
                            .toThrow(StorageConfigError)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('腾讯云 COS 配置验证', () => {
        it('有效配置不应抛出错误', () => {
            fc.assert(
                fc.property(
                    validTencentConfigArb,
                    (config) => {
                        expect(() => validateStorageConfig(StorageProviderType.TENCENT_COS, config))
                            .not.toThrow()
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('缺少 secretId 应抛出 StorageConfigError', () => {
            fc.assert(
                fc.property(
                    validTencentConfigArb,
                    (config) => {
                        const invalidConfig = { ...config, secretId: '' }
                        expect(() => validateStorageConfig(StorageProviderType.TENCENT_COS, invalidConfig))
                            .toThrow(StorageConfigError)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('缺少 secretKey 应抛出 StorageConfigError', () => {
            fc.assert(
                fc.property(
                    validTencentConfigArb,
                    (config) => {
                        const invalidConfig = { ...config, secretKey: '' }
                        expect(() => validateStorageConfig(StorageProviderType.TENCENT_COS, invalidConfig))
                            .toThrow(StorageConfigError)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('缺少 bucket 应抛出 StorageConfigError', () => {
            fc.assert(
                fc.property(
                    validTencentConfigArb,
                    (config) => {
                        const invalidConfig = { ...config, bucket: '' }
                        expect(() => validateStorageConfig(StorageProviderType.TENCENT_COS, invalidConfig))
                            .toThrow(StorageConfigError)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('缺少 region 应抛出 StorageConfigError', () => {
            fc.assert(
                fc.property(
                    validTencentConfigArb,
                    (config) => {
                        const invalidConfig = { ...config, region: '' }
                        expect(() => validateStorageConfig(StorageProviderType.TENCENT_COS, invalidConfig))
                            .toThrow(StorageConfigError)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('缺少 appId 应抛出 StorageConfigError', () => {
            fc.assert(
                fc.property(
                    validTencentConfigArb,
                    (config) => {
                        const invalidConfig = { ...config, appId: '' }
                        expect(() => validateStorageConfig(StorageProviderType.TENCENT_COS, invalidConfig))
                            .toThrow(StorageConfigError)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('不支持的存储类型', () => {
        it('未知类型应抛出 StorageConfigError', () => {
            fc.assert(
                fc.property(
                    fc.string().filter(s => !['aliyun_oss', 'qiniu', 'tencent_cos'].includes(s)),
                    fc.object(),
                    (type, config) => {
                        expect(() => validateStorageConfig(type, config as Record<string, unknown>))
                            .toThrow(StorageConfigError)
                    }
                ),
                { numRuns: 50 }
            )
        })
    })
})
