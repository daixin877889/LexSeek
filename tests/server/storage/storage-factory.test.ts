/**
 * 存储适配器工厂属性测试
 *
 * 使用 fast-check 进行属性测试，验证工厂适配器创建和缓存
 * Feature: storage-adapter
 * Property 4: 工厂适配器创建
 * Property 5: 适配器缓存一致性
 * Validates: Requirements 5.1, 5.4
 */

import { describe, it, expect, beforeEach } from 'vitest'
import * as fc from 'fast-check'
import {
    StorageProviderType,
    type StorageConfig,
    type AliyunOssConfig,
    type StorageAdapter
} from '../../../server/lib/storage/types'
import { StorageConfigError } from '../../../server/lib/storage/errors'
import { StorageFactory } from '../../../server/lib/storage/factory'

/**
 * 生成有效的阿里云 OSS 配置
 */
const validAliyunConfigArb = fc.record({
    id: fc.option(fc.integer({ min: 1, max: 10000 }), { nil: undefined }),
    type: fc.constant(StorageProviderType.ALIYUN_OSS),
    name: fc.string({ minLength: 1, maxLength: 50 }),
    bucket: fc.stringMatching(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/),
    region: fc.constantFrom('cn-hangzhou', 'cn-shanghai', 'cn-beijing', 'cn-shenzhen'),
    accessKeyId: fc.stringMatching(/^[A-Za-z0-9]{16,24}$/),
    accessKeySecret: fc.stringMatching(/^[A-Za-z0-9]{30,40}$/),
    enabled: fc.boolean(),
    customDomain: fc.option(fc.constant('https://cdn.example.com'), { nil: undefined })
}) as fc.Arbitrary<AliyunOssConfig>

/**
 * 生成不同的配置 ID
 */
const differentConfigIdsArb = fc.tuple(
    fc.integer({ min: 1, max: 5000 }),
    fc.integer({ min: 5001, max: 10000 })
)

describe('Property 4: 工厂适配器创建', () => {
    beforeEach(() => {
        // 每个测试前清除缓存
        StorageFactory.clearCache()
    })

    describe('适配器类型匹配', () => {
        it('阿里云配置应返回阿里云适配器', () => {
            fc.assert(
                fc.property(
                    validAliyunConfigArb,
                    (config) => {
                        StorageFactory.clearCache()
                        const adapter = StorageFactory.getAdapter(config)

                        expect(adapter).toBeDefined()
                        expect(adapter.type).toBe(StorageProviderType.ALIYUN_OSS)
                    }
                ),
                { numRuns: 50 }
            )
        })

        it('适配器应实现 StorageAdapter 接口', () => {
            fc.assert(
                fc.property(
                    validAliyunConfigArb,
                    (config) => {
                        StorageFactory.clearCache()
                        const adapter = StorageFactory.getAdapter(config)

                        // 验证适配器实现了所有必需方法
                        expect(typeof adapter.upload).toBe('function')
                        expect(typeof adapter.download).toBe('function')
                        expect(typeof adapter.downloadStream).toBe('function')
                        expect(typeof adapter.delete).toBe('function')
                        expect(typeof adapter.generateSignedUrl).toBe('function')
                        expect(typeof adapter.generatePostSignature).toBe('function')
                        expect(typeof adapter.testConnection).toBe('function')
                    }
                ),
                { numRuns: 50 }
            )
        })
    })

    describe('不支持的配置类型', () => {
        it('七牛云适配器应能创建但方法调用会抛出错误', () => {
            const qiniuConfig = {
                type: StorageProviderType.QINIU,
                name: 'test-qiniu',
                bucket: 'test-bucket',
                region: 'z0',
                accessKey: 'test-access-key',
                secretKey: 'test-secret-key',
                enabled: true
            }

            // 适配器可以创建
            const adapter = StorageFactory.getAdapter(qiniuConfig as StorageConfig)
            expect(adapter).toBeDefined()
            expect(adapter.type).toBe(StorageProviderType.QINIU)

            // 但方法调用会抛出错误（尚未实现）
            expect(adapter.testConnection()).rejects.toThrow(StorageConfigError)
        })

        it('腾讯云适配器应能创建但方法调用会抛出错误', () => {
            const tencentConfig = {
                type: StorageProviderType.TENCENT_COS,
                name: 'test-tencent',
                bucket: 'test-bucket',
                region: 'ap-guangzhou',
                secretId: 'test-secret-id',
                secretKey: 'test-secret-key',
                appId: '1234567890',
                enabled: true
            }

            // 适配器可以创建
            const adapter = StorageFactory.getAdapter(tencentConfig as StorageConfig)
            expect(adapter).toBeDefined()
            expect(adapter.type).toBe(StorageProviderType.TENCENT_COS)

            // 但方法调用会抛出错误（尚未实现）
            expect(adapter.testConnection()).rejects.toThrow(StorageConfigError)
        })
    })
})

