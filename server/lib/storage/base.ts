/**
 * 基础存储适配器抽象类
 *
 * 提供通用的错误转换和辅助方法
 */

import type { Readable } from 'stream'
import type {
    StorageAdapter,
    StorageConfig,
    StorageProviderType,
    UploadOptions,
    UploadResult,
    DownloadOptions,
    DeleteResult,
    SignedUrlOptions,
    PostSignatureOptions,
    PostSignatureResult
} from './types'
import {
    StorageError,
    StorageErrorCode,
    StorageConfigError,
    StorageNotFoundError,
    StoragePermissionError,
    StorageNetworkError,
    StorageUploadError,
    StorageDownloadError,
    StorageDeleteError,
    StorageSignatureError
} from './errors'

/**
 * 基础存储适配器抽象类
 * 所有具体适配器实现都应继承此类
 */
export abstract class BaseStorageAdapter implements StorageAdapter {
    /** 适配器类型 */
    abstract readonly type: StorageProviderType

    /** 存储配置 */
    protected readonly config: StorageConfig

    constructor(config: StorageConfig) {
        this.config = config
        this.validateConfig()
    }

    /**
     * 验证配置
     * 子类可以重写此方法添加特定的验证逻辑
     */
    protected validateConfig(): void {
        if (!this.config.bucket) {
            throw new StorageConfigError('缺少必填配置: bucket')
        }
        if (!this.config.region) {
            throw new StorageConfigError('缺少必填配置: region')
        }
    }

    /**
     * 上传文件
     */
    abstract upload(path: string, data: Buffer | Readable, options?: UploadOptions): Promise<UploadResult>

    /**
     * 下载文件
     */
    abstract download(path: string, options?: DownloadOptions): Promise<Buffer>

    /**
     * 流式下载文件
     */
    abstract downloadStream(path: string, options?: DownloadOptions): Promise<Readable>

    /**
     * 删除文件
     */
    abstract delete(paths: string | string[]): Promise<DeleteResult>

    /**
     * 生成签名 URL
     */
    abstract generateSignedUrl(path: string, options?: SignedUrlOptions): Promise<string>

    /**
     * 生成客户端直传签名
     */
    abstract generatePostSignature(options: PostSignatureOptions): Promise<PostSignatureResult>

    /**
     * 测试连接
     */
    abstract testConnection(): Promise<boolean>

    // ============================================================================
    // 错误转换辅助方法
    // ============================================================================

    /**
     * 将原始错误转换为上传错误
     */
    protected wrapUploadError(error: unknown): StorageUploadError {
        if (error instanceof StorageError) {
            return new StorageUploadError(error.message, error)
        }
        const message = error instanceof Error ? error.message : '上传失败'
        return new StorageUploadError(message, error instanceof Error ? error : undefined)
    }

    /**
     * 将原始错误转换为下载错误
     */
    protected wrapDownloadError(error: unknown): StorageDownloadError {
        if (error instanceof StorageError) {
            return new StorageDownloadError(error.message, error)
        }
        const message = error instanceof Error ? error.message : '下载失败'
        return new StorageDownloadError(message, error instanceof Error ? error : undefined)
    }

    /**
     * 将原始错误转换为删除错误
     */
    protected wrapDeleteError(error: unknown): StorageDeleteError {
        if (error instanceof StorageError) {
            return new StorageDeleteError(error.message, error)
        }
        const message = error instanceof Error ? error.message : '删除失败'
        return new StorageDeleteError(message, error instanceof Error ? error : undefined)
    }

    /**
     * 将原始错误转换为签名错误
     */
    protected wrapSignatureError(error: unknown): StorageSignatureError {
        if (error instanceof StorageError) {
            return new StorageSignatureError(error.message, error)
        }
        const message = error instanceof Error ? error.message : '签名生成失败'
        return new StorageSignatureError(message, error instanceof Error ? error : undefined)
    }

    /**
     * 检查是否为文件不存在错误
     * 子类应重写此方法以适配特定服务商的错误格式
     */
    protected isNotFoundError(error: unknown): boolean {
        if (error instanceof StorageNotFoundError) {
            return true
        }
        if (error && typeof error === 'object') {
            const err = error as Record<string, unknown>
            // 通用检查
            if (err.code === 'NoSuchKey' || err.status === 404) {
                return true
            }
        }
        return false
    }

