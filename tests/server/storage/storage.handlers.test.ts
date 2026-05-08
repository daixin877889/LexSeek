/**
 * server/api/v1/storage/** handler 单元覆盖（9 文件）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../_helpers/handler-test'
import { makeEvent, expectSuccess, expectError } from '../_helpers/handler-test'

vi.mock('~~/server/services/files/ossFiles.dao', () => ({
    createOssFileDao: vi.fn(),
    createOssFilesDao: vi.fn(),
    updateOssFileDao: vi.fn(),
}))
vi.mock('~~/server/services/storage/storage.service', () => ({
    generatePostSignatureService: vi.fn(),
    testStorageConnectionService: vi.fn(),
    clearAdapterCacheService: vi.fn(),
}))
vi.mock('~~/server/services/storage/storageConfig.dao', () => ({
    getStorageConfigsDao: vi.fn(),
    createStorageConfigDao: vi.fn(),
    deleteStorageConfigDao: vi.fn(),
    updateStorageConfigDao: vi.fn(),
    isConfigNameExistsDao: vi.fn(),
}))
vi.mock('~~/server/services/membership/userBenefit.service', () => ({
    checkStorageQuotaService: vi.fn(),
}))

;(globalThis as any).prisma = {
    $transaction: vi.fn(async (fn: any) => fn({})),
}

import { createOssFileDao, createOssFilesDao, updateOssFileDao } from '~~/server/services/files/ossFiles.dao'
import { generatePostSignatureService, testStorageConnectionService, clearAdapterCacheService } from '~~/server/services/storage/storage.service'
import {
    getStorageConfigsDao,
    createStorageConfigDao,
    deleteStorageConfigDao,
    updateStorageConfigDao,
    isConfigNameExistsDao,
} from '~~/server/services/storage/storageConfig.dao'
import { checkStorageQuotaService } from '~~/server/services/membership/userBenefit.service'

const mCreateOss = vi.mocked(createOssFileDao)
const mCreateOssBatch = vi.mocked(createOssFilesDao)
const mUpdateOss = vi.mocked(updateOssFileDao)
const mGenSign = vi.mocked(generatePostSignatureService)
const mTestConn = vi.mocked(testStorageConnectionService)
const mClearCache = vi.mocked(clearAdapterCacheService)
const mGetConfigs = vi.mocked(getStorageConfigsDao)
const mCreateConfig = vi.mocked(createStorageConfigDao)
const mDeleteConfig = vi.mocked(deleteStorageConfigDao)
const mUpdateConfig = vi.mocked(updateStorageConfigDao)
const mIsNameExist = vi.mocked(isConfigNameExistsDao)
const mCheckQuota = vi.mocked(checkStorageQuotaService)

const { default: callbackHandler } = await import('../../../server/api/v1/storage/callback/.post')
const { default: configsListHandler } = await import('../../../server/api/v1/storage/config/.get')
const { default: configCreateHandler } = await import('../../../server/api/v1/storage/config/.post')
const { default: configDeleteHandler } = await import('../../../server/api/v1/storage/config/[id].delete')
const { default: configUpdateHandler } = await import('../../../server/api/v1/storage/config/[id].put')
const { default: configTestHandler } = await import('../../../server/api/v1/storage/config/test.post')
const { default: presignedGetHandler } = await import('../../../server/api/v1/storage/presigned-url/.get')
const { default: presignedPostHandler } = await import('../../../server/api/v1/storage/presigned-url/.post')
const { default: presignedConfigHandler } = await import('../../../server/api/v1/storage/presigned-url/config.get')

describe('POST /api/v1/storage/callback', () => {
    beforeEach(() => vi.clearAllMocks())

    it('happy path → 更新文件状态为 UPLOADED', async () => {
        const res: any = await callbackHandler(makeEvent({
            body: { 'x:file_id': '42', filename: 'a.txt', size: 100, mimeType: 'text/plain' },
        }) as any)
        expect(res.success).toBe(true)
        expect(mUpdateOss).toHaveBeenCalledWith(42, expect.objectContaining({ encrypted: false }))
    })

    it('加密文件 → 保留 originalMimeType', async () => {
        const res: any = await callbackHandler(makeEvent({
            body: {
                'x:file_id': '43',
                'x:encrypted': '1',
                'x:original_mime_type': 'image/png',
                filename: 'a.age',
            },
        }) as any)
        expect(res.success).toBe(true)
        expect(mUpdateOss).toHaveBeenCalledWith(43, expect.objectContaining({ encrypted: true, originalMimeType: 'image/png' }))
    })

    it('缺 fileId → 失败', async () => {
        const res: any = await callbackHandler(makeEvent({
            body: { filename: 'a.txt' },
        }) as any)
        expect(res.success).toBe(false)
        expect(res.error).toContain('fileId')
    })

    it('DAO 抛错 → 返回 callback processing failed', async () => {
        mUpdateOss.mockRejectedValueOnce(new Error('db'))
        const res: any = await callbackHandler(makeEvent({
            body: { 'x:file_id': '1' },
        }) as any)
        expect(res.success).toBe(false)
    })
})

describe('GET /api/v1/storage/config', () => {
    beforeEach(() => vi.clearAllMocks())

    it('happy path → 过滤敏感字段', async () => {
        mGetConfigs.mockResolvedValue([
            { id: 1, name: 'oss', type: 'aliyun_oss', bucket: 'b', region: 'r', customDomain: '', enabled: true, accessKeySecret: 'SECRET' },
        ] as any)
        const res: any = await configsListHandler(makeEvent({ userId: 100, query: {} }) as any)
        expectSuccess(res, d => {
            expect(d[0].accessKeySecret).toBeUndefined()
        })
    })

    it('Zod 失败 → 500（被外层 catch 包成 500）', async () => {
        const res: any = await configsListHandler(makeEvent({ userId: 100, query: { type: 'invalid' } }) as any)
        expectError(res, 500)
    })

    it('enabled=false 透传 false', async () => {
        mGetConfigs.mockResolvedValue([] as any)
        await configsListHandler(makeEvent({ userId: 100, query: { enabled: 'false' } }) as any)
        expect(mGetConfigs).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }))
    })
})

describe('POST /api/v1/storage/config', () => {
    beforeEach(() => vi.clearAllMocks())

    const validBody = {
        name: 'cfg-1',
        type: 'aliyun_oss',
        config: { bucket: 'b', region: 'r' },
    }

    it('happy path', async () => {
        mIsNameExist.mockResolvedValue(false as any)
        mCreateConfig.mockResolvedValue({ id: 1, name: 'cfg-1', type: 'aliyun_oss', isDefault: false, enabled: true } as any)
        const res: any = await configCreateHandler(makeEvent({ userId: 100, body: validBody }) as any)
        expectSuccess(res, d => expect(d.id).toBe(1))
    })

    it('Zod 失败 → 500', async () => {
        const res: any = await configCreateHandler(makeEvent({ userId: 100, body: { name: '' } }) as any)
        expectError(res, 500)
    })

    it('名称已存在 → 400', async () => {
        mIsNameExist.mockResolvedValue(true as any)
        const res: any = await configCreateHandler(makeEvent({ userId: 100, body: validBody }) as any)
        expectError(res, 400, '已存在')
    })

    it('testConnection=true 且失败 → 400', async () => {
        mIsNameExist.mockResolvedValue(false as any)
        mTestConn.mockResolvedValue(false as any)
        const res: any = await configCreateHandler(makeEvent({
            userId: 100, body: { ...validBody, testConnection: true },
        }) as any)
        expectError(res, 400, '测试失败')
    })

    it('testConnection 抛错 → 400', async () => {
        mIsNameExist.mockResolvedValue(false as any)
        mTestConn.mockRejectedValueOnce(new Error('boom'))
        const res: any = await configCreateHandler(makeEvent({
            userId: 100, body: { ...validBody, testConnection: true },
        }) as any)
        expectError(res, 400, '测试失败')
    })
})

describe('DELETE /api/v1/storage/config/:id', () => {
    beforeEach(() => vi.clearAllMocks())

    it('happy path', async () => {
        mDeleteConfig.mockResolvedValue(true as any)
        const res: any = await configDeleteHandler(makeEvent({
            userId: 100, params: { id: '5' },
        }) as any)
        expectSuccess(res)
        expect(mClearCache).toHaveBeenCalledWith(5)
    })

    it('id 非法 → 400', async () => {
        const res: any = await configDeleteHandler(makeEvent({
            userId: 100, params: { id: 'abc' },
        }) as any)
        expectError(res, 400)
    })

    it('未找到 → 404', async () => {
        mDeleteConfig.mockResolvedValue(false as any)
        const res: any = await configDeleteHandler(makeEvent({
            userId: 100, params: { id: '5' },
        }) as any)
        expectError(res, 404)
    })

    it('DAO 抛错 → 500', async () => {
        mDeleteConfig.mockRejectedValueOnce(new Error('db'))
        const res: any = await configDeleteHandler(makeEvent({
            userId: 100, params: { id: '5' },
        }) as any)
        expectError(res, 500)
    })
})

describe('PUT /api/v1/storage/config/:id', () => {
    beforeEach(() => vi.clearAllMocks())

    it('happy path', async () => {
        mUpdateConfig.mockResolvedValue({ id: 5, name: 'new', type: 'aliyun_oss', isDefault: false, enabled: true } as any)
        const res: any = await configUpdateHandler(makeEvent({
            userId: 100, params: { id: '5' }, body: { name: 'new' },
        }) as any)
        expectSuccess(res, d => expect(d.name).toBe('new'))
    })

    it('id 非法 → 400', async () => {
        const res: any = await configUpdateHandler(makeEvent({
            userId: 100, params: { id: 'x' }, body: { name: 'new' },
        }) as any)
        expectError(res, 400)
    })

    it('改名重复 → 400', async () => {
        mIsNameExist.mockResolvedValue(true as any)
        const res: any = await configUpdateHandler(makeEvent({
            userId: 100, params: { id: '5' }, body: { name: 'taken' },
        }) as any)
        expectError(res, 400, '已存在')
    })

    it('未找到 → 404', async () => {
        mIsNameExist.mockResolvedValue(false as any)
        mUpdateConfig.mockResolvedValue(null as any)
        const res: any = await configUpdateHandler(makeEvent({
            userId: 100, params: { id: '5' }, body: { enabled: false },
        }) as any)
        expectError(res, 404)
    })
})

describe('POST /api/v1/storage/config/test', () => {
    beforeEach(() => vi.clearAllMocks())

    it('连接成功', async () => {
        mTestConn.mockResolvedValue(true as any)
        const res: any = await configTestHandler(makeEvent({ userId: 100, body: { configId: 5 } }) as any)
        expectSuccess(res)
    })

    it('连接失败 → 400', async () => {
        mTestConn.mockResolvedValue(false as any)
        const res: any = await configTestHandler(makeEvent({ userId: 100, body: {} }) as any)
        expectError(res, 400)
    })
})

describe('GET /api/v1/storage/presigned-url', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mCreateOss.mockResolvedValue({ id: 99 } as any)
        mGenSign.mockResolvedValue({ host: 'https://oss', accessId: 'AK', policy: 'P', signature: 'S' } as any)
    })

    it('happy path', async () => {
        const res: any = await presignedGetHandler(makeEvent({
            userId: 100,
            query: {
                source: 'doc',
                fileSize: '1024',
                mimeType: 'application/pdf',
                originalFileName: 'a.pdf',
            },
        }) as any)
        expectSuccess(res)
    })

    it('Zod 失败 → 500（被 catch 包）', async () => {
        const res: any = await presignedGetHandler(makeEvent({
            userId: 100, query: { source: 'unknown' },
        }) as any)
        expectError(res, 500)
    })

    it('文件名无扩展 → 500', async () => {
        const res: any = await presignedGetHandler(makeEvent({
            userId: 100,
            query: { source: 'doc', fileSize: '1024', mimeType: 'application/pdf', originalFileName: 'NoExt' },
        }) as any)
        expectError(res, 500)
    })

    it('mime 不允许 → 400', async () => {
        const res: any = await presignedGetHandler(makeEvent({
            userId: 100,
            query: { source: 'doc', fileSize: '1024', mimeType: 'application/x-evil', originalFileName: 'a.evil' },
        }) as any)
        expectError(res, 400, '类型')
    })
})

describe('POST /api/v1/storage/presigned-url', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mCheckQuota.mockResolvedValue({ allowed: true } as any)
        mCreateOssBatch.mockResolvedValue([{ id: 11 }, { id: 12 }] as any)
        mGenSign.mockResolvedValue({ host: 'https://oss' } as any)
        ;(globalThis as any).prisma.$transaction.mockImplementation(async (fn: any) => fn({}))
    })

    it('happy path', async () => {
        const res: any = await presignedPostHandler(makeEvent({
            userId: 100,
            body: {
                source: 'doc',
                files: [
                    { originalFileName: 'a.pdf', fileSize: 100, mimeType: 'application/pdf' },
                    { originalFileName: 'b.pdf', fileSize: 200, mimeType: 'application/pdf' },
                ],
            },
        }) as any)
        expectSuccess(res, d => expect(d).toHaveLength(2))
        expect((res as any).data?.[0]?.ossFileId).toBeTypeOf('number')
        expect((res as any).data?.[0]?.ossFileId).toBeGreaterThan(0)
    })

    it('配额不足 → 400', async () => {
        mCheckQuota.mockResolvedValue({ allowed: false, message: '空间不足' } as any)
        const res: any = await presignedPostHandler(makeEvent({
            userId: 100,
            body: {
                source: 'doc',
                files: [{ originalFileName: 'a.pdf', fileSize: 100, mimeType: 'application/pdf' }],
            },
        }) as any)
        expectError(res, 400, '空间')
    })

    it('文件类型不被允许 → 400', async () => {
        const res: any = await presignedPostHandler(makeEvent({
            userId: 100,
            body: {
                source: 'doc',
                files: [{ originalFileName: 'a.bad', fileSize: 100, mimeType: 'application/x-evil' }],
            },
        }) as any)
        expectError(res, 400)
    })

    it('Zod 失败 → 500', async () => {
        const res: any = await presignedPostHandler(makeEvent({
            userId: 100, body: { source: 'doc', files: [] },
        }) as any)
        expectError(res, 500)
    })
})

describe('GET /api/v1/storage/presigned-url/config', () => {
    it('happy path', async () => {
        const res: any = await presignedConfigHandler(makeEvent({ query: { source: 'doc' } }) as any)
        expectSuccess(res)
    })

    it('不传 source → 全量', async () => {
        const res: any = await presignedConfigHandler(makeEvent({ query: {} }) as any)
        expectSuccess(res)
    })
})
