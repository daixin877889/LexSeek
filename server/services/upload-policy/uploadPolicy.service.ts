import { FileSource, OssFileStatus } from '#shared/types/file'
import {
    UploadPolicyKey,
    UploadRiskLevel,
    UploadUsage,
} from '#shared/types/uploadPolicy'
import type { UploadAllowedType, UploadPolicy } from '#shared/types/uploadPolicy'
import { getExtensionFromFileName } from '#shared/utils/file'
import { getUploadPolicy } from '#shared/utils/uploadPolicy'

type SizeLike = number | bigint | string | { toNumber?: () => number; toString: () => string }

export type UploadPolicyValidationCode =
    | 'policy_not_found'
    | 'file_name_required'
    | 'file_extension_required'
    | 'file_size_invalid'
    | 'file_too_large'
    | 'file_count_invalid'
    | 'file_count_exceeded'
    | 'total_size_exceeded'
    | 'extension_not_allowed'
    | 'mime_required'
    | 'mime_not_allowed'
    | 'extension_mime_mismatch'
    | 'encrypted_not_allowed'
    | 'source_mismatch'
    | 'status_not_uploaded'
    | 'usage_not_allowed'
    | 'object_size_exceeds_record'

export type UploadPolicyValidationResult =
    | {
        ok: true
        policy: UploadPolicy
        allowedType: UploadAllowedType
        riskLevel: UploadRiskLevel
        riskNote?: string
    }
    | { ok: false; code: UploadPolicyValidationCode; message: string }

export type UploadPolicyBatchValidationResult =
    | { ok: true; policy: UploadPolicy; files: Array<Extract<UploadPolicyValidationResult, { ok: true }>> }
    | { ok: false; code: UploadPolicyValidationCode; message: string }

export interface UploadFileIntent {
    fileName: string
    fileSize: SizeLike
    mimeType: string | null | undefined
    encrypted?: boolean
}

export interface DecodedBase64Input {
    fileName?: string
    mimeType: string | null | undefined
    decodedBytes: SizeLike
}

export interface RemoteDownloadInput {
    fileName?: string
    mimeType: string | null | undefined
    contentLength?: SizeLike | null
    actualBytes?: SizeLike | null
}

export interface UploadPolicyOssFile {
    id?: number
    fileName: string
    fileSize: SizeLike
    fileType: string
    source: string | null
    status: number
    encrypted?: boolean
    originalMimeType?: string | null
}

export interface ActualOssObject {
    size?: SizeLike | null
    contentType?: string | null
}

