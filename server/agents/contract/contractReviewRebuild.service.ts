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
 * **Phase B 改造**：批注来源从 review.risks JSON 切换为 contractAnnotations 表。
 */
import { randomUUID } from 'node:crypto'
import type { contractReviews } from '~~/generated/prisma/client'
import { findOssFileByIdDao, createOssFileDao } from '~~/server/services/files/ossFiles.dao'
import { setCompletedAfterRebuildDAO } from './contractReview.dao'
import { resolveContractExportSignatureService } from '~~/server/services/users/contractSignature.service'
import {
    injectAnnotations,
    injectRedlineMarks,
    findMaxSharedIdInDocx,
    loadDocxZip,
} from './docx'
import { listAnnotationsForExportDAO } from './contractAnnotation.dao'
import { filterExportableDbAnnotations } from './contractAnnotation.service'
import { listContractRisksDAO } from './contractRisk.dao'
import {
    downloadFileService,
    uploadFileService,
    generateSignedUrlService,
    deleteFileService,
} from '~~/server/services/storage/storage.service'
import { getDefaultStorageConfigDao } from '~~/server/services/storage/storageConfig.dao'
import { StorageProviderType } from '~~/server/lib/storage/types'
import { FileSource, OssFileStatus } from '#shared/types/file'
import { DOCX_MIME } from '#shared/utils/mime'
import type {
    ContractAnnotationForExport,
    RedlineRisk,
} from './docx'
import {
    buildContractReviewFilename,
    buildContentDispositionForFilename,
} from './contractReviewFilename'
import type { ContractExportMode } from '#shared/types/contract'

export interface RebuildDocxResult {
    reviewedFileId: number
    downloadUrl: string
    filename: string
}

