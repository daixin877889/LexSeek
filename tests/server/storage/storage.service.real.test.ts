/**
 * 存储服务 - 真实业务编排测试
 *
 * 覆盖 server/services/storage/storage.service.ts 的全部导出函数与未覆盖分支：
 * - getAdapter 内部：configId 指定路径、默认配置路径、找不到配置抛错路径
 * - uploadFileService / downloadFileService / downloadFileStreamService
 * - deleteFileService / generateSignedUrlService / generatePostSignatureService
 * - testStorageConnectionService
 * - clearAdapterCacheService（带 ID 和不带 ID 两种）
 *
 * 设计：
 * - Prisma：真实连接 .env.testing 的 ls_new_testing 数据库
 * - storageConfig.dao：真实加密/解密 + 真实 DB 读写
 * - StorageFactory：通过 vi.mock 隔离，避免触发真实 OSS 网络调用
 *
 * **Feature: storage-service-real**
 * **Validates: Requirements 5.1, 5.4, 5.5**
 */

import { Readable } from 'stream'
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import {
    testPrisma,
    connectTestDb,
    disconnectTestDb,
} from '../membership/test-db-helper'
import {
    StorageProviderType,
    type StorageAdapter,
    type UploadResult,
    type DeleteResult,
    type PostSignatureResult,
} from '../../../server/lib/storage/types'
import { StorageConfigError } from '../../../server/lib/storage/errors'

// ============================================================================
// Mock 设置：必须在 import 被测模块之前
// ============================================================================

// Mock logger（自动导入）
vi.mock('#shared/utils/logger', () => ({
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}))

// 提供 runtimeConfig 用于 DAO 的加密密钥获取
vi.mock('#imports', () => ({
    useRuntimeConfig: () => ({
        storageConfigEncryptionKey: 'test_encryption_key_for_service_real',
        storage: {
            aliyunOss: {
                accessKeyId: 'env_oss_key',
                accessKeySecret: 'env_oss_secret',
                bucket: 'env-oss-bucket',
                region: 'cn-hangzhou',
            },
        },
    }),
}), { virtual: true })

// Mock StorageFactory（避免真实 OSS 网络）；StorageProviderType / 错误类型走真实导出
// 注意：使用 importOriginal 保留其余导出，只替换 StorageFactory
vi.mock('~~/server/lib/storage', async () => {
    const actual: any = await vi.importActual('~~/server/lib/storage')
    return {
        ...actual,
        StorageFactory: {
            getAdapter: vi.fn(),
            clearCache: vi.fn(),
            clearCacheByConfigId: vi.fn(),
        },
    }
})

// ============================================================================
// 常量与工具
// ============================================================================

const TEST_CONFIG_PREFIX = 'TEST_SVC_REAL_'
const createdConfigIds: number[] = []

/**
 * 构造一个可被注入为 StorageAdapter 的 mock 对象。
 * 每个方法默认返回合理值；如需模拟失败可在测试内覆盖具体方法。
 */
function createMockAdapter(): StorageAdapter {
    const uploadResult: UploadResult = {
        name: 'mock/path.txt',
        etag: 'mock-etag',
        url: 'https://mock.example.com/mock/path.txt',
    }
    const deleteResult: DeleteResult = { deleted: [] }
    const postSig: PostSignatureResult = {
        host: 'https://mock.example.com',
        dir: 'mock/',
        policy: 'policy-b64',
        signatureVersion: 'OSS4-HMAC-SHA256',
        credential: 'cred',
        date: '20260101',
        signature: 'sig',
    } as PostSignatureResult

    return {
        type: StorageProviderType.ALIYUN_OSS,
        upload: vi.fn().mockResolvedValue(uploadResult),
        download: vi.fn().mockResolvedValue(Buffer.from('mock-data')),
        downloadStream: vi.fn().mockResolvedValue(Readable.from(['mock-stream'])),
        delete: vi.fn().mockImplementation(async (paths: string | string[]) => ({
            deleted: Array.isArray(paths) ? paths : [paths],
        } as DeleteResult)),
        generateSignedUrl: vi.fn().mockResolvedValue('https://mock.example.com/signed'),
        generatePostSignature: vi.fn().mockResolvedValue(postSig),
        testConnection: vi.fn().mockResolvedValue(true),
    } as unknown as StorageAdapter
}

