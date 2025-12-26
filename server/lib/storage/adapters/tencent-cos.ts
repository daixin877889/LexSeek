/**
 * 腾讯云 COS 存储适配器
 *
 * TODO: 需要安装腾讯云 SDK: bun add cos-nodejs-sdk-v5
 */

import type { Readable } from 'stream'
import type {
    TencentCosConfig,
    StorageProviderType,
    UploadOptions,
    UploadResult,
    DownloadOptions,
    DeleteResult,
    SignedUrlOptions,
    PostSignatureOptions,
    TencentPostSignatureResult
} from '../types'
import { BaseStorageAdapter } from '../base'
import { StorageConfigError } from '../errors'

/**
 * 腾讯云 COS 存储适配器
 *
 * 实现 StorageAdapter 接口，提供腾讯云 COS 存储操作
 */
export class TencentCosAdapter extends BaseStorageAdapter {
    readonly type = 'tencent_cos' as StorageProviderType

    /** 腾讯云 COS 配置 */
    private readonly cosConfig: TencentCosConfig

    constructor(config: TencentCosConfig) {
        super(config)
        this.cosConfig = config
    }

    /**
     * 验证配置
     */
    protected override validateConfig(): void {
        super.validateConfig()

        const config = this.config as TencentCosConfig

        if (!config.secretId) {
            throw new StorageConfigError('缺少必填配置: secretId')
        }
        if (!config.secretKey) {
            throw new StorageConfigError('缺少必填配置: secretKey')
        }
        if (!config.appId) {
            throw new StorageConfigError('缺少必填配置: appId')
        }
    }

    /**
     * 获取存储主机地址
     */
    protected getHost(): string {
        if (this.cosConfig.customDomain) {
            return this.cosConfig.customDomain
        }
        // 腾讯云 COS 默认域名格式
        return `https://${this.cosConfig.bucket}-${this.cosConfig.appId}.cos.${this.cosConfig.region}.myqcloud.com`
    }

    /**
     * 上传文件
     */
    async upload(
        _path: string,
        _data: Buffer | Readable,
        _options?: UploadOptions
    ): Promise<UploadResult> {
        // TODO: 实现腾讯云 COS 上传
        throw new StorageConfigError('腾讯云 COS 适配器尚未实现')
    }

    /**
     * 下载文件
     */
    async download(_path: string, _options?: DownloadOptions): Promise<Buffer> {
        // TODO: 实现腾讯云 COS 下载
        throw new StorageConfigError('腾讯云 COS 适配器尚未实现')
    }

    /**
     * 流式下载文件
     */
    async downloadStream(_path: string, _options?: DownloadOptions): Promise<Readable> {
        // TODO: 实现腾讯云 COS 流式下载
        throw new StorageConfigError('腾讯云 COS 适配器尚未实现')
    }

    /**
     * 删除文件
     */
    async delete(_paths: string | string[]): Promise<DeleteResult> {
        // TODO: 实现腾讯云 COS 删除
        throw new StorageConfigError('腾讯云 COS 适配器尚未实现')
    }

    /**
     * 生成签名 URL
     */
    async generateSignedUrl(_path: string, _options?: SignedUrlOptions): Promise<string> {
        // TODO: 实现腾讯云 COS 签名 URL
        throw new StorageConfigError('腾讯云 COS 适配器尚未实现')
    }

    /**
     * 生成客户端直传签名
     */
    async generatePostSignature(
        _options: PostSignatureOptions
    ): Promise<TencentPostSignatureResult> {
        // TODO: 实现腾讯云 COS 上传签名
        throw new StorageConfigError('腾讯云 COS 适配器尚未实现')
    }

    /**
     * 测试连接
     */
    async testConnection(): Promise<boolean> {
        // TODO: 实现腾讯云 COS 连接测试
        throw new StorageConfigError('腾讯云 COS 适配器尚未实现')
    }
}
