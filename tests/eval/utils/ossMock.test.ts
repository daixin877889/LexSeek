import { describe, it, expect, afterEach } from 'vitest'
import { StorageFactory } from '~~/server/lib/storage/factory'
import {
    StorageProviderType,
    type AliyunOssConfig
} from '~~/server/lib/storage/types'
import { installOssMock, uninstallOssMock, mockedUploads } from './ossMock'

/**
 * Task 8 单元测试
 *
 * 仅验证 eval-only override 钩子被正确注入：StorageFactory.getAdapter() 在
 * installOssMock() 后返回 fake adapter；upload/delete 等操作不发真实网络请求。
 *
 * 端到端验证（真的能跑完一个 eval 而不写 OSS）放在 Task 12 首跑时做。
 */

const fakeConfig: AliyunOssConfig = {
    type: StorageProviderType.ALIYUN_OSS,
    name: 'eval-test',
    bucket: 'eval-bucket',
    region: 'oss-cn-hangzhou',
    accessKeyId: 'fake',
    accessKeySecret: 'fake',
    enabled: true
}

describe('ossMock', () => {
    afterEach(() => {
        uninstallOssMock()
    })

    it('installOssMock 后 StorageFactory.getAdapter 返回 fake adapter', () => {
        installOssMock()
        const adapter = StorageFactory.getAdapter(fakeConfig)
        expect(adapter.type).toBe(StorageProviderType.ALIYUN_OSS)
        // fake adapter 是简单对象，不是 AliyunOssAdapter 实例
        expect(adapter.constructor.name).toBe('Object')
    })

    it('upload 走 mock 时记录到 mockedUploads，不发真实请求', async () => {
        installOssMock()
        const adapter = StorageFactory.getAdapter(fakeConfig)
        const data = Buffer.from('hello eval')

        const result = await adapter.upload('eval/test.txt', data, { contentType: 'text/plain' })

        expect(result.name).toBe('eval/test.txt')
        expect(result.url).toBe('mock://eval/eval/test.txt')
        expect(mockedUploads).toHaveLength(1)
        expect(mockedUploads[0]).toMatchObject({
            key: 'eval/test.txt',
            size: data.byteLength,
            contentType: 'text/plain'
        })
    })

    it('uninstallOssMock 后恢复正常工厂行为（不再返回 fake）', () => {
        installOssMock()
        const fakeAdapter = StorageFactory.getAdapter(fakeConfig)
        expect(fakeAdapter.constructor.name).toBe('Object')

        uninstallOssMock()
        const realAdapter = StorageFactory.getAdapter(fakeConfig)
        // 真实 AliyunOssAdapter 类实例
        expect(realAdapter.constructor.name).toBe('AliyunOssAdapter')
    })

    it('uninstallOssMock 清空 mockedUploads', async () => {
        installOssMock()
        const adapter = StorageFactory.getAdapter(fakeConfig)
        await adapter.upload('a.txt', Buffer.from('a'))
        expect(mockedUploads).toHaveLength(1)

        uninstallOssMock()
        expect(mockedUploads).toHaveLength(0)
    })

    it('delete / generateSignedUrl / testConnection 走 mock 不发真实请求', async () => {
        installOssMock()
        const adapter = StorageFactory.getAdapter(fakeConfig)

        const del = await adapter.delete(['a.txt', 'b.txt'])
        expect(del.deleted).toEqual(['a.txt', 'b.txt'])

        const url = await adapter.generateSignedUrl('a.txt')
        expect(url).toContain('mock://eval/')

        const ok = await adapter.testConnection()
        expect(ok).toBe(true)
    })
})
