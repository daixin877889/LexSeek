/**
 * 存储适配器模块统一导出
 *
 * 提供统一的存储操作接口，支持多种云存储服务商
 */

// 导出类型定义
export {
    StorageProviderType,
    type StorageAdapter,
    type BaseStorageConfig,
    type AliyunOssConfig,
    type QiniuConfig,
    type TencentCosConfig,
    type StorageConfig,
    type UploadOptions,
    type UploadResult,
    type DownloadOptions,
    type DeleteResult,
    type SignedUrlOptions,
    type PostSignatureOptions,
    type PostSignatureResult,
    type AliyunPostSignatureResult,
    type QiniuPostSignatureResult,
    type TencentCosPostSignatureResult,
    type CallbackOptions,
    // 类型守卫
    isAliyunOssConfig,
    isQiniuConfig,
    isTencentCosConfig,
    isAliyunPostSignatureResult,
    isQiniuPostSignatureResult,
    isTencentCosPostSignatureResult
} from './types'

// 导出错误类型
export {
    StorageError,
    StorageConfigError,
    StorageNotFoundError,
    StoragePermissionError,
    StorageNetworkError,
    StorageUploadError,
    StorageDownloadError,
    StorageDeleteError,
    StorageSignatureError,
    // 错误转换工具
    convertAliyunError,
    convertQiniuError,
    convertTencentError
} from './errors'

// 导出基础适配器类
export { BaseStorageAdapter } from './base'

// 导出适配器工厂
export { StorageFactory } from './factory'

// 导出适配器实现
export { AliyunOssAdapter } from './adapters/aliyun-oss'
export { QiniuAdapter } from './adapters/qiniu'
export { TencentCosAdapter } from './adapters/tencent-cos'

// 导出回调处理模块
export {
    type CallbackData,
    type CallbackVerifyResult,
    type CallbackHandler,
    verifyCallback,
    parseCallback,
    registerCallbackHandler,
    AliyunCallbackValidator,
    clearPublicKeyCache
} from './callback'
