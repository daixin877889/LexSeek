/**
 * 七牛云存储适配器
 *
 * TODO: 需要安装 qiniu SDK: bun add qiniu
 */

import type { Readable } from 'stream'
import type {
    QiniuConfig,
    StorageProviderType,
    UploadOptions,
    UploadResult,
    DownloadOptions,
    DeleteResult,
    SignedUrlOptions,
    PostSignatureOptions,
    QiniuPostSignatureResult
} from '../types'
import { BaseStorageAdapter } from '../base'
import { StorageConfigError } from '../errors'

/**
 * 七牛云存储适配器
 *
 * 实现 StorageAdapter 接口，提供七牛云存储操作
 */
export class QiniuAdapter extends BaseStorageAdapter {
    readonly type = 'qiniu' as StorageProviderType

    /** 七牛云配置 */
    private readonly qiniuConfig: QiniuConfig

    constructor(config: QiniuConfig) {
        super(config)
        this.qiniuConfig = config
    }

    /**
     * 验证配置
     */
    protected override validateConfig(): void {
        super.validateConfig()

        const config = this.config as QiniuConfig

        if (!config.accessKey) {
            throw new StorageConfigError('缺少必填配置: accessKey')
        }
        if (!config.secretKey) {
            throw new StorageConfigError('缺少必填配置: secretKey')
        }
    }

    /**
     * 获取存储主机地址
     */
    protected getHost(): string {
        if (this.qiniuConfig.customDomain) {
            return this.qiniuConfig.customDomain
        }
        // 七牛云默认域名格式
        return `https://${this.qiniuConfig.bucket}.${this.qiniuConfig.region}.qiniucs.com`
    }

    /**
     * 上传文件
     */
    async upload(
        _path: string,
        _data: Buffer | Readable,
        _options?: UploadOptions
    ): Promise<UploadResult> {
        // TODO: 实现七牛云上传
        throw new StorageConfigError('七牛云适配器尚未实现')
    }

    /**
     * 下载文件
     */
    async download(_path: string, _options?: DownloadOptions): Promise<Buffer> {
        // TODO: 实现七牛云下载
        throw new StorageConfigError('七牛云适配器尚未实现')
    }

    /**
     * 流式下载文件
     */
    async downloadStream(_path: string, _options?: DownloadOptions): Promise<Readable> {
        // TODO: 实现七牛云流式下载
        throw new StorageConfigError('七牛云适配器尚未实现')
    }

    /**
     * 删除文件
     */
    async delete(_paths: string | string[]): Promise<DeleteResult> {
        // TODO: 实现七牛云删除
        throw new StorageConfigError('七牛云适配器尚未实现')
    }

    /**
     * 生成签名 URL
     */
    async generateSignedUrl(_path: string, _options?: SignedUrlOptions): Promise<string> {
        // TODO: 实现七牛云签名 URL
        throw new StorageConfigError('七牛云适配器尚未实现')
    }

    /**
     * 生成客户端直传签名
     */
    async generatePostSignature(
        _options: PostSignatureOptions
    ): Promise<QiniuPostSignatureResult> {
        // TODO: 实现七牛云上传凭证
        throw new StorageConfigError('七牛云适配器尚未实现')
    }

    /**
     * 测试连接
     */
    async testConnection(): Promise<boolean> {
        // TODO: 实现七牛云连接测试
        throw new StorageConfigError('七牛云适配器尚未实现')
    }
}