const formatMb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(2)}MB`

const fail = (
    code: UploadPolicyValidationCode,
    message: string
): Extract<UploadPolicyValidationResult, { ok: false }> => ({
    ok: false,
    code,
    message,
})

const getPolicyOrFailure = (
    policyKey: UploadPolicyKey | string
): UploadPolicy | Extract<UploadPolicyValidationResult, { ok: false }> => {
    const policy = getUploadPolicy(policyKey)
    if (!policy) {
        return fail('policy_not_found', '上传策略不存在')
    }
    return policy
}

const parseBytes = (value: SizeLike | null | undefined): number | null => {
    if (value === null || value === undefined) return null
    if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null
    if (typeof value === 'bigint') {
        return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null
    }
    if (typeof value === 'string') {
        const parsed = Number(value)
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
    }
    if (typeof value.toNumber === 'function') {
        const parsed = value.toNumber()
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
    }
    const parsed = Number(value.toString())
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

export const normalizeMimeType = (mimeType: string | null | undefined): string => {
    if (!mimeType) return ''
    return mimeType.split(';')[0]?.trim().toLowerCase() ?? ''
}

const findAllowedTypeByMime = (
    policy: UploadPolicy,
    mimeType: string | null | undefined
): UploadAllowedType | null => {
    const normalizedMime = normalizeMimeType(mimeType)
    if (!normalizedMime) return null
    return policy.allowedTypes.find(allowedType => allowedType.mimeTypes.includes(normalizedMime)) ?? null
}

export const findAllowedType = (
    policy: UploadPolicy,
    fileName: string,
    mimeType: string | null | undefined
): UploadAllowedType | null => {
    const extension = getExtensionFromFileName(fileName)
    const normalizedMime = normalizeMimeType(mimeType)
    if (!extension || !normalizedMime) return null
    return policy.allowedTypes.find(allowedType =>
        allowedType.extensions.includes(extension)
        && allowedType.mimeTypes.includes(normalizedMime)
    ) ?? null
}

const validateAllowedType = (
    policy: UploadPolicy,
    fileName: string | undefined,
    mimeType: string | null | undefined,
    fileSize: SizeLike,
    requireFileName = true
): UploadPolicyValidationResult => {
    const bytes = parseBytes(fileSize)
    if (bytes === null) return fail('file_size_invalid', '文件大小无效')

    let allowedType: UploadAllowedType | null = null
    if (fileName) {
        const extension = getExtensionFromFileName(fileName)
        if (!extension) return fail('file_extension_required', '文件必须包含扩展名')

        const allowedByExtension = policy.allowedTypes.find(item => item.extensions.includes(extension))
        if (!allowedByExtension) return fail('extension_not_allowed', `不支持的文件类型：.${extension}`)

        const normalizedMime = normalizeMimeType(mimeType)
        if (!normalizedMime) return fail('mime_required', '文件 MIME 类型不能为空')

        const allowedByMime = policy.allowedTypes.find(item => item.mimeTypes.includes(normalizedMime))
        if (!allowedByMime) return fail('mime_not_allowed', `不支持的文件 MIME 类型：${normalizedMime}`)

        allowedType = findAllowedType(policy, fileName, normalizedMime)
        if (!allowedType) {
            return fail('extension_mime_mismatch', '文件扩展名与 MIME 类型不匹配')
        }
    } else {
        if (requireFileName) return fail('file_name_required', '文件名不能为空')
        allowedType = findAllowedTypeByMime(policy, mimeType)
        if (!allowedType) {
            const normalizedMime = normalizeMimeType(mimeType)
            if (!normalizedMime) return fail('mime_required', '文件 MIME 类型不能为空')
            return fail('mime_not_allowed', `不支持的文件 MIME 类型：${normalizedMime}`)
        }
    }

    if (bytes > allowedType.maxBytes) {
        return fail(
            'file_too_large',
            `文件大小超出限制：当前 ${formatMb(bytes)}，最大允许 ${formatMb(allowedType.maxBytes)}`
        )
    }

    return {
        ok: true,
        policy,
        allowedType,
        riskLevel: allowedType.riskLevel ?? UploadRiskLevel.NORMAL,
        ...(allowedType.riskNote ? { riskNote: allowedType.riskNote } : {}),
    }
}

export const validateUploadIntent = (
    policyKey: UploadPolicyKey | string,
    input: UploadFileIntent
): UploadPolicyValidationResult => {
    const policy = getPolicyOrFailure(policyKey)
    if ('ok' in policy) return policy

    if (!input.fileName) return fail('file_name_required', '文件名不能为空')
    if (input.encrypted && !policy.encryptionAllowed) {
        return fail('encrypted_not_allowed', '当前上传场景不允许加密上传')
    }

    return validateAllowedType(policy, input.fileName, input.mimeType, input.fileSize)
}

export const validateUploadBatch = (
    policyKey: UploadPolicyKey | string,
    files: UploadFileIntent[]
): UploadPolicyBatchValidationResult => {
    const policy = getPolicyOrFailure(policyKey)
    if ('ok' in policy) return policy

    if (files.length === 0) return fail('file_count_invalid', '单次上传至少需要 1 个文件')
    if (files.length > policy.maxFilesPerRequest) {
        return fail('file_count_exceeded', `单次最多上传 ${policy.maxFilesPerRequest} 个文件`)
    }

    const results: Array<Extract<UploadPolicyValidationResult, { ok: true }>> = []
    let totalBytes = 0
    for (const file of files) {
        const result = validateUploadIntent(policy.key, file)
        if (!result.ok) return result
        const bytes = parseBytes(file.fileSize)
        if (bytes === null) return fail('file_size_invalid', '文件大小无效')
        totalBytes += bytes
        results.push(result)
    }

    if (policy.maxTotalBytesPerRequest && totalBytes > policy.maxTotalBytesPerRequest) {
        return fail(
            'total_size_exceeded',
            `单次上传总大小超出限制：当前 ${formatMb(totalBytes)}，最大允许 ${formatMb(policy.maxTotalBytesPerRequest)}`
        )
    }

    return { ok: true, policy, files: results }
}

export const validateDecodedBase64 = (
    policyKey: UploadPolicyKey | string,
    input: DecodedBase64Input
): UploadPolicyValidationResult => {
    const policy = getPolicyOrFailure(policyKey)
    if ('ok' in policy) return policy
    return validateAllowedType(policy, input.fileName, input.mimeType, input.decodedBytes, false)
}

export const validateRemoteDownload = (
    policyKey: UploadPolicyKey | string,
    input: RemoteDownloadInput
): UploadPolicyValidationResult => {
    const policy = getPolicyOrFailure(policyKey)
    if ('ok' in policy) return policy

    const sizeForTypeCheck = input.actualBytes ?? input.contentLength ?? 0
    const typeResult = validateAllowedType(policy, input.fileName, input.mimeType, sizeForTypeCheck, false)
    if (!typeResult.ok) return typeResult

    for (const [label, value] of [
        ['Content-Length', input.contentLength],
        ['实际下载大小', input.actualBytes],
    ] as const) {
        if (value === null || value === undefined) continue
        const bytes = parseBytes(value)
        if (bytes === null) return fail('file_size_invalid', `${label} 无效`)
        if (bytes > typeResult.allowedType.maxBytes) {
            return fail(
                'file_too_large',
                `${label} 超出限制：当前 ${formatMb(bytes)}，最大允许 ${formatMb(typeResult.allowedType.maxBytes)}`
            )
        }
    }

    return typeResult
}

export const validateOssObjectAgainstRecord = (
    policyKey: UploadPolicyKey | string,
    ossFile: UploadPolicyOssFile,
    actual: ActualOssObject = {}
): UploadPolicyValidationResult => {
    const policy = getPolicyOrFailure(policyKey)
    if ('ok' in policy) return policy

    if (ossFile.source !== policy.storageSource) {
        const actualSource = ossFile.source ?? 'unknown'
        return fail('source_mismatch', `文件来源不匹配：当前 ${actualSource}，期望 ${policy.storageSource}`)
    }

    const recordBytes = parseBytes(ossFile.fileSize)
    if (recordBytes === null) return fail('file_size_invalid', '文件登记大小无效')

    const actualBytes = parseBytes(actual.size ?? ossFile.fileSize)
    if (actualBytes === null) return fail('file_size_invalid', '文件实际大小无效')
    if (actualBytes > recordBytes) {
        return fail('object_size_exceeds_record', 'OSS 实际文件大小超过登记大小')
    }

    const mimeType = ossFile.encrypted
        ? ossFile.originalMimeType
        : (actual.contentType ?? ossFile.fileType)

    return validateAllowedType(policy, ossFile.fileName, mimeType, actualBytes)
}

export const assertFileUsableFor = (
    policyKey: UploadPolicyKey | string,
    ossFile: UploadPolicyOssFile,
    usage: UploadUsage
): UploadPolicyValidationResult => {
    const policy = getPolicyOrFailure(policyKey)
    if ('ok' in policy) return policy

    if (ossFile.status !== OssFileStatus.UPLOADED) {
        return fail('status_not_uploaded', '文件尚未上传完成，不能用于当前业务场景')
    }
    if (!policy.allowedUsages.includes(usage)) {
        return fail('usage_not_allowed', '文件不能用于当前业务场景')
    }

    return validateOssObjectAgainstRecord(policy.key, ossFile)
}

export const getPolicyStorageSource = (policyKey: UploadPolicyKey | string): FileSource | null => {
    const policy = getUploadPolicy(policyKey)
    return policy?.storageSource ?? null
}
