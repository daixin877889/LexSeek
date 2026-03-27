/**
 * 存储模块导出测试
 *
 * 测试存储模块的导出是否正确
 *
 * **Feature: storage-system**
 */

import { describe, it, expect } from 'vitest'

describe('存储模块导出', () => {
    it('应导出所有类型', async () => {
        const storageModule = await import('../../../server/lib/storage')

        // 类型
        expect(storageModule.StorageProviderType).toBeDefined()
        expect(storageModule.BaseStorageAdapter).toBeDefined()
        expect(storageModule.StorageFactory).toBeDefined()
        expect(storageModule.AliyunOssAdapter).toBeDefined()
        expect(storageModule.QiniuAdapter).toBeDefined()
        expect(storageModule.TencentCosAdapter).toBeDefined()

        // 错误类型
        expect(storageModule.StorageError).toBeDefined()
        expect(storageModule.StorageConfigError).toBeDefined()
        expect(storageModule.StorageNotFoundError).toBeDefined()
        expect(storageModule.StoragePermissionError).toBeDefined()
        expect(storageModule.StorageNetworkError).toBeDefined()
        expect(storageModule.StorageUploadError).toBeDefined()
        expect(storageModule.StorageDownloadError).toBeDefined()
        expect(storageModule.StorageDeleteError).toBeDefined()
        expect(storageModule.StorageSignatureError).toBeDefined()

        // 错误转换
        expect(storageModule.convertAliyunError).toBeDefined()
        expect(storageModule.convertQiniuError).toBeDefined()
        expect(storageModule.convertTencentError).toBeDefined()

        // 类型守卫
        expect(storageModule.isAliyunOssConfig).toBeDefined()
        expect(storageModule.isQiniuConfig).toBeDefined()
        expect(storageModule.isTencentCosConfig).toBeDefined()
        expect(storageModule.isAliyunPostSignatureResult).toBeDefined()
        expect(storageModule.isQiniuPostSignatureResult).toBeDefined()

        // 回调处理
        expect(storageModule.verifyCallback).toBeDefined()
        expect(storageModule.parseCallback).toBeDefined()
        expect(storageModule.registerCallbackHandler).toBeDefined()
        expect(storageModule.AliyunCallbackValidator).toBeDefined()
        expect(storageModule.clearPublicKeyCache).toBeDefined()
    })

    it('StorageProviderType 应包含所有枚举值', async () => {
        const { StorageProviderType } = await import('../../../server/lib/storage')
        expect(StorageProviderType.ALIYUN_OSS).toBe('aliyun_oss')
        expect(StorageProviderType.QINIU).toBe('qiniu')
        expect(StorageProviderType.TENCENT_COS).toBe('tencent_cos')
    })

    it('错误类应继承自 Error', async () => {
        const { StorageError, StorageConfigError, StorageNotFoundError } = await import('../../../server/lib/storage')
        expect(new StorageError('test')).toBeInstanceOf(Error)
        expect(new StorageConfigError('test')).toBeInstanceOf(Error)
        expect(new StorageNotFoundError('test.txt')).toBeInstanceOf(Error)
    })
})
