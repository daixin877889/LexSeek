/**
 * 重生批注 Word 服务（只在 POST /reviews/:id/rebuild-docx 端点中调用）。
 *
 * 责任：
 *   1. 调用方已占位 rebuilding —— 本函数专注"下载原件 → 注入 → 上传 → 更新"
 *   2. 任意步骤抛异常 → 调用方负责调用 rollbackRebuildDAO 回滚
 *   3. 成功时返回 { reviewedFileId, downloadUrl }（1h 签名）
 *
 * 关键时序（P0-4 spec 修订）：
 *   upload → generateSignedUrlService → createOssFileDao → setCompletedAfterRebuildDAO
 *   确保 setCompletedAfterRebuildDAO 之后无 throw 点，回滚不会出现 reviewedFileId 漂移。
 *
 * **Feature: contract-review-m5**
 */
import { randomUUID } from 'node:crypto'
import type { contractReviews } from '~~/generated/prisma/client'
import { findOssFileByIdDao, createOssFileDao } from '~~/server/services/files/ossFiles.dao'
import { setCompletedAfterRebuildDAO } from './contractReview.dao'
import { injectComments } from './docx'
import {
    downloadFileService,
    uploadFileService,
    generateSignedUrlService,
} from '~~/server/services/storage/storage.service'
import { getDefaultStorageConfigDao } from '~~/server/services/storage/storageConfig.dao'
import { StorageProviderType } from '~~/server/lib/storage/types'
import { FileSource, OssFileStatus } from '#shared/types/file'
import type { Risk } from '#shared/types/contract'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export interface RebuildDocxResult {
    reviewedFileId: number
    downloadUrl: string
}

export async function rebuildDocxService(review: contractReviews): Promise<RebuildDocxResult> {
    if (!review.originalFileId) throw new Error('审查没有原始文件，无法重生批注')
    const origOssFile = await findOssFileByIdDao(review.originalFileId)
    if (!origOssFile?.filePath) throw new Error('原始文件已丢失，无法重生批注')

    const origBuffer = await downloadFileService(origOssFile.filePath)
    const risks = (review.risks ?? []) as unknown as Risk[]
    const newDocxBuffer = await injectComments(origBuffer, risks)
    const buffer = Buffer.isBuffer(newDocxBuffer) ? newDocxBuffer : Buffer.from(newDocxBuffer)

    // OSS 路径与 M3 contractReview.service 保持同构：contract-review/<userId>/<uuid>.docx
    const ossPath = `contract-review/${review.userId}/rebuild-${randomUUID()}.docx`
    const uploadResult = await uploadFileService(ossPath, buffer, {
        contentType: DOCX_MIME,
        userId: review.userId,
    })

    const storageConfig = await getDefaultStorageConfigDao(StorageProviderType.ALIYUN_OSS, review.userId)
    const bucketName = storageConfig?.bucket ?? ''

    // 先生成签名 URL（若失败，此时 reviewedFileId 尚未更新，handler catch 里 rollback 能正确还原 status）
    const downloadUrl = await generateSignedUrlService(uploadResult.name, {
        expires: 3600,
        userId: review.userId,
    })

    const newOssFile = await createOssFileDao({
        userId: review.userId,
        bucketName,
        fileName: `合同审查-${review.id}.docx`,
        filePath: uploadResult.name,
        fileSize: buffer.byteLength,
        fileType: DOCX_MIME,
        source: FileSource.CASE_ANALYSIS,
        status: OssFileStatus.UPLOADED,
        encrypted: false,
    })

    // 最后落库 reviewedFileId：OSS + 签名 URL + ossFiles 行都就绪，失败只发生在此 DB 写入
    await setCompletedAfterRebuildDAO(review.id, newOssFile.id)

    return { reviewedFileId: newOssFile.id, downloadUrl }
}
