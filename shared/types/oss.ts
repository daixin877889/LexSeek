import type { Readable } from 'stream'

/**
 * OSS 基础配置
 */
export interface OssBaseConfig {
    /** Access Key ID */
    accessKeyId: string
    /** Access Key Secret */
    accessKeySecret: string
    /** Bucket 名称 */
    bucket: string
    /** 区域，如 'cn-hangzhou' */
    region: string
}

/**
 * STS 配置（可选）
 */
export interface OssStsConfig {
    /** STS 角色 ARN */
    roleArn: string
    /** 会话名称（可选） */
    roleSessionName?: string
    /** 凭证有效期（秒），默认 3600 */
    durationSeconds?: number
}

/**
 * 完整 OSS 配置
 */
export interface OssConfig extends OssBaseConfig {
    /** STS 配置，提供时使用 STS 临时凭证 */
    sts?: OssStsConfig
}

/**
 * 回调配置
 */
export interface CallbackConfig {
    /** 回调 URL */
    callbackUrl: string
    /** 回调体模板，支持 OSS 变量如 ${object}、${size} 等 */
    callbackBody?: string
    /** 回调体类型，默认 'application/x-www-form-urlencoded' */
    callbackBodyType?: 'application/x-www-form-urlencoded' | 'application/json'
    /** 自定义回调参数 */
    callbackVar?: Record<string, string>
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
    /** 原始文件名（用于提取扩展名） */
    originalFileName: string
    /** 文件名生成策略，默认 'uuid' */
    strategy?: 'uuid' | 'timestamp' | 'original'
    /** 自定义文件名（当 strategy 为 'custom' 时使用） */
    customFileName?: string
}

/**
 * 客户端直传签名选项
 */
export interface PostSignatureOptions {
    /** 文件目录前缀 */
    dir?: string
    /** 文件名生成选项（提供时会在结果中返回完整的 key） */
    fileKey?: FileKeyOptions
    /** 签名过期时间（分钟），默认 10 */
    expirationMinutes?: number
    /** 回调配置 */
    callback?: CallbackConfig
    /** 策略条件 */
    conditions?: PolicyConditions
}


/**
 * 客户端直传签名结果
 */
export interface PostSignatureResult {
    /** OSS 上传地址 */
    host: string
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
    /** 文件目录前缀 */
    dir: string
    /** 完整的文件路径（当提供 fileKey 选项时返回） */
    key?: string
    /** Base64 编码的回调配置（可选） */
    callback?: string
    /** STS 安全令牌（使用 STS 时） */
    securityToken?: string
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
 * 下载选项
 */
export interface DownloadOptions {
    /** 下载范围，格式 'bytes=0-100' */
    range?: string
}

/**
 * 删除结果
 */
export interface DeleteResult {
    /** 删除的文件路径列表 */
    deleted: string[]
}

/**
 * STS 临时凭证
 */
export interface StsCredentials {
    accessKeyId: string
    accessKeySecret: string
    securityToken: string
    expiration: Date
}

/**
 * OSS 客户端实例
 */
export interface OssClientInstance {
    /** ali-oss 客户端实例 */
    client: any
    /** 配置信息 */
    config: OssConfig
    /** STS 临时凭证（如果使用 STS） */
    credentials?: StsCredentials
}
