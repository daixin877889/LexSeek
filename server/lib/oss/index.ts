// 导出类型（从 shared/types/oss 重新导出）
export type {
    OssBaseConfig,
    OssStsConfig,
    OssConfig,
    CallbackConfig,
    PolicyConditions,
    PostSignatureOptions,
    PostSignatureResult,
    SignedUrlOptions,
    UploadOptions,
    UploadResult,
    DownloadOptions,
    DeleteResult,
    StsCredentials,
    OssClientInstance
} from '~~/shared/types/oss'

// 导出错误类
export {
    OssConfigError,
    OssStsError,
    OssNotFoundError,
    OssUploadError,
    OssDownloadError,
    OssDeleteError,
    OssNetworkError
} from './errors'

// 导出核心函数
export { createOssClient } from './client'
export { validateConfig } from './validator'

// 导出功能函数
export { generatePostSignature } from './postSignature'
export { generateSignedUrl } from './signedUrl'
export { uploadFile } from './upload'
export { downloadFile, downloadFileStream } from './download'
export { deleteFile } from './delete'

// 导出工具函数
export {
    formatDateToUTC,
    getStandardRegion,
    getCredential,
    encodeBase64,
    decodeBase64,
    getOssHost
} from './utils'
