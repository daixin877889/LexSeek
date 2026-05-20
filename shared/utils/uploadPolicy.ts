import { FileSource, FileSourceName } from '../types/file'
import {
    UploadInputMode,
    UploadPolicyKey,
    UploadQuotaMode,
    UploadRiskLevel,
    UploadUsage,
} from '../types/uploadPolicy'
import type {
    PublicUploadAcceptItem,
    PublicUploadPolicy,
    UploadAllowedType,
    UploadPolicy,
} from '../types/uploadPolicy'
import { DOCX_MIME, mime } from './mime'

const MB = 1024 * 1024
const LARGE_FILE_MAX_BYTES = 180 * MB

export const ASR_ACCEPT = {
    m4a: 200 * MB,
    mp3: 200 * MB,
    wav: 500 * MB,
} as const

export const DOC_ACCEPT = {
    pdf: 180 * MB,
    md: 20 * MB,
    mkd: 20 * MB,
    txt: 1 * MB,
    docx: 100 * MB,
    doc: 20 * MB,
} as const

export const IMAGE_ACCEPT = {
    png: 10 * MB,
    jpg: 10 * MB,
    jpeg: 10 * MB,
    gif: 10 * MB,
    webp: 10 * MB,
    heic: 10 * MB,
    heif: 10 * MB,
} as const

export const IMAGE_EXTENSIONS: readonly string[] = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif']
export const AUDIO_EXTENSIONS: readonly string[] = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'webm', 'amr', 'opus']
export const DOC_EXTENSIONS: readonly string[] = ['docx', 'doc', 'pdf', 'md', 'mkd', 'markdown', 'txt']

const SVG_RISK_NOTE = 'SVG 保留兼容，但必须经过 sanitizer 或下载型展示，不进入可执行 HTML 渲染路径'

const unique = <T>(items: T[]): T[] => [...new Set(items)]

const compact = (items: Array<string | null | undefined>): string[] =>
    unique(items.filter((item): item is string => !!item).map(item => item.toLowerCase()))

const mimeFor = (extension: string, fallback?: string): string[] =>
    compact([mime.getType(extension), fallback])

const allowed = (
    extensions: string[],
    maxBytes: number,
    mimeTypes?: string[],
    options?: Pick<UploadAllowedType, 'riskLevel' | 'riskNote'>
): UploadAllowedType => ({
    extensions,
    mimeTypes: compact(mimeTypes ?? extensions.flatMap(ext => mimeFor(ext))),
    maxBytes,
    ...options,
})

const docTypes: UploadAllowedType[] = [
    allowed(['pdf'], DOC_ACCEPT.pdf, ['application/pdf']),
    allowed(['md', 'mkd', 'markdown'], DOC_ACCEPT.md, ['text/markdown', 'text/x-markdown']),
    allowed(['txt'], DOC_ACCEPT.txt, ['text/plain']),
    allowed(['docx'], DOC_ACCEPT.docx, [DOCX_MIME]),
    allowed(['doc'], DOC_ACCEPT.doc, ['application/msword']),
]

const mineruDocTypes: UploadAllowedType[] = [
    allowed(['pdf'], DOC_ACCEPT.pdf, ['application/pdf']),
    allowed(['docx'], DOC_ACCEPT.docx, [DOCX_MIME]),
    allowed(['doc'], DOC_ACCEPT.doc, ['application/msword']),
]

const imageTypes: UploadAllowedType[] = [
    allowed(['png'], IMAGE_ACCEPT.png, ['image/png']),
    allowed(['jpg', 'jpeg'], IMAGE_ACCEPT.jpg, ['image/jpeg']),
    allowed(['gif'], IMAGE_ACCEPT.gif, ['image/gif']),
    allowed(['webp'], IMAGE_ACCEPT.webp, ['image/webp']),
    allowed(['heic'], IMAGE_ACCEPT.heic, ['image/heic']),
    allowed(['heif'], IMAGE_ACCEPT.heif, ['image/heif']),
]

const remoteImageTypes: UploadAllowedType[] = [
    ...imageTypes,
    allowed(['svg'], 10 * MB, ['image/svg+xml'], {
        riskLevel: UploadRiskLevel.HIGH,
        riskNote: SVG_RISK_NOTE,
    }),
    allowed(['bmp'], 10 * MB, ['image/bmp']),
    allowed(['ico'], 10 * MB, ['image/x-icon', 'image/vnd.microsoft.icon']),
]