describe('Property 5: 适配器缓存一致性', () => {
    beforeEach(() => {
        StorageFactory.clearCache()
    })

    describe('相同配置返回相同实例', () => {
        it('多次调用 getAdapter 应返回相同实例（引用相等）', () => {
            fc.assert(
                fc.property(
                    validAliyunConfigArb,
                    (config) => {
                        StorageFactory.clearCache()

                        const adapter1 = StorageFactory.getAdapter(config)
                        const adapter2 = StorageFactory.getAdapter(config)
                        const adapter3 = StorageFactory.getAdapter(config)

                        // 验证引用相等
                        expect(adapter1).toBe(adapter2)
                        expect(adapter2).toBe(adapter3)
                    }
                ),
                { numRuns: 50 }
            )
        })

        it('带 ID 的配置应正确缓存', () => {
            fc.assert(
                fc.property(
                    validAliyunConfigArb.map(c => ({ ...c, id: 123 })),
                    (config) => {
                        StorageFactory.clearCache()

                        const adapter1 = StorageFactory.getAdapter(config)
                        const adapter2 = StorageFactory.getAdapter(config)

                        expect(adapter1).toBe(adapter2)
                        expect(StorageFactory.isCached(config)).toBe(true)
                    }
                ),
                { numRuns: 50 }
            )
        })
    })

    describe('不同配置返回不同实例', () => {
        it('不同 ID 的配置应返回不同实例', () => {
            fc.assert(
                fc.property(
                    validAliyunConfigArb,
                    differentConfigIdsArb,
                    (baseConfig, [id1, id2]) => {
                        StorageFactory.clearCache()

                        const config1 = { ...baseConfig, id: id1 }
                        const config2 = { ...baseConfig, id: id2 }

                        const adapter1 = StorageFactory.getAdapter(config1)
                        const adapter2 = StorageFactory.getAdapter(config2)

                        // 不同 ID 应该是不同实例
                        expect(adapter1).not.toBe(adapter2)
                    }
                ),
                { numRuns: 50 }
            )
        })

        it('不同 bucket 的配置应返回不同实例', () => {
            fc.assert(
                fc.property(
                    validAliyunConfigArb,
                    fc.stringMatching(/^[a-z0-9][a-z0-9-]{1,10}[a-z0-9]$/),
                    (config, bucket2) => {
                        StorageFactory.clearCache()

                        // 确保两个 bucket 不同
                        const bucket1 = config.bucket
                        if (bucket1 === bucket2) return true // 跳过相同的情况

                        const config1 = { ...config, id: undefined }
                        const config2 = { ...config, id: undefined, bucket: bucket2 }

                        const adapter1 = StorageFactory.getAdapter(config1)
                        const adapter2 = StorageFactory.getAdapter(config2)

                        expect(adapter1).not.toBe(adapter2)
                    }
                ),
                { numRuns: 50 }
            )
        })
    })

    describe('缓存管理', () => {
        it('clearCache 应清除所有缓存', () => {
            fc.assert(
                fc.property(
                    validAliyunConfigArb,
                    (config) => {
                        StorageFactory.clearCache()

                        // 创建适配器
                        StorageFactory.getAdapter(config)
                        expect(StorageFactory.getCacheSize()).toBeGreaterThan(0)

                        // 清除缓存
                        StorageFactory.clearCache()
                        expect(StorageFactory.getCacheSize()).toBe(0)
                    }
                ),
                { numRuns: 20 }
            )
        })

        it('clearCacheByConfigId 应只清除指定配置的缓存', () => {
            fc.assert(
                fc.property(
                    validAliyunConfigArb,
                    differentConfigIdsArb,
                    (baseConfig, [id1, id2]) => {
                        StorageFactory.clearCache()

                        // 确保配置有 ID
                        const config1 = { ...baseConfig, id: id1 }
                        const config2 = { ...baseConfig, id: id2, bucket: baseConfig.bucket + '2' }

                        // 创建两个适配器
                        StorageFactory.getAdapter(config1)
                        StorageFactory.getAdapter(config2)
                        expect(StorageFactory.getCacheSize()).toBe(2)

                        // 清除第一个配置的缓存
                        StorageFactory.clearCacheByConfigId(id1)

                        // 第一个应该被清除，第二个应该还在
                        expect(StorageFactory.isCached(config1)).toBe(false)
                        expect(StorageFactory.isCached(config2)).toBe(true)
                    }
                ),
                { numRuns: 20 }
            )
        })

        it('isCached 应正确报告缓存状态', () => {
            fc.assert(
                fc.property(
                    validAliyunConfigArb,
                    (config) => {
                        StorageFactory.clearCache()

                        // 初始状态应该未缓存
                        expect(StorageFactory.isCached(config)).toBe(false)

                        // 获取适配器后应该已缓存
                        StorageFactory.getAdapter(config)
                        expect(StorageFactory.isCached(config)).toBe(true)

                        // 清除后应该未缓存
                        StorageFactory.clearCache()
                        expect(StorageFactory.isCached(config)).toBe(false)
                    }
                ),
                { numRuns: 20 }
            )
        })
    })
})

