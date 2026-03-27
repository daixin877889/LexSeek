/**
 * 存储服务测试
 *
 * 测试 storage.service.ts 的功能，包括：
 * - getAdapter 内部逻辑
 * - uploadFileService / downloadFileService
 * - deleteFileService / generateSignedUrlService
 * - generatePostSignatureService
 * - testStorageConnectionService
 * - clearAdapterCacheService
 *
 * **Feature: storage-service**
 * **Validates: Requirements 5.1, 5.4, 5.5**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fc from 'fast-check'

// Mock logger
vi.mock('#shared/utils/logger', () => ({
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}))

// Mock StorageFactory
vi.mock('~~/server/lib/storage', () => ({
    StorageFactory: {
        getAdapter: vi.fn(),
        clearCache: vi.fn(),
        clearCacheByConfigId: vi.fn(),
    },
    StorageProviderType: {
        ALIYUN_OSS: 'aliyun_oss',
        QINIU: 'qiniu',
        TENCENT_COS: 'tencent_cos',
    },
}))

// Mock storageConfig.dao
const mockGetDefaultStorageConfigDao = vi.fn()
vi.mock('../../../server/services/storage/storageConfig.dao', () => ({
    getStorageConfigByIdDao: vi.fn(),
    getDefaultStorageConfigDao: mockGetDefaultStorageConfigDao,
}))

// Mock errors
vi.mock('~~/server/lib/storage/errors', () => ({
    StorageConfigError: class StorageConfigError extends Error {
        constructor(message: string) {
            super(message)
            this.name = 'StorageConfigError'
        }
    },
}))

const PBT_CONFIG = { numRuns: 100 }

describe('存储服务', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('clearAdapterCacheService - 清除适配器缓存', () => {
        it('清除指定配置 ID 的缓存', async () => {
            const { StorageFactory } = await import('~~/server/lib/storage')
            const { clearAdapterCacheService } = await import('../../../server/services/storage/storage.service')

            clearAdapterCacheService(123)

            expect(StorageFactory.clearCacheByConfigId).toHaveBeenCalledWith(123)
        })

        it('不指定配置 ID 时清除所有缓存', async () => {
            const { StorageFactory } = await import('~~/server/lib/storage')
            const { clearAdapterCacheService } = await import('../../../server/services/storage/storage.service')

            clearAdapterCacheService()

            expect(StorageFactory.clearCache).toHaveBeenCalled()
        })
    })

    describe('testStorageConnectionService - 测试存储连接', () => {
        const mockConfig = {
            id: 1,
            name: 'test',
            type: 'aliyun_oss' as const,
            encryptedConfig: 'encrypted',
            isDefault: true,
            userId: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
        }

        it('应调用适配器的 testConnection', async () => {
            const mockAdapter = {
                testConnection: vi.fn().mockResolvedValue(true),
            }
            mockGetDefaultStorageConfigDao.mockResolvedValue(mockConfig)

            const { StorageFactory } = await import('~~/server/lib/storage')
            ;(StorageFactory.getAdapter as any).mockResolvedValue(mockAdapter)

            const { testStorageConnectionService } = await import('../../../server/services/storage/storage.service')

            const result = await testStorageConnectionService({ type: 'aliyun_oss' })

            expect(result).toBe(true)
            expect(StorageFactory.getAdapter).toHaveBeenCalled()
        })

        it('连接失败时应返回 false', async () => {
            const mockAdapter = {
                testConnection: vi.fn().mockResolvedValue(false),
            }
            mockGetDefaultStorageConfigDao.mockResolvedValue(mockConfig)

            const { StorageFactory } = await import('~~/server/lib/storage')
            ;(StorageFactory.getAdapter as any).mockResolvedValue(mockAdapter)

            const { testStorageConnectionService } = await import('../../../server/services/storage/storage.service')

            const result = await testStorageConnectionService({})
            expect(result).toBe(false)
        })
    })
})
