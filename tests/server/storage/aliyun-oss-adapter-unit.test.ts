import { describe, it, expect, vi, beforeEach } from 'vitest'

// 用 vi.hoisted 把 mock fn 提到 vi.mock 工厂之前可用（避免 TDZ）
const { headFileMock } = vi.hoisted(() => ({ headFileMock: vi.fn() }))
vi.mock('~~/server/lib/oss', async (importOriginal) => {
    const actual = await importOriginal<any>()
    return {
        ...actual,
        headFile: headFileMock,
    }
})

import { AliyunOssAdapter } from '~~/server/lib/storage/adapters/aliyun-oss'
import { StorageProviderType } from '~~/server/lib/storage/types'

const adapterConfig = {
    type: StorageProviderType.ALIYUN_OSS,
    name: 'test',
    bucket: 'b',
    region: 'oss-cn-hangzhou',
    accessKeyId: 'ak',
    accessKeySecret: 'sk',
    enabled: true,
} as const

describe('AliyunOssAdapter.head', () => {
    beforeEach(() => {
        headFileMock.mockReset()
    })

    it('对象存在 → 返回 HeadObjectResult', async () => {
        headFileMock.mockResolvedValueOnce({
            size: 100,
            etag: 'abc',
            contentType: 'image/png',
            lastModified: new Date('2026-05-01T00:00:00Z'),
        })

        const adapter = new AliyunOssAdapter(adapterConfig as any)
        const result = await adapter.head('user1/case/x.png')

        expect(result).toEqual({
            size: 100,
            etag: 'abc',
            contentType: 'image/png',
            lastModified: new Date('2026-05-01T00:00:00Z'),
        })
        expect(headFileMock).toHaveBeenCalledWith(
            expect.objectContaining({ bucket: 'b', region: 'oss-cn-hangzhou' }),
            'user1/case/x.png'
        )
    })

    it('对象不存在 → 返回 null', async () => {
        headFileMock.mockResolvedValueOnce(null)
        const adapter = new AliyunOssAdapter(adapterConfig as any)
        expect(await adapter.head('missing')).toBeNull()
    })

    it('底层抛错 → 适配器向上抛', async () => {
        headFileMock.mockRejectedValueOnce(new Error('boom'))
        const adapter = new AliyunOssAdapter(adapterConfig as any)
        await expect(adapter.head('x')).rejects.toThrow()
    })
})