    /**
     * 检查是否为权限错误
     * 子类应重写此方法以适配特定服务商的错误格式
     */
    protected isPermissionError(error: unknown): boolean {
        if (error instanceof StoragePermissionError) {
            return true
        }
        if (error && typeof error === 'object') {
            const err = error as Record<string, unknown>
            // 通用检查
            if (err.code === 'AccessDenied' || err.status === 403) {
                return true
            }
        }
        return false
    }

    /**
     * 检查是否为配置错误
     * 子类应重写此方法以适配特定服务商的错误格式
     */
    protected isConfigError(error: unknown): boolean {
        if (error instanceof StorageConfigError) {
            return true
        }
        if (error && typeof error === 'object') {
            const err = error as Record<string, unknown>
            // 通用检查
            if (
                err.code === 'InvalidAccessKeyId' ||
                err.code === 'SignatureDoesNotMatch'
            ) {
                return true
            }
        }
        return false
    }

    /**
     * 检查是否为网络错误
     * 子类应重写此方法以适配特定服务商的错误格式
     */
    protected isNetworkError(error: unknown): boolean {
        if (error instanceof StorageNetworkError) {
            return true
        }
        if (error && typeof error === 'object') {
            const err = error as Record<string, unknown>
            // 通用检查
            if (
                err.code === 'NetworkError' ||
                err.code === 'ConnectionTimeoutError' ||
                err.code === 'ECONNREFUSED' ||
                err.code === 'ETIMEDOUT'
            ) {
                return true
            }
        }
        return false
    }

    /**
     * 转换通用错误
     * 根据错误类型返回对应的 StorageError 子类
     */
    protected convertError(error: unknown, defaultMessage: string): StorageError {
        // 如果已经是 StorageError，直接返回
        if (error instanceof StorageError) {
            return error
        }

        const errorObj = error as Record<string, unknown> | undefined
        const message = (errorObj?.message as string) || defaultMessage

        // 检查特定错误类型
        if (this.isNotFoundError(error)) {
            const path = (errorObj?.key as string) || (errorObj?.path as string) || ''
            return new StorageNotFoundError(path, error instanceof Error ? error : undefined)
        }

        if (this.isPermissionError(error)) {
            return new StoragePermissionError(message, error instanceof Error ? error : undefined)
        }

        if (this.isConfigError(error)) {
            return new StorageConfigError(message, error instanceof Error ? error : undefined)
        }

        if (this.isNetworkError(error)) {
            return new StorageNetworkError(message, error instanceof Error ? error : undefined)
        }

        // 返回通用错误
        return new StorageError(message, StorageErrorCode.UNKNOWN_ERROR, error instanceof Error ? error : undefined)
    }

    // ============================================================================
    // 辅助方法
    // ============================================================================

    /**
     * 获取文件扩展名
     */
    protected getExtension(filename: string): string {
        const lastDot = filename.lastIndexOf('.')
        if (lastDot === -1) {
            return ''
        }
        return filename.substring(lastDot + 1).toLowerCase()
    }

    /**
     * 生成 UUID
     */
    protected generateUuid(): string {
        return crypto.randomUUID()
    }

    /**
     * 生成文件名
     */
    protected generateFileName(
        originalFileName: string,
        strategy: 'uuid' | 'timestamp' | 'original' | 'custom' = 'uuid',
        customFileName?: string
    ): string {
        const extension = this.getExtension(originalFileName)

        switch (strategy) {
            case 'uuid':
                return extension ? `${this.generateUuid()}.${extension}` : this.generateUuid()
            case 'timestamp':
                return extension ? `${Date.now()}.${extension}` : String(Date.now())
            case 'original':
                return originalFileName
            case 'custom':
                return customFileName || originalFileName
            default:
                return extension ? `${this.generateUuid()}.${extension}` : this.generateUuid()
        }
    }

    /**
     * 构建完整的文件路径
     */
    protected buildFilePath(dir: string, fileName: string): string {
        // 确保目录以 / 结尾
        const normalizedDir = dir.endsWith('/') ? dir : `${dir}/`
        // 移除文件名开头的 /
        const normalizedFileName = fileName.startsWith('/') ? fileName.substring(1) : fileName
        return `${normalizedDir}${normalizedFileName}`
    }

    /**
     * 获取存储主机地址
     * 子类应重写此方法以返回特定服务商的主机地址
     */
    protected abstract getHost(): string
}
