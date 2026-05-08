/**
 * server/lib/oss/headFile 单元测试
 *
 * mock ali-oss client 的 getObjectMeta；不联实际 OSS。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// 用 vi.hoisted 保证 mock fn 在 vi.mock 工厂执行前可用（ESM 提升要求，与项目 11+ 处现有风格一致）
const { getObjectMetaMock } = vi.hoisted(() => ({ getObjectMetaMock: vi.fn() }))
vi.mock('~~/server/lib/oss/client', () => ({
    createOssClient: vi.fn(async () => ({
        client: { getObjectMeta: getObjectMetaMock },
    })),
}))

import { headFile } from '~~/server/lib/oss/headFile'

const fakeConfig = {
    accessKeyId: 'ak',
    accessKeySecret: 'sk',
    bucket: 'b',
    region: 'oss-cn-hangzhou',
} as any

describe('headFile (server/lib/oss)', () => {
    beforeEach(() => {
        getObjectMetaMock.mockReset()
    })

    it('对象存在时返回结构化 HeadObjectResult', async () => {
        getObjectMetaMock.mockResolvedValueOnce({
            status: 200,
            res: {
                headers: {
                    'content-length': '12345',
                    etag: '"abc123"',
                    'content-type': 'application/pdf',
                    'last-modified': 'Sun, 03 May 2026 09:00:00 GMT',
                },
            },
        })

        const result = await headFile(fakeConfig, 'user1/case/file.pdf')

        expect(result).not.toBeNull()
        expect(result!.size).toBe(12345)
        expect(result!.etag).toBe('abc123')
        expect(result!.contentType).toBe('application/pdf')
        expect(result!.lastModified).toBeInstanceOf(Date)
    })

    it('NoSuchKey 返回 null（不抛错）', async () => {
        const err: any = new Error('NoSuchKey')
        err.code = 'NoSuchKey'
        err.status = 404
        getObjectMetaMock.mockRejectedValueOnce(err)

        const result = await headFile(fakeConfig, 'user1/case/missing.pdf')

        expect(result).toBeNull()
    })

    it('网络/凭证等其他错误向上抛出', async () => {
        const err: any = new Error('NetworkError')
        err.code = 'NetworkError'
        err.status = 500
        getObjectMetaMock.mockRejectedValueOnce(err)

        await expect(headFile(fakeConfig, 'user1/case/x.pdf')).rejects.toThrow('NetworkError')
    })
})
