/**
 * 存储适配器类型守卫测试
 *
 * 测试类型守卫函数的正确性
 *
 * **Feature: storage-system**
 * **Validates: Requirements 10.1**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import {
    StorageProviderType,
    isAliyunOssConfig,
    isQiniuConfig,
    isTencentCosConfig,
    isAliyunPostSignatureResult,
    isQiniuPostSignatureResult,
    isTencentPostSignatureResult,
} from '../../../server/lib/storage/types'

describe('存储类型守卫', () => {
    describe('isAliyunOssConfig - 阿里云 OSS 配置判断', () => {
        it('阿里云 OSS 配置应返回 true', () => {
            expect(isAliyunOssConfig({
                type: StorageProviderType.ALIYUN_OSS,
                bucket: 'test',
                region: 'cn-hangzhou',
                name: 'test',
                enabled: true,
                accessKeyId: 'key',
                accessKeySecret: 'secret',
            })).toBe(true)
        })

        it('七牛云配置应返回 false', () => {
            expect(isAliyunOssConfig({
                type: StorageProviderType.QINIU,
                bucket: 'test',
                region: 'z0',
                name: 'test',
                enabled: true,
                accessKey: 'key',
                secretKey: 'secret',
            })).toBe(false)
        })

        it('腾讯云 COS 配置应返回 false', () => {
            expect(isAliyunOssConfig({
                type: StorageProviderType.TENCENT_COS,
                bucket: 'test',
                region: 'ap-guangzhou',
                name: 'test',
                enabled: true,
                secretId: 'id',
                secretKey: 'key',
                appId: '123',
            })).toBe(false)
        })

        it('属性测试: 类型匹配应正确', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(
                        { type: StorageProviderType.ALIYUN_OSS },
                        { type: StorageProviderType.QINIU },
                        { type: StorageProviderType.TENCENT_COS },
                    ),
                    (config) => {
                        expect(isAliyunOssConfig(config as any)).toBe(config.type === StorageProviderType.ALIYUN_OSS)
                        return true
                    }
                ),
                { numRuns: 50 }
            )
        })
    })

    describe('isQiniuConfig - 七牛云配置判断', () => {
        it('七牛云配置应返回 true', () => {
            expect(isQiniuConfig({
                type: StorageProviderType.QINIU,
                bucket: 'test',
                region: 'z0',
                name: 'test',
                enabled: true,
                accessKey: 'key',
                secretKey: 'secret',
            })).toBe(true)
        })

        it('阿里云 OSS 配置应返回 false', () => {
            expect(isQiniuConfig({
                type: StorageProviderType.ALIYUN_OSS,
                bucket: 'test',
                region: 'cn-hangzhou',
                name: 'test',
                enabled: true,
                accessKeyId: 'key',
                accessKeySecret: 'secret',
            })).toBe(false)
        })

        it('腾讯云 COS 配置应返回 false', () => {
            expect(isQiniuConfig({
                type: StorageProviderType.TENCENT_COS,
                bucket: 'test',
                region: 'ap-guangzhou',
                name: 'test',
                enabled: true,
                secretId: 'id',
                secretKey: 'key',
                appId: '123',
            })).toBe(false)
        })
    })

    describe('isTencentCosConfig - 腾讯云 COS 配置判断', () => {
        it('腾讯云 COS 配置应返回 true', () => {
            expect(isTencentCosConfig({
                type: StorageProviderType.TENCENT_COS,
                bucket: 'test',
                region: 'ap-guangzhou',
                name: 'test',
                enabled: true,
                secretId: 'id',
                secretKey: 'key',
                appId: '123',
            })).toBe(true)
        })

        it('阿里云 OSS 配置应返回 false', () => {
            expect(isTencentCosConfig({
                type: StorageProviderType.ALIYUN_OSS,
                bucket: 'test',
                region: 'cn-hangzhou',
                name: 'test',
                enabled: true,
                accessKeyId: 'key',
                accessKeySecret: 'secret',
            })).toBe(false)
        })

        it('七牛云配置应返回 false', () => {
            expect(isTencentCosConfig({
                type: StorageProviderType.QINIU,
                bucket: 'test',
                region: 'z0',
                name: 'test',
                enabled: true,
                accessKey: 'key',
                secretKey: 'secret',
            })).toBe(false)
        })
    })

    describe('isAliyunPostSignatureResult - 阿里云签名结果判断', () => {
        it('阿里云签名结果应返回 true', () => {
            expect(isAliyunPostSignatureResult({
                host: 'https://test.oss-cn-hangzhou.aliyuncs.com',
                policy: 'base64-policy',
                signatureVersion: 'OSS4-HMAC-SHA256',
                credential: 'key/20240101/cn-hangzhou/oss/aliyun_v4_request',
                date: '20240101T000000Z',
                signature: 'sig',
                dir: 'uploads/',
            })).toBe(true)
        })

        it('七牛云签名结果应返回 false', () => {
            expect(isAliyunPostSignatureResult({
                host: 'https://test.qiniu.com',
                uploadToken: 'token',
                dir: 'uploads/',
            })).toBe(false)
        })

        it('腾讯云签名结果应返回 false', () => {
            expect(isAliyunPostSignatureResult({
                host: 'https://test.cos.com',
                tmpSecretId: 'id',
                tmpSecretKey: 'key',
                sessionToken: 'token',
                startTime: 1704067200,
                expiredTime: 1704153600,
                dir: 'uploads/',
            })).toBe(false)
        })

        it('空对象应返回 false', () => {
            expect(isAliyunPostSignatureResult({})).toBe(false)
            expect(isAliyunPostSignatureResult({ host: 'test' })).toBe(false)
        })
    })

    describe('isQiniuPostSignatureResult - 七牛云签名结果判断', () => {
        it('七牛云签名结果应返回 true', () => {
            expect(isQiniuPostSignatureResult({
                host: 'https://test.qiniu.com',
                uploadToken: 'token',
                dir: 'uploads/',
            })).toBe(true)
        })

        it('阿里云签名结果应返回 false', () => {
            expect(isQiniuPostSignatureResult({
                host: 'https://test.oss-cn-hangzhou.aliyuncs.com',
                policy: 'base64-policy',
                signatureVersion: 'OSS4-HMAC-SHA256',
                credential: 'key/20240101/cn-hangzhou/oss/aliyun_v4_request',
                date: '20240101T000000Z',
                signature: 'sig',
                dir: 'uploads/',
            })).toBe(false)
        })

        it('空对象应返回 false', () => {
            expect(isQiniuPostSignatureResult({})).toBe(false)
        })
    })

    describe('isTencentPostSignatureResult - 腾讯云签名结果判断', () => {
        it('腾讯云签名结果应返回 true', () => {
            expect(isTencentPostSignatureResult({
                host: 'https://test.cos.com',
                tmpSecretId: 'id',
                tmpSecretKey: 'key',
                sessionToken: 'token',
                startTime: 1704067200,
                expiredTime: 1704153600,
                dir: 'uploads/',
            })).toBe(true)
        })

        it('阿里云签名结果应返回 false', () => {
            expect(isTencentPostSignatureResult({
                host: 'https://test.oss-cn-hangzhou.aliyuncs.com',
                policy: 'base64-policy',
                signatureVersion: 'OSS4-HMAC-SHA256',
                credential: 'key/20240101/cn-hangzhou/oss/aliyun_v4_request',
                date: '20240101T000000Z',
                signature: 'sig',
                dir: 'uploads/',
            })).toBe(false)
        })

        it('只有部分字段应返回 false', () => {
            expect(isTencentPostSignatureResult({
                tmpSecretId: 'id',
                tmpSecretKey: 'key',
            })).toBe(false)
        })
    })
})

describe('StorageProviderType 枚举值', () => {
    it('应正确定义所有存储类型', () => {
        expect(StorageProviderType.ALIYUN_OSS).toBe('aliyun_oss')
        expect(StorageProviderType.QINIU).toBe('qiniu')
        expect(StorageProviderType.TENCENT_COS).toBe('tencent_cos')
    })

    it('枚举值应为字符串', () => {
        expect(typeof StorageProviderType.ALIYUN_OSS).toBe('string')
        expect(typeof StorageProviderType.QINIU).toBe('string')
        expect(typeof StorageProviderType.TENCENT_COS).toBe('string')
    })
})
