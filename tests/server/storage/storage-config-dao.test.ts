/**
 * 存储配置 DAO 测试
 *
 * 测试 storageConfig.dao.ts 的功能，包括：
 * - validateStorageConfig (内部函数)
 * - createStorageConfigDao
 * - getStorageConfigByIdDao
 * - getStorageConfigsDao
 * - getDefaultStorageConfigDao
 * - updateStorageConfigDao
 * - deleteStorageConfigDao
 * - isConfigNameExistsDao
 *
 * **Feature: storage-config-dao**
 * **Validates: Requirements 5.1, 5.2, 5.3, 5.4**
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import * as fc from 'fast-check'
import {
    testPrisma,
    connectTestDb,
    disconnectTestDb,
} from '../membership/test-db-helper'
import { StorageProviderType } from '../../../server/lib/storage/types'
import { StorageConfigError } from '../../../server/lib/storage/errors'

// Mock logger - 因为 config dao 中使用了 logger
vi.mock('#shared/utils/logger', () => ({
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}))

// Mock useRuntimeConfig
vi.mock('#imports', () => ({
    useRuntimeConfig: () => ({
        storageConfigEncryptionKey: 'test_encryption_key_for_tests_purposes_only',
        storage: {
            aliyunOss: {
                accessKeyId: 'test_key',
                accessKeySecret: 'test_secret',
                bucket: 'test-bucket',
                region: 'cn-hangzhou',
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
            update: vi.fn().mockReturnValue(Buffer.from(JSON.stringify({ accessKeyId: 'test', accessKeySecret: 'test', bucket: 'test', region: 'cn-hangzhou' }))),
            final: vi.fn().mockReturnValue(''),
            setAuthTag: vi.fn(),
        }),
    },
}))

const PBT_CONFIG = { numRuns: 100 }
const TEST_CONFIG_PREFIX = 'TEST_STORAGE_'

// 测试数据追踪
const createdConfigIds: number[] = []

describe('存储配置 DAO 测试', () => {
    beforeAll(async () => {
        // 设置加密密钥环境变量
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
        // 清理测试数据
        if (createdConfigIds.length > 0) {
            await testPrisma.storageConfigs.deleteMany({
                where: { id: { in: createdConfigIds } },
            })
        }
    })

    describe('createStorageConfigDao - 创建存储配置', () => {
        it('应能创建阿里云 OSS 配置', async () => {
            const { createStorageConfigDao } = await import('../../../server/services/storage/storageConfig.dao')

            const config = await createStorageConfigDao({
                name: `${TEST_CONFIG_PREFIX}aliyun_${Date.now()}`,
                type: StorageProviderType.ALIYUN_OSS,
                config: {
                    accessKeyId: 'test_access_key_id',
                    accessKeySecret: 'test_access_key_secret',
                    bucket: 'test-bucket-name',
                    region: 'cn-hangzhou',
                },
            })

            createdConfigIds.push(config.id)
            expect(config.id).toBeGreaterThan(0)
            expect(config.type).toBe(StorageProviderType.ALIYUN_OSS)
            expect(config.name).toContain(TEST_CONFIG_PREFIX)
        })

        it('缺少必需字段时应抛出错误', async () => {
            const { createStorageConfigDao } = await import('../../../server/services/storage/storageConfig.dao')

            await expect(
                createStorageConfigDao({
                    name: `${TEST_CONFIG_PREFIX}invalid_${Date.now()}`,
                    type: StorageProviderType.ALIYUN_OSS,
                    config: {
                        accessKeyId: 'test_access_key_id',
                        // 缺少 accessKeySecret, bucket, region
                    },
                })
            ).rejects.toThrow(StorageConfigError)
        })

        it('无效存储类型应抛出错误', async () => {
            const { createStorageConfigDao } = await import('../../../server/services/storage/storageConfig.dao')

            await expect(
                createStorageConfigDao({
                    name: `${TEST_CONFIG_PREFIX}invalid_type_${Date.now()}`,
                    type: 'invalid_type',
                    config: {},
                })
            ).rejects.toThrow(StorageConfigError)
        })

        it('设置为默认时应取消其他默认配置', async () => {
            const { createStorageConfigDao, getDefaultStorageConfigDao } = await import('../../../server/services/storage/storageConfig.dao')

            const name1 = `${TEST_CONFIG_PREFIX}default_${Date.now()}_1`
            const name2 = `${TEST_CONFIG_PREFIX}default_${Date.now()}_2`

            const config1 = await createStorageConfigDao({
                name: name1,
                type: StorageProviderType.ALIYUN_OSS,
                config: {
                    accessKeyId: 'key1',
                    accessKeySecret: 'secret1',
                    bucket: 'bucket1',
                    region: 'cn-hangzhou',
                },
                isDefault: true,
            })
            createdConfigIds.push(config1.id)

            const config2 = await createStorageConfigDao({
                name: name2,
                type: StorageProviderType.ALIYUN_OSS,
                config: {
                    accessKeyId: 'key2',
                    accessKeySecret: 'secret2',
                    bucket: 'bucket2',
                    region: 'cn-hangzhou',
                },
                isDefault: true,
            })
            createdConfigIds.push(config2.id)

            // config2 应该是新的默认
            const defaultConfig = await getDefaultStorageConfigDao(StorageProviderType.ALIYUN_OSS)
            expect(defaultConfig?.name).toBe(name2)
        })
    })

    describe('getStorageConfigByIdDao - 通过 ID 获取配置', () => {
        it('应能通过 ID 获取配置', async () => {
            const { createStorageConfigDao, getStorageConfigByIdDao } = await import('../../../server/services/storage/storageConfig.dao')

            const created = await createStorageConfigDao({
                name: `${TEST_CONFIG_PREFIX}getbyid_${Date.now()}`,
                type: StorageProviderType.ALIYUN_OSS,
                config: {
                    accessKeyId: 'key',
                    accessKeySecret: 'secret',
                    bucket: 'bucket',
                    region: 'cn-hangzhou',
                },
            })
            createdConfigIds.push(created.id)

            const config = await getStorageConfigByIdDao(created.id)

            expect(config).not.toBeNull()
            expect(config!.id).toBe(created.id)
        })

        it('不存在的 ID 应返回 null', async () => {
            const { getStorageConfigByIdDao } = await import('../../../server/services/storage/storageConfig.dao')

            const config = await getStorageConfigByIdDao(999999999)
            expect(config).toBeNull()
        })

        it('指定 userId 时只能获取自己的配置或系统配置', async () => {
            const { createStorageConfigDao, getStorageConfigByIdDao } = await import('../../../server/services/storage/storageConfig.dao')

            const userId = 1
            const created = await createStorageConfigDao({
                name: `${TEST_CONFIG_PREFIX}user_${Date.now()}`,
                type: StorageProviderType.ALIYUN_OSS,
                config: {
                    accessKeyId: 'key',
                    accessKeySecret: 'secret',
                    bucket: 'bucket',
                    region: 'cn-hangzhou',
                },
                userId,
            })
            createdConfigIds.push(created.id)

            const config = await getStorageConfigByIdDao(created.id, userId)
            expect(config).not.toBeNull()

            const otherUserConfig = await getStorageConfigByIdDao(created.id, 99999)
            expect(otherUserConfig).toBeNull()
        })
    })

    describe('getStorageConfigsDao - 获取配置列表', () => {
        it('应能获取配置列表', async () => {
            const { createStorageConfigDao, getStorageConfigsDao } = await import('../../../server/services/storage/storageConfig.dao')

            const created = await createStorageConfigDao({
                name: `${TEST_CONFIG_PREFIX}list_${Date.now()}`,
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

            const configs = await getStorageConfigsDao({ userId: 1, includeSystem: true })

            expect(Array.isArray(configs)).toBe(true)
        })

        it('按类型筛选应生效', async () => {
            const { createStorageConfigDao, getStorageConfigsDao } = await import('../../../server/services/storage/storageConfig.dao')

            const name = `${TEST_CONFIG_PREFIX}filter_${Date.now()}`
            await createStorageConfigDao({
                name,
                type: StorageProviderType.ALIYUN_OSS,
                config: {
                    accessKeyId: 'key',
                    accessKeySecret: 'secret',
                    bucket: 'bucket',
                    region: 'cn-hangzhou',
                },
                userId: 1,
            })

            const configs = await getStorageConfigsDao({
                userId: 1,
                includeSystem: true,
                type: StorageProviderType.ALIYUN_OSS,
            })

            expect(configs.every(c => c.type === StorageProviderType.ALIYUN_OSS)).toBe(true)
        })
    })

    describe('updateStorageConfigDao - 更新配置', () => {
        it('应能更新配置名称', async () => {
            const { createStorageConfigDao, updateStorageConfigDao } = await import('../../../server/services/storage/storageConfig.dao')

            const created = await createStorageConfigDao({
                name: `${TEST_CONFIG_PREFIX}old_name_${Date.now()}`,
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

            const newName = `${TEST_CONFIG_PREFIX}new_name_${Date.now()}`
            const updated = await updateStorageConfigDao(created.id, 1, { name: newName })

            expect(updated).not.toBeNull()
            expect(updated!.name).toBe(newName)
        })

        it('无权用户更新应返回 null', async () => {
            const { createStorageConfigDao, updateStorageConfigDao } = await import('../../../server/services/storage/storageConfig.dao')

            const created = await createStorageConfigDao({
                name: `${TEST_CONFIG_PREFIX}update_${Date.now()}`,
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

            // 用另一个用户更新
            const updated = await updateStorageConfigDao(created.id, 999, { name: 'hacked' })
            expect(updated).toBeNull()
        })

        it('设置为默认应取消其他默认配置', async () => {
            const { createStorageConfigDao, updateStorageConfigDao, getDefaultStorageConfigDao } = await import('../../../server/services/storage/storageConfig.dao')

            const created = await createStorageConfigDao({
                name: `${TEST_CONFIG_PREFIX}setdefault_${Date.now()}`,
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

            await updateStorageConfigDao(created.id, undefined, { isDefault: true })

            const defaultConfig = await getDefaultStorageConfigDao(StorageProviderType.ALIYUN_OSS)
            expect(defaultConfig?.id).toBe(created.id)
        })
    })

    describe('deleteStorageConfigDao - 删除配置', () => {
        it('软删除应设置 deletedAt', async () => {
            const { createStorageConfigDao, deleteStorageConfigDao, getStorageConfigByIdDao } = await import('../../../server/services/storage/storageConfig.dao')

            const created = await createStorageConfigDao({
                name: `${TEST_CONFIG_PREFIX}delete_${Date.now()}`,
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

            const result = await deleteStorageConfigDao(created.id, 1)
            expect(result).toBe(true)

            // 应该无法再查询到
            const config = await getStorageConfigByIdDao(created.id, 1)
            expect(config).toBeNull()
        })

        it('不存在的配置应返回 false', async () => {
            const { deleteStorageConfigDao } = await import('../../../server/services/storage/storageConfig.dao')

            const result = await deleteStorageConfigDao(999999999)
            expect(result).toBe(false)
        })
    })

    describe('isConfigNameExistsDao - 检查名称是否存在', () => {
        it('存在的名称应返回 true', async () => {
            const { createStorageConfigDao, isConfigNameExistsDao } = await import('../../../server/services/storage/storageConfig.dao')

            const name = `${TEST_CONFIG_PREFIX}exists_${Date.now()}`
            await createStorageConfigDao({
                name,
                type: StorageProviderType.ALIYUN_OSS,
                config: {
                    accessKeyId: 'key',
                    accessKeySecret: 'secret',
                    bucket: 'bucket',
                    region: 'cn-hangzhou',
                },
                userId: 1,
            })

            const exists = await isConfigNameExistsDao(name, 1)
            expect(exists).toBe(true)
        })

        it('不存在的名称应返回 false', async () => {
            const { isConfigNameExistsDao } = await import('../../../server/services/storage/storageConfig.dao')

            const exists = await isConfigNameExistsDao(`${TEST_CONFIG_PREFIX}nonexistent_${Date.now()}`, 1)
            expect(exists).toBe(false)
        })

        it('排除自身时应返回 false', async () => {
            const { createStorageConfigDao, isConfigNameExistsDao } = await import('../../../server/services/storage/storageConfig.dao')

            const created = await createStorageConfigDao({
                name: `${TEST_CONFIG_PREFIX}exclude_${Date.now()}`,
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

            const exists = await isConfigNameExistsDao(created.name, 1, created.id)
            expect(exists).toBe(false)
        })
    })

    describe('Property: CRUD 往返一致性', () => {
        it('创建的配置应能被正确查询到', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.string({ minLength: 1, maxLength: 30 }),
                    async (nameSuffix) => {
                        const { createStorageConfigDao, getStorageConfigByIdDao } = await import('../../../server/services/storage/storageConfig.dao')

                        const created = await createStorageConfigDao({
                            name: `${TEST_CONFIG_PREFIX}${nameSuffix}_${Date.now()}`,
                            type: StorageProviderType.ALIYUN_OSS,
                            config: {
                                accessKeyId: `key_${Date.now()}`,
                                accessKeySecret: `secret_${Date.now()}`,
                                bucket: `bucket-${Date.now()}`,
                                region: 'cn-hangzhou',
                            },
                        })
                        createdConfigIds.push(created.id)

                        const found = await getStorageConfigByIdDao(created.id)
                        expect(found).not.toBeNull()
                        expect(found!.id).toBe(created.id)
                        expect(found!.type).toBe(StorageProviderType.ALIYUN_OSS)
                    }
                ),
                { numRuns: 10 }
            )
        })
    })
})
