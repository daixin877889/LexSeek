/**
 * verifyAndFixOssFileService 集成测试
 *
 * - 真实 worker 隔离 DB（getTestPrisma）；createTestUser/createTestOssFile fixture
 * - 仅 mock storage adapter（OSS 网络层）
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest'
import { OssFileStatus } from '#shared/types/file'

// 唯一 mock：getStorageAdapterService 返回带可控 head 的伪 adapter
const { adapterHeadMock } = vi.hoisted(() => ({ adapterHeadMock: vi.fn() }))
vi.mock('~~/server/services/storage/storage.service', () => ({
    getStorageAdapterService: vi.fn(async () => ({ head: adapterHeadMock })),
}))

import { verifyAndFixOssFileService, confirmOssFileByStorageCallbackService } from '~~/server/services/files/ossFileVerify.service'
import {
    getTestPrisma,
    createTestUser,
    createTestOssFile,
    cleanupTestData,
    createEmptyTestIds,
} from '../files/test-db-helper'

describe('verifyAndFixOssFileService', () => {
    const testIds = createEmptyTestIds()
    let userId: number

    beforeAll(async () => {
        const user = await createTestUser()
        userId = user.id
        testIds.userIds.push(user.id)
    })

    beforeEach(() => {
        adapterHeadMock.mockReset()
    })

    afterEach(async () => {
        if (testIds.ossFileIds.length) {
            await getTestPrisma().ossFiles.deleteMany({
                where: { id: { in: testIds.ossFileIds } },
            })
            testIds.ossFileIds = []
        }
    })

    afterAll(async () => {
        await cleanupTestData(testIds)
    })

    async function makeFile(status: number, opts?: { filePath?: string | null }) {
        const file = await createTestOssFile(userId, {
            status,
            filePath: opts?.filePath === null ? undefined : (opts?.filePath ?? `u/${Date.now()}_${Math.random()}.pdf`),
        })
        // filePath=null 场景必须直接 update（createTestOssFile 默认会塞个值）
        if (opts?.filePath === null) {
            await getTestPrisma().ossFiles.update({
                where: { id: file.id },
                data: { filePath: null },
            })
        }
        testIds.ossFileIds.push(file.id)
        return file
    }

    it('file 不存在 → invalid', async () => {
        const r = await verifyAndFixOssFileService(99999999, userId)
        expect(r).toEqual({ ok: false, reason: 'invalid' })
    })

    it('userId 不匹配 → forbidden', async () => {
        const file = await makeFile(OssFileStatus.PENDING)
        const otherUser = await createTestUser()
        testIds.userIds.push(otherUser.id)
        const r = await verifyAndFixOssFileService(file.id, otherUser.id)
        expect(r).toEqual({ ok: false, reason: 'forbidden' })
    })

    it('已 UPLOADED → ok 直接返回（不调 head）', async () => {
        const file = await makeFile(OssFileStatus.UPLOADED)
        const r = await verifyAndFixOssFileService(file.id, userId)
        expect(r).toEqual({ ok: true, status: 'uploaded' })
        expect(adapterHeadMock).not.toHaveBeenCalled()
    })

    it('已 FAILED → already_failed', async () => {
        const file = await makeFile(OssFileStatus.FAILED)
        const r = await verifyAndFixOssFileService(file.id, userId)
        expect(r).toEqual({ ok: false, reason: 'already_failed' })
    })

    it('PENDING + filePath 缺失 → invalid', async () => {
        const file = await makeFile(OssFileStatus.PENDING, { filePath: null })
        const r = await verifyAndFixOssFileService(file.id, userId)
        expect(r).toEqual({ ok: false, reason: 'invalid' })
    })

    it('PENDING + head=null → not_found，DB 不动', async () => {
        const file = await makeFile(OssFileStatus.PENDING)
        adapterHeadMock.mockResolvedValueOnce(null)
        const r = await verifyAndFixOssFileService(file.id, userId)
        expect(r).toEqual({ ok: false, reason: 'not_found' })
        const fresh = await getTestPrisma().ossFiles.findUnique({ where: { id: file.id } })
        expect(fresh!.status).toBe(OssFileStatus.PENDING)
    })

    it('PENDING + head 命中 → DB 改为 UPLOADED', async () => {
        const file = await makeFile(OssFileStatus.PENDING)
        adapterHeadMock.mockResolvedValueOnce({
            size: 1, etag: 'x', contentType: 'application/pdf', lastModified: new Date(),
        })
        const r = await verifyAndFixOssFileService(file.id, userId)
        expect(r).toEqual({ ok: true, status: 'uploaded' })
        const fresh = await getTestPrisma().ossFiles.findUnique({ where: { id: file.id } })
        expect(fresh!.status).toBe(OssFileStatus.UPLOADED)
    })

    it('并发两次：最终 status=UPLOADED 且最少一次返回 ok', async () => {
        const file = await makeFile(OssFileStatus.PENDING)
        adapterHeadMock.mockResolvedValue({
            size: 1, etag: 'x', contentType: 'pdf', lastModified: new Date(),
        })
        const [a, b] = await Promise.all([
            verifyAndFixOssFileService(file.id, userId),
            verifyAndFixOssFileService(file.id, userId),
        ])
        expect([a, b].some((r) => r.ok)).toBe(true)
        const fresh = await getTestPrisma().ossFiles.findUnique({ where: { id: file.id } })
        expect(fresh!.status).toBe(OssFileStatus.UPLOADED)
    })

    it('PENDING + head 抛错 → 服务向上抛', async () => {
        const file = await makeFile(OssFileStatus.PENDING)
        adapterHeadMock.mockRejectedValueOnce(new Error('OSS 5xx'))
        await expect(verifyAndFixOssFileService(file.id, userId)).rejects.toThrow('OSS 5xx')
    })
})

describe('confirmOssFileByStorageCallbackService - 存储回调核对', () => {
    const testIds = createEmptyTestIds()
    let userId: number

    beforeAll(async () => {
        const user = await createTestUser()
        userId = user.id
        testIds.userIds.push(user.id)
    })

    afterEach(async () => {
        if (testIds.ossFileIds.length) {
            await getTestPrisma().ossFiles.deleteMany({
                where: { id: { in: testIds.ossFileIds } },
            })
            testIds.ossFileIds = []
        }
    })

    afterAll(async () => {
        await cleanupTestData(testIds)
    })

    async function makeFile(status: number, filePath: string) {
        const file = await createTestOssFile(userId, { status, filePath })
        testIds.ossFileIds.push(file.id)
        return file
    }

    it('文件不存在 → not_found', async () => {
        const r = await confirmOssFileByStorageCallbackService({
            fileId: 99999999, filePath: 'u/x.pdf', userId, encrypted: false, originalMimeType: null,
        })
        expect(r).toEqual({ ok: false, reason: 'not_found' })
    })

    it('回调路径与登记路径不符 → path_mismatch', async () => {
        const file = await makeFile(OssFileStatus.PENDING, 'u/real.pdf')
        const r = await confirmOssFileByStorageCallbackService({
            fileId: file.id, filePath: 'u/forged.pdf', userId, encrypted: false, originalMimeType: null,
        })
        expect(r).toEqual({ ok: false, reason: 'path_mismatch' })
    })

    it('回调用户与文件归属不符 → user_mismatch', async () => {
        const file = await makeFile(OssFileStatus.PENDING, 'u/a.pdf')
        const r = await confirmOssFileByStorageCallbackService({
            fileId: file.id, filePath: 'u/a.pdf', userId: 99999999, encrypted: false, originalMimeType: null,
        })
        expect(r).toEqual({ ok: false, reason: 'user_mismatch' })
    })

    it('核对通过 → ok，文件标记为 UPLOADED', async () => {
        const file = await makeFile(OssFileStatus.PENDING, 'u/ok.pdf')
        const r = await confirmOssFileByStorageCallbackService({
            fileId: file.id, filePath: 'u/ok.pdf', userId, encrypted: false, originalMimeType: null,
        })
        expect(r).toEqual({ ok: true })
        const fresh = await getTestPrisma().ossFiles.findUnique({ where: { id: file.id } })
        expect(fresh!.status).toBe(OssFileStatus.UPLOADED)
    })

    it('回调重放（文件已 UPLOADED）→ 幂等 ok', async () => {
        const file = await makeFile(OssFileStatus.UPLOADED, 'u/dup.pdf')
        const r = await confirmOssFileByStorageCallbackService({
            fileId: file.id, filePath: 'u/dup.pdf', userId, encrypted: false, originalMimeType: null,
        })
        expect(r).toEqual({ ok: true })
    })

    it('文件已 FAILED → rejected', async () => {
        const file = await makeFile(OssFileStatus.FAILED, 'u/failed.pdf')
        const r = await confirmOssFileByStorageCallbackService({
            fileId: file.id, filePath: 'u/failed.pdf', userId, encrypted: false, originalMimeType: null,
        })
        expect(r).toEqual({ ok: false, reason: 'rejected' })
    })
})