export async function rebuildDocxService(
    review: contractReviews,
    opts: { mode?: ContractExportMode } = {},
): Promise<RebuildDocxResult> {
    const mode: ContractExportMode = opts.mode ?? 'comment'

    if (!review.originalFileId) throw new Error('审查没有原始文件，无法重生批注')
    const origOssFile = await findOssFileByIdDao(review.originalFileId)
    if (!origOssFile?.filePath) throw new Error('原始文件已丢失，无法重生批注')

    const origBuffer = await downloadFileService(origOssFile.filePath)

    // Phase B：从 contractAnnotations 表读取批注，而非 review.risks JSON 字段
    const dbAnnotations = await listAnnotationsForExportDAO(review.id)

    // VER-R3：共享 filter+warn 谓词（与 reviewResultPersistence middleware 同口径）。
    const exportable = filterExportableDbAnnotations(dbAnnotations, review.id)

    const annotations: ContractAnnotationForExport[] = exportable.map(a => ({
        id: a.id,
        riskId: a.riskId,
        authorType: a.authorType as ContractAnnotationForExport['authorType'],
        authorName: a.authorName,
        content: a.content,
        parentAnnotationId: a.parentAnnotationId,
        anchorQuote: a.risk.clauseText,
        anchorParagraphIndex: a.risk.clauseParagraphIndex!,
        wordCommentRef: a.wordCommentRef,
        createdAt: a.createdAt,
    }))

    let finalBuffer: Buffer
    const writeRefs = new Map<number, string>()
    const signature = await resolveContractExportSignatureService(review.userId)

    if (mode === 'comment') {
        // M15：comment 模式不注入 redline；清理 base 残留的陈旧 redlineRefs.xml
        const r = await injectAnnotations(origBuffer, annotations, review.id, { signature, purgeRedlineRefs: true })
        finalBuffer = Buffer.isBuffer(r.buffer) ? r.buffer : Buffer.from(r.buffer)
        for (const [k, v] of r.refsByAnnotationId) writeRefs.set(k, v)
    }
    else {
        // redline / both 都需要先扫 ID 池底数
        // M16：扫全文 w:id 共享池（含页眉/页脚/原生批注）取 max+1，避免新 w:id 撞车致 Word 报损坏。
        const idStart = await findMaxSharedIdInDocx(await loadDocxZip(origBuffer)) + 1

        const risks = await listContractRisksDAO(review.id)
        const redlineRisks: RedlineRisk[] = risks.map(r => ({
            id: r.id,
            clauseText: r.clauseText,
            clauseParagraphIndex: r.clauseParagraphIndex,
            problematicQuote: r.problematicQuote,
            quoteCharStart: r.quoteCharStart,
            quoteCharEnd: r.quoteCharEnd,
            suggestedClauseText: r.suggestedClauseText,
        }))
        const redlineResult = await injectRedlineMarks(origBuffer, redlineRisks, {
            reviewId: review.id, idStart, signature,
        })

        if (mode === 'redline') {
            // 跳过的 risk → fallback 挂 comment
            const skippedSet = new Set(redlineResult.skippedRiskIds)
            const fallback = annotations.filter(a => skippedSet.has(a.riskId))
            if (fallback.length > 0) {
                const cr = await injectAnnotations(redlineResult.buffer, fallback, review.id, { idStart: redlineResult.nextIdAfter, signature })
                finalBuffer = Buffer.isBuffer(cr.buffer) ? cr.buffer : Buffer.from(cr.buffer)
                for (const [k, v] of cr.refsByAnnotationId) writeRefs.set(k, v)
            }
            else {
                finalBuffer = Buffer.isBuffer(redlineResult.buffer) ? redlineResult.buffer : Buffer.from(redlineResult.buffer)
            }
        }
        else {
            // both：全部 annotations 走 commentInjector，从 nextIdAfter 接力
            // 传 wrapTargetByRiskId 让 commentRange 精确包到 redline 的 del+ins 周围（spec §8.3.6）
            const cr = await injectAnnotations(redlineResult.buffer, annotations, review.id, {
                idStart: redlineResult.nextIdAfter,
                wrapTargetByRiskId: redlineResult.spansByRiskId,
                signature,
            })
            finalBuffer = Buffer.isBuffer(cr.buffer) ? cr.buffer : Buffer.from(cr.buffer)
            for (const [k, v] of cr.refsByAnnotationId) writeRefs.set(k, v)
        }
    }

    // 将新生成的 wordCommentRef 批量回写到 DB（只更新已导出且 wordCommentRef 为 null 的条目）
    const toUpdate = exportable.filter(a => a.wordCommentRef === null && writeRefs.has(a.id))
    if (toUpdate.length > 0) {
        await prisma.$transaction(
            toUpdate.map(a =>
                prisma.contractAnnotations.update({
                    where: { id: a.id },
                    data: { wordCommentRef: writeRefs.get(a.id) },
                }),
            ),
        )
    }

    const buffer = finalBuffer

    // OSS 路径与 M3 contractReview.service 保持同构：contract-review/<userId>/<uuid>.docx
    const ossPath = `contract-review/${review.userId}/rebuild-${randomUUID()}.docx`
    const [uploadResult, storageConfig] = await Promise.all([
        uploadFileService(ossPath, buffer, {
            contentType: DOCX_MIME,
            userId: review.userId,
        }),
        getDefaultStorageConfigDao(StorageProviderType.ALIYUN_OSS, review.userId),
    ])
    const bucketName = storageConfig?.bucket ?? ''

    // 构造 spec §4.4 规范的用户可见文件名：{合同名}_{版本号/"工作区"}_{日期}.docx
    const filename = buildContractReviewFilename({
        originalFileName: origOssFile.fileName,
        versionNumber: review.maxVersionNo,
    })
    const contentDisposition = buildContentDispositionForFilename(filename)

    // OSS 已上传成功；后续 DB 写入失败需清理 OSS 以免留孤儿文件。
    // 用局部 try 捕获生成签名 URL / createOssFile / setCompleted 三步中的任意失败。
    try {
        const downloadUrl = await generateSignedUrlService(uploadResult.name, {
            expires: 3600,
            userId: review.userId,
            response: { contentDisposition },
        })

        const newOssFile = await createOssFileDao({
            userId: review.userId,
            bucketName,
            fileName: filename,
            filePath: uploadResult.name,
            fileSize: buffer.byteLength,
            fileType: DOCX_MIME,
            source: FileSource.CASE_ANALYSIS,
            status: OssFileStatus.UPLOADED,
            encrypted: false,
        })

        // 最后落库 reviewedFileId：OSS + 签名 URL + ossFiles 行都就绪，失败只发生在此 DB 写入
        await setCompletedAfterRebuildDAO(review.id, newOssFile.id)

        return { reviewedFileId: newOssFile.id, downloadUrl, filename }
    } catch (err) {
        // 清理 OSS 孤儿文件。失败只记日志，不覆盖原始错误。
        // Promise.resolve(...) 包裹防御性：测试中 deleteFileService mock 未返回 Promise 时也不炸。
        await Promise.resolve(deleteFileService(uploadResult.name, { userId: review.userId }))
            .catch((cleanupErr) => {
                logger.warn('rebuildDocx: OSS 孤儿文件清理失败', {
                    reviewId: review.id,
                    ossPath: uploadResult.name,
                    cleanupErr: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
                })
            })
        throw err
    }
}
