/**
 * OSS head（获取对象元数据）
 *
 * 用 ali-oss client.getObjectMeta()——SDK 自带告警："Because HeadObject has gzip
 * enabled, head cannot get the file size correctly. If you need to get the file size,
 * please use getObjectMeta"。两者返回结构兼容，getObjectMeta 在 gzip 对象上拿到的
 * content-length 准确。
 */
import type { OssConfig } from '~~/shared/types/oss'
import { createOssClient } from './client'
import { createLogger } from '#shared/utils/logger'

const log = createLogger('oss:head')

/**
 * head 操作结果（对象元数据） — 单一定义源
 */
export interface HeadObjectResult {
    /** 对象字节数（OSS Content-Length） */
    size: number
    /** OSS ETag（已去引号） */
    etag: string
    /** Content-Type，可能为空字符串 */
    contentType: string
    /** 最后修改时间 */
    lastModified: Date
}

/**
 * head OSS 对象元数据
 * @returns 对象存在 → 元数据；NoSuchKey/404 → null；其他错误 → throw
 */
export async function headFile(
    config: OssConfig,
    objectKey: string
): Promise<HeadObjectResult | null> {
    const { client } = await createOssClient(config)

    try {
        const res = await client.getObjectMeta(objectKey)
        const headers = res.res.headers as Record<string, string | undefined>

        return {
            size: Number(headers['content-length'] ?? 0),
            etag: String(headers.etag ?? '').replace(/"/g, ''),
            contentType: String(headers['content-type'] ?? ''),
            lastModified: headers['last-modified']
                ? new Date(headers['last-modified'])
                : new Date(),
        }
    } catch (error: unknown) {
        const e = error as { code?: string; status?: number }
        if (e?.code === 'NoSuchKey' || e?.status === 404) {
            log.debug('对象不存在', { objectKey })
            return null
        }
        log.warn('head 调用异常，向上抛出', { objectKey, error })
        throw error
    }
}