describe('自定义适配器注册', () => {
    beforeEach(() => {
        StorageFactory.clearCache()
    })

    it('注册的自定义适配器应优先于内置适配器', () => {
        // 创建一个模拟的自定义适配器类
        class MockAdapter implements StorageAdapter {
            readonly type = StorageProviderType.ALIYUN_OSS
            readonly config: StorageConfig

            constructor(config: StorageConfig) {
                this.config = config
            }

            async upload() { return { name: 'mock', etag: 'mock', url: 'mock' } }
            async download() { return Buffer.from('mock') }
            async downloadStream() { return null as any }
            async delete() { return { deleted: [] } }
            async generateSignedUrl() { return 'mock-url' }
            async generatePostSignature() { return {} as any }
            async testConnection() { return true }
        }

        // 注册自定义适配器
        StorageFactory.registerAdapter(StorageProviderType.ALIYUN_OSS, MockAdapter as any)

        const config: AliyunOssConfig = {
            type: StorageProviderType.ALIYUN_OSS,
            name: 'test',
            bucket: 'test-bucket',
            region: 'cn-hangzhou',
            accessKeyId: 'test-key-id-12345678',
            accessKeySecret: 'test-key-secret-123456789012345678901234',
            enabled: true
        }

        const adapter = StorageFactory.getAdapter(config)

        // 应该是自定义适配器的实例
        expect(adapter).toBeInstanceOf(MockAdapter)

        // 清理：取消注册
        StorageFactory.unregisterAdapter(StorageProviderType.ALIYUN_OSS)
    })

    it('取消注册后应使用内置适配器', () => {
        class MockAdapter implements StorageAdapter {
            readonly type = StorageProviderType.ALIYUN_OSS
            constructor(_config: StorageConfig) { }
            async upload() { return { name: 'mock', etag: 'mock', url: 'mock' } }
            async download() { return Buffer.from('mock') }
            async downloadStream() { return null as any }
            async delete() { return { deleted: [] } }
            async generateSignedUrl() { return 'mock-url' }
            async generatePostSignature() { return {} as any }
            async testConnection() { return true }
        }

        // 注册然后取消注册
        StorageFactory.registerAdapter(StorageProviderType.ALIYUN_OSS, MockAdapter as any)
        StorageFactory.unregisterAdapter(StorageProviderType.ALIYUN_OSS)
        StorageFactory.clearCache()

        const config: AliyunOssConfig = {
            type: StorageProviderType.ALIYUN_OSS,
            name: 'test',
            bucket: 'test-bucket',
            region: 'cn-hangzhou',
            accessKeyId: 'test-key-id-12345678',
            accessKeySecret: 'test-key-secret-123456789012345678901234',
            enabled: true
        }

        const adapter = StorageFactory.getAdapter(config)

        // 应该不是 MockAdapter 的实例
        expect(adapter).not.toBeInstanceOf(MockAdapter)
        expect(adapter.type).toBe(StorageProviderType.ALIYUN_OSS)
    })
})


