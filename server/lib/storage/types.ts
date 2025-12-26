/**
 * 存储适配器类型定义
 *
 * 定义统一的存储操作接口和类型，支持多种云存储服务商
 */

import type { Readable } from 'stream'

// ============================================================================
// 存储服务商类型
// ============================================================================

/**
 * 存储服务商类型枚举
 */
export enum StorageProviderType {
    /** 阿里云 OSS */
    ALIYUN_OSS = 'aliyun_oss',
    /** 七牛云 */
    QINIU = 'qiniu',
    /** 腾讯云 COS */
    TENCENT_COS = 'tencent_cos'
}

// ============================================================================
// 存储配置类型
// ============================================================================

/**
 * 基础存储配置
 */
export interface BaseStorageConfig {
    /** 配置 ID */
    id?: number
    /** 服务商类型 */
    type: StorageProviderType
    /** 配置名称 */
    name: string
    /** Bucket 名称 */
    bucket: string
    /** 区域 */
    region: string
    /** 自定义域名（CDN 加速域名） */
    customDomain?: string
    /** 是否启用 */
    enabled: boolean
}

/**
 * 阿里云 OSS STS 配置
 */
export interface AliyunStsConfig {
    /** STS 角色 ARN */
    roleArn: string
    /** 会话名称 */
    roleSessionName?: string
    /** 凭证有效期（秒），默认 3600 */
    durationSeconds?: number
}

/**
 * 阿里云 OSS 配置
 */
export interface AliyunOssConfig extends BaseStorageConfig {
    type: StorageProviderType.ALIYUN_OSS
    /** Access Key ID */
    accessKeyId: string
    /** Access Key Secret */
    accessKeySecret: string
    /** STS 配置 */
    sts?: AliyunStsConfig
}

/**
 * 七牛云区域类型
 */
export type QiniuZone = 'z0' | 'z1' | 'z2' | 'na0' | 'as0'

/**
 * 七牛云配置
 */
export interface QiniuConfig extends BaseStorageConfig {
    type: StorageProviderType.QINIU
    /** Access Key */
    accessKey: string
    /** Secret Key */
    secretKey: string
    /** 上传区域 */
    zone?: QiniuZone
}

/**
 * 腾讯云 COS STS 配置
 */
export interface TencentStsConfig {
    /** STS 角色 ARN */
    roleArn: string
    /** 凭证有效期（秒） */
    durationSeconds?: number
}

/**
 * 腾讯云 COS 配置
 */
export interface TencentCosConfig extends BaseStorageConfig {
    type: StorageProviderType.TENCENT_COS
    /** Secret ID */
    secretId: string
    /** Secret Key */
    secretKey: string
    /** App ID */
    appId: string
    /** STS 配置 */
    sts?: TencentStsConfig
}

/**
 * 存储配置联合类型
 */
export type StorageConfig = AliyunOssConfig | QiniuConfig | TencentCosConfig

// ============================================================================
// 操作选项类型
// ============================================================================

/**
 * 上传选项
 */
export interface UploadOptions {
    /** Content-Type */
    contentType?: string
    /** 自定义元数据 */
    meta?: Record<string, string>
    /** 存储类型 */
    storageClass?: 'Standard' | 'IA' | 'Archive'
}

/**
 * 下载选项
 */
export interface DownloadOptions {
    /** 下载范围，格式 'bytes=0-100' */
    range?: string
}

/**
 * 签名 URL 选项
 */
export interface SignedUrlOptions {
    /** URL 过期时间（秒），默认 3600 */
    expires?: number
    /** HTTP 方法，默认 'GET' */
    method?: 'GET' | 'PUT' | 'HEAD'
    /** 响应头设置 */
    response?: {
        contentType?: string
        contentDisposition?: string
    }
}

/**
 * 回调配置
 */
export interface CallbackConfig {
    /** 回调 URL */
    callbackUrl: string
    /** 回调体模板 */
    callbackBody?: string
    /** 回调体类型 */
    callbackBodyType?: 'application/x-www-form-urlencoded' | 'application/json'
    /** 自定义回调参数 */
    callbackVar?: Record<string, string | number>
}

/**
 * 策略条件
 */
export interface PolicyConditions {
    /** 文件大小范围 [最小, 最大]（字节） */
    contentLengthRange?: [number, number]
    /** 允许的 Content-Type 列表 */
    contentType?: string[]
}

/**
 * 文件名生成选项
 */
export interface FileKeyOptions {
    /** 原始文件名 */
    originalFileName?: string
    /** 文件名生成策略 */
    strategy?: 'uuid' | 'timestamp' | 'original' | 'custom'
    /** 自定义文件名 */
    customFileName?: string
}

/**
 * 客户端直传签名选项
 */
export interface PostSignatureOptions {
    /** 文件目录前缀 */
    dir?: string
    /** 文件名生成选项 */
    fileKey?: FileKeyOptions
    /** 签名过期时间（分钟），默认 10 */
    expirationMinutes?: number
    /** 回调配置 */
    callback?: CallbackConfig
    /** 策略条件 */
    conditions?: PolicyConditions
}

// ============================================================================
// 操作结果类型
// ============================================================================

/**
 * 上传结果
 */
export interface UploadResult {
    /** 文件路径 */
    name: string
    /** ETag */
    etag: string
    /** 文件 URL */
    url: string
}

/**
 * 删除结果
 */
export interface DeleteResult {
    /** 删除的文件路径列表 */
    deleted: string[]
}

/**
 * 客户端直传签名结果（基础字段）
 */
