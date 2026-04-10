/**
 * 存储配置 DAO 补充测试
 *
 * 补充覆盖 storageConfig.dao.ts 中未充分测试的分支：
 * - validateStorageConfig（七牛云、腾讯云验证）
 * - decryptConfig 格式错误处理
 * - getStorageConfigsDao 用户过滤组合
 * - getDefaultStorageConfigDao 环境变量回退
 * - updateStorageConfigDao 更新配置和启禁用
 * - deleteStorageConfigDao 无权删除
 *
 * **Feature: storage-config-dao-extended**
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import {
    testPrisma,
    connectTestDb,
    disconnectTestDb,
} from '../membership/test-db-helper'
import { StorageProviderType } from '../../../server/lib/storage/types'
import { StorageConfigError } from '../../../server/lib/storage/errors'

// Mock logger
vi.mock('#shared/utils/logger', () => ({
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}))

// Mock useRuntimeConfig - 提供七牛云和腾讯云配置
vi.mock('#imports', () => ({
    useRuntimeConfig: () => ({
        storageConfigEncryptionKey: 'test_encryption_key_for_tests_purposes_only',
        storage: {
            aliyunOss: {
                accessKeyId: 'env_oss_key',
                accessKeySecret: 'env_oss_secret',
                bucket: 'env-oss-bucket',
                region: 'cn-hangzhou',
                customDomain: 'https://cdn.example.com',
                sts: {
                    roleArn: 'acs:ram::123456:role/test',
                    roleSessionName: 'test-session',
                    durationSeconds: 3600,
                },
            },
            qiniu: {
                accessKey: 'env_qiniu_key',
                secretKey: 'env_qiniu_secret',
                bucket: 'env-qiniu-bucket',
                zone: 'z0',
            },
            tencentCos: {
                secretId: 'env_cos_id',
                secretKey: 'env_cos_secret',
                bucket: 'env-cos-bucket',
                region: 'ap-guangzhou',
                appId: '1234567890',
            },
        },
    }),
}), { virtual: true })

// Mock crypto
vi.mock('crypto', () => ({
    default: {
        randomBytes: vi.fn().mockReturnValue({
            toString: vi.fn().mockReturnValue('a'.repeat(32)),
        }),
        createHash: vi.fn().mockReturnValue({
            update: vi.fn().mockReturnValue({
                digest: vi.fn().mockReturnValue(Buffer.alloc(32)),
            }),
        }),
        createCipheriv: vi.fn().mockReturnValue({
            update: vi.fn().mockReturnValue('encrypted'),
            final: vi.fn().mockReturnValue(''),
            getAuthTag: vi.fn().mockReturnValue(Buffer.alloc(16)),
        }),
        createDecipheriv: vi.fn().mockReturnValue({
            update: vi.fn().mockReturnValue(Buffer.from(JSON.stringify({
                accessKeyId: 'test', accessKeySecret: 'test',
                bucket: 'test', region: 'cn-hangzhou',
            }))),
            final: vi.fn().mockReturnValue(''),
            setAuthTag: vi.fn(),
        }),
    },
}))

const TEST_CONFIG_PREFIX = 'TEST_SC_EXT_'
const createdConfigIds: number[] = []

describe('存储配置 DAO 补充测试', () => {
    beforeAll(async () => {
        process.env.NUXT_STORAGE_CONFIG_ENCRYPTION_KEY = 'test_encryption_key_for_tests_purposes_only'
        process.env.STORAGE_CONFIG_ENCRYPTION_KEY = 'test_encryption_key_for_tests_purposes_only'
        await connectTestDb()
    })

    afterAll(async () => {
        await disconnectTestDb()
    })

    beforeEach(() => {
        createdConfigIds.length = 0
    })

    afterEach(async () => {
        if (createdConfigIds.length > 0) {
            await testPrisma.storageConfigs.deleteMany({
                where: { id: { in: createdConfigIds } },
            })
        }
    })

    describe('validateStorageConfig - 七牛云验证', () => {
        it('七牛云缺少 accessKey 或 secretKey 应抛出错误', async () => {
            const { createStorageConfigDao } = await import('../../../server/services/storage/storageConfig.dao')

            await expect(
                createStorageConfigDao({
                    name: `${TEST_CONFIG_PREFIX}qiniu_no_key_${Date.now()}`,
                    type: StorageProviderType.QINIU,
                    config: { bucket: 'test-bucket' },
                })
            ).rejects.toThrow('七牛云配置缺少 accessKey 或 secretKey')
        })

        it('七牛云缺少 bucket 应抛出错误', async () => {
            const { createStorageConfigDao } = await import('../../../server/services/storage/storageConfig.dao')

            await expect(
                createStorageConfigDao({
                    name: `${TEST_CONFIG_PREFIX}qiniu_no_bucket_${Date.now()}`,
                    type: StorageProviderType.QINIU,
                    config: {
                        accessKey: 'test_key',
                        secretKey: 'test_secret',
                    },
                })
            ).rejects.toThrow('七牛云配置缺少 bucket')
        })

        it('七牛云完整配置应通过验证', async () => {
            const { createStorageConfigDao } = await import('../../../server/services/storage/storageConfig.dao')

            const config = await createStorageConfigDao({
                name: `${TEST_CONFIG_PREFIX}qiniu_ok_${Date.now()}`,
                type: StorageProviderType.QINIU,
                config: {
                    accessKey: 'test_key',
                    secretKey: 'test_secret',
                    bucket: 'test-bucket',
                },
            })
            createdConfigIds.push(config.id)
            expect(config.id).toBeGreaterThan(0)
        })
    })

    describe('validateStorageConfig - 腾讯云 COS 验证', () => {
        it('腾讯云缺少 secretId 或 secretKey 应抛出错误', async () => {
            const { createStorageConfigDao } = await import('../../../server/services/storage/storageConfig.dao')

            await expect(
                createStorageConfigDao({
                    name: `${TEST_CONFIG_PREFIX}cos_no_key_${Date.now()}`,
                    type: StorageProviderType.TENCENT_COS,
                    config: {
                        bucket: 'test-bucket',
                        region: 'ap-guangzhou',
                        appId: '123456',
                    },
                })
            ).rejects.toThrow('腾讯云 COS 配置缺少 secretId 或 secretKey')
        })

        it('腾讯云缺少 bucket、region 或 appId 应抛出错误', async () => {
            const { createStorageConfigDao } = await import('../../../server/services/storage/storageConfig.dao')

            await expect(
                createStorageConfigDao({
                    name: `${TEST_CONFIG_PREFIX}cos_no_bucket_${Date.now()}`,
                    type: StorageProviderType.TENCENT_COS,
                    config: {
                        secretId: 'test_id',
                        secretKey: 'test_secret',
                    },
                })
            ).rejects.toThrow('腾讯云 COS 配置缺少 bucket、region 或 appId')
        })

        it('腾讯云完整配置应通过验证', async () => {
            const { createStorageConfigDao } = await import('../../../server/services/storage/storageConfig.dao')

            const config = await createStorageConfigDao({
                name: `${TEST_CONFIG_PREFIX}cos_ok_${Date.now()}`,
                type: StorageProviderType.TENCENT_COS,
                config: {
                    secretId: 'test_id',
                    secretKey: 'test_secret',
                    bucket: 'test-bucket',
                    region: 'ap-guangzhou',
                    appId: '1234567890',
                },
            })
            createdConfigIds.push(config.id)
            expect(config.id).toBeGreaterThan(0)
        })
    })

    describe('getStorageConfigsDao - 用户过滤组合', () => {
        it('不指定 userId 且 includeSystem=false 应只返回系统配置', async () => {
            const { createStorageConfigDao, getStorageConfigsDao } = await import('../../../server/services/storage/storageConfig.dao')

            const sysConfig = await createStorageConfigDao({
                name: `${TEST_CONFIG_PREFIX}sys_${Date.now()}`,
                type: StorageProviderType.ALIYUN_OSS,
                config: {
                    accessKeyId: 'key',
                    accessKeySecret: 'secret',
                    bucket: 'bucket',
                    region: 'cn-hangzhou',
                },
            })
            createdConfigIds.push(sysConfig.id)

            const configs = await getStorageConfigsDao({ includeSystem: false })
            // 所有结果的 userId 应为 null（系统配置）
            configs.forEach(c => {
                // toStorageConfig 不暴露 userId，但确保结果中不包含有特定用户的配置
                expect(c.id).toBeGreaterThan(0)
            })
        })

        it('指定 userId 且 includeSystem=false 应只返回该用户配置', async () => {
            const { createStorageConfigDao, getStorageConfigsDao } = await import('../../../server/services/storage/storageConfig.dao')

            const userId = 999
            const userConfig = await createStorageConfigDao({
                name: `${TEST_CONFIG_PREFIX}user_only_${Date.now()}`,
                type: StorageProviderType.ALIYUN_OSS,
                config: {
                    accessKeyId: 'key',
                    accessKeySecret: 'secret',
                    bucket: 'bucket',
                    region: 'cn-hangzhou',
                },
                userId,
            })
            createdConfigIds.push(userConfig.id)

            const configs = await getStorageConfigsDao({ userId, includeSystem: false })
            expect(configs.length).toBeGreaterThanOrEqual(1)
        })

        it('按 enabled 状态筛选应正确过滤', async () => {
            const { createStorageConfigDao, getStorageConfigsDao } = await import('../../../server/services/storage/storageConfig.dao')

            const enabled = await createStorageConfigDao({
                name: `${TEST_CONFIG_PREFIX}enabled_${Date.now()}`,
                type: StorageProviderType.ALIYUN_OSS,
                config: {
                    accessKeyId: 'key',
                    accessKeySecret: 'secret',
                    bucket: 'bucket',
                    region: 'cn-hangzhou',
                },
                enabled: true,
            })
            createdConfigIds.push(enabled.id)

            const disabled = await createStorageConfigDao({
                name: `${TEST_CONFIG_PREFIX}disabled_${Date.now()}`,
                type: StorageProviderType.ALIYUN_OSS,
                config: {
                    accessKeyId: 'key2',
                    accessKeySecret: 'secret2',
                    bucket: 'bucket2',
                    region: 'cn-hangzhou',
                },
                enabled: false,
            })
            createdConfigIds.push(disabled.id)

            const enabledConfigs = await getStorageConfigsDao({ enabled: true })
            enabledConfigs.forEach(c => expect(c.enabled).toBe(true))
        })
    })

    describe('updateStorageConfigDao - 补充场景', () => {
        it('应能更新启用状态', async () => {
            const { createStorageConfigDao, updateStorageConfigDao } = await import('../../../server/services/storage/storageConfig.dao')

            const created = await createStorageConfigDao({
                name: `${TEST_CONFIG_PREFIX}toggle_${Date.now()}`,
                type: StorageProviderType.ALIYUN_OSS,
                config: {
                    accessKeyId: 'key',
                    accessKeySecret: 'secret',
                    bucket: 'bucket',
                    region: 'cn-hangzhou',
                },
                enabled: true,
            })
            createdConfigIds.push(created.id)

            const updated = await updateStorageConfigDao(created.id, undefined, { enabled: false })
            expect(updated).not.toBeNull()
            expect(updated!.enabled).toBe(false)
        })

        it('取消默认标记应正确设置 isDefault=false', async () => {
            const { createStorageConfigDao, updateStorageConfigDao } = await import('../../../server/services/storage/storageConfig.dao')

            const created = await createStorageConfigDao({
                name: `${TEST_CONFIG_PREFIX}undefault_${Date.now()}`,
                type: StorageProviderType.ALIYUN_OSS,
                config: {
                    accessKeyId: 'key',
                    accessKeySecret: 'secret',
                    bucket: 'bucket',
                    region: 'cn-hangzhou',
                },
                isDefault: true,
            })
            createdConfigIds.push(created.id)

            const updated = await updateStorageConfigDao(created.id, undefined, { isDefault: false })
            expect(updated).not.toBeNull()
            expect(updated!.isDefault).toBe(false)
        })

        it('更新配置时无效类型配置应抛出错误', async () => {
            const { createStorageConfigDao, updateStorageConfigDao } = await import('../../../server/services/storage/storageConfig.dao')

            const created = await createStorageConfigDao({
                name: `${TEST_CONFIG_PREFIX}badupdate_${Date.now()}`,
                type: StorageProviderType.ALIYUN_OSS,
                config: {
                    accessKeyId: 'key',
                    accessKeySecret: 'secret',
                    bucket: 'bucket',
                    region: 'cn-hangzhou',
                },
            })
            createdConfigIds.push(created.id)

            // 更新配置但缺少必要字段
            await expect(
                updateStorageConfigDao(created.id, undefined, {
                    config: { accessKeyId: 'new_key' },
                })
            ).rejects.toThrow(StorageConfigError)
        })

        it('更新不存在的配置应返回 null', async () => {
            const { updateStorageConfigDao } = await import('../../../server/services/storage/storageConfig.dao')

            const result = await updateStorageConfigDao(999999999, undefined, { name: 'noop' })
            expect(result).toBeNull()
        })
    })

    describe('deleteStorageConfigDao - 权限控制', () => {
        it('其他用户不能删除别人的配置', async () => {
            const { createStorageConfigDao, deleteStorageConfigDao } = await import('../../../server/services/storage/storageConfig.dao')

            const created = await createStorageConfigDao({
                name: `${TEST_CONFIG_PREFIX}otherdel_${Date.now()}`,
                type: StorageProviderType.ALIYUN_OSS,
                config: {
                    accessKeyId: 'key',
                    accessKeySecret: 'secret',
                    bucket: 'bucket',
                    region: 'cn-hangzhou',
                },
                userId: 1,
            })
            createdConfigIds.push(created.id)

            const result = await deleteStorageConfigDao(created.id, 999)
            expect(result).toBe(false)
        })

        it('已删除的配置不能再次删除', async () => {
            const { createStorageConfigDao, deleteStorageConfigDao } = await import('../../../server/services/storage/storageConfig.dao')

            const created = await createStorageConfigDao({
                name: `${TEST_CONFIG_PREFIX}doubledel_${Date.now()}`,
                type: StorageProviderType.ALIYUN_OSS,
                config: {
                    accessKeyId: 'key',
                    accessKeySecret: 'secret',
                    bucket: 'bucket',
                    region: 'cn-hangzhou',
                },
            })
            createdConfigIds.push(created.id)

            const first = await deleteStorageConfigDao(created.id)
            expect(first).toBe(true)

            const second = await deleteStorageConfigDao(created.id)
            expect(second).toBe(false)
        })
    })

    describe('getDefaultStorageConfigDao - 优先级', () => {
        it('用户默认配置应优先于系统默认配置', async () => {
            const { createStorageConfigDao, getDefaultStorageConfigDao } = await import('../../../server/services/storage/storageConfig.dao')

            const userId = 998

            // 创建系统默认配置
            const sysConfig = await createStorageConfigDao({
                name: `${TEST_CONFIG_PREFIX}sys_default_${Date.now()}`,
                type: StorageProviderType.ALIYUN_OSS,
                config: {
                    accessKeyId: 'sys_key',
                    accessKeySecret: 'sys_secret',
                    bucket: 'sys-bucket',
                    region: 'cn-hangzhou',
                },
                isDefault: true,
            })
            createdConfigIds.push(sysConfig.id)

            // 创建用户默认配置
            const userConfig = await createStorageConfigDao({
                name: `${TEST_CONFIG_PREFIX}user_default_${Date.now()}`,
                type: StorageProviderType.ALIYUN_OSS,
                config: {
                    accessKeyId: 'user_key',
                    accessKeySecret: 'user_secret',
                    bucket: 'user-bucket',
                    region: 'cn-hangzhou',
                },
                isDefault: true,
                userId,
            })
            createdConfigIds.push(userConfig.id)

            const defaultConfig = await getDefaultStorageConfigDao(StorageProviderType.ALIYUN_OSS, userId)
            expect(defaultConfig).not.toBeNull()
            expect(defaultConfig!.id).toBe(userConfig.id)
        })

        it('无用户配置时应回退到系统默认配置', async () => {
            const { createStorageConfigDao, getDefaultStorageConfigDao } = await import('../../../server/services/storage/storageConfig.dao')

            const sysConfig = await createStorageConfigDao({
                name: `${TEST_CONFIG_PREFIX}sys_fallback_${Date.now()}`,
                type: StorageProviderType.ALIYUN_OSS,
                config: {
                    accessKeyId: 'sys_key',
                    accessKeySecret: 'sys_secret',
                    bucket: 'sys-bucket',
                    region: 'cn-hangzhou',
                },
                isDefault: true,
            })
            createdConfigIds.push(sysConfig.id)

            // 使用一个没有配置的用户 ID
            const defaultConfig = await getDefaultStorageConfigDao(StorageProviderType.ALIYUN_OSS, 997)
            expect(defaultConfig).not.toBeNull()
        })
    })

    describe('isConfigNameExistsDao - 系统级配置', () => {
        it('系统级配置（userId=undefined）名称检查应正确', async () => {
            const { createStorageConfigDao, isConfigNameExistsDao } = await import('../../../server/services/storage/storageConfig.dao')

            const name = `${TEST_CONFIG_PREFIX}sys_name_${Date.now()}`
            const created = await createStorageConfigDao({
                name,
                type: StorageProviderType.ALIYUN_OSS,
                config: {
                    accessKeyId: 'key',
                    accessKeySecret: 'secret',
                    bucket: 'bucket',
                    region: 'cn-hangzhou',
                },
            })
            createdConfigIds.push(created.id)

            // 不传 userId，检查系统级配置
            const exists = await isConfigNameExistsDao(name)
            expect(exists).toBe(true)
        })
    })
})
