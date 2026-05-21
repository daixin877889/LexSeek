/**
 * 服务端上传策略校验测试
 *
 * 覆盖扩展名 / MIME / 大小 / 数量 / 用途等服务端强校验。
 */

import { describe, expect, it } from 'vitest'
import { FileSource, OssFileStatus } from '#shared/types/file'
import {
    UploadPolicyKey,
    UploadRiskLevel,
    UploadUsage,
} from '#shared/types/uploadPolicy'
import {
    assertFileUsableFor,
    findAllowedType,
    normalizeMimeType,
    validateDecodedBase64,
    validateRemoteDownload,
    validateUploadBatch,
    validateUploadIntent,
} from '~~/server/services/upload-policy/uploadPolicy.service'
import { getUploadPolicy } from '#shared/utils/uploadPolicy'

const MB = 1024 * 1024

const uploadedFile = {
    fileName: 'a.pdf',
    fileSize: 180 * MB,
    fileType: 'application/pdf',
    source: FileSource.CASE_ANALYSIS,
    status: OssFileStatus.UPLOADED,
}

describe('uploadPolicy.service', () => {
    it('normalizeMimeType 去掉参数并转小写', () => {
        expect(normalizeMimeType('Application/PDF; charset=utf-8')).toBe('application/pdf')
    })

    it('findAllowedType 要求扩展名和 MIME 命中同一个类型项', () => {
        const policy = getUploadPolicy(UploadPolicyKey.CASE_MATERIAL)!
        expect(findAllowedType(policy, 'a.pdf', 'application/pdf')).toBeTruthy()
        expect(findAllowedType(policy, 'a.pdf', 'application/msword')).toBeNull()
    })

    it('validateUploadIntent 接受等于上限的合法文件', () => {
        const result = validateUploadIntent(UploadPolicyKey.CASE_MATERIAL, {
            fileName: 'a.pdf',
            fileSize: 180 * MB,
            mimeType: 'application/pdf',
            encrypted: true,
        })
        expect(result.ok).toBe(true)
    })

    it('文件无扩展名时拒绝', () => {
        const result = validateUploadIntent(UploadPolicyKey.CASE_MATERIAL, {
            fileName: 'README',
            fileSize: 1,
            mimeType: 'text/plain',
        })
        expect(result).toMatchObject({ ok: false, code: 'file_extension_required' })
    })

    it('扩展名合法但 MIME 不合法时拒绝', () => {
        const result = validateUploadIntent(UploadPolicyKey.CASE_MATERIAL, {
            fileName: 'a.pdf',
            fileSize: 1,
            mimeType: 'application/x-msdownload',
        })
        expect(result).toMatchObject({ ok: false, code: 'mime_not_allowed' })
    })

    it('MIME 合法但扩展名不合法时拒绝', () => {
        const result = validateUploadIntent(UploadPolicyKey.CASE_MATERIAL, {
            fileName: 'a.exe',
            fileSize: 1,
            mimeType: 'application/pdf',
        })
        expect(result).toMatchObject({ ok: false, code: 'extension_not_allowed' })
    })

    it('扩展名与 MIME 分属不同类型项时拒绝', () => {
        const result = validateUploadIntent(UploadPolicyKey.CASE_MATERIAL, {
            fileName: 'a.pdf',
            fileSize: 1,
            mimeType: 'application/msword',
        })
        expect(result).toMatchObject({ ok: false, code: 'extension_mime_mismatch' })
    })

    it('文件大小超过上限 1 byte 时拒绝', () => {
        const result = validateUploadIntent(UploadPolicyKey.CASE_MATERIAL, {
            fileName: 'a.pdf',
            fileSize: 180 * MB + 1,
            mimeType: 'application/pdf',
        })
        expect(result).toMatchObject({ ok: false, code: 'file_too_large' })
    })

    it('合同审查入口只接受 docx', () => {
        const result = validateUploadIntent(UploadPolicyKey.CONTRACT_REVIEW_ORIGINAL, {
            fileName: 'contract.pdf',
            fileSize: 1,
            mimeType: 'application/pdf',
        })
        expect(result).toMatchObject({ ok: false, code: 'extension_not_allowed' })
    })

    it('不允许加密的策略会拒绝 encrypted=true', () => {
        const result = validateUploadIntent(UploadPolicyKey.CONTRACT_REVIEW_ORIGINAL, {
            fileName: 'contract.docx',
            fileSize: 1,
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            encrypted: true,
        })
        expect(result).toMatchObject({ ok: false, code: 'encrypted_not_allowed' })
    })

    it('validateUploadBatch 校验数量和总大小', () => {
        const tooMany = Array.from({ length: 21 }, (_, index) => ({
            fileName: `a-${index}.pdf`,
            fileSize: 1,
            mimeType: 'application/pdf',
        }))
        expect(validateUploadBatch(UploadPolicyKey.CASE_MATERIAL, tooMany))
            .toMatchObject({ ok: false, code: 'file_count_exceeded' })

        const totalTooLarge = Array.from({ length: 11 }, (_, index) => ({
            fileName: `a-${index}.png`,
            fileSize: 10 * MB,
            mimeType: 'image/png',
        }))
        expect(validateUploadBatch(UploadPolicyKey.DOC_EMBEDDED_IMAGE, totalTooLarge))
            .toMatchObject({ ok: false, code: 'total_size_exceeded' })
    })

    it('validateDecodedBase64 按解码后字节数校验', () => {
        expect(validateDecodedBase64(UploadPolicyKey.RECOGNITION_IMAGE_BASE64, {
            mimeType: 'image/png',
            decodedBytes: 10 * MB,
        }).ok).toBe(true)
        expect(validateDecodedBase64(UploadPolicyKey.RECOGNITION_IMAGE_BASE64, {
            mimeType: 'image/png',
            decodedBytes: 10 * MB + 1,
        })).toMatchObject({ ok: false, code: 'file_too_large' })
    })

    it('validateRemoteDownload 同时校验 Content-Length 与实际字节数', () => {
        expect(validateRemoteDownload(UploadPolicyKey.REMOTE_IMAGE_PROXY, {
            mimeType: 'image/png',
            contentLength: 10 * MB,
            actualBytes: 10 * MB,
        }).ok).toBe(true)
        expect(validateRemoteDownload(UploadPolicyKey.REMOTE_IMAGE_PROXY, {
            mimeType: 'image/png',
            contentLength: 10 * MB + 1,
        })).toMatchObject({ ok: false, code: 'file_too_large' })
        expect(validateRemoteDownload(UploadPolicyKey.REMOTE_IMAGE_PROXY, {
            mimeType: 'image/png',
            actualBytes: 10 * MB + 1,
        })).toMatchObject({ ok: false, code: 'file_too_large' })
    })

    it('SVG 在普通图片策略中拒绝，在远程图片策略中通过并标记高风险', () => {
        expect(validateUploadIntent(UploadPolicyKey.IMAGE_UPLOAD, {
            fileName: 'a.svg',
            fileSize: 1,
            mimeType: 'image/svg+xml',
        })).toMatchObject({ ok: false, code: 'extension_not_allowed' })

        const result = validateRemoteDownload(UploadPolicyKey.REMOTE_IMAGE_PROXY, {
            fileName: 'a.svg',
            mimeType: 'image/svg+xml',
            contentLength: 1,
        })
        expect(result).toMatchObject({ ok: true, riskLevel: UploadRiskLevel.HIGH })
    })

    it('assertFileUsableFor 校验状态、来源、MIME、大小和用途', () => {
        expect(assertFileUsableFor(
            UploadPolicyKey.CASE_MATERIAL,
            uploadedFile,
            UploadUsage.CASE_MATERIAL
        ).ok).toBe(true)

        expect(assertFileUsableFor(
            UploadPolicyKey.CASE_MATERIAL,
            { ...uploadedFile, status: OssFileStatus.PENDING },
            UploadUsage.CASE_MATERIAL
        )).toMatchObject({ ok: false, code: 'status_not_uploaded' })

        expect(assertFileUsableFor(
            UploadPolicyKey.CASE_MATERIAL,
            { ...uploadedFile, source: FileSource.FILE },
            UploadUsage.CASE_MATERIAL
        )).toMatchObject({ ok: false, code: 'source_mismatch' })

        expect(assertFileUsableFor(
            UploadPolicyKey.CONTRACT_REVIEW_ORIGINAL,
            uploadedFile,
            UploadUsage.CONTRACT_REVIEW
        )).toMatchObject({ ok: false, code: 'extension_not_allowed' })

        expect(assertFileUsableFor(
            UploadPolicyKey.CASE_MATERIAL,
            uploadedFile,
            UploadUsage.CONTRACT_REVIEW
        )).toMatchObject({ ok: false, code: 'usage_not_allowed' })
    })
})
