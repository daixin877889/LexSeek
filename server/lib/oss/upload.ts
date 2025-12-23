import type { Readable } from 'stream'
import type { OssConfig, UploadOptions, UploadResult } from '~~/shared/types/oss'
import { createOssClient } from './client'
import { OssUploadError } from './errors'
import { getOssHost } from './utils'

/**
 * 上传文件到 OSS
 * @param config OSS 配置
 * @param objectPath 目标文件路径
 * @param data 文件数据（Buffer 或 Readable 流）
 * @param options 上传选项
 * @returns 上传结果
 */
export async function uploadFile(
    config: OssConfig,
    objectPath: string,
    data: Buffer | Readable,
    options: UploadOptions = {}
): Promise<UploadResult> {
    const { client } = await createOssClient(config)

    try {
        // 构建上传选项
        const putOptions: Record<string, any> = {}

        if (options.contentType) {
            putOptions.mime = options.contentType
        }

        if (options.meta) {
            putOptions.meta = options.meta
        }

        if (options.storageClass) {
            putOptions.headers = {
                'x-oss-storage-class': options.storageClass
            }
        }

        // 执行上传
        const result = await client.put(objectPath, data, putOptions)

        // 构建文件 URL
        const host = getOssHost(config.bucket, config.region)
        const url = `${host}/${objectPath}`

        return {
            name: result.name,
            etag: result.res.headers.etag?.replace(/"/g, '') || '',
            url
        }
    } catch (error: any) {
        throw new OssUploadError(error.message)
    }
}