export interface BasePostSignatureResult {
    /** 上传地址 */
    host: string
    /** 文件目录前缀 */
    dir: string
    /** 完整的文件路径 */
    key?: string
}

/**
 * 阿里云 OSS 直传签名结果
 */
export interface AliyunPostSignatureResult extends BasePostSignatureResult {
    /** Base64 编码的策略 */
    policy: string
    /** 签名版本 */
    signatureVersion: string
    /** 凭证信息 */
    credential: string
    /** 签名日期 */
    date: string
    /** 签名 */
    signature: string
    /** Base64 编码的回调配置 */
    callback?: string
    /** 回调自定义变量 */
    callbackVar?: Record<string, string>
    /** STS 安全令牌 */
    securityToken?: string
}

/**
 * 七牛云直传签名结果
 */
export interface QiniuPostSignatureResult extends BasePostSignatureResult {
    /** 上传凭证 */
    uploadToken: string
}

/**
 * 腾讯云 COS 直传签名结果
 */
export interface TencentPostSignatureResult extends BasePostSignatureResult {
    /** 临时密钥 ID */
    tmpSecretId: string
    /** 临时密钥 Key */
    tmpSecretKey: string
    /** 会话令牌 */
    sessionToken: string
    /** 开始时间戳 */
    startTime: number
    /** 过期时间戳 */
    expiredTime: number
}

/**
 * 客户端直传签名结果联合类型
 */
export type PostSignatureResult =
    | AliyunPostSignatureResult
    | QiniuPostSignatureResult
    | TencentPostSignatureResult

// ============================================================================
// 适配器接口
// ============================================================================

/**
 * 存储适配器接口
 * 定义所有存储服务商必须实现的方法
 */
export interface StorageAdapter {
    /** 适配器类型标识 */
    readonly type: StorageProviderType

    /**
     * 上传文件
     * @param path 目标路径
     * @param data 文件数据（Buffer 或 Readable 流）
     * @param options 上传选项
     * @returns 上传结果
     */
    upload(path: string, data: Buffer | Readable, options?: UploadOptions): Promise<UploadResult>

    /**
     * 下载文件
     * @param path 文件路径
     * @param options 下载选项
     * @returns 文件数据 Buffer
     */
    download(path: string, options?: DownloadOptions): Promise<Buffer>

    /**
     * 流式下载文件
     * @param path 文件路径
     * @param options 下载选项
     * @returns 可读流
     */
    downloadStream(path: string, options?: DownloadOptions): Promise<Readable>

    /**
     * 删除文件
     * @param paths 文件路径或路径数组
     * @returns 删除结果
     */
    delete(paths: string | string[]): Promise<DeleteResult>

    /**
     * 生成签名 URL（用于私有文件访问）
     * @param path 文件路径
     * @param options 签名选项
     * @returns 带签名的 URL
     */
    generateSignedUrl(path: string, options?: SignedUrlOptions): Promise<string>

    /**
     * 生成客户端直传签名
     * @param options 签名选项
     * @returns 签名结果
     */
    generatePostSignature(options: PostSignatureOptions): Promise<PostSignatureResult>

    /**
     * 测试连接
     * @returns 连接是否成功
     */
    testConnection(): Promise<boolean>
}

// ============================================================================
// 适配器构造函数类型
// ============================================================================

/**
 * 适配器构造函数类型
 */
export type AdapterConstructor = new (config: StorageConfig) => StorageAdapter

// ============================================================================
// 回调相关类型
// ============================================================================

/**
 * 统一回调数据结构
 */
export interface CallbackData {
    /** 文件路径 */
    filePath: string
    /** 文件大小（字节） */
    fileSize: number
    /** MIME 类型 */
    mimeType: string
    /** 自定义变量 */
    customVars: Record<string, string>
    /** 原始回调数据 */
    rawData: unknown
}

/**
 * 回调处理器接口
 */
export interface CallbackHandler {
    /**
     * 验证回调请求
     * @param headers 请求头
     * @param body 请求体
     * @param config 存储配置
     * @returns 验证是否通过
     */
    verify(headers: Record<string, string>, body: unknown, config: StorageConfig): Promise<boolean>

    /**
     * 解析回调数据
     * @param body 请求体
     * @returns 统一的回调数据
     */
    parse(body: unknown): Promise<CallbackData>
}

// ============================================================================
// 类型守卫
// ============================================================================

/**
 * 判断是否为阿里云 OSS 配置
 */
export function isAliyunOssConfig(config: StorageConfig): config is AliyunOssConfig {
    return config.type === StorageProviderType.ALIYUN_OSS
}

/**
 * 判断是否为七牛云配置
 */
export function isQiniuConfig(config: StorageConfig): config is QiniuConfig {
    return config.type === StorageProviderType.QINIU
}

/**
 * 判断是否为腾讯云 COS 配置
 */
export function isTencentCosConfig(config: StorageConfig): config is TencentCosConfig {
    return config.type === StorageProviderType.TENCENT_COS
}

/**
 * 判断是否为阿里云 OSS 签名结果
 */
export function isAliyunPostSignatureResult(
    result: PostSignatureResult
): result is AliyunPostSignatureResult {
    return 'policy' in result && 'signatureVersion' in result
}

/**
 * 判断是否为七牛云签名结果
 */
export function isQiniuPostSignatureResult(
    result: PostSignatureResult
): result is QiniuPostSignatureResult {
    return 'uploadToken' in result
}

/**
 * 判断是否为腾讯云 COS 签名结果
 */
export function isTencentPostSignatureResult(
    result: PostSignatureResult
): result is TencentPostSignatureResult {
    return 'tmpSecretId' in result && 'sessionToken' in result
}
