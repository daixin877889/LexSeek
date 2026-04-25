/**
 * Eval-only OSS mock
 *
 * 注入一个 fake StorageAdapter，把所有上传请求记录在内存里，避免 eval 过程
 * 真实写到阿里云 OSS / 七牛云 / 腾讯云 COS。
 *
 * 仅供 tests/eval/** 使用，**禁止在生产代码或单元测试中引入**。
 */

import type { Readable } from 'stream'
import { __setStorageAdapterOverrideForEval } from '~~/server/lib/storage/factory'
import type {
    StorageAdapter,
    UploadOptions,
    UploadResult,
    DownloadOptions,
    DeleteResult,
    SignedUrlOptions,
    PostSignatureOptions,
    AliyunPostSignatureResult
} from '~~/server/lib/storage/types'
import { StorageProviderType } from '~~/server/lib/storage/types'

/** 单次记录的 mock 上传 */
export interface MockedUpload {
    /** 上传路径 */
    key: string
    /** 数据字节数 */
    size: number
    /** 记录时间戳（毫秒） */
    ts: number
    /** Content-Type */
    contentType?: string
}

/** 内存中累积的 mock 上传记录；测试可读取断言 */
export const mockedUploads: MockedUpload[] = []

/** 计算上传数据的字节数 */
function sizeOf(data: Buffer | Readable): number {
    if (Buffer.isBuffer(data)) {
        return data.byteLength
    }
    // Readable 流无法同步取 size，用 0 占位（eval 链路里基本是 Buffer）
    return 0
}

/** 构造一个 fake AliyunOss adapter（实际不发请求） */
function createFakeAdapter(): StorageAdapter {
    return {
        type: StorageProviderType.ALIYUN_OSS,

        async upload(path: string, data: Buffer | Readable, options?: UploadOptions): Promise<UploadResult> {
            mockedUploads.push({
                key: path,
                size: sizeOf(data),
                ts: Date.now(),
                contentType: options?.contentType
            })
            return {
                name: path,
                etag: `mock-etag-${mockedUploads.length}`,
                url: `mock://eval/${path}`
            }
        },

        async download(_path: string, _options?: DownloadOptions): Promise<Buffer> {
            return Buffer.alloc(0)
        },

        async downloadStream(_path: string, _options?: DownloadOptions): Promise<Readable> {
            // 返回一个空可读流
            const { Readable: NodeReadable } = await import('stream')
            return NodeReadable.from(Buffer.alloc(0))
        },

        async delete(paths: string | string[]): Promise<DeleteResult> {
            const list = Array.isArray(paths) ? paths : [paths]
            return { deleted: list }
        },

        async generateSignedUrl(path: string, _options?: SignedUrlOptions): Promise<string> {
            return `mock://eval/${path}?signed=1`
        },

        async generatePostSignature(_options: PostSignatureOptions): Promise<AliyunPostSignatureResult> {
            return {
                host: 'mock://eval',
                dir: 'mock/',
                policy: 'mock-policy',
                signatureVersion: 'OSS4-HMAC-SHA256',
                credential: 'mock-credential',
                date: '20260101T000000Z',
                signature: 'mock-signature'
            }
        },

        async testConnection(): Promise<boolean> {
            return true
        }
    }
}

/** 安装 OSS mock：注入 fake adapter，覆盖 StorageFactory.getAdapter() 返回值 */
export function installOssMock(): void {
    __setStorageAdapterOverrideForEval(createFakeAdapter())
}

/** 卸载 OSS mock：清除 override，并重置已记录的上传 */
export function uninstallOssMock(): void {
    __setStorageAdapterOverrideForEval(null)
    mockedUploads.length = 0
}
