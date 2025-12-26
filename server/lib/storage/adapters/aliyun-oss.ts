/**
 * 阿里云 OSS 存储适配器
 *
 * 复用现有的 server/lib/oss 模块实现
 */

import type { Readable } from 'stream'
import type {
    AliyunOssConfig,
    StorageProviderType,
    UploadOptions,
    UploadResult,
    DownloadOptions,
    DeleteResult,
    SignedUrlOptions,
    PostSignatureOptions,
    AliyunPostSignatureResult
} from '../types'
import { BaseStorageAdapter } from '../base'
import {
    StorageConfigError,
    StorageNotFoundError,
    StoragePermissionError,
    StorageNetworkError,
    convertAliyunError
} from '../errors'

// 复用现有的 OSS 模块
import {
    createOssClient,
    generatePostSignature as ossGeneratePostSignature,
    generateSignedUrl as ossGenerateSignedUrl,
    uploadFile as ossUploadFile,
    downloadFile as ossDownloadFile,
    downloadFileStream as ossDownloadFileStream,
    deleteFile as ossDeleteFile
} from '~~/server/lib/oss'
import type { OssConfig } from '~~/shared/types/oss'

/**
 * 阿里云 OSS 存储适配器
 */
export class AliyunOssAdapter extends BaseStorageAdapter {
    readonly type = 'aliyun_oss' as StorageProviderType

    /** 阿里云 OSS 配置 */
    private readonly ossConfig: AliyunOssConfig

    constructor(config: AliyunOssConfig) {
        super(config)
        this.ossConfig = config
    }

    /**
     * 验证配置
     */
    protected override validateConfig(): void {
        super.validateConfig()

        const config = this.config as AliyunOssConfig

        if (!config.accessKeyId) {
            throw new StorageConfigError('缺少必填配置: accessKeyId')
        }
        if (!config.accessKeySecret) {
            throw new StorageConfigError('缺少必填配置: accessKeySecret')
        }

        // 验证 region 格式
        const regionPattern = /^(oss-)?[a-z]+-[a-z0-9]+$/
        if (!regionPattern.test(config.region)) {
            throw new StorageConfigError(`无效的 region 格式: ${config.region}`)
        }

        // 如果提供了 STS 配置，验证 roleArn 格式
        if (config.sts) {
            const arnPattern = /^acs:ram::\d+:role\/[\w-]+$/
            if (!arnPattern.test(config.sts.roleArn)) {
                throw new StorageConfigError('无效的 STS role ARN 格式')
            }
        }
    }

    /**
     * 转换为 OSS 库的配置格式
     */
    private toOssConfig(): OssConfig {
        return {
            accessKeyId: this.ossConfig.accessKeyId,
            accessKeySecret: this.ossConfig.accessKeySecret,
            bucket: this.ossConfig.bucket,
            region: this.ossConfig.region,
            customDomain: this.ossConfig.customDomain,
            sts: this.ossConfig.sts
                ? {
                    roleArn: this.ossConfig.sts.roleArn,
                    roleSessionName: this.ossConfig.sts.roleSessionName,
                    durationSeconds: this.ossConfig.sts.durationSeconds
                }
                : undefined
        }
    }

    /**
     * 获取存储主机地址
     */
    protected getHost(): string {
        if (this.ossConfig.customDomain) {
            let domain = this.ossConfig.customDomain.trim()
            if (!domain.startsWith('http://') && !domain.startsWith('https://')) {
                domain = `https://${domain}`
            }
            return domain.replace(/\/+$/, '')
        }

        const region = this.ossConfig.region.replace(/^oss-/g, '')
        return `https://${this.ossConfig.bucket}.oss-${region}.aliyuncs.com`
    }

    /**
     * 检查是否为文件不存在错误
     */
    protected override isNotFoundError(error: unknown): boolean {
        if (super.isNotFoundError(error)) {
            return true
        }
        if (error && typeof error === 'object') {
            const err = error as Record<string, unknown>
            return err.code === 'NoSuchKey' || err.status === 404
        }
        return false
    }

    /**
     * 检查是否为权限错误
     */
    protected override isPermissionError(error: unknown): boolean {
        if (super.isPermissionError(error)) {
            return true
        }
        if (error && typeof error === 'object') {
            const err = error as Record<string, unknown>
            return err.code === 'AccessDenied' || err.status === 403
        }
        return false
    }

    /**
     * 检查是否为配置错误
     */
    protected override isConfigError(error: unknown): boolean {
        if (super.isConfigError(error)) {
            return true
        }
        if (error && typeof error === 'object') {
            const err = error as Record<string, unknown>
            return (
                err.code === 'InvalidAccessKeyId' ||
                err.code === 'SignatureDoesNotMatch'
            )
        }
        return false
    }