const audioTypes: UploadAllowedType[] = [
    allowed(['m4a'], ASR_ACCEPT.m4a, ['audio/x-m4a', 'audio/mp4']),
    allowed(['mp3'], ASR_ACCEPT.mp3, ['audio/mpeg', 'audio/mp3']),
    allowed(['wav'], ASR_ACCEPT.wav, ['audio/wav', 'audio/wave', 'audio/x-wav']),
]

const caseMaterialTypes: UploadAllowedType[] = [
    ...docTypes,
    ...imageTypes,
    ...audioTypes,
]

const workspaceTypes: UploadAllowedType[] = [
    allowed(['txt', 'log'], LARGE_FILE_MAX_BYTES, ['text/plain']),
    allowed(['md'], LARGE_FILE_MAX_BYTES, ['text/markdown', 'text/x-markdown']),
    allowed(['csv'], LARGE_FILE_MAX_BYTES, ['text/csv']),
    allowed(['html'], LARGE_FILE_MAX_BYTES, ['text/html']),
    allowed(['json'], LARGE_FILE_MAX_BYTES, ['application/json']),
    allowed(['xml'], LARGE_FILE_MAX_BYTES, ['application/xml', 'text/xml']),
    allowed(['pdf'], LARGE_FILE_MAX_BYTES, ['application/pdf']),
    allowed(['docx'], DOC_ACCEPT.docx, [DOCX_MIME]),
    allowed(['doc'], LARGE_FILE_MAX_BYTES, ['application/msword']),
    allowed(['xls'], LARGE_FILE_MAX_BYTES, ['application/vnd.ms-excel']),
    allowed(['xlsx'], LARGE_FILE_MAX_BYTES, ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']),
    allowed(['ppt'], LARGE_FILE_MAX_BYTES, ['application/vnd.ms-powerpoint']),
    allowed(['pptx'], LARGE_FILE_MAX_BYTES, ['application/vnd.openxmlformats-officedocument.presentationml.presentation']),
    allowed(['png'], LARGE_FILE_MAX_BYTES, ['image/png']),
    allowed(['jpg', 'jpeg'], LARGE_FILE_MAX_BYTES, ['image/jpeg']),
    allowed(['gif'], LARGE_FILE_MAX_BYTES, ['image/gif']),
    allowed(['webp'], LARGE_FILE_MAX_BYTES, ['image/webp']),
    allowed(['mp3'], LARGE_FILE_MAX_BYTES, ['audio/mpeg', 'audio/mp3']),
    allowed(['mp4'], LARGE_FILE_MAX_BYTES, ['video/mp4']),
    allowed(['wav'], LARGE_FILE_MAX_BYTES, ['audio/wav', 'audio/wave', 'audio/x-wav']),
    allowed(['zip'], LARGE_FILE_MAX_BYTES, ['application/zip']),
    allowed(['gz'], LARGE_FILE_MAX_BYTES, ['application/gzip']),
    allowed(['sh'], LARGE_FILE_MAX_BYTES, ['text/x-shellscript']),
    allowed(['py'], LARGE_FILE_MAX_BYTES, ['text/x-python', 'text/x-script.python']),
    allowed(['js'], LARGE_FILE_MAX_BYTES, ['text/javascript', 'application/javascript']),
    allowed(['ts'], LARGE_FILE_MAX_BYTES, ['text/typescript']),
]

export const UPLOAD_POLICIES: Record<UploadPolicyKey, UploadPolicy> = {
    [UploadPolicyKey.CLOUD_DISK_FILE]: {
        key: UploadPolicyKey.CLOUD_DISK_FILE,
        displayName: '云盘上传',
        storageSource: FileSource.FILE,
        allowedTypes: caseMaterialTypes,
        maxFilesPerRequest: 20,
        inputModes: [UploadInputMode.OSS_POST],
        quotaMode: UploadQuotaMode.USER_STORAGE_REQUIRED,
        encryptionAllowed: true,
        callbackRequired: true,
        verifyActualObject: true,
        allowedUsages: [UploadUsage.CLOUD_DISK],
    },
    [UploadPolicyKey.CASE_MATERIAL]: {
        key: UploadPolicyKey.CASE_MATERIAL,
        displayName: '案件材料',
        storageSource: FileSource.CASE_ANALYSIS,
        allowedTypes: caseMaterialTypes,
        maxFilesPerRequest: 20,
        inputModes: [UploadInputMode.OSS_POST],
        quotaMode: UploadQuotaMode.USER_STORAGE_REQUIRED,
        encryptionAllowed: true,
        callbackRequired: true,
        verifyActualObject: true,
        allowedUsages: [UploadUsage.CASE_MATERIAL, UploadUsage.DOCUMENT_RECOGNITION, UploadUsage.IMAGE_RECOGNITION, UploadUsage.AUDIO_RECOGNITION],
    },
    [UploadPolicyKey.ASSISTANT_ATTACHMENT]: {
        key: UploadPolicyKey.ASSISTANT_ATTACHMENT,
        displayName: '通用问答附件',
        storageSource: FileSource.CASE_ANALYSIS,
        allowedTypes: caseMaterialTypes,
        maxFilesPerRequest: 20,
        inputModes: [UploadInputMode.OSS_POST],
        quotaMode: UploadQuotaMode.USER_STORAGE_REQUIRED,
        encryptionAllowed: true,
        callbackRequired: true,
        verifyActualObject: true,
        allowedUsages: [UploadUsage.ASSISTANT_ATTACHMENT, UploadUsage.CASE_MATERIAL],
    },
    [UploadPolicyKey.CONTRACT_REVIEW_ORIGINAL]: {
        key: UploadPolicyKey.CONTRACT_REVIEW_ORIGINAL,
        displayName: '合同审查原文',
        storageSource: FileSource.CASE_ANALYSIS,
        allowedTypes: [allowed(['docx'], DOC_ACCEPT.docx, [DOCX_MIME])],
        maxFilesPerRequest: 1,
        inputModes: [UploadInputMode.OSS_POST],
        quotaMode: UploadQuotaMode.USER_STORAGE_REQUIRED,
        encryptionAllowed: false,
        callbackRequired: true,
        verifyActualObject: true,
        allowedUsages: [UploadUsage.CONTRACT_REVIEW],
    },
    [UploadPolicyKey.DEMO_CASE_MATERIAL]: {
        key: UploadPolicyKey.DEMO_CASE_MATERIAL,
        displayName: '示范案例材料',
        storageSource: FileSource.DEMO_CASE,
        allowedTypes: caseMaterialTypes,
        maxFilesPerRequest: 20,
        inputModes: [UploadInputMode.OSS_POST],
        quotaMode: UploadQuotaMode.SYSTEM_STORAGE,
        encryptionAllowed: false,
        callbackRequired: true,
        verifyActualObject: true,
        allowedUsages: [UploadUsage.DEMO_CASE_MATERIAL, UploadUsage.CASE_MATERIAL],
    },
    [UploadPolicyKey.DOCUMENT_UPLOAD]: {
        key: UploadPolicyKey.DOCUMENT_UPLOAD,
        displayName: '文档识别',
        storageSource: FileSource.DOC,
        allowedTypes: docTypes,
        maxFilesPerRequest: 20,
        inputModes: [UploadInputMode.OSS_POST],
        quotaMode: UploadQuotaMode.USER_STORAGE_REQUIRED,
        encryptionAllowed: true,
        callbackRequired: true,
        verifyActualObject: true,
        allowedUsages: [UploadUsage.DOCUMENT_RECOGNITION],
    },
    [UploadPolicyKey.DOCUMENT_TEMPLATE_PRIVATE]: {
        key: UploadPolicyKey.DOCUMENT_TEMPLATE_PRIVATE,
        displayName: '私人文书模板',
        storageSource: FileSource.DOCUMENT_TEMPLATE,
        allowedTypes: [allowed(['docx'], DOC_ACCEPT.docx, [DOCX_MIME])],
        maxFilesPerRequest: 1,
        inputModes: [UploadInputMode.MULTIPART],
        quotaMode: UploadQuotaMode.USER_STORAGE_REQUIRED,
        encryptionAllowed: false,
        callbackRequired: false,
        verifyActualObject: false,
        allowedUsages: [UploadUsage.DOCUMENT_TEMPLATE],
    },
    [UploadPolicyKey.DOCUMENT_TEMPLATE_GLOBAL]: {
        key: UploadPolicyKey.DOCUMENT_TEMPLATE_GLOBAL,
        displayName: '全局文书模板',
        storageSource: FileSource.DOCUMENT_TEMPLATE,
        allowedTypes: [allowed(['docx'], DOC_ACCEPT.docx, [DOCX_MIME])],
        maxFilesPerRequest: 1,
        inputModes: [UploadInputMode.MULTIPART],
        quotaMode: UploadQuotaMode.SYSTEM_STORAGE,
        encryptionAllowed: false,
        callbackRequired: false,
        verifyActualObject: false,
        allowedUsages: [UploadUsage.DOCUMENT_TEMPLATE],
    },
    [UploadPolicyKey.IMAGE_UPLOAD]: {
        key: UploadPolicyKey.IMAGE_UPLOAD,
        displayName: '图片识别',
        storageSource: FileSource.IMAGE,
        allowedTypes: imageTypes,
        maxFilesPerRequest: 20,
        inputModes: [UploadInputMode.OSS_POST],
        quotaMode: UploadQuotaMode.USER_STORAGE_REQUIRED,
        encryptionAllowed: true,
        callbackRequired: true,
        verifyActualObject: true,
        allowedUsages: [UploadUsage.IMAGE_RECOGNITION],
    },
    [UploadPolicyKey.AUDIO_UPLOAD]: {
        key: UploadPolicyKey.AUDIO_UPLOAD,
        displayName: '语音识别',
        storageSource: FileSource.ASR,
        allowedTypes: audioTypes,
        maxFilesPerRequest: 20,
        inputModes: [UploadInputMode.OSS_POST],
        quotaMode: UploadQuotaMode.USER_STORAGE_REQUIRED,
        encryptionAllowed: true,
        callbackRequired: true,
        verifyActualObject: true,
        allowedUsages: [UploadUsage.AUDIO_RECOGNITION],
    },
    [UploadPolicyKey.RECOGNITION_IMAGE_BASE64]: {
        key: UploadPolicyKey.RECOGNITION_IMAGE_BASE64,
        displayName: '图片 Base64 识别',
        storageSource: FileSource.IMAGE,
        allowedTypes: imageTypes,
        maxFilesPerRequest: 1,
        inputModes: [UploadInputMode.BASE64],
        quotaMode: UploadQuotaMode.NONE,
        encryptionAllowed: false,
        callbackRequired: false,
        verifyActualObject: false,
        allowedUsages: [UploadUsage.IMAGE_RECOGNITION],
    },
    [UploadPolicyKey.RECOGNITION_AUDIO_TEMP]: {
        key: UploadPolicyKey.RECOGNITION_AUDIO_TEMP,
        displayName: '音频临时识别',
        storageSource: FileSource.ASR,
        allowedTypes: audioTypes,
        maxFilesPerRequest: 1,
        inputModes: [UploadInputMode.TEMP_OSS_POST],
        quotaMode: UploadQuotaMode.TEMPORARY,
        encryptionAllowed: false,
        callbackRequired: false,
        verifyActualObject: true,
        allowedUsages: [UploadUsage.AUDIO_RECOGNITION],
    },
    [UploadPolicyKey.DOCUMENT_RECOGNITION_MINERU]: {
        key: UploadPolicyKey.DOCUMENT_RECOGNITION_MINERU,
        displayName: 'MinerU 文档识别',
        storageSource: FileSource.DOC,
        allowedTypes: mineruDocTypes,
        maxFilesPerRequest: 20,
        inputModes: [UploadInputMode.MINERU_PROXY],
        quotaMode: UploadQuotaMode.NONE,
        encryptionAllowed: false,
        callbackRequired: false,
        verifyActualObject: true,
        allowedUsages: [UploadUsage.DOCUMENT_RECOGNITION],
    },
    [UploadPolicyKey.REMOTE_IMAGE_PROXY]: {
        key: UploadPolicyKey.REMOTE_IMAGE_PROXY,
        displayName: '远程图片代理',
        storageSource: FileSource.IMAGE,
        allowedTypes: remoteImageTypes,
        maxFilesPerRequest: 1,
        inputModes: [UploadInputMode.REMOTE_URL],
        quotaMode: UploadQuotaMode.NONE,
        encryptionAllowed: false,
        callbackRequired: false,
        verifyActualObject: false,
        allowedUsages: [UploadUsage.REMOTE_IMAGE_PROXY],
    },
    [UploadPolicyKey.DOC_EMBEDDED_IMAGE]: {
        key: UploadPolicyKey.DOC_EMBEDDED_IMAGE,
        displayName: '文档内嵌图片',
        storageSource: FileSource.DOC_EMBEDDED_IMAGE,
        allowedTypes: remoteImageTypes,
        maxFilesPerRequest: 50,
        maxTotalBytesPerRequest: 100 * MB,
        inputModes: [UploadInputMode.BASE64, UploadInputMode.REMOTE_URL, UploadInputMode.MINERU_PROXY],
        quotaMode: UploadQuotaMode.USER_STORAGE_REQUIRED,
        encryptionAllowed: false,
        callbackRequired: false,
        verifyActualObject: true,
        allowedUsages: [UploadUsage.DOC_EMBEDDED_IMAGE],
    },
    [UploadPolicyKey.AGENT_WORKSPACE_EXPORT]: {
        key: UploadPolicyKey.AGENT_WORKSPACE_EXPORT,
        displayName: 'AI 生成文件导出',
        storageSource: FileSource.CASE_ANALYSIS,
        allowedTypes: workspaceTypes,
        maxFilesPerRequest: 1,
        inputModes: [UploadInputMode.SERVER_WORKSPACE],
        quotaMode: UploadQuotaMode.USER_STORAGE_WITH_TEMP_FALLBACK,
        encryptionAllowed: false,
        callbackRequired: false,
        verifyActualObject: false,
        allowedUsages: [UploadUsage.WORKSPACE_EXPORT],
    },
    [UploadPolicyKey.DOCUMENT_EXPORT]: {
        key: UploadPolicyKey.DOCUMENT_EXPORT,
        displayName: '文书导出',
        storageSource: FileSource.DOCUMENT_EXPORT,
        allowedTypes: [
            allowed(['docx'], DOC_ACCEPT.docx, [DOCX_MIME]),
            allowed(['pdf'], LARGE_FILE_MAX_BYTES, ['application/pdf']),
        ],
        maxFilesPerRequest: 1,
        inputModes: [UploadInputMode.SERVER_GENERATED],
        quotaMode: UploadQuotaMode.SYSTEM_STORAGE,
        encryptionAllowed: false,
        callbackRequired: false,
        verifyActualObject: false,
        allowedUsages: [UploadUsage.DOCUMENT_EXPORT],
    },
}

export const getUploadPolicy = (key: UploadPolicyKey | string): UploadPolicy | null =>
    UPLOAD_POLICIES[key as UploadPolicyKey] ?? null

export const listUploadPolicies = (): UploadPolicy[] => Object.values(UPLOAD_POLICIES)

export const mapFileSourceToDefaultPolicy = (source: FileSource): UploadPolicyKey | null => {
    const map: Partial<Record<FileSource, UploadPolicyKey>> = {
        [FileSource.FILE]: UploadPolicyKey.CLOUD_DISK_FILE,
        [FileSource.ASR]: UploadPolicyKey.AUDIO_UPLOAD,
        [FileSource.DOC]: UploadPolicyKey.DOCUMENT_UPLOAD,
        [FileSource.IMAGE]: UploadPolicyKey.IMAGE_UPLOAD,
        [FileSource.CASE_ANALYSIS]: UploadPolicyKey.CASE_MATERIAL,
        [FileSource.DEMO_CASE]: UploadPolicyKey.DEMO_CASE_MATERIAL,
        [FileSource.DOCUMENT_TEMPLATE]: UploadPolicyKey.DOCUMENT_TEMPLATE_PRIVATE,
        [FileSource.DOCUMENT_EXPORT]: UploadPolicyKey.DOCUMENT_EXPORT,
        [FileSource.DOC_EMBEDDED_IMAGE]: UploadPolicyKey.DOC_EMBEDDED_IMAGE,
    }
    return map[source] ?? null
}

const preferredMimeForExtension = (allowedType: UploadAllowedType, extension: string): string => {
    const detected = mime.getType(extension)?.toLowerCase()
    if (detected && allowedType.mimeTypes.includes(detected)) return detected
    return allowedType.mimeTypes[0] ?? ''
}

export const getAcceptListFromPolicy = (policy: UploadPolicy): PublicUploadAcceptItem[] =>
    policy.allowedTypes.flatMap(allowedType =>
        allowedType.extensions.map(extension => ({
            name: extension,
            mime: preferredMimeForExtension(allowedType, extension),
            maxSize: allowedType.maxBytes,
            ...(allowedType.riskLevel ? { riskLevel: allowedType.riskLevel } : {}),
        }))
    )

export const getPublicUploadPolicy = (key: UploadPolicyKey | string): PublicUploadPolicy | null => {
    const policy = getUploadPolicy(key)
    if (!policy) return null
    return {
        key: policy.key,
        displayName: policy.displayName,
        source: policy.storageSource,
        accept: getAcceptListFromPolicy(policy),
        maxFilesPerRequest: policy.maxFilesPerRequest,
        maxTotalBytesPerRequest: policy.maxTotalBytesPerRequest,
        inputModes: policy.inputModes,
        encryptionAllowed: policy.encryptionAllowed,
    }
}

export const getFileSourceAcceptFromPolicies = (source?: FileSource) => {
    const sources = source ? [source] : Object.values(FileSource)
    return sources.map(item => {
        const policyKey = mapFileSourceToDefaultPolicy(item)
        const policy = policyKey ? getUploadPolicy(policyKey) : null
        return {
            name: FileSourceName[item],
            accept: policy ? getAcceptListFromPolicy(policy) : [],
        }
    })
}