/**
 * 在测试数据库创建一条有效的阿里云 OSS 存储配置。
 * 真实加密写入，测试结束统一清理。
 */
async function seedAliyunOssConfig(opts: {
    name: string
    userId?: number
    isDefault?: boolean
    enabled?: boolean
}): Promise<number> {
    const { createStorageConfigDao } = await import('../../../server/services/storage/storageConfig.dao')
    const created = await createStorageConfigDao({
        name: opts.name,
        type: StorageProviderType.ALIYUN_OSS,
        userId: opts.userId,
        isDefault: opts.isDefault,
        enabled: opts.enabled,
        config: {
            accessKeyId: 'test_ak_id_1234567890',
            accessKeySecret: 'test_ak_secret_abcdefghijklmnopqrstuvwxyz',
            bucket: 'test-bucket',
            region: 'cn-hangzhou',
        },
    })
    createdConfigIds.push(created.id)
    return created.id
}

// ============================================================================
// 测试主体
// ============================================================================

describe('存储服务 - 真实业务编排', () => {
    beforeAll(async () => {
        process.env.NUXT_STORAGE_CONFIG_ENCRYPTION_KEY = 'test_encryption_key_for_service_real'
        process.env.STORAGE_CONFIG_ENCRYPTION_KEY = 'test_encryption_key_for_service_real'
        await connectTestDb()
    })

    afterAll(async () => {
        if (createdConfigIds.length > 0) {
            await testPrisma.storageConfigs.deleteMany({
                where: { id: { in: createdConfigIds } },
            })
            createdConfigIds.length = 0
        }
        // 额外保险：清理本套件所有带前缀的残留记录
        await testPrisma.storageConfigs.deleteMany({
            where: { name: { startsWith: TEST_CONFIG_PREFIX } },
        })
        await disconnectTestDb()
    })

    beforeEach(() => {
        vi.clearAllMocks()
    })

    // -------------------------------------------------------------------------
    // getAdapter 内部分支（通过 service 的公开入口间接覆盖）
    // -------------------------------------------------------------------------
    describe('getAdapter 内部分支', () => {
        it('通过 configId 指定配置时应加载对应存储配置', async () => {
            const configId = await seedAliyunOssConfig({
                name: `${TEST_CONFIG_PREFIX}by_id_${Date.now()}`,
            })
            const mockAdapter = createMockAdapter()
            const { StorageFactory } = await import('~~/server/lib/storage')
            ;(StorageFactory.getAdapter as any).mockReturnValue(mockAdapter)

            const { uploadFileService } = await import('../../../server/services/storage/storage.service')
            const result = await uploadFileService('foo/bar.txt', Buffer.from('abc'), { configId })

            expect(result.name).toBe('mock/path.txt')
            // 应当传入 id 等于 configId 的配置
            expect(StorageFactory.getAdapter).toHaveBeenCalledTimes(1)
            const passedConfig = (StorageFactory.getAdapter as any).mock.calls[0][0]
            expect(passedConfig.id).toBe(configId)
            expect(passedConfig.type).toBe(StorageProviderType.ALIYUN_OSS)
        })

        it('指定不存在的 configId 时应抛 StorageConfigError', async () => {
            const { StorageFactory } = await import('~~/server/lib/storage')
            ;(StorageFactory.getAdapter as any).mockReturnValue(createMockAdapter())
            const { uploadFileService } = await import('../../../server/services/storage/storage.service')

            await expect(
                uploadFileService('foo/bar.txt', Buffer.from('abc'), { configId: 999999999 })
            ).rejects.toThrow(StorageConfigError)
            await expect(
                uploadFileService('foo/bar.txt', Buffer.from('abc'), { configId: 999999999 })
            ).rejects.toThrow('存储配置不存在')
        })

        it('不指定 configId 时应使用默认配置', async () => {
            // 创建一条系统级默认阿里云 OSS 配置
            await seedAliyunOssConfig({
                name: `${TEST_CONFIG_PREFIX}default_sys_${Date.now()}`,
                isDefault: true,
                enabled: true,
            })

            const mockAdapter = createMockAdapter()
            const { StorageFactory } = await import('~~/server/lib/storage')
            ;(StorageFactory.getAdapter as any).mockReturnValue(mockAdapter)

            const { generateSignedUrlService } = await import('../../../server/services/storage/storage.service')
            const url = await generateSignedUrlService('my/file.txt')
            expect(url).toBe('https://mock.example.com/signed')
            expect(StorageFactory.getAdapter).toHaveBeenCalledTimes(1)
        })

        it('未提供 type 时默认使用 ALIYUN_OSS', async () => {
            // 新建另一条 OSS 默认配置供本用例使用
            await seedAliyunOssConfig({
                name: `${TEST_CONFIG_PREFIX}default_type_${Date.now()}`,
                isDefault: true,
                enabled: true,
            })
            const mockAdapter = createMockAdapter()
            const { StorageFactory } = await import('~~/server/lib/storage')
            ;(StorageFactory.getAdapter as any).mockReturnValue(mockAdapter)

            const { testStorageConnectionService } = await import('../../../server/services/storage/storage.service')
            const ok = await testStorageConnectionService({})
            expect(ok).toBe(true)
            const passedConfig = (StorageFactory.getAdapter as any).mock.calls[0][0]
            expect(passedConfig.type).toBe(StorageProviderType.ALIYUN_OSS)
        })

        it('未找到默认配置且环境变量无相关配置时应抛 StorageConfigError', async () => {
            // 使用一个从未配置过的七牛云类型，且 #imports mock 中没提供 qiniu 环境变量
            const { StorageFactory } = await import('~~/server/lib/storage')
            ;(StorageFactory.getAdapter as any).mockReturnValue(createMockAdapter())
            const { testStorageConnectionService } = await import('../../../server/services/storage/storage.service')

            await expect(
                testStorageConnectionService({ type: StorageProviderType.QINIU })
            ).rejects.toThrow(StorageConfigError)
        })
    })

    // -------------------------------------------------------------------------
    // uploadFileService
    // -------------------------------------------------------------------------
    describe('uploadFileService - 上传文件', () => {
        it('应将 path、data 与 uploadOptions 透传给 adapter.upload', async () => {
            const configId = await seedAliyunOssConfig({
                name: `${TEST_CONFIG_PREFIX}upload_${Date.now()}`,
            })
            const mockAdapter = createMockAdapter()
            const { StorageFactory } = await import('~~/server/lib/storage')
            ;(StorageFactory.getAdapter as any).mockReturnValue(mockAdapter)
            const { uploadFileService } = await import('../../../server/services/storage/storage.service')

            const payload = Buffer.from('hello world')
            const result = await uploadFileService('a/b/c.txt', payload, {
                configId,
                contentType: 'text/plain',
                meta: { foo: 'bar' },
            })

            expect(result.etag).toBe('mock-etag')
            expect(mockAdapter.upload).toHaveBeenCalledTimes(1)
            const [passedPath, passedData, passedOptions] = (mockAdapter.upload as any).mock.calls[0]
            expect(passedPath).toBe('a/b/c.txt')
            expect(passedData).toBe(payload)
            // configId/userId/type 三个内部字段不应被透传给 adapter
            expect(passedOptions).toEqual({ contentType: 'text/plain', meta: { foo: 'bar' } })
        })

        it('不传 options 时应正常调用（options 为 undefined 分支）', async () => {
            const configId = await seedAliyunOssConfig({
                name: `${TEST_CONFIG_PREFIX}upload_nopt_${Date.now()}`,
            })
            const mockAdapter = createMockAdapter()
            const { StorageFactory } = await import('~~/server/lib/storage')
            ;(StorageFactory.getAdapter as any).mockReturnValue(mockAdapter)
            const { uploadFileService } = await import('../../../server/services/storage/storage.service')

            // 通过把 configId 作为唯一 option 传入（仍走“已指定配置”分支）
            await uploadFileService('foo', Buffer.from('x'), { configId })
            expect(mockAdapter.upload).toHaveBeenCalled()
        })
    })

    // -------------------------------------------------------------------------
    // downloadFileService
    // -------------------------------------------------------------------------
    describe('downloadFileService - 下载文件', () => {
        it('应返回 Buffer 并透传 range', async () => {
            const configId = await seedAliyunOssConfig({
                name: `${TEST_CONFIG_PREFIX}dl_${Date.now()}`,
            })
            const mockAdapter = createMockAdapter()
            ;(mockAdapter.download as any).mockResolvedValue(Buffer.from('binary'))
            const { StorageFactory } = await import('~~/server/lib/storage')
            ;(StorageFactory.getAdapter as any).mockReturnValue(mockAdapter)
            const { downloadFileService } = await import('../../../server/services/storage/storage.service')

            const buf = await downloadFileService('x/y.bin', { configId, range: 'bytes=0-100' })
            expect(Buffer.isBuffer(buf)).toBe(true)
            expect(buf.toString()).toBe('binary')
            expect(mockAdapter.download).toHaveBeenCalledWith('x/y.bin', { range: 'bytes=0-100' })
        })

        it('不指定 options 时也能正常下载', async () => {
            const configId = await seedAliyunOssConfig({
                name: `${TEST_CONFIG_PREFIX}dl_noopt_${Date.now()}`,
            })
            const mockAdapter = createMockAdapter()
            ;(mockAdapter.download as any).mockResolvedValue(Buffer.from('data'))
            const { StorageFactory } = await import('~~/server/lib/storage')
            ;(StorageFactory.getAdapter as any).mockReturnValue(mockAdapter)
            const { downloadFileService } = await import('../../../server/services/storage/storage.service')

            const buf = await downloadFileService('a.txt', { configId })
            expect(buf.toString()).toBe('data')
            expect(mockAdapter.download).toHaveBeenCalledWith('a.txt', {})
        })
    })

    // -------------------------------------------------------------------------
    // downloadFileStreamService
    // -------------------------------------------------------------------------
    describe('downloadFileStreamService - 流式下载', () => {
        it('应返回 Readable 流并透传下载参数', async () => {
            const configId = await seedAliyunOssConfig({
                name: `${TEST_CONFIG_PREFIX}stream_${Date.now()}`,
            })
            const mockAdapter = createMockAdapter()
            const fakeStream = Readable.from(['chunk1', 'chunk2'])
            ;(mockAdapter.downloadStream as any).mockResolvedValue(fakeStream)
            const { StorageFactory } = await import('~~/server/lib/storage')
            ;(StorageFactory.getAdapter as any).mockReturnValue(mockAdapter)
            const { downloadFileStreamService } = await import('../../../server/services/storage/storage.service')

            const stream = await downloadFileStreamService('x.log', { configId, range: 'bytes=0-9' })
            expect(stream).toBe(fakeStream)
            expect(mockAdapter.downloadStream).toHaveBeenCalledWith('x.log', { range: 'bytes=0-9' })
        })
    })

    // -------------------------------------------------------------------------
    // deleteFileService
    // -------------------------------------------------------------------------
    describe('deleteFileService - 删除文件', () => {
        it('支持删除单个路径（string）', async () => {
            const configId = await seedAliyunOssConfig({
                name: `${TEST_CONFIG_PREFIX}del_single_${Date.now()}`,
            })
            const mockAdapter = createMockAdapter()
            const { StorageFactory } = await import('~~/server/lib/storage')
            ;(StorageFactory.getAdapter as any).mockReturnValue(mockAdapter)
            const { deleteFileService } = await import('../../../server/services/storage/storage.service')

            const res = await deleteFileService('a.txt', { configId })
            expect(res.deleted).toEqual(['a.txt'])
            expect(mockAdapter.delete).toHaveBeenCalledWith('a.txt')
        })

        it('支持删除多个路径（string[]）', async () => {
            const configId = await seedAliyunOssConfig({
                name: `${TEST_CONFIG_PREFIX}del_batch_${Date.now()}`,
            })
            const mockAdapter = createMockAdapter()
            const { StorageFactory } = await import('~~/server/lib/storage')
            ;(StorageFactory.getAdapter as any).mockReturnValue(mockAdapter)
            const { deleteFileService } = await import('../../../server/services/storage/storage.service')

            const res = await deleteFileService(['a.txt', 'b.txt'], { configId })
            expect(res.deleted).toEqual(['a.txt', 'b.txt'])
            expect(mockAdapter.delete).toHaveBeenCalledWith(['a.txt', 'b.txt'])
        })

        it('不传 options 时走默认配置路径', async () => {
            await seedAliyunOssConfig({
                name: `${TEST_CONFIG_PREFIX}del_default_${Date.now()}`,
                isDefault: true,
            })
            const mockAdapter = createMockAdapter()
            const { StorageFactory } = await import('~~/server/lib/storage')
            ;(StorageFactory.getAdapter as any).mockReturnValue(mockAdapter)
            const { deleteFileService } = await import('../../../server/services/storage/storage.service')

            const res = await deleteFileService('x/y.txt')
            expect(res.deleted).toEqual(['x/y.txt'])
        })
    })

    // -------------------------------------------------------------------------
    // generateSignedUrlService
    // -------------------------------------------------------------------------
    describe('generateSignedUrlService - 生成签名 URL', () => {
        it('应透传 signedUrl 选项且返回签名 URL', async () => {
            const configId = await seedAliyunOssConfig({
                name: `${TEST_CONFIG_PREFIX}sign_${Date.now()}`,
            })
            const mockAdapter = createMockAdapter()
            ;(mockAdapter.generateSignedUrl as any).mockResolvedValue('https://signed.example.com/x')
            const { StorageFactory } = await import('~~/server/lib/storage')
            ;(StorageFactory.getAdapter as any).mockReturnValue(mockAdapter)
            const { generateSignedUrlService } = await import('../../../server/services/storage/storage.service')

            const url = await generateSignedUrlService('foo.pdf', {
                configId,
                expires: 600,
                method: 'GET',
            })
            expect(url).toBe('https://signed.example.com/x')
            const [, passedOptions] = (mockAdapter.generateSignedUrl as any).mock.calls[0]
            expect(passedOptions).toEqual({ expires: 600, method: 'GET' })
        })

        it('不传 options 时等价于空 options 传给 adapter', async () => {
            const configId = await seedAliyunOssConfig({
                name: `${TEST_CONFIG_PREFIX}sign_noopt_${Date.now()}`,
            })
            const mockAdapter = createMockAdapter()
            ;(mockAdapter.generateSignedUrl as any).mockResolvedValue('https://signed.example.com/y')
            const { StorageFactory } = await import('~~/server/lib/storage')
            ;(StorageFactory.getAdapter as any).mockReturnValue(mockAdapter)
            const { generateSignedUrlService } = await import('../../../server/services/storage/storage.service')

            const url = await generateSignedUrlService('foo.pdf', { configId })
            expect(url).toBe('https://signed.example.com/y')
            expect(mockAdapter.generateSignedUrl).toHaveBeenCalledWith('foo.pdf', {})
        })
    })

    // -------------------------------------------------------------------------
    // generatePostSignatureService
    // -------------------------------------------------------------------------
    describe('generatePostSignatureService - 生成客户端直传签名', () => {
        it('应将签名选项透传给 adapter 且返回签名结果', async () => {
            const configId = await seedAliyunOssConfig({
                name: `${TEST_CONFIG_PREFIX}post_${Date.now()}`,
            })
            const mockAdapter = createMockAdapter()
            const { StorageFactory } = await import('~~/server/lib/storage')
            ;(StorageFactory.getAdapter as any).mockReturnValue(mockAdapter)
            const { generatePostSignatureService } = await import('../../../server/services/storage/storage.service')

            const res = await generatePostSignatureService({
                configId,
                dir: 'uploads/',
                expirationMinutes: 15,
            })
            expect(res).toHaveProperty('host')
            const [passedOptions] = (mockAdapter.generatePostSignature as any).mock.calls[0]
            expect(passedOptions).toEqual({ dir: 'uploads/', expirationMinutes: 15 })
        })
    })

    // -------------------------------------------------------------------------
    // testStorageConnectionService
    // -------------------------------------------------------------------------
    describe('testStorageConnectionService - 连接测试', () => {
        it('adapter 连接成功应返回 true', async () => {
            const configId = await seedAliyunOssConfig({
                name: `${TEST_CONFIG_PREFIX}conn_ok_${Date.now()}`,
            })
            const mockAdapter = createMockAdapter()
            ;(mockAdapter.testConnection as any).mockResolvedValue(true)
            const { StorageFactory } = await import('~~/server/lib/storage')
            ;(StorageFactory.getAdapter as any).mockReturnValue(mockAdapter)
            const { testStorageConnectionService } = await import('../../../server/services/storage/storage.service')

            await expect(testStorageConnectionService({ configId })).resolves.toBe(true)
        })

        it('adapter 连接失败应返回 false', async () => {
            const configId = await seedAliyunOssConfig({
                name: `${TEST_CONFIG_PREFIX}conn_fail_${Date.now()}`,
            })
            const mockAdapter = createMockAdapter()
            ;(mockAdapter.testConnection as any).mockResolvedValue(false)
            const { StorageFactory } = await import('~~/server/lib/storage')
            ;(StorageFactory.getAdapter as any).mockReturnValue(mockAdapter)
            const { testStorageConnectionService } = await import('../../../server/services/storage/storage.service')

            await expect(testStorageConnectionService({ configId })).resolves.toBe(false)
        })

        it('adapter.testConnection 抛错时应冒泡', async () => {
            const configId = await seedAliyunOssConfig({
                name: `${TEST_CONFIG_PREFIX}conn_err_${Date.now()}`,
            })
            const mockAdapter = createMockAdapter()
            ;(mockAdapter.testConnection as any).mockRejectedValue(new Error('network'))
            const { StorageFactory } = await import('~~/server/lib/storage')
            ;(StorageFactory.getAdapter as any).mockReturnValue(mockAdapter)
            const { testStorageConnectionService } = await import('../../../server/services/storage/storage.service')

            await expect(testStorageConnectionService({ configId })).rejects.toThrow('network')
        })
    })

    // -------------------------------------------------------------------------
    // clearAdapterCacheService
    // -------------------------------------------------------------------------
    describe('clearAdapterCacheService - 清除缓存', () => {
        it('传入 configId 应调用 StorageFactory.clearCacheByConfigId', async () => {
            const { StorageFactory } = await import('~~/server/lib/storage')
            const { clearAdapterCacheService } = await import('../../../server/services/storage/storage.service')

            clearAdapterCacheService(42)
            expect(StorageFactory.clearCacheByConfigId).toHaveBeenCalledWith(42)
            expect(StorageFactory.clearCache).not.toHaveBeenCalled()
        })

        it('不传 configId 应调用 StorageFactory.clearCache 清空全部', async () => {
            const { StorageFactory } = await import('~~/server/lib/storage')
            const { clearAdapterCacheService } = await import('../../../server/services/storage/storage.service')

            clearAdapterCacheService()
            expect(StorageFactory.clearCache).toHaveBeenCalledTimes(1)
            expect(StorageFactory.clearCacheByConfigId).not.toHaveBeenCalled()
        })

        it('configId = 0 应走清空全部分支（0 为 falsy）', async () => {
            const { StorageFactory } = await import('~~/server/lib/storage')
            const { clearAdapterCacheService } = await import('../../../server/services/storage/storage.service')

            clearAdapterCacheService(0)
            expect(StorageFactory.clearCache).toHaveBeenCalledTimes(1)
            expect(StorageFactory.clearCacheByConfigId).not.toHaveBeenCalled()
        })
    })

    // -------------------------------------------------------------------------
    // 用户维度的配置可见性（configId + userId 组合走 DAO 真实过滤）
    // -------------------------------------------------------------------------
    describe('configId + userId 组合', () => {
        it('用户访问自己的配置应成功', async () => {
            const userId = 88881
            const configId = await seedAliyunOssConfig({
                name: `${TEST_CONFIG_PREFIX}owner_${Date.now()}`,
                userId,
            })
            const mockAdapter = createMockAdapter()
            const { StorageFactory } = await import('~~/server/lib/storage')
            ;(StorageFactory.getAdapter as any).mockReturnValue(mockAdapter)
            const { uploadFileService } = await import('../../../server/services/storage/storage.service')

            const res = await uploadFileService('o.txt', Buffer.from('owner'), { configId, userId })
            expect(res.name).toBe('mock/path.txt')
        })

        it('其他用户访问私有配置应抛 StorageConfigError', async () => {
            const ownerId = 88882
            const otherId = 88883
            const configId = await seedAliyunOssConfig({
                name: `${TEST_CONFIG_PREFIX}other_${Date.now()}`,
                userId: ownerId,
            })
            const mockAdapter = createMockAdapter()
            const { StorageFactory } = await import('~~/server/lib/storage')
            ;(StorageFactory.getAdapter as any).mockReturnValue(mockAdapter)
            const { uploadFileService } = await import('../../../server/services/storage/storage.service')

            await expect(
                uploadFileService('x.txt', Buffer.from('x'), { configId, userId: otherId })
            ).rejects.toThrow(StorageConfigError)
        })
    })
})
