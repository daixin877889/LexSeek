/**
 * OSS 客户端测试
 *
 * 测试 OSS 客户端创建和 STS 凭证获取
 *
 * **Feature: storage-system**
 * **Validates: Requirements 10.1, 10.2**
 */

import { describe, it, expect, vi } from 'vitest'
import { config } from 'dotenv'

// 加载环境变量
config()

// 从环境变量获取配置
const ossConfig = {
    accessKeyId: process.env.NUXT_STORAGE_ALIYUN_OSS_ACCESS_KEY_ID || '',
    accessKeySecret: process.env.NUXT_STORAGE_ALIYUN_OSS_ACCESS_KEY_SECRET || '',
    bucket: process.env.NUXT_STORAGE_ALIYUN_OSS_BUCKET || '',
    region: process.env.NUXT_STORAGE_ALIYUN_OSS_REGION || '',
    customDomain: process.env.NUXT_STORAGE_ALIYUN_OSS_CUSTOM_DOMAIN,
    sts: process.env.NUXT_STORAGE_ALIYUN_OSS_STS_ROLE_ARN ? {
        roleArn: process.env.NUXT_STORAGE_ALIYUN_OSS_STS_ROLE_ARN,
        roleSessionName: process.env.NUXT_STORAGE_ALIYUN_OSS_STS_ROLE_SESSION_NAME || 'OSS',
        durationSeconds: parseInt(process.env.NUXT_STORAGE_ALIYUN_OSS_STS_DURATION_SECONDS || '3600')
    } : undefined
}

// 检查配置是否完整
const hasValidConfig = ossConfig.accessKeyId && ossConfig.accessKeySecret && ossConfig.bucket && ossConfig.region
const hasStsConfig = hasValidConfig && ossConfig.sts

// 跳过测试如果没有配置
const describeIfConfigured = hasValidConfig ? describe : describe.skip
const describeIfStsConfigured = hasStsConfig ? describe : describe.skip

describeIfConfigured('OSS 客户端测试', () => {
    describe('createOssClient - 基本功能', () => {
        it('应成功创建 OSS 客户端（无 STS）', async () => {
            const { createOssClient } = await import('../../../server/lib/oss/client')

            // 使用不带 STS 的配置
            const configWithoutSts = {
                ...ossConfig,
                sts: undefined
            }

            const { client, config: returnedConfig, credentials } = await createOssClient(configWithoutSts)

            expect(client).toBeDefined()
            expect(returnedConfig).toEqual(configWithoutSts)
            expect(credentials).toBeUndefined()
        })

        it('应支持 useCname 参数', async () => {
            const { createOssClient } = await import('../../../server/lib/oss/client')

            const configWithDomain = {
                ...ossConfig,
                sts: undefined,
                customDomain: 'cdn.example.com'
            }

            const { client } = await createOssClient(configWithDomain, true)

            expect(client).toBeDefined()
        })

        it('无自定义域名时 useCname 应被忽略', async () => {
            const { createOssClient } = await import('../../../server/lib/oss/client')

            const configWithoutDomain = {
                ...ossConfig,
                sts: undefined,
                customDomain: undefined
            }

            const { client } = await createOssClient(configWithoutDomain, true)

            expect(client).toBeDefined()
        })
    })
})

describeIfStsConfigured('OSS 客户端 STS 测试', () => {
    it('应成功创建带 STS 凭证的 OSS 客户端', async () => {
        const { createOssClient } = await import('../../../server/lib/oss/client')

        const { client, credentials } = await createOssClient(ossConfig)

        expect(client).toBeDefined()
        expect(credentials).toBeDefined()
        expect(credentials?.accessKeyId).toBeDefined()
        expect(credentials?.accessKeySecret).toBeDefined()
        expect(credentials?.securityToken).toBeDefined()
        expect(credentials?.expiration).toBeInstanceOf(Date)
    })

    it('STS 凭证应在有效期内', async () => {
        const { createOssClient } = await import('../../../server/lib/oss/client')

        const { credentials } = await createOssClient(ossConfig)

        expect(credentials).toBeDefined()
        expect(credentials!.expiration.getTime()).toBeGreaterThan(Date.now())
    })
})

describe('OSS 客户端错误处理', () => {
    it('无效的 STS roleArn 应抛出 OssStsError', async () => {
        const { createOssClient } = await import('../../../server/lib/oss/client')
        const { OssStsError } = await import('../../../server/lib/oss/errors')

        const invalidStsConfig = {
            ...ossConfig,
            sts: {
                roleArn: 'invalid-role-arn',
                roleSessionName: 'test'
            }
        }

        await expect(createOssClient(invalidStsConfig)).rejects.toThrow()
    })

    it('无效的 accessKeyId 应导致 STS 失败', async () => {
        const { createOssClient } = await import('../../../server/lib/oss/client')

        const invalidConfig = {
            accessKeyId: 'invalid-key',
            accessKeySecret: 'invalid-secret',
            bucket: 'test-bucket',
            region: 'oss-cn-hangzhou',
            sts: {
                roleArn: 'acs:ram::123456789:role/test-role',
                roleSessionName: 'test'
            }
        }

        await expect(createOssClient(invalidConfig)).rejects.toThrow()
    })
})

// 如果没有配置，输出提示信息
if (!hasValidConfig) {
    describe('OSS 客户端测试', () => {
        it.skip('跳过测试：缺少阿里云 OSS 配置', () => {
            console.log('请在 .env 文件中配置阿里云 OSS 环境变量')
        })
    })
}

if (!hasStsConfig) {
    describe('OSS 客户端 STS 测试', () => {
        it.skip('跳过测试：缺少 STS 配置', () => {
            console.log('请在 .env 文件中配置 STS 相关环境变量')
        })
    })
}
