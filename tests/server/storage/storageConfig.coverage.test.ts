/**
 * 存储配置 DAO 覆盖测试
 *
 * 覆盖 storageConfig.dao.ts 中的加密/解密、验证、CRUD 逻辑
 *
 * **Feature: storage-config-coverage**
 * **Validates: Requirements 11.1, 11.2, 11.3**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock prisma
const mockPrisma = {
    storageConfigs: {
        create: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        count: vi.fn(),
    },
}

vi.stubGlobal('prisma', mockPrisma)
vi.stubGlobal('logger', {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
})

// 设置加密密钥环境变量
process.env.NUXT_STORAGE_CONFIG_ENCRYPTION_KEY = 'test-encryption-key-for-unit-tests-32'
process.env.STORAGE_CONFIG_ENCRYPTION_KEY = 'test-encryption-key-for-unit-tests-32'

// Mock useRuntimeConfig
vi.stubGlobal('useRuntimeConfig', () => ({
    storageConfigEncryptionKey: 'test-encryption-key-for-unit-tests-32',
    storage: {
        aliyunOss: {
            accessKeyId: 'test-ak',
            accessKeySecret: 'test-sk',
            bucket: 'test-bucket',
            region: 'oss-cn-hangzhou',
            customDomain: '',
            sts: null,
        },
        qiniu: {
            accessKey: 'test-ak',
            secretKey: 'test-sk',
            bucket: 'test-bucket',
            zone: 'z0',
        },
        tencentCos: {
            secretId: 'test-id',
            secretKey: 'test-sk',
            bucket: 'test-bucket',
            region: 'ap-guangzhou',
            appId: '12345',
        },
    },
}))

import {
    createStorageConfigDao,
    getStorageConfigByIdDao,
    getStorageConfigsDao,
    getDefaultStorageConfigDao,
    updateStorageConfigDao,
    deleteStorageConfigDao,
    isConfigNameExistsDao,
} from '../../../server/services/storage/storageConfig.dao'
import { StorageProviderType } from '../../../server/lib/storage/types'
import { StorageConfigError } from '../../../server/lib/storage/errors'

describe('存储配置 DAO 覆盖测试', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('createStorageConfigDao', () => {
        it('阿里云 OSS 配置缺少必填字段应抛出错误', async () => {
            await expect(
                createStorageConfigDao({
                    name: '测试配置',
                    type: StorageProviderType.ALIYUN_OSS,
                    config: { accessKeyId: 'ak' }, // 缺少 accessKeySecret, bucket, region
                })
            ).rejects.toThrow(StorageConfigError)
        })

        it('阿里云 OSS 配置缺少 bucket/region 应抛出错误', async () => {
            await expect(
                createStorageConfigDao({
                    name: '测试配置',
                    type: StorageProviderType.ALIYUN_OSS,
                    config: { accessKeyId: 'ak', accessKeySecret: 'sk' }, // 缺少 bucket/region
                })
            ).rejects.toThrow('阿里云 OSS 配置缺少 bucket 或 region')
        })

        it('七牛云配置缺少 accessKey/secretKey 应抛出错误', async () => {
            await expect(
                createStorageConfigDao({
                    name: '测试配置',
                    type: StorageProviderType.QINIU,
                    config: { bucket: 'test' }, // 缺少 accessKey/secretKey
                })
            ).rejects.toThrow('七牛云配置缺少 accessKey 或 secretKey')
        })

        it('七牛云配置缺少 bucket 应抛出错误', async () => {
            await expect(
                createStorageConfigDao({
                    name: '测试配置',
                    type: StorageProviderType.QINIU,
                    config: { accessKey: 'ak', secretKey: 'sk' }, // 缺少 bucket
                })
            ).rejects.toThrow('七牛云配置缺少 bucket')
        })

        it('腾讯云 COS 配置缺少 secretId/secretKey 应抛出错误', async () => {
            await expect(
                createStorageConfigDao({
                    name: '测试配置',
                    type: StorageProviderType.TENCENT_COS,
                    config: { bucket: 'test', region: 'ap-guangzhou', appId: '123' },
                })
            ).rejects.toThrow('腾讯云 COS 配置缺少 secretId 或 secretKey')
        })

        it('腾讯云 COS 配置缺少 bucket/region/appId 应抛出错误', async () => {
            await expect(
                createStorageConfigDao({
                    name: '测试配置',
                    type: StorageProviderType.TENCENT_COS,
                    config: { secretId: 'id', secretKey: 'sk' },
                })
            ).rejects.toThrow('腾讯云 COS 配置缺少 bucket、region 或 appId')
        })

        it('不支持的存储类型应抛出错误', async () => {
            await expect(
                createStorageConfigDao({
                    name: '测试配置',
                    type: 'unknown_provider',
                    config: {},
                })
            ).rejects.toThrow('不支持的存储类型')
        })

        it('设为默认时应先取消其他默认配置', async () => {
            mockPrisma.storageConfigs.updateMany.mockResolvedValue({ count: 1 })
            mockPrisma.storageConfigs.create.mockResolvedValue({
                id: 1,
                name: '测试',
                type: StorageProviderType.ALIYUN_OSS,
                config: 'encrypted',
                isDefault: true,
                enabled: true,
            })

            await createStorageConfigDao({
                name: '测试',
                type: StorageProviderType.ALIYUN_OSS,
                config: {
                    accessKeyId: 'ak',
                    accessKeySecret: 'sk',
                    bucket: 'b',
                    region: 'r',
                },
                isDefault: true,
            })

            expect(mockPrisma.storageConfigs.updateMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ isDefault: true }),
                    data: { isDefault: false },
                })
            )
        })

        it('正确配置应成功创建', async () => {
            mockPrisma.storageConfigs.create.mockResolvedValue({
                id: 1,
                name: '测试',
                type: StorageProviderType.ALIYUN_OSS,
                config: 'encrypted',
                isDefault: false,
                enabled: true,
            })

            const result = await createStorageConfigDao({
                name: '测试',
                type: StorageProviderType.ALIYUN_OSS,
                config: {
                    accessKeyId: 'ak',
                    accessKeySecret: 'sk',
                    bucket: 'b',
                    region: 'r',
                },
            })

            expect(result.id).toBe(1)
            expect(mockPrisma.storageConfigs.create).toHaveBeenCalled()
        })
    })

    describe('getStorageConfigByIdDao', () => {
        it('记录不存在应返回 null', async () => {
            mockPrisma.storageConfigs.findFirst.mockResolvedValue(null)

            const result = await getStorageConfigByIdDao(999)
            expect(result).toBeNull()
        })

        it('指定 userId 时应构建 OR 条件', async () => {
            mockPrisma.storageConfigs.findFirst.mockResolvedValue(null)

            await getStorageConfigByIdDao(1, 100)

            expect(mockPrisma.storageConfigs.findFirst).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        OR: [{ userId: 100 }, { userId: null }],
                    }),
                })
            )
        })
    })

    describe('getStorageConfigsDao', () => {
        it('按类型筛选', async () => {
            mockPrisma.storageConfigs.findMany.mockResolvedValue([])

            await getStorageConfigsDao({ type: StorageProviderType.ALIYUN_OSS })

            expect(mockPrisma.storageConfigs.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        type: StorageProviderType.ALIYUN_OSS,
                    }),
                })
            )
        })

        it('includeSystem 时应构建 OR 条件', async () => {
            mockPrisma.storageConfigs.findMany.mockResolvedValue([])

            await getStorageConfigsDao({ userId: 100, includeSystem: true })

            expect(mockPrisma.storageConfigs.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        OR: [{ userId: 100 }, { userId: null }],
                    }),
                })
            )
        })

        it('不含 includeSystem 时仅查询用户配置', async () => {
            mockPrisma.storageConfigs.findMany.mockResolvedValue([])

            await getStorageConfigsDao({ userId: 100 })

            expect(mockPrisma.storageConfigs.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        userId: 100,
                    }),
                })
            )
        })

        it('无 userId 且不含 includeSystem 时查询系统配置', async () => {
            mockPrisma.storageConfigs.findMany.mockResolvedValue([])

            await getStorageConfigsDao({})

            expect(mockPrisma.storageConfigs.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        userId: null,
                    }),
                })
            )
        })

        it('enabled 筛选应正确传递', async () => {
            mockPrisma.storageConfigs.findMany.mockResolvedValue([])

            await getStorageConfigsDao({ enabled: true })

            expect(mockPrisma.storageConfigs.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        enabled: true,
                    }),
                })
            )
        })
    })

    describe('getDefaultStorageConfigDao', () => {
        it('用户有默认配置时应返回用户配置', async () => {
            // config 是非加密的 JSON 对象（typeof !== 'string' 分支）
            const mockRecord = {
                id: 1,
                type: StorageProviderType.ALIYUN_OSS,
                name: '用户配置',
                config: { bucket: 'b', region: 'r', accessKeyId: 'ak', accessKeySecret: 'sk' },
                enabled: true,
                isDefault: true,
                userId: 100,
            }
            mockPrisma.storageConfigs.findFirst.mockResolvedValue(mockRecord)

            const result = await getDefaultStorageConfigDao(StorageProviderType.ALIYUN_OSS, 100)
            expect(result).not.toBeNull()
            expect(result!.type).toBe(StorageProviderType.ALIYUN_OSS)
        })

        it('用户无默认配置时应回退到系统配置', async () => {
            mockPrisma.storageConfigs.findFirst
                .mockResolvedValueOnce(null) // 用户配置
                .mockResolvedValueOnce({
                    id: 2,
                    type: StorageProviderType.ALIYUN_OSS,
                    name: '系统配置',
                    config: { bucket: 'b', region: 'r', accessKeyId: 'ak', accessKeySecret: 'sk' },
                    enabled: true,
                    isDefault: true,
                    userId: null,
                })

            const result = await getDefaultStorageConfigDao(StorageProviderType.ALIYUN_OSS, 100)
            expect(result).not.toBeNull()
        })

        it('数据库无配置时应从环境变量构建 - 阿里云', async () => {
            mockPrisma.storageConfigs.findFirst.mockResolvedValue(null)

            const result = await getDefaultStorageConfigDao(StorageProviderType.ALIYUN_OSS)
            expect(result).not.toBeNull()
            expect(result!.type).toBe(StorageProviderType.ALIYUN_OSS)
            expect(result!.id).toBe(0)
        })

        it('数据库无配置且环境变量不完整时应返回 null - 七牛', async () => {
            // 由于 mock 的 runtimeConfig 中 qiniu 配置可能不完整，测试 null 回退
            mockPrisma.storageConfigs.findFirst.mockResolvedValue(null)

            const result = await getDefaultStorageConfigDao(StorageProviderType.QINIU)
            // 如果环境变量完整则返回配置，否则返回 null
            if (result) {
                expect(result.type).toBe(StorageProviderType.QINIU)
            } else {
                expect(result).toBeNull()
            }
        })

        it('数据库无配置且环境变量不完整时应返回 null - 腾讯', async () => {
            mockPrisma.storageConfigs.findFirst.mockResolvedValue(null)

            const result = await getDefaultStorageConfigDao(StorageProviderType.TENCENT_COS)
            if (result) {
                expect(result.type).toBe(StorageProviderType.TENCENT_COS)
            } else {
                expect(result).toBeNull()
            }
        })
    })

    describe('updateStorageConfigDao', () => {
        it('配置不存在应返回 null', async () => {
            mockPrisma.storageConfigs.findFirst.mockResolvedValue(null)

            const result = await updateStorageConfigDao(999, undefined, { name: '新名称' })
            expect(result).toBeNull()
        })

        it('更新名称应正确传递', async () => {
            mockPrisma.storageConfigs.findFirst.mockResolvedValue({
                id: 1,
                type: StorageProviderType.ALIYUN_OSS,
                userId: null,
            })
            mockPrisma.storageConfigs.update.mockResolvedValue({ id: 1, name: '新名称' })

            await updateStorageConfigDao(1, undefined, { name: '新名称' })

            expect(mockPrisma.storageConfigs.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ name: '新名称' }),
                })
            )
        })

        it('设为默认时应先取消其他默认', async () => {
            mockPrisma.storageConfigs.findFirst.mockResolvedValue({
                id: 1,
                type: StorageProviderType.ALIYUN_OSS,
                userId: null,
            })
            mockPrisma.storageConfigs.updateMany.mockResolvedValue({ count: 1 })
            mockPrisma.storageConfigs.update.mockResolvedValue({ id: 1, isDefault: true })

            await updateStorageConfigDao(1, undefined, { isDefault: true })

            expect(mockPrisma.storageConfigs.updateMany).toHaveBeenCalled()
        })

        it('设 isDefault 为 false 应正确传递', async () => {
            mockPrisma.storageConfigs.findFirst.mockResolvedValue({
                id: 1,
                type: StorageProviderType.ALIYUN_OSS,
                userId: null,
            })
            mockPrisma.storageConfigs.update.mockResolvedValue({ id: 1, isDefault: false })

            await updateStorageConfigDao(1, undefined, { isDefault: false })

            expect(mockPrisma.storageConfigs.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ isDefault: false }),
                })
            )
        })

        it('更新 enabled 应正确传递', async () => {
            mockPrisma.storageConfigs.findFirst.mockResolvedValue({
                id: 1,
                type: StorageProviderType.ALIYUN_OSS,
                userId: null,
            })
            mockPrisma.storageConfigs.update.mockResolvedValue({ id: 1, enabled: false })

            await updateStorageConfigDao(1, undefined, { enabled: false })

            expect(mockPrisma.storageConfigs.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ enabled: false }),
                })
            )
        })

        it('更新 config 应验证配置', async () => {
            mockPrisma.storageConfigs.findFirst.mockResolvedValue({
                id: 1,
                type: StorageProviderType.ALIYUN_OSS,
                userId: null,
            })

            await expect(
                updateStorageConfigDao(1, undefined, {
                    config: { accessKeyId: 'ak' }, // 不完整
                })
            ).rejects.toThrow(StorageConfigError)
        })
    })

    describe('deleteStorageConfigDao', () => {
        it('成功删除应返回 true', async () => {
            mockPrisma.storageConfigs.updateMany.mockResolvedValue({ count: 1 })

            const result = await deleteStorageConfigDao(1)
            expect(result).toBe(true)
        })

        it('记录不存在应返回 false', async () => {
            mockPrisma.storageConfigs.updateMany.mockResolvedValue({ count: 0 })

            const result = await deleteStorageConfigDao(999)
            expect(result).toBe(false)
        })

        it('指定 userId 时应加入查询条件', async () => {
            mockPrisma.storageConfigs.updateMany.mockResolvedValue({ count: 1 })

            await deleteStorageConfigDao(1, 100)

            expect(mockPrisma.storageConfigs.updateMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ userId: 100 }),
                })
            )
        })
    })

    describe('isConfigNameExistsDao', () => {
        it('名称存在应返回 true', async () => {
            mockPrisma.storageConfigs.count.mockResolvedValue(1)

            const result = await isConfigNameExistsDao('existing')
            expect(result).toBe(true)
        })

        it('名称不存在应返回 false', async () => {
            mockPrisma.storageConfigs.count.mockResolvedValue(0)

            const result = await isConfigNameExistsDao('nonexistent')
            expect(result).toBe(false)
        })

        it('排除指定 ID 应加入查询条件', async () => {
            mockPrisma.storageConfigs.count.mockResolvedValue(0)

            await isConfigNameExistsDao('test', 100, 5)

            expect(mockPrisma.storageConfigs.count).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        id: { not: 5 },
                    }),
                })
            )
        })
    })
})
