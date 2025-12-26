/**
 * 存储适配器错误类型
 *
 * 定义统一的错误类型，用于处理各种存储操作异常
 */

/**
 * 存储错误码枚举
 */
export enum StorageErrorCode {
    /** 配置错误 */
    CONFIG_ERROR = 'STORAGE_CONFIG_ERROR',
    /** 文件不存在 */
    NOT_FOUND = 'STORAGE_NOT_FOUND',
    /** 权限不足 */
    PERMISSION_DENIED = 'STORAGE_PERMISSION_DENIED',
    /** 网络错误 */
    NETWORK_ERROR = 'STORAGE_NETWORK_ERROR',
    /** 上传错误 */
    UPLOAD_ERROR = 'STORAGE_UPLOAD_ERROR',
    /** 下载错误 */
    DOWNLOAD_ERROR = 'STORAGE_DOWNLOAD_ERROR',
    /** 删除错误 */
    DELETE_ERROR = 'STORAGE_DELETE_ERROR',
    /** 签名错误 */
    SIGNATURE_ERROR = 'STORAGE_SIGNATURE_ERROR',
    /** STS 错误 */
    STS_ERROR = 'STORAGE_STS_ERROR',
    /** 未知错误 */
    UNKNOWN_ERROR = 'STORAGE_UNKNOWN_ERROR'
}

/**
 * 存储错误基类
 * 所有存储相关错误都继承自此类
 */
export class StorageError extends Error {
    /** 错误码 */
    readonly code: StorageErrorCode
    /** 原始错误 */
    readonly cause?: Error

    constructor(message: string, code: StorageErrorCode, cause?: Error) {
        super(message)
        this.name = 'StorageError'
        this.code = code
        this.cause = cause

        // 保持原型链
        Object.setPrototypeOf(this, new.target.prototype)
    }

    /**
     * 转换为 JSON 对象
     */
    toJSON(): Record<string, unknown> {
        return {
            name: this.name,
            code: this.code,
            message: this.message,
            cause: this.cause?.message
        }
    }
}

/**
 * 配置错误
 * 当存储配置无效或缺少必填字段时抛出
 */
export class StorageConfigError extends StorageError {
    constructor(message: string, cause?: Error) {
        super(message, StorageErrorCode.CONFIG_ERROR, cause)
        this.name = 'StorageConfigError'
    }
}

/**
 * 文件不存在错误
 * 当请求的文件在存储中不存在时抛出
 */
export class StorageNotFoundError extends StorageError {
    /** 文件路径 */
    readonly path: string

    constructor(path: string, cause?: Error) {
        super(`文件不存在: ${path}`, StorageErrorCode.NOT_FOUND, cause)
        this.name = 'StorageNotFoundError'
        this.path = path
    }

    toJSON(): Record<string, unknown> {
        return {
            ...super.toJSON(),
            path: this.path
        }
    }
}

/**
 * 权限错误
 * 当没有足够权限执行操作时抛出
 */
export class StoragePermissionError extends StorageError {
    constructor(message: string, cause?: Error) {
        super(message, StorageErrorCode.PERMISSION_DENIED, cause)
        this.name = 'StoragePermissionError'
    }
}

/**
 * 网络错误
 * 当网络连接失败或超时时抛出
 */
export class StorageNetworkError extends StorageError {
    constructor(message: string, cause?: Error) {
        super(message, StorageErrorCode.NETWORK_ERROR, cause)
        this.name = 'StorageNetworkError'
    }
}

/**
 * 上传错误
 * 当文件上传失败时抛出
 */
export class StorageUploadError extends StorageError {
    constructor(message: string, cause?: Error) {
        super(message, StorageErrorCode.UPLOAD_ERROR, cause)
        this.name = 'StorageUploadError'
    }
}

/**
 * 下载错误
 * 当文件下载失败时抛出
 */
export class StorageDownloadError extends StorageError {
    constructor(message: string, cause?: Error) {
        super(message, StorageErrorCode.DOWNLOAD_ERROR, cause)
        this.name = 'StorageDownloadError'
    }
}

/**
 * 删除错误
 * 当文件删除失败时抛出
 */
export class StorageDeleteError extends StorageError {
    constructor(message: string, cause?: Error) {
        super(message, StorageErrorCode.DELETE_ERROR, cause)
        this.name = 'StorageDeleteError'
    }
}

/**
 * 签名错误
 * 当生成签名失败时抛出
 */
export class StorageSignatureError extends StorageError {
    constructor(message: string, cause?: Error) {
        super(message, StorageErrorCode.SIGNATURE_ERROR, cause)
        this.name = 'StorageSignatureError'
    }
}

