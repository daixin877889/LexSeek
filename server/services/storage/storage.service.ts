/**
 * 存储服务
 *
 * 封装适配器调用，提供统一的存储操作接口
 */

import type { Readable } from 'stream'
import {
    StorageFactory,
    type StorageConfig,
    type StorageAdapter,
    type UploadOptions,
    type UploadResult,
    type DownloadOptions,
    type DeleteResult,
    type SignedUrlOptions,
    type PostSignatureOptions,
    type PostSignatureResult,
    StorageProviderType
} from '~~/server/lib/storage'
import {
    getDefaultStorageConfigDao,
    getStorageConfigByIdDao
} from './storage-config.dao'
import { StorageConfigError } from '~~/server/lib/storage/errors'

/**
 * 获取存储适配器
 * 优先使用指定的配置，否则使用默认配置
 */
async function getAdapter(options: {
    configId?: number
    userId?: number
    type?: StorageProviderType
}): Promise<StorageAdapter> {
    let config: StorageConfig | null = null

    // 如果指定了配置 ID，使用指定配置
    if (options.configId) {
        config = await getStorageConfigByIdDao(options.configId, options.userId)
        if (!config) {
            throw new StorageConfigError(`存储配置不存在: ${options.configId}`)
        }
    } else {
        // 使用默认配置
        const type = options.type || StorageProviderType.ALIYUN_OSS
        config = await getDefaultStorageConfigDao(type, options.userId)
        if (!config) {
            throw new StorageConfigError(`未找到默认存储配置: ${type}`)
        }
    }

    return StorageFactory.getAdapter(config)
}

/**
 * 上传文件
 */
export async function uploadFileService(
    path: string,
    data: Buffer | Readable,
    options?: UploadOptions & {
        configId?: number
        userId?: number
        type?: StorageProviderType
    }
): Promise<UploadResult> {
    const { configId, userId, type, ...uploadOptions } = options || {}
    const adapter = await getAdapter({ configId, userId, type })
    return adapter.upload(path, data, uploadOptions)
}

/**
 * 下载文件
 */
export async function downloadFileService(
    path: string,
    options?: DownloadOptions & {
        configId?: number
        userId?: number
        type?: StorageProviderType
    }
): Promise<Buffer> {
    const { configId, userId, type, ...downloadOptions } = options || {}
    const adapter = await getAdapter({ configId, userId, type })
    return adapter.download(path, downloadOptions)
}

/**
 * 流式下载文件
 */
export async function downloadFileStreamService(
    path: string,
    options?: DownloadOptions & {
        configId?: number
        userId?: number
        type?: StorageProviderType
    }
): Promise<Readable> {
    const { configId, userId, type, ...downloadOptions } = options || {}
    const adapter = await getAdapter({ configId, userId, type })
    return adapter.downloadStream(path, downloadOptions)
}

/**
 * 删除文件
 */
export async function deleteFileService(
    paths: string | string[],
    options?: {
        configId?: number
        userId?: number
        type?: StorageProviderType
    }
): Promise<DeleteResult> {
    const { configId, userId, type } = options || {}
    const adapter = await getAdapter({ configId, userId, type })
    return adapter.delete(paths)
}

/**
 * 生成签名 URL
 */
export async function generateSignedUrlService(
    path: string,
    options?: SignedUrlOptions & {
        configId?: number
        userId?: number
        type?: StorageProviderType
    }
): Promise<string> {
    const { configId, userId, type, ...signedUrlOptions } = options || {}
    const adapter = await getAdapter({ configId, userId, type })
    return adapter.generateSignedUrl(path, signedUrlOptions)
}

/**
 * 生成客户端直传签名
 */
export async function generatePostSignatureService(
    options: PostSignatureOptions & {
        configId?: number
        userId?: number
        type?: StorageProviderType
    }
): Promise<PostSignatureResult> {
    const { configId, userId, type, ...signatureOptions } = options
    const adapter = await getAdapter({ configId, userId, type })
    return adapter.generatePostSignature(signatureOptions)
}

/**
 * 测试存储连接
 */
export async function testStorageConnectionService(options: {
    configId?: number
    userId?: number
    type?: StorageProviderType
}): Promise<boolean> {
    const adapter = await getAdapter(options)
    return adapter.testConnection()
}

/**
 * 清除指定配置的适配器缓存
 * 当配置更新或删除时调用
 */
export function clearAdapterCache(configId?: number): void {
    if (configId) {
        StorageFactory.clearCacheByConfigId(configId)
    } else {
        StorageFactory.clearCache()
    }
}
