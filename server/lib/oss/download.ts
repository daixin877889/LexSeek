import type { Readable } from 'stream'
import type { OssConfig, DownloadOptions } from '~~/shared/types/oss'
import { createOssClient } from './client'
import { OssDownloadError, OssNotFoundError } from './errors'

/**
 * 从 OSS 下载文件
 * @param config OSS 配置
 * @param objectPath 文件路径
 * @param options 下载选项
 * @returns 文件数据 Buffer
 */
export async function downloadFile(
    config: OssConfig,
    objectPath: string,
    options: DownloadOptions = {}
): Promise<Buffer> {
    const { client } = await createOssClient(config)

    try {
        // 构建下载选项
        const getOptions: Record<string, any> = {}

        if (options.range) {
            getOptions.headers = {
                Range: options.range
            }
        }

        // 执行下载
        const result = await client.get(objectPath, getOptions)

        // 返回 Buffer
        return result.content as Buffer
    } catch (error: any) {
        // 检查是否为文件不存在错误
        if (error.code === 'NoSuchKey' || error.status === 404) {
            throw new OssNotFoundError(objectPath)
        }
        throw new OssDownloadError(error.message)
    }
}

/**
 * 从 OSS 下载文件（流式）
 * @param config OSS 配置
 * @param objectPath 文件路径
 * @param options 下载选项
 * @returns 可读流
 */
export async function downloadFileStream(
    config: OssConfig,
    objectPath: string,
    options: DownloadOptions = {}
): Promise<Readable> {
    const { client } = await createOssClient(config)

    try {
        // 构建下载选项
        const getOptions: Record<string, any> = {}

        if (options.range) {
            getOptions.headers = {
                Range: options.range
            }
        }

        // 执行流式下载
        const result = await client.getStream(objectPath, getOptions)

        return result.stream as Readable
    } catch (error: any) {
        // 检查是否为文件不存在错误
        if (error.code === 'NoSuchKey' || error.status === 404) {
            throw new OssNotFoundError(objectPath)
        }
        throw new OssDownloadError(error.message)
    }
}