describe('类型守卫函数', () => {
    it('isQiniuPostSignatureResult 应正确识别七牛云签名结果', async () => {
        const { isQiniuPostSignatureResult } = await import('../../../server/lib/storage/types')

        const qiniuResult = {
            host: 'https://up.qiniup.com',
            dir: 'test/',
            uploadToken: 'test-token'
        }

        const aliyunResult = {
            host: 'https://bucket.oss-cn-hangzhou.aliyuncs.com',
            dir: 'test/',
            policy: 'base64-policy',
            signatureVersion: 'OSS4-HMAC-SHA256',
            credential: 'test-credential',
            date: '20231201T000000Z',
            signature: 'test-signature'
        }

        expect(isQiniuPostSignatureResult(qiniuResult)).toBe(true)
        expect(isQiniuPostSignatureResult(aliyunResult)).toBe(false)
    })

    it('isTencentPostSignatureResult 应正确识别腾讯云签名结果', async () => {
        const { isTencentPostSignatureResult } = await import('../../../server/lib/storage/types')

        const tencentResult = {
            host: 'https://bucket.cos.ap-guangzhou.myqcloud.com',
            dir: 'test/',
            tmpSecretId: 'test-secret-id',
            tmpSecretKey: 'test-secret-key',
            sessionToken: 'test-session-token',
            startTime: 1701388800,
            expiredTime: 1701392400
        }

        const aliyunResult = {
            host: 'https://bucket.oss-cn-hangzhou.aliyuncs.com',
            dir: 'test/',
            policy: 'base64-policy',
            signatureVersion: 'OSS4-HMAC-SHA256'
        }

        expect(isTencentPostSignatureResult(tencentResult)).toBe(true)
        expect(isTencentPostSignatureResult(aliyunResult)).toBe(false)
    })
})

describe('工厂错误处理', () => {
    beforeEach(() => {
        StorageFactory.clearCache()
    })

    it('不支持的存储类型应抛出 StorageConfigError', () => {
        const invalidConfig = {
            type: 'invalid_type' as any,
            name: 'test',
            bucket: 'test-bucket',
            region: 'test-region',
            enabled: true
        }

        expect(() => {
            StorageFactory.getAdapter(invalidConfig as StorageConfig)
        }).toThrow(StorageConfigError)
    })

    it('clearCache 应支持指定 key 清除', () => {
        const config1: AliyunOssConfig = {
            type: StorageProviderType.ALIYUN_OSS,
            name: 'test1',
            bucket: 'bucket1',
            region: 'cn-hangzhou',
            accessKeyId: 'test-key-id-12345678',
            accessKeySecret: 'test-key-secret-123456789012345678901234',
            enabled: true
        }

        const config2: AliyunOssConfig = {
            type: StorageProviderType.ALIYUN_OSS,
            name: 'test2',
            bucket: 'bucket2',
            region: 'cn-shanghai',
            accessKeyId: 'test-key-id-12345678',
            accessKeySecret: 'test-key-secret-123456789012345678901234',
            enabled: true
        }

        // 创建两个适配器
        StorageFactory.getAdapter(config1)
        StorageFactory.getAdapter(config2)
        expect(StorageFactory.getCacheSize()).toBe(2)

        // 清除指定 key
        StorageFactory.clearCache('aliyun_oss:bucket1:cn-hangzhou')
        expect(StorageFactory.getCacheSize()).toBe(1)
        expect(StorageFactory.isCached(config1)).toBe(false)
        expect(StorageFactory.isCached(config2)).toBe(true)
    })
})
