/**
 * OSS 模块导出测试
 *
 * 测试 OSS 模块的导出是否正确
 *
 * **Feature: storage-system**
 */

import { describe, it, expect } from 'vitest'

describe('OSS 模块导出', () => {
    it('应导出所有错误类', async () => {
        const module = await import('../../../server/lib/oss')

        expect(module.OssConfigError).toBeDefined()
        expect(module.OssStsError).toBeDefined()
        expect(module.OssNotFoundError).toBeDefined()
        expect(module.OssUploadError).toBeDefined()
        expect(module.OssDownloadError).toBeDefined()
        expect(module.OssDeleteError).toBeDefined()
        expect(module.OssNetworkError).toBeDefined()
    })

    it('应导出所有核心函数', async () => {
        const module = await import('../../../server/lib/oss')

        expect(module.createOssClient).toBeDefined()
        expect(module.validateConfig).toBeDefined()
        expect(module.generatePostSignature).toBeDefined()
        expect(module.generateSignedUrl).toBeDefined()
        expect(module.uploadFile).toBeDefined()
        expect(module.downloadFile).toBeDefined()
        expect(module.downloadFileStream).toBeDefined()
        expect(module.deleteFile).toBeDefined()
    })

    it('应导出所有工具函数', async () => {
        const module = await import('../../../server/lib/oss')

        expect(module.formatDateToUTC).toBeDefined()
        expect(module.getStandardRegion).toBeDefined()
        expect(module.getCredential).toBeDefined()
        expect(module.encodeBase64).toBeDefined()
        expect(module.decodeBase64).toBeDefined()
        expect(module.getOssHost).toBeDefined()
    })

    it('错误类应继承自 Error', async () => {
        const { OssConfigError, OssStsError, OssUploadError } = await import('../../../server/lib/oss')
        expect(new OssConfigError('test')).toBeInstanceOf(Error)
        expect(new OssStsError('test')).toBeInstanceOf(Error)
        expect(new OssUploadError('test')).toBeInstanceOf(Error)
    })

    it('validateConfig 应正确验证配置', async () => {
        const { validateConfig } = await import('../../../server/lib/oss')
        const { OssConfigError } = await import('../../../server/lib/oss')

        // 有效配置
        expect(() => validateConfig({
            accessKeyId: 'key',
            accessKeySecret: 'secret',
            bucket: 'bucket',
            region: 'oss-cn-hangzhou'
        })).not.toThrow()

        // 无效配置
        expect(() => validateConfig({
            accessKeyId: '',
            accessKeySecret: '',
            bucket: '',
            region: ''
        })).toThrow(OssConfigError)
    })

    it('formatDateToUTC 应返回正确格式', async () => {
        const { formatDateToUTC } = await import('../../../server/lib/oss')
        const date = new Date('2024-06-15T10:30:45Z')
        expect(formatDateToUTC(date)).toBe('20240615T103045Z')
    })

    it('getStandardRegion 应正确处理 oss- 前缀', async () => {
        const { getStandardRegion } = await import('../../../server/lib/oss')
        expect(getStandardRegion('oss-cn-hangzhou')).toBe('cn-hangzhou')
        expect(getStandardRegion('cn-hangzhou')).toBe('cn-hangzhou')
    })

    it('getCredential 应生成正确格式的凭证', async () => {
        const { getCredential } = await import('../../../server/lib/oss')
        const result = getCredential('20240615', 'cn-hangzhou', 'LTAI5tTest')
        expect(result).toBe('LTAI5tTest/20240615/cn-hangzhou/oss/aliyun_v4_request')
    })

    it('encodeBase64 和 decodeBase64 应往返正确', async () => {
        const { encodeBase64, decodeBase64 } = await import('../../../server/lib/oss')
        const original = 'Hello, 世界!'
        expect(decodeBase64(encodeBase64(original))).toBe(original)
    })

    it('getOssHost 应生成正确的主机地址', async () => {
        const { getOssHost } = await import('../../../server/lib/oss')
        expect(getOssHost('bucket', 'cn-hangzhou')).toBe('https://bucket.oss-cn-hangzhou.aliyuncs.com')
        expect(getOssHost('bucket', 'oss-cn-shanghai')).toBe('https://bucket.oss-cn-shanghai.aliyuncs.com')
        expect(getOssHost('bucket', 'cn-hangzhou', 'cdn.example.com')).toBe('https://cdn.example.com')
        expect(getOssHost('bucket', 'cn-hangzhou', 'https://cdn.example.com/')).toBe('https://cdn.example.com')
    })
})