/**
 * STS 错误
 * 当获取 STS 临时凭证失败时抛出
 */
export class StorageStsError extends StorageError {
    constructor(message: string, cause?: Error) {
        super(message, StorageErrorCode.STS_ERROR, cause)
        this.name = 'StorageStsError'
    }
}

// ============================================================================
// 错误转换工具
// ============================================================================

/**
 * 错误类构造函数类型
 * 用于映射表中存储错误子类
 */
type StorageErrorConstructor = new (message: string, cause?: Error) => StorageError

/**
 * 阿里云 OSS 错误码映射
 */
const ALIYUN_ERROR_MAP: Record<string, StorageErrorConstructor> = {
    NoSuchKey: StorageNotFoundError as unknown as StorageErrorConstructor,
    AccessDenied: StoragePermissionError,
    InvalidAccessKeyId: StorageConfigError,
    SignatureDoesNotMatch: StorageConfigError,
    NetworkError: StorageNetworkError,
    ConnectionTimeoutError: StorageNetworkError
}

/**
 * 七牛云错误码映射
 */
const QINIU_ERROR_MAP: Record<number, StorageErrorConstructor> = {
    612: StorageNotFoundError as unknown as StorageErrorConstructor,
    401: StoragePermissionError,
    403: StoragePermissionError
}

/**
 * 腾讯云 COS 错误码映射
 */
const TENCENT_ERROR_MAP: Record<string, StorageErrorConstructor> = {
    NoSuchKey: StorageNotFoundError as unknown as StorageErrorConstructor,
    AccessDenied: StoragePermissionError,
    InvalidAccessKeyId: StorageConfigError,
    SignatureDoesNotMatch: StorageConfigError
}

/**
 * 将阿里云 OSS 错误转换为统一错误类型
 * @param error 原始错误
 * @param defaultErrorClass 默认错误类型
 * @returns 统一的存储错误
 */
export function convertAliyunError(
    error: any,
    defaultErrorClass: StorageErrorConstructor = StorageNetworkError
): StorageError {
    const code = error.code || error.name
    const ErrorClass = ALIYUN_ERROR_MAP[code] || defaultErrorClass

    if (ErrorClass === StorageNotFoundError) {
        return new StorageNotFoundError(error.message || '文件不存在', error)
    }

    return new ErrorClass(error.message || '阿里云 OSS 操作失败', error)
}

/**
 * 将七牛云错误转换为统一错误类型
 * @param error 原始错误
 * @param defaultErrorClass 默认错误类型
 * @returns 统一的存储错误
 */
export function convertQiniuError(
    error: any,
    defaultErrorClass: StorageErrorConstructor = StorageNetworkError
): StorageError {
    const statusCode = error.statusCode || error.code
    const ErrorClass = QINIU_ERROR_MAP[statusCode] || defaultErrorClass

    if (ErrorClass === StorageNotFoundError) {
        return new StorageNotFoundError(error.message || '文件不存在', error)
    }

    return new ErrorClass(error.message || '七牛云操作失败', error)
}

/**
 * 将腾讯云 COS 错误转换为统一错误类型
 * @param error 原始错误
 * @param defaultErrorClass 默认错误类型
 * @returns 统一的存储错误
 */
export function convertTencentError(
    error: any,
    defaultErrorClass: StorageErrorConstructor = StorageNetworkError
): StorageError {
    const code = error.code || error.Code
    const ErrorClass = TENCENT_ERROR_MAP[code] || defaultErrorClass

    if (ErrorClass === StorageNotFoundError) {
        return new StorageNotFoundError(error.message || '文件不存在', error)
    }

    return new ErrorClass(error.message || '腾讯云 COS 操作失败', error)
}

/**
 * 判断是否为存储错误
 */
export function isStorageError(error: unknown): error is StorageError {
    return error instanceof StorageError
}

/**
 * 判断是否为配置错误
 */
export function isStorageConfigError(error: unknown): error is StorageConfigError {
    return error instanceof StorageConfigError
}

/**
 * 判断是否为文件不存在错误
 */
export function isStorageNotFoundError(error: unknown): error is StorageNotFoundError {
    return error instanceof StorageNotFoundError
}

/**
 * 判断是否为权限错误
 */
export function isStoragePermissionError(error: unknown): error is StoragePermissionError {
    return error instanceof StoragePermissionError
}

/**
 * 判断是否为网络错误
 */
export function isStorageNetworkError(error: unknown): error is StorageNetworkError {
    return error instanceof StorageNetworkError
}
