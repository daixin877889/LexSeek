/**
 * server/api/v1/files/** handler 单元覆盖（5 文件）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../_helpers/handler-test'
import { makeEvent, expectSuccess, expectError } from '../_helpers/handler-test'

vi.mock('~~/server/services/files/files.service', () => ({
    generateOssDownloadSignaturesService: vi.fn(),
}))
vi.mock('~~/server/services/files/ossFiles.dao', () => ({
    findOssFileByIdDao: vi.fn(),
    findOssFileByIdsDao: vi.fn(),
    deleteFileDao: vi.fn(),
    deleteOssFilesDao: vi.fn(),
    findOssFilesByUserIdDao: vi.fn(),
}))

;(globalThis as any).prisma = {
    ossFiles: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
    },
}

import { generateOssDownloadSignaturesService } from '~~/server/services/files/files.service'
import {
    findOssFileByIdDao,
    findOssFileByIdsDao,
    deleteFileDao,
    deleteOssFilesDao,
    findOssFilesByUserIdDao,
} from '~~/server/services/files/ossFiles.dao'

const mGenSign = vi.mocked(generateOssDownloadSignaturesService)
const mFindById = vi.mocked(findOssFileByIdDao)
const mFindByIds = vi.mocked(findOssFileByIdsDao)
const mDeleteFile = vi.mocked(deleteFileDao)
const mDeleteFiles = vi.mocked(deleteOssFilesDao)
const mFindByUser = vi.mocked(findOssFilesByUserIdDao)

const { default: downloadHandler } = await import('../../../server/api/v1/files/download/[fileId].get')
const { default: deleteHandler } = await import('../../../server/api/v1/files/oss/[id].delete')
const { default: listHandler } = await import('../../../server/api/v1/files/oss/file-list')
const { default: batchDeleteHandler } = await import('../../../server/api/v1/files/oss/batch-delete.post')
const { default: batchUrlHandler } = await import('../../../server/api/v1/files/oss/download-url/.post')

describe('GET /api/v1/files/download/:fileId', () => {
    beforeEach(() => vi.clearAllMocks())

    it('happy path', async () => {
        ;(globalThis as any).prisma.ossFiles.findFirst.mockResolvedValue({ id: 1, userId: 100 })
        mGenSign.mockResolvedValue([{ ossFileId: 1, downloadUrl: 'https://x' }] as any)
        const res: any = await downloadHandler(makeEvent({ userId: 100, params: { fileId: '1' } }) as any)
        expectSuccess(res)
    })

    it('未登录 → 401', async () => {
        const res: any = await downloadHandler(makeEvent({ params: { fileId: '1' } }) as any)
        expectError(res, 401)
    })

    it('id 非整数 → 400', async () => {
        const res: any = await downloadHandler(makeEvent({ userId: 100, params: { fileId: 'abc' } }) as any)
        expectError(res, 400)
    })

    it('文件不存在 → 404', async () => {
        ;(globalThis as any).prisma.ossFiles.findFirst.mockResolvedValue(null)
        const res: any = await downloadHandler(makeEvent({ userId: 100, params: { fileId: '1' } }) as any)
        expectError(res, 404)
    })

    it('文件非本人 → 403', async () => {
        ;(globalThis as any).prisma.ossFiles.findFirst.mockResolvedValue({ id: 1, userId: 999 })
        const res: any = await downloadHandler(makeEvent({ userId: 100, params: { fileId: '1' } }) as any)
        expectError(res, 403)
    })

    it('生成签名失败 → 500', async () => {
        ;(globalThis as any).prisma.ossFiles.findFirst.mockResolvedValue({ id: 1, userId: 100 })
        mGenSign.mockResolvedValue([] as any)
        const res: any = await downloadHandler(makeEvent({ userId: 100, params: { fileId: '1' } }) as any)
        expectError(res, 500)
    })
})

describe('DELETE /api/v1/files/oss/:id', () => {
    beforeEach(() => vi.clearAllMocks())

    it('happy path', async () => {
        mFindById.mockResolvedValue({ id: 1, userId: 100 } as any)
        const res: any = await deleteHandler(makeEvent({ userId: 100, params: { id: '1' } }) as any)
        expectSuccess(res)
        expect(mDeleteFile).toHaveBeenCalledWith(1)
    })

    it('id 非数字 → 400（被 catch 包成 400）', async () => {
        const res: any = await deleteHandler(makeEvent({ userId: 100, params: { id: 'abc' } }) as any)
        expectError(res, 400)
    })

    it('文件不存在 → 404', async () => {
        mFindById.mockResolvedValue(null as any)
        const res: any = await deleteHandler(makeEvent({ userId: 100, params: { id: '1' } }) as any)
        expectError(res, 404)
    })

    it('文件非本人 → 403', async () => {
        mFindById.mockResolvedValue({ id: 1, userId: 999 } as any)
        const res: any = await deleteHandler(makeEvent({ userId: 100, params: { id: '1' } }) as any)
        expectError(res, 403)
    })
})

describe('GET /api/v1/files/oss/file-list', () => {
    beforeEach(() => vi.clearAllMocks())

    it('happy path', async () => {
        mFindByUser.mockResolvedValue({
            files: [{ id: 1, fileName: 'a', fileSize: '100', fileType: 'doc', source: 'doc', status: 1, encrypted: false, createdAt: new Date() }],
            total: 1,
        } as any)
        mGenSign.mockResolvedValue([{ ossFileId: 1, downloadUrl: 'https://x' }] as any)
        const res: any = await listHandler(makeEvent({ userId: 100, query: {} }) as any)
        expectSuccess(res, d => {
            expect(d.list[0].url).toBe('https://x')
            expect(d.list[0].fileSize).toBe(100)
        })
    })

    it('参数非法 → 400', async () => {
        const res: any = await listHandler(makeEvent({ userId: 100, query: { pageSize: '999' } }) as any)
        expectError(res, 400)
    })

    it('某文件签名缺失 → url=null', async () => {
        mFindByUser.mockResolvedValue({
            files: [{ id: 1, fileName: 'a', fileSize: '100', fileType: 'doc', source: 'doc', status: 1, encrypted: false, createdAt: new Date() }],
            total: 1,
        } as any)
        mGenSign.mockResolvedValue([] as any)
        const res: any = await listHandler(makeEvent({ userId: 100, query: {} }) as any)
        expectSuccess(res, d => expect(d.list[0].url).toBeNull())
    })
})

describe('POST /api/v1/files/oss/batch-delete', () => {
    beforeEach(() => vi.clearAllMocks())

    it('happy path', async () => {
        mFindByIds.mockResolvedValue([{ id: 1, userId: 100 }, { id: 2, userId: 100 }] as any)
        const res: any = await batchDeleteHandler(makeEvent({
            userId: 100, body: { fileIds: [1, 2] },
        }) as any)
        expectSuccess(res, d => expect(d.deletedCount).toBe(2))
        expect(mDeleteFiles).toHaveBeenCalledWith([1, 2])
    })

    it('Zod 失败 → 400', async () => {
        const res: any = await batchDeleteHandler(makeEvent({
            userId: 100, body: { fileIds: [] },
        }) as any)
        expectError(res, 400)
    })

    it('部分文件不存在 → 404', async () => {
        mFindByIds.mockResolvedValue([{ id: 1, userId: 100 }] as any)
        const res: any = await batchDeleteHandler(makeEvent({
            userId: 100, body: { fileIds: [1, 2] },
        }) as any)
        expectError(res, 404)
    })

    it('部分文件非本人 → 403', async () => {
        mFindByIds.mockResolvedValue([{ id: 1, userId: 100 }, { id: 2, userId: 999 }] as any)
        const res: any = await batchDeleteHandler(makeEvent({
            userId: 100, body: { fileIds: [1, 2] },
        }) as any)
        expectError(res, 403)
    })
})

describe('POST /api/v1/files/oss/download-url', () => {
    beforeEach(() => vi.clearAllMocks())

    it('happy path', async () => {
        ;(globalThis as any).prisma.ossFiles.findMany.mockResolvedValue([
            { id: 1, userId: 100 }, { id: 2, userId: 100 },
        ])
        mGenSign.mockResolvedValue([
            { ossFileId: 1, downloadUrl: 'u1' },
            { ossFileId: 2, downloadUrl: 'u2' },
        ] as any)
        const res: any = await batchUrlHandler(makeEvent({
            userId: 100, body: { ossFileIds: [1, 2] },
        }) as any)
        expectSuccess(res, d => expect(d).toHaveLength(2))
    })

    it('Zod 失败 → 500（被 catch 包）', async () => {
        const res: any = await batchUrlHandler(makeEvent({
            userId: 100, body: { ossFileIds: [] },
        }) as any)
        expectError(res, 500)
    })

    it('部分文件不存在 → 404', async () => {
        ;(globalThis as any).prisma.ossFiles.findMany.mockResolvedValue([{ id: 1, userId: 100 }])
        const res: any = await batchUrlHandler(makeEvent({
            userId: 100, body: { ossFileIds: [1, 2] },
        }) as any)
        expectError(res, 404, '不存在')
    })

    it('部分文件无权 → 403', async () => {
        ;(globalThis as any).prisma.ossFiles.findMany.mockResolvedValue([
            { id: 1, userId: 100 }, { id: 2, userId: 999 },
        ])
        const res: any = await batchUrlHandler(makeEvent({
            userId: 100, body: { ossFileIds: [1, 2] },
        }) as any)
        expectError(res, 403)
    })

    it('部分文件签名生成失败 → 仍 success（warn）', async () => {
        ;(globalThis as any).prisma.ossFiles.findMany.mockResolvedValue([
            { id: 1, userId: 100 }, { id: 2, userId: 100 },
        ])
        mGenSign.mockResolvedValue([{ ossFileId: 1, downloadUrl: 'u1' }] as any)
        const res: any = await batchUrlHandler(makeEvent({
            userId: 100, body: { ossFileIds: [1, 2] },
        }) as any)
        expectSuccess(res)
    })
})
