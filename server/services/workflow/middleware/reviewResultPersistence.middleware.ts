/**
 * 合同审查结果持久化中间件（contractReviewMain 专用，末位）
 *
 * beforeAgent: 置 status='reviewing'
 * afterAgent:
 *   - structuredResponse 缺失 → status='failed'（risks=null，不可 rebuild）
 *   - structuredResponse 有值 → 写 risks/summary（失败态 rebuild 的前提）→ 注入批注 + 两步写 OSS → status='completed'
 *   - 注入/上传失败 → status='failed'（risks 已落库，用户可通过 rebuild-docx 重试）
 */

import { createMiddleware } from 'langchain'
import type { Prisma } from '~~/generated/prisma/client'
import {
    getContractReviewDAO,
    updateContractReviewDAO,
} from '../../assistant/contract/contractReview.dao'
import { injectComments } from '../../assistant/contract/docx'
import {
    downloadFileService,
    uploadFileService,
} from '../../storage/storage.service'
import { getDefaultStorageConfigDao } from '../../storage/storageConfig.dao'
import {
    findOssFileByIdDao,
    createOssFileDao,
} from '../../files/ossFiles.dao'
import { FileSource, OssFileStatus } from '#shared/types/file'
import { StorageProviderType } from '~~/server/lib/storage/types'
import type { Risk } from '#shared/types/contract'

interface ReviewResultPersistenceOptions {
    reviewId: number
    sessionId: string
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export const reviewResultPersistenceMiddleware = (
    options: ReviewResultPersistenceOptions,
) => createMiddleware({
    name: 'ReviewResultPersistenceMiddleware',

    beforeAgent: {
        hook: async (_state: any) => {
            try {
                await updateContractReviewDAO(options.reviewId, { status: 'reviewing' })
            } catch (err) {
                logger.error('reviewResultPersistence beforeAgent 失败', {
                    reviewId: options.reviewId, err,
                })
            }
        },
    },

    afterAgent: {
        hook: async (state: any) => {
            const structured = state.structuredResponse as
                | { risks: Risk[]; summary: string }
                | undefined

            if (!structured) {
                await updateContractReviewDAO(options.reviewId, { status: 'failed' })
                logger.warn('reviewResultPersistence: structuredResponse 缺失', {
                    reviewId: options.reviewId,
                })
                return
            }

            // Step 1: 先落库 risks/summary（失败态 rebuild 的前提）
            // Risk[] 是 POJO 结构，Prisma Json 字段需显式转为 InputJsonValue
            try {
                await updateContractReviewDAO(options.reviewId, {
                    risks: structured.risks as unknown as Prisma.InputJsonValue,
                    summary: structured.summary,
                })
            } catch (err) {
                logger.error('reviewResultPersistence: 写 risks/summary 失败', {
                    reviewId: options.reviewId, err,
                })
                await updateContractReviewDAO(options.reviewId, { status: 'failed' })
                return
            }

            // Step 2: 注入批注 + 上传新 .docx
            try {
                const review = await getContractReviewDAO(options.reviewId)
                if (!review) throw new Error(`review ${options.reviewId} not found`)
                const originalOssFile = await findOssFileByIdDao(review.originalFileId)
                if (!originalOssFile) throw new Error(`original oss file ${review.originalFileId} not found`)
                if (!originalOssFile.filePath) throw new Error(`original oss file ${review.originalFileId} has no filePath`)

                const originalBuffer = await downloadFileService(originalOssFile.filePath)
                const reviewedBuffer = await injectComments(originalBuffer, structured.risks)

                const ossPath = `users/${review.userId}/contract-review/reviewed-${options.reviewId}-${Date.now()}.docx`
                const uploadResult = await uploadFileService(ossPath, reviewedBuffer, {
                    contentType: DOCX_MIME,
                    userId: review.userId,
                })

                const storageConfig = await getDefaultStorageConfigDao(StorageProviderType.ALIYUN_OSS, review.userId)
                const bucketName = storageConfig?.bucket ?? ''

                const ossFileRow = await createOssFileDao({
                    userId: review.userId,
                    bucketName,
                    fileName: `reviewed-${options.reviewId}.docx`,
                    filePath: uploadResult.name,
                    fileSize: reviewedBuffer.length,
                    fileType: DOCX_MIME,
                    source: FileSource.CASE_ANALYSIS,
                    status: OssFileStatus.UPLOADED,
                    encrypted: false,
                })

                await updateContractReviewDAO(options.reviewId, {
                    reviewedFileId: ossFileRow.id,
                    status: 'completed',
                })
            } catch (err) {
                logger.error('reviewResultPersistence: 批注/上传失败', {
                    reviewId: options.reviewId, err,
                })
                await updateContractReviewDAO(options.reviewId, { status: 'failed' })
            }
        },
    },
})
