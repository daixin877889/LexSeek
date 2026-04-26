/**
 * 合同审查结果持久化中间件（contractReviewMain 专用，末位）
 *
 * M6.1 子期 2 改造后职责：
 * beforeAgent: 首轮 agent.stream 启动前置 status='reviewing'。
 *   注：M6.1 子期 2 改造后，resume 路径直接由 runContractReviewChat 处理
 *   （不再经过此 middleware），故 resume 分支的 status 由 runContractReviewChat 直接写。
 * afterAgent（异常兜底，正常流程下不走此分支）:
 *   risks 已由 runAnalyzeLoop 写进 DB；这里只做兜底路径 "读 DB → 注入批注 → 上传"
 *   - DB risks 有值 → 调 runAnnotateAndUpload 注入批注 + 上传 OSS → status='completed'
 *   - DB risks 为空 → status='failed'（见下方注释说明为何这里 risks=[] 判 failed）
 *
 * runAnnotateAndUpload：独立导出，供 runContractReviewChat 在 resume 分支直接调用。
 */

import { createMiddleware } from 'langchain'
import { randomUUID } from 'node:crypto'
import {
    getContractReviewDAO,
    updateContractReviewDAO,
} from '~~/server/services/assistant/contract/contractReview.dao'
import { injectAnnotations } from '~~/server/services/assistant/contract/docx'
import { listAnnotationsForExportDAO } from '~~/server/services/assistant/contract/contractAnnotation.dao'
import { isAnnotationExportable } from '~~/server/services/assistant/contract/contractAnnotation.service'
import {
    downloadFileService,
    deleteFileService,
} from '~~/server/services/storage/storage.service'
import { findOssFileByIdDao } from '~~/server/services/files/ossFiles.dao'
import { uploadAndRegisterOssFile } from '~~/server/services/assistant/contract/utils/uploadAndRegisterOssFile'
import { FileSource } from '#shared/types/file'
import { DOCX_MIME } from '#shared/utils/mime'
import type { ContractAnnotationForExport } from '~~/server/services/assistant/contract/docx'

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

    // 1. 先加载原始文件（失败直接抛，让调用方 catch 置 failed）
    //    必须在查 annotations 之前，保证 originalFile 不存在时能正确置 failed
    const originalOssFile = await findOssFileByIdDao(review.originalFileId)
    if (!originalOssFile) throw new Error(`original oss file ${review.originalFileId} not found`)
    if (!originalOssFile.filePath) throw new Error(`original oss file ${review.originalFileId} has no filePath`)

    const originalBuffer = await downloadFileService(originalOssFile.filePath)

    // 2. 从 contractAnnotations 表读取批注（过滤软删和 suppressInExport）
    const dbAnnotations = await listAnnotationsForExportDAO(reviewId)
    if (dbAnnotations.length === 0) {
        const risks = Array.isArray(review.risks) ? review.risks : []
        if (risks.length === 0) {
            // 合理跳过：无风险 + 无批注（真无风险合同）
            logger.info('runAnnotateAndUpload: 无风险无批注，跳过注入，置 completed', { reviewId })
            await updateContractReviewDAO(reviewId, { status: 'completed' })
            return
        }
        // 流程异常：risks 已产出但批注未初始化，应由调用方 catch 置 failed
        throw new Error(`runAnnotateAndUpload: review ${reviewId} 有 ${risks.length} 条风险但未找到批注记录，流程异常`)
    }

    // VER-R3：用共享 isAnnotationExportable 替代本地三段过滤；行为一致。
    const exportable = dbAnnotations.filter(a => {
        const ok = isAnnotationExportable(a, a.risk)
        if (!ok) {
            logger.warn('[contract export] 跳过不可导出的批注（孤立 / suppressed / 软删）', {
                reviewId, annotationId: a.id, riskId: a.riskId,
                anchorParagraphIndex: a.risk.anchorParagraphIndex,
                orphaned: a.risk.orphaned,
            })
        }
        return ok
    })

    const annotations: ContractAnnotationForExport[] = exportable.map(a => ({
        id: a.id,
        riskId: a.riskId,
        authorType: a.authorType as ContractAnnotationForExport['authorType'],
        authorName: a.authorName,
        content: a.content,
        parentAnnotationId: a.parentAnnotationId,
        anchorQuote: a.risk.anchorQuote,
        anchorParagraphIndex: a.risk.anchorParagraphIndex!,
        wordCommentRef: a.wordCommentRef,
        createdAt: a.createdAt,
    }))

    const injectResult = await injectAnnotations(originalBuffer, annotations, reviewId)

    // 将新生成的 wordCommentRef 批量回写到 DB（只更新已导出且 wordCommentRef 为 null 的条目）
    const toUpdate = exportable.filter(a => a.wordCommentRef === null)
    if (toUpdate.length > 0) {
        await prisma.$transaction(
            toUpdate.map(a =>
                prisma.contractAnnotations.update({
                    where: { id: a.id },
                    data: { wordCommentRef: injectResult.refsByAnnotationId.get(a.id) },
                }),
            ),
        )
    }

    // OSS 路径与 contractReviewRebuild.service 保持同构：
    // contract-review/<userId>/reviewed-<uuid>.docx
    // CORE-R3：上传 + 落 ossFiles + 失败清孤儿统一走 uploadAndRegisterOssFile。
    const ossPath = `contract-review/${review.userId}/reviewed-${randomUUID()}.docx`
    const { uploadName, ossFileId } = await uploadAndRegisterOssFile({
        ossPath,
        buffer: injectResult.buffer,
        fileName: `reviewed-${reviewId}.docx`,
        fileType: DOCX_MIME,
        userId: review.userId,
        source: FileSource.CASE_ANALYSIS,
    })

    // OSS + ossFiles 行已就绪；后续 updateContractReview 失败仍需清理 OSS 孤儿，
    // 与 contractReviewRebuild.service.ts 同构：deleteFileService 用 Promise.resolve 包裹兜底。
    try {
        await updateContractReviewDAO(reviewId, { reviewedFileId: ossFileId, status: 'completed' })
    } catch (err) {
        await Promise.resolve(deleteFileService(uploadName, { userId: review.userId }))
            .catch((cleanupErr) => {
                logger.warn('runAnnotateAndUpload: OSS 孤儿文件清理失败', {
                    reviewId,
                    ossPath: uploadName,
                    cleanupErr: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
                })
            })
        throw err
    }
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
                    const { emitContractReviewEvent } = await import('~~/server/services/workflow/nodes/contractReviewStageEmitter')
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

            // CORE-M5：Phase B 之后 contractRisks 表是权威来源；review.risks JSONB 只是
            // 老消费方兼容快照。判断异常流程必须看新表 count，否则只要 syncReviewRisksJsonb
            // 还没跑完就被强行置 failed，把可能完整的 risks 数据当成空。
            const newTableCount = await prisma.contractRisks.count({
                where: { reviewId: options.reviewId },
            })
            const legacyRisks = Array.isArray(review.risks) ? review.risks : []
            if (newTableCount === 0 && legacyRisks.length === 0) {
                await updateContractReviewDAO(options.reviewId, { status: 'failed' })
                logger.warn('reviewResultPersistence afterAgent: 新表 + 老 JSONB 都空（异常流程），置 failed', {
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
