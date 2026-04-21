/**
 * 合同审查结果持久化中间件（contractReviewMain 专用，末位）
 *
 * M6.1 子期 2 改造后职责：
 * beforeAgent: 置 status='reviewing'（仅首轮；resume 后由 parseAndAskStance 工具自行置 reviewing）
 * afterAgent:
 *   M6.1 子期 2：risks 已由外层 runAnalyzeLoop 写进 DB；这里只做"读 DB → 注入批注 → 上传"
 *   - DB risks 有值 → 调 runAnnotateAndUpload 注入批注 + 上传 OSS → status='completed'
 *   - DB risks 为空或无 → status='failed'
 *
 * runAnnotateAndUpload：独立导出，供 runContractReviewChat 在 resume 分支直接调用。
 */

import { createMiddleware } from 'langchain'
import { randomUUID } from 'node:crypto'
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
import { DOCX_MIME } from '#shared/utils/mime'
import type { Risk } from '#shared/types/contract'

interface ReviewResultPersistenceOptions {
    reviewId: number
    sessionId: string
    /** agent run ID，用于 SSE 事件路由（可选；缺省时跳过事件发送）*/
    runId?: string
}

/**
 * 注入批注 + 上传 OSS + 写 reviewedFileId。
 *
 * 从 DB 读取 review 的 risks，注入批注到原始 .docx，上传为新文件，
 * 更新 status='completed' 和 reviewedFileId。
 *
 * 供两处调用：
 * 1. reviewResultPersistenceMiddleware.afterAgent（兜底路径）
 * 2. runContractReviewChat resume 分支直接调用（主路径）
 *
 * 失败时置 status='failed' 并向上抛错（由调用方决定是否继续）。
 */
export async function runAnnotateAndUpload(reviewId: number): Promise<void> {
    const review = await getContractReviewDAO(reviewId)
    if (!review) throw new Error(`review ${reviewId} not found`)

    const risks = Array.isArray(review.risks) ? review.risks as unknown as Risk[] : []
    if (risks.length === 0) {
        logger.warn('runAnnotateAndUpload: risks 为空，跳过注入，置 completed', { reviewId })
        // risks 为空时（无风险合同）仍置 completed（不是失败），只是没有批注文件
        await updateContractReviewDAO(reviewId, { status: 'completed' })
        return
    }

    const originalOssFile = await findOssFileByIdDao(review.originalFileId)
    if (!originalOssFile) throw new Error(`original oss file ${review.originalFileId} not found`)
    if (!originalOssFile.filePath) throw new Error(`original oss file ${review.originalFileId} has no filePath`)

    const originalBuffer = await downloadFileService(originalOssFile.filePath)
    const injectResult = await injectComments(originalBuffer, risks)

    // OSS 路径与 contractReviewRebuild.service 保持同构：
    // contract-review/<userId>/reviewed-<uuid>.docx
    const ossPath = `contract-review/${review.userId}/reviewed-${randomUUID()}.docx`
    const uploadResult = await uploadFileService(ossPath, injectResult.buffer, {
        contentType: DOCX_MIME,
        userId: review.userId,
    })

    const storageConfig = await getDefaultStorageConfigDao(StorageProviderType.ALIYUN_OSS, review.userId)
    const bucketName = storageConfig?.bucket ?? ''

    const ossFileRow = await createOssFileDao({
        userId: review.userId,
        bucketName,
        fileName: `reviewed-${reviewId}.docx`,
        filePath: uploadResult.name,
        fileSize: injectResult.buffer.length,
        fileType: DOCX_MIME,
        source: FileSource.CASE_ANALYSIS,
        status: OssFileStatus.UPLOADED,
        encrypted: false,
    })

    // 若注入时丢掉了越界 risks，DB 只保存有效的 risks，
    // 避免 risks JSON 与 docx 批注不一致
    const updatePayload: Prisma.contractReviewsUpdateInput = {
        reviewedFileId: ossFileRow.id,
        status: 'completed',
    }
    if (injectResult.skippedIndices.length > 0) {
        updatePayload.risks = injectResult.validRisks as unknown as Prisma.InputJsonValue
        logger.warn('runAnnotateAndUpload: clauseIndex 越界的 risks 已从 DB 剔除', {
            reviewId,
            skipped: injectResult.skippedIndices.length,
            kept: injectResult.validRisks.length,
        })
    }
    await updateContractReviewDAO(reviewId, updatePayload)
}

export const reviewResultPersistenceMiddleware = (
    options: ReviewResultPersistenceOptions,
) => createMiddleware({
    name: 'ReviewResultPersistenceMiddleware',

    beforeAgent: {
        hook: async (_state: any) => {
            try {
                await updateContractReviewDAO(options.reviewId, { status: 'reviewing' })
                // M6.1：agent 启动即视为 detect 阶段 running
                if (options.runId) {
                    const { emitContractReviewEvent } = await import('../nodes/contractReviewStageEmitter')
                    await emitContractReviewEvent(
                        { runId: options.runId, sessionId: options.sessionId },
                        { type: 'stage', stage: 'detect', status: 'running' },
                    )
                }
            } catch (err) {
                logger.error('reviewResultPersistence beforeAgent 失败', {
                    reviewId: options.reviewId, err,
                })
            }
        },
    },

    afterAgent: {
        hook: async (_state: any) => {
            // M6.1 子期 2：risks 已由外层 runAnalyzeLoop 写进 DB
            // 这里只做兜底：读 DB risks → 注入批注 → 上传 OSS
            // 如果主流程（runContractReviewChat resume 分支）已执行 runAnnotateAndUpload，
            // afterAgent 可能不会被触发（因为 resume 分支不走 agent.stream）；
            // 若触发，则 review.status 已是 completed，幂等安全。
            const review = await getContractReviewDAO(options.reviewId)
            if (!review) {
                logger.warn('reviewResultPersistence afterAgent: review not found', { reviewId: options.reviewId })
                return
            }

            // 已完成（主流程已处理），不重复执行
            if (review.status === 'completed') {
                logger.info('reviewResultPersistence afterAgent: 已 completed，跳过', { reviewId: options.reviewId })
                return
            }

            const risks = Array.isArray(review.risks) ? review.risks as unknown as Risk[] : []
            if (risks.length === 0) {
                await updateContractReviewDAO(options.reviewId, { status: 'failed' })
                logger.warn('reviewResultPersistence afterAgent: risks 为空，置 failed', {
                    reviewId: options.reviewId,
                })
                return
            }

            try {
                await runAnnotateAndUpload(options.reviewId)
            } catch (err) {
                logger.error('reviewResultPersistence afterAgent: 批注/上传失败', {
                    reviewId: options.reviewId, err,
                })
                await updateContractReviewDAO(options.reviewId, { status: 'failed' })
            }
        },
    },
})
