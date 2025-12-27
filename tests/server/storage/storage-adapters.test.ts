/**
 * 存储适配器测试
 *
 * 测试各云服务商存储适配器的配置验证和基本功能
 *
 * **Feature: storage-system**
 * **Validates: Requirements 10.5**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { AliyunOssAdapter } from '../../../server/lib/storage/adapters/aliyun-oss'
import { QiniuAdapter } from '../../../server/lib/storage/adapters/qiniu'
import { TencentCosAdapter } from '../../../server/lib/storage/adapters/tencent-cos'
import { StorageConfigError } from '../../../server/lib/storage/errors'
import type { AliyunOssConfig, QiniuConfig, TencentCosConfig } from '../../../server/lib/storage/types'

describe('AliyunOssAdapter 配置验证', () => {
    // 有效的阿里云 OSS 配置
    const validConfig: AliyunOssConfig = {
        type: 'aliyun_oss' as any,
        name: 'test-config',
        enabled: true,
        accessKeyId: 'LTAI5tKjkmxxxxxxxx',
        accessKeySecret: 'xxxxxxxxxxxxxxxxxxxxxxxx',
        bucket: 'test-bucket',
        region: 'oss-cn-hangzhou'
    }

    it('有效配置应成功创建适配器', () => {
        const adapter = new AliyunOssAdapter(validConfig)
        expect(adapter.type).toBe('aliyun_oss')
    })

    it('缺少 bucket 应抛出配置错误', () => {
        const config = { ...validConfig, bucket: '' }
        expect(() => new AliyunOssAdapter(config)).toThrow(StorageConfigError)
        expect(() => new AliyunOssAdapter(config)).toThrow('缺少必填配置: bucket')
    })

    it('缺少 region 应抛出配置错误', () => {
        const config = { ...validConfig, region: '' }
        expect(() => new AliyunOssAdapter(config)).toThrow(StorageConfigError)
        expect(() => new AliyunOssAdapter(config)).toThrow('缺少必填配置: region')
    })

    it('缺少 accessKeyId 应抛出配置错误', () => {
        const config = { ...validConfig, accessKeyId: '' }
        expect(() => new AliyunOssAdapter(config)).toThrow(StorageConfigError)
        expect(() => new AliyunOssAdapter(config)).toThrow('缺少必填配置: accessKeyId')
    })

    it('缺少 accessKeySecret 应抛出配置错误', () => {
        const config = { ...validConfig, accessKeySecret: '' }
        expect(() => new AliyunOssAdapter(config)).toThrow(StorageConfigError)
        expect(() => new AliyunOssAdapter(config)).toThrow('缺少必填配置: accessKeySecret')
    })

    it('无效的 region 格式应抛出配置错误', () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 1, maxLength: 20 })
                    .filter(s => !/^(oss-)?[a-z]+-[a-z0-9]+$/.test(s)),
                (invalidRegion) => {
                    const config = { ...validConfig, region: invalidRegion }
                    expect(() => new AliyunOssAdapter(config)).toThrow(StorageConfigError)
                    expect(() => new AliyunOssAdapter(config)).toThrow('无效的 region 格式')
                    return true
                }
            ),
            { numRuns: 50 }
        )
    })

    it('有效的 region 格式应通过验证', () => {
        // 阿里云 OSS region 格式：(oss-)?[a-z]+-[a-z0-9]+
        // 例如：oss-cn-hangzhou, cn-hangzhou
        const validRegions = [
            'oss-cn-hangzhou',
            'oss-cn-shanghai',
            'oss-cn-beijing',
            'cn-hangzhou',
            'cn-shanghai'
        ]

        for (const region of validRegions) {
            const config = { ...validConfig, region }
            expect(() => new AliyunOssAdapter(config)).not.toThrow()
        }
    })

    it('无效的 STS roleArn 格式应抛出配置错误', () => {
        const config: AliyunOssConfig = {
            ...validConfig,
            sts: {
                roleArn: 'invalid-arn',
                roleSessionName: 'test'
            }
        }
        expect(() => new AliyunOssAdapter(config)).toThrow(StorageConfigError)
        expect(() => new AliyunOssAdapter(config)).toThrow('无效的 STS role ARN 格式')
    })

    it('有效的 STS roleArn 格式应通过验证', () => {
        const config: AliyunOssConfig = {
            ...validConfig,
            sts: {
                roleArn: 'acs:ram::1234567890123456:role/test-role',
                roleSessionName: 'test'
            }
        }
        expect(() => new AliyunOssAdapter(config)).not.toThrow()
    })

    it('配置自定义域名应正确处理', () => {
        const configWithDomain: AliyunOssConfig = {
            ...validConfig,
            customDomain: 'https://cdn.example.com'
        }
        const adapter = new AliyunOssAdapter(configWithDomain)
        expect(adapter.type).toBe('aliyun_oss')
    })
})

describe('QiniuAdapter 配置验证', () => {
    // 有效的七牛云配置
    const validConfig: QiniuConfig = {
        type: 'qiniu' as any,
        name: 'test-qiniu-config',
        enabled: true,
        accessKey: 'test-access-key',
        secretKey: 'test-secret-key',
        bucket: 'test-bucket',
        region: 'z0'
    }

    it('有效配置应成功创建适配器', () => {
        const adapter = new QiniuAdapter(validConfig)
        expect(adapter.type).toBe('qiniu')
    })

    it('缺少 bucket 应抛出配置错误', () => {
        const config = { ...validConfig, bucket: '' }
        expect(() => new QiniuAdapter(config)).toThrow(StorageConfigError)
        expect(() => new QiniuAdapter(config)).toThrow('缺少必填配置: bucket')
    })

    it('缺少 region 应抛出配置错误', () => {
        const config = { ...validConfig, region: '' }
        expect(() => new QiniuAdapter(config)).toThrow(StorageConfigError)
        expect(() => new QiniuAdapter(config)).toThrow('缺少必填配置: region')
    })

    it('缺少 accessKey 应抛出配置错误', () => {
        const config = { ...validConfig, accessKey: '' }
        expect(() => new QiniuAdapter(config)).toThrow(StorageConfigError)
        expect(() => new QiniuAdapter(config)).toThrow('缺少必填配置: accessKey')
    })

    it('缺少 secretKey 应抛出配置错误', () => {
        const config = { ...validConfig, secretKey: '' }
        expect(() => new QiniuAdapter(config)).toThrow(StorageConfigError)
        expect(() => new QiniuAdapter(config)).toThrow('缺少必填配置: secretKey')
    })

    it('未实现的方法应抛出错误', async () => {
        const adapter = new QiniuAdapter(validConfig)

        await expect(adapter.upload('test.txt', Buffer.from('test'))).rejects.toThrow('七牛云适配器尚未实现')
        await expect(adapter.download('test.txt')).rejects.toThrow('七牛云适配器尚未实现')
        await expect(adapter.downloadStream('test.txt')).rejects.toThrow('七牛云适配器尚未实现')
        await expect(adapter.delete('test.txt')).rejects.toThrow('七牛云适配器尚未实现')
        await expect(adapter.generateSignedUrl('test.txt')).rejects.toThrow('七牛云适配器尚未实现')
        await expect(adapter.generatePostSignature({ dir: 'test/' })).rejects.toThrow('七牛云适配器尚未实现')
        await expect(adapter.testConnection()).rejects.toThrow('七牛云适配器尚未实现')
    })
})

describe('TencentCosAdapter 配置验证', () => {
    // 有效的腾讯云 COS 配置
    const validConfig: TencentCosConfig = {
        type: 'tencent_cos' as any,
        name: 'test-tencent-config',
        enabled: true,
        secretId: 'test-secret-id',
        secretKey: 'test-secret-key',
        appId: '1234567890',
        bucket: 'test-bucket',
        region: 'ap-guangzhou'
    }

    it('有效配置应成功创建适配器', () => {
        const adapter = new TencentCosAdapter(validConfig)
        expect(adapter.type).toBe('tencent_cos')
    })

    it('缺少 bucket 应抛出配置错误', () => {
        const config = { ...validConfig, bucket: '' }
        expect(() => new TencentCosAdapter(config)).toThrow(StorageConfigError)
        expect(() => new TencentCosAdapter(config)).toThrow('缺少必填配置: bucket')
    })

    it('缺少 region 应抛出配置错误', () => {
        const config = { ...validConfig, region: '' }
        expect(() => new TencentCosAdapter(config)).toThrow(StorageConfigError)
        expect(() => new TencentCosAdapter(config)).toThrow('缺少必填配置: region')
    })

    it('缺少 secretId 应抛出配置错误', () => {
        const config = { ...validConfig, secretId: '' }
        expect(() => new TencentCosAdapter(config)).toThrow(StorageConfigError)
        expect(() => new TencentCosAdapter(config)).toThrow('缺少必填配置: secretId')
    })

    it('缺少 secretKey 应抛出配置错误', () => {
        const config = { ...validConfig, secretKey: '' }
        expect(() => new TencentCosAdapter(config)).toThrow(StorageConfigError)
        expect(() => new TencentCosAdapter(config)).toThrow('缺少必填配置: secretKey')
    })

    it('缺少 appId 应抛出配置错误', () => {
        const config = { ...validConfig, appId: '' }
        expect(() => new TencentCosAdapter(config)).toThrow(StorageConfigError)
        expect(() => new TencentCosAdapter(config)).toThrow('缺少必填配置: appId')
    })

    it('未实现的方法应抛出错误', async () => {
        const adapter = new TencentCosAdapter(validConfig)

        await expect(adapter.upload('test.txt', Buffer.from('test'))).rejects.toThrow('腾讯云 COS 适配器尚未实现')
        await expect(adapter.download('test.txt')).rejects.toThrow('腾讯云 COS 适配器尚未实现')
        await expect(adapter.downloadStream('test.txt')).rejects.toThrow('腾讯云 COS 适配器尚未实现')
        await expect(adapter.delete('test.txt')).rejects.toThrow('腾讯云 COS 适配器尚未实现')
        await expect(adapter.generateSignedUrl('test.txt')).rejects.toThrow('腾讯云 COS 适配器尚未实现')
        await expect(adapter.generatePostSignature({ dir: 'test/' })).rejects.toThrow('腾讯云 COS 适配器尚未实现')
        await expect(adapter.testConnection()).rejects.toThrow('腾讯云 COS 适配器尚未实现')
    })
})

describe('Property: 配置验证一致性', () => {
    it('任意有效配置都应成功创建阿里云适配器', () => {
        fc.assert(
            fc.property(
                fc.record({
                    // 使用非空白字符的字符串
                    accessKeyId: fc.stringMatching(/^[A-Za-z0-9]{10,30}$/),
                    accessKeySecret: fc.stringMatching(/^[A-Za-z0-9]{20,50}$/),
                    bucket: fc.string({ minLength: 3, maxLength: 63 })
                        .filter(s => /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(s)),
                    // 阿里云 OSS region 格式
                    region: fc.constantFrom(
                        'oss-cn-hangzhou',
                        'oss-cn-shanghai',
                        'oss-cn-beijing',
                        'cn-hangzhou',
                        'cn-shanghai'
                    )
                }),
                (config) => {
                    const fullConfig: AliyunOssConfig = {
                        type: 'aliyun_oss' as any,
                        name: 'test-config',
                        enabled: true,
                        ...config
                    }
                    const adapter = new AliyunOssAdapter(fullConfig)
                    expect(adapter.type).toBe('aliyun_oss')
                    return true
                }
            ),
            { numRuns: 50 }
        )
    })

    it('任意有效配置都应成功创建七牛云适配器', () => {
        fc.assert(
            fc.property(
                fc.record({
                    accessKey: fc.string({ minLength: 10, maxLength: 50 }),
                    secretKey: fc.string({ minLength: 20, maxLength: 50 }),
                    bucket: fc.string({ minLength: 3, maxLength: 63 })
                        .filter(s => /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(s)),
                    region: fc.constantFrom('z0', 'z1', 'z2', 'na0', 'as0')
                }),
                (config) => {
                    const fullConfig: QiniuConfig = {
                        type: 'qiniu' as any,
                        name: 'test-qiniu-config',
                        enabled: true,
                        ...config
                    }
                    const adapter = new QiniuAdapter(fullConfig)
                    expect(adapter.type).toBe('qiniu')
                    return true
                }
            ),
            { numRuns: 50 }
        )
    })

    it('任意有效配置都应成功创建腾讯云适配器', () => {
        fc.assert(
            fc.property(
                fc.record({
                    secretId: fc.string({ minLength: 10, maxLength: 50 }),
                    secretKey: fc.string({ minLength: 20, maxLength: 50 }),
                    appId: fc.stringMatching(/^[0-9]{10,15}$/),
                    bucket: fc.string({ minLength: 3, maxLength: 63 })
                        .filter(s => /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(s)),
                    region: fc.constantFrom('ap-guangzhou', 'ap-shanghai', 'ap-beijing', 'ap-chengdu')
                }),
                (config) => {
                    const fullConfig: TencentCosConfig = {
                        type: 'tencent_cos' as any,
                        name: 'test-tencent-config',
                        enabled: true,
                        ...config
                    }
                    const adapter = new TencentCosAdapter(fullConfig)
                    expect(adapter.type).toBe('tencent_cos')
                    return true
                }
            ),
            { numRuns: 50 }
        )
    })
})
