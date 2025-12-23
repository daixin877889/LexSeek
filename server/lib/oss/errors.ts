/**
 * OSS 配置错误
 */
export class OssConfigError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'OssConfigError'
    }
}

/**
 * OSS STS 错误
 */
export class OssStsError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'OssStsError'
    }
}

/**
 * OSS 文件不存在错误
 */
export class OssNotFoundError extends Error {
    constructor(objectPath: string) {
        super(`Object not found: ${objectPath}`)
        this.name = 'OssNotFoundError'
    }
}

/**
 * OSS 上传错误
 */
export class OssUploadError extends Error {
    constructor(detail: string) {
        super(`Upload failed: ${detail}`)
        this.name = 'OssUploadError'
    }
}

/**
 * OSS 下载错误
 */
export class OssDownloadError extends Error {
    constructor(detail: string) {
        super(`Download failed: ${detail}`)
        this.name = 'OssDownloadError'
    }
}

/**
 * OSS 删除错误
 */
export class OssDeleteError extends Error {
    constructor(detail: string) {
        super(`Delete failed: ${detail}`)
        this.name = 'OssDeleteError'
    }
}

/**
 * OSS 网络错误
 */
export class OssNetworkError extends Error {
    constructor(detail: string) {
        super(`Network error: ${detail}`)
        this.name = 'OssNetworkError'
    }
}
