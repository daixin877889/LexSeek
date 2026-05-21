import type { FileSource } from './file'

/**
 * 文件上传策略 key。
 *
 * FileSource 只描述文件最终存储分类；UploadPolicyKey 描述真实业务入口和安全边界。
 */
export enum UploadPolicyKey {
    CLOUD_DISK_FILE = 'cloud_disk_file',
    CASE_MATERIAL = 'case_material',
    ASSISTANT_ATTACHMENT = 'assistant_attachment',
    CONTRACT_REVIEW_ORIGINAL = 'contract_review_original',
    DEMO_CASE_MATERIAL = 'demo_case_material',
    DOCUMENT_UPLOAD = 'document_upload',
    DOCUMENT_TEMPLATE_PRIVATE = 'document_template_private',
    DOCUMENT_TEMPLATE_GLOBAL = 'document_template_global',
    IMAGE_UPLOAD = 'image_upload',
    AUDIO_UPLOAD = 'audio_upload',
    RECOGNITION_IMAGE_BASE64 = 'recognition_image_base64',
    RECOGNITION_AUDIO_TEMP = 'recognition_audio_temp',
    DOCUMENT_RECOGNITION_MINERU = 'document_recognition_mineru',
    REMOTE_IMAGE_PROXY = 'remote_image_proxy',
    DOC_EMBEDDED_IMAGE = 'doc_embedded_image',
    AGENT_WORKSPACE_EXPORT = 'agent_workspace_export',
    DOCUMENT_EXPORT = 'document_export',
}

/**
 * 文件进入系统的方式。
 */
export enum UploadInputMode {
    OSS_POST = 'oss_post',
    MULTIPART = 'multipart',
    BASE64 = 'base64',
    REMOTE_URL = 'remote_url',
    MINERU_PROXY = 'mineru_proxy',
    TEMP_OSS_POST = 'temp_oss_post',
    SERVER_WORKSPACE = 'server_workspace',
    SERVER_GENERATED = 'server_generated',
}

/**
 * 上传文件可被使用的业务用途。
 */
export enum UploadUsage {
    CLOUD_DISK = 'cloud_disk',
    CASE_MATERIAL = 'case_material',
    ASSISTANT_ATTACHMENT = 'assistant_attachment',
    CONTRACT_REVIEW = 'contract_review',
    DEMO_CASE_MATERIAL = 'demo_case_material',
    DOCUMENT_TEMPLATE = 'document_template',
    IMAGE_RECOGNITION = 'image_recognition',
    AUDIO_RECOGNITION = 'audio_recognition',
    DOCUMENT_RECOGNITION = 'document_recognition',
    REMOTE_IMAGE_PROXY = 'remote_image_proxy',
    DOC_EMBEDDED_IMAGE = 'doc_embedded_image',
    WORKSPACE_EXPORT = 'workspace_export',
    DOCUMENT_EXPORT = 'document_export',
}

/**
 * 文件占用空间的口径。
 */
export enum UploadQuotaMode {
    USER_STORAGE_REQUIRED = 'user_storage_required',
    USER_STORAGE_WITH_TEMP_FALLBACK = 'user_storage_with_temp_fallback',
    SYSTEM_STORAGE = 'system_storage',
    TEMPORARY = 'temporary',
    NONE = 'none',
}

/**
 * 单类文件的安全风险等级。
 */
export enum UploadRiskLevel {
    NORMAL = 'normal',
    HIGH = 'high',
}

export interface UploadAllowedType {
    /** 允许扩展名，不含点号，小写 */
    extensions: string[]
    /** 允许 MIME，小写 */
    mimeTypes: string[]
    /** 单文件最大字节数 */
    maxBytes: number
    /** 高风险类型必须有额外处理，例如 SVG sanitizer / 下载型展示 */
    riskLevel?: UploadRiskLevel
    /** 高风险类型的处理说明 */
    riskNote?: string
}

export interface UploadPolicy {
    key: UploadPolicyKey
    displayName: string
    storageSource: FileSource
    allowedTypes: UploadAllowedType[]
    maxFilesPerRequest: number
    maxTotalBytesPerRequest?: number
    inputModes: UploadInputMode[]
    quotaMode: UploadQuotaMode
    encryptionAllowed: boolean
    callbackRequired: boolean
    verifyActualObject: boolean
    allowedUsages: UploadUsage[]
}

export interface PublicUploadAcceptItem {
    name: string
    mime: string
    maxSize: number
    riskLevel?: UploadRiskLevel
}

export interface PublicUploadPolicy {
    key: UploadPolicyKey
    displayName: string
    source: FileSource
    accept: PublicUploadAcceptItem[]
    maxFilesPerRequest: number
    maxTotalBytesPerRequest?: number
    inputModes: UploadInputMode[]
    encryptionAllowed: boolean
}