    /**
     * 检查是否为网络错误
     */
    protected override isNetworkError(error: unknown): boolean {
        if (super.isNetworkError(error)) {
            return true
        }
        if (error && typeof error === 'object') {
            const err = error as Record<string, unknown>
            return (
                err.code === 'NetworkError' ||
                err.code === 'ConnectionTimeoutError'
            )
        }
        return false
    }

    /**
     * 上传文件
     */
    async upload(
        path: string,
        data: Buffer | Readable,
        options?: UploadOptions
    ): Promise<UploadResult> {
        try {
            const result = await ossUploadFile(this.toOssConfig(), path, data, {
                contentType: options?.contentType,
                meta: options?.meta,
                storageClass: options?.storageClass
            })

            return {
                name: result.name,
                etag: result.etag,
                url: result.url
            }
        } catch (error) {
            throw convertAliyunError(error, this.wrapUploadError(error).constructor as any)
        }
    }

    /**
     * 下载文件
     */
    async download(path: string, options?: DownloadOptions): Promise<Buffer> {
        try {
            return await ossDownloadFile(this.toOssConfig(), path, {
                range: options?.range
            })
        } catch (error) {
            if (this.isNotFoundError(error)) {
                throw new StorageNotFoundError(path, error instanceof Error ? error : undefined)
            }
            throw convertAliyunError(error, this.wrapDownloadError(error).constructor as any)
        }
    }

    /**
     * 流式下载文件
     */
    async downloadStream(path: string, options?: DownloadOptions): Promise<Readable> {
        try {
            return await ossDownloadFileStream(this.toOssConfig(), path, {
                range: options?.range
            })
        } catch (error) {
            if (this.isNotFoundError(error)) {
                throw new StorageNotFoundError(path, error instanceof Error ? error : undefined)
            }
            throw convertAliyunError(error, this.wrapDownloadError(error).constructor as any)
        }
    }

    /**
     * 删除文件
     */
    async delete(paths: string | string[]): Promise<DeleteResult> {
        try {
            const result = await ossDeleteFile(this.toOssConfig(), paths)
            return {
                deleted: result.deleted
            }
        } catch (error) {
            throw convertAliyunError(error, this.wrapDeleteError(error).constructor as any)
        }
    }

    /**
     * 生成签名 URL
     */
    async generateSignedUrl(path: string, options?: SignedUrlOptions): Promise<string> {
        try {
            return await ossGenerateSignedUrl(this.toOssConfig(), path, {
                expires: options?.expires,
                method: options?.method,
                response: options?.response
            })
        } catch (error) {
            throw this.wrapSignatureError(error)
        }
    }

    /**
     * 生成客户端直传签名
     */
    async generatePostSignature(
        options: PostSignatureOptions
    ): Promise<AliyunPostSignatureResult> {
        try {
            const result = await ossGeneratePostSignature(this.toOssConfig(), {
                dir: options.dir,
                fileKey: options.fileKey
                    ? {
                        originalFileName: options.fileKey.originalFileName,
                        strategy: options.fileKey.strategy,
                        customFileName: options.fileKey.customFileName
                    }
                    : undefined,
                expirationMinutes: options.expirationMinutes,
                callback: options.callback
                    ? {
                        callbackUrl: options.callback.callbackUrl,
                        callbackBody: options.callback.callbackBody,
                        callbackBodyType: options.callback.callbackBodyType,
                        callbackVar: options.callback.callbackVar
                    }
                    : undefined,
                conditions: options.conditions
                    ? {
                        contentLengthRange: options.conditions.contentLengthRange,
                        contentType: options.conditions.contentType
                    }
                    : undefined
            })

            return {
                host: result.host,
                policy: result.policy,
                signatureVersion: result.signatureVersion,
                credential: result.credential,
                date: result.date,
                signature: result.signature,
                dir: result.dir,
                key: result.key,
                callback: result.callback,
                callbackVar: result.callbackVar,
                securityToken: result.securityToken
            }
        } catch (error) {
            throw this.wrapSignatureError(error)
        }
    }

    /**
     * 测试连接
     */
    async testConnection(): Promise<boolean> {
        try {
            const { client } = await createOssClient(this.toOssConfig())
            // 尝试列出 bucket 中的文件（最多 1 个）来测试连接
            await client.list({ 'max-keys': 1 })
            return true
        } catch (error) {
            // 如果是权限错误，说明连接成功但没有列表权限，也算连接成功
            if (this.isPermissionError(error)) {
                return true
            }
            return false
        }
    }
}
