/**
 * ContractReviewVersion Service
 *
 * 核心：saveContractReviewVersionService 用 prisma.$transaction 原子递增 maxVersionNo
 * + dump snapshot + 更新 currentVersionId，确保并发安全。
 *
 * **Feature: contract-review-versioning-phase-a**
 */
import { randomUUID } from 'node:crypto'
import type { Prisma, contractReviews } from '~~/generated/prisma/client'
import type {
    VersionSystemLabel,
    ContractReviewVersionSnapshotResponse,
    ContractRiskEntity,
    ContractAnnotationEntity,
    ClauseSnapshotItem,
} from '#shared/types/contract'
import { getContractReviewVersionByIdDAO } from './contractReviewVersion.dao'
import { injectAnnotations } from './docx'
import type { ContractAnnotationForExport } from './docx'
import { findOssFileByIdDao, createOssFileDao } from '~~/server/services/files/ossFiles.dao'
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

export interface SaveVersionInput {
    reviewId: number
    systemLabel: VersionSystemLabel
    lawyerNote?: string | null
    createdById: number
    /**
     * 正文内容。Phase A 首次快照（initial_upload）由调用方显式传入；
     * lawyer_save 传 undefined → 从 currentVersion snapshot 继承。
     */
    docxText?: string
    /**
     * 上传的 docx 文件 ID（落库到 contractReviewVersions.docxFileId）。
     * Phase B initial_upload 时传入；其他快照类型传 undefined → null。
     */
    docxFileId?: number | null
    /**
     * 条款切分结果。Phase B initial_upload 时由 segmentClauses 产出传入；
     * 其他快照类型传 undefined → 从 currentVersion snapshot 继承，没有退 []。
     */
    clauses?: ClauseSnapshotItem[]
}

/**
 * 原子操作：递增 maxVersionNo → 创建快照记录 → 更新 currentVersionId
 * 整个过程在 prisma.$transaction 内完成，避免并发冲突
 */
export async function saveContractReviewVersionService(input: SaveVersionInput) {
    const { reviewId, systemLabel, lawyerNote, createdById } = input

    return prisma.$transaction(async (tx) => {
        // 1. 原子递增 + 读当前 currentVersionId 用于继承 docxText
        const review = await tx.contractReviews.update({
            where: { id: reviewId },
            data: { maxVersionNo: { increment: 1 } },
            select: { maxVersionNo: true, currentVersionId: true },
        })
        const versionNumber = review.maxVersionNo

        // 2. 从入参或当前版本继承 docxText 和 clauses
        let prevSnap: { docxText?: string; clauses?: ClauseSnapshotItem[] } | undefined
        if ((input.docxText === undefined || input.clauses === undefined) && review.currentVersionId) {
            const prev = await tx.contractReviewVersions.findUnique({
                where: { id: review.currentVersionId },
                select: { snapshotData: true },
            })
            prevSnap = prev?.snapshotData as typeof prevSnap
        }
        const docxText = input.docxText ?? prevSnap?.docxText ?? ''
        const clauses = input.clauses ?? prevSnap?.clauses ?? []

        // 3. 拿当前工作区 risks + annotations（软删的不进 snapshot）
        const [risks, annotations] = await Promise.all([
            tx.contractRisks.findMany({
                where: { reviewId },
                orderBy: { createdAt: 'asc' },
            }),
            tx.contractAnnotations.findMany({
                where: { reviewId, deletedAt: null },
                orderBy: [{ riskId: 'asc' }, { createdAt: 'asc' }],
            }),
        ])

        const snapshotData = { risks, annotations, docxText, clauses } as unknown as Prisma.InputJsonValue

        // 4. 创建版本记录
        const version = await tx.contractReviewVersions.create({
            data: {
                reviewId,
                versionNumber,
                systemLabel,
                lawyerNote: lawyerNote ?? null,
                snapshotData,
                createdById,
                docxFileId: input.docxFileId ?? null,
            },
        })

        // 5. 更新 currentVersionId 指向最新版本
        await tx.contractReviews.update({
            where: { id: reviewId },
            data: { currentVersionId: version.id },
        })

        return version
    })
}

/**
 * 读取版本完整快照（含 snapshotData 反序列化）
 * 返回 `{ data }` / `{ error: 'version_not_found' }`，与 contractAnnotation.service / contractRisk.service 的错误模式统一。
 */
export async function loadContractReviewVersionSnapshotService(versionId: number): Promise<
    | { data: ContractReviewVersionSnapshotResponse }
    | { error: 'version_not_found' }
> {
    const version = await getContractReviewVersionByIdDAO(versionId)
    if (!version) return { error: 'version_not_found' as const }

    // 查询 createdBy 用户名
    const createdByUser = await prisma.users.findUnique({
        where: { id: version.createdById },
        select: { name: true },
    })

    const snapshot = version.snapshotData as unknown as {
        risks: ContractRiskEntity[]
        annotations: ContractAnnotationEntity[]
        docxText: string
        clauses: ClauseSnapshotItem[]
    }

    return {
        data: {
            id: version.id,
            reviewId: version.reviewId,
            versionNumber: version.versionNumber,
            systemLabel: version.systemLabel as VersionSystemLabel,
            lawyerNote: version.lawyerNote,
            createdById: version.createdById,
            createdByName: createdByUser?.name ?? '',
            createdAt: version.createdAt.toISOString(),
            docxFileId: version.docxFileId,
            snapshot,
        },
    }
}

// ============================================================
// 历史版本 docx 下载
// ============================================================

export type DownloadVersionResult =
    | { data: { downloadUrl: string; filename: string } }
    | { error: 'version_not_found' | 'origin_file_missing' | 'snapshot_invalid' | 'inject_failed' }

/**
 * 依据历史版本 snapshotData（risks + annotations）在对应基底 docx 上重注入批注，
 * 上传到 OSS 并返回 1h 签名 URL。只读操作：不修改 snapshotData，不回写 wordCommentRef。
 *
 * 基底文件优先级：version.docxFileId（客户回传原件）→ review.originalFileId。
 * 过滤：
 *   - annotation 关联的 risk.anchorParagraphIndex 为 null → 跳过（孤立批注无法注入）
 *   - risk.orphaned === true → 跳过（原文已变更，批注无意义）
 */
export async function downloadContractReviewVersionService(
    review: contractReviews,
    versionId: number,
): Promise<DownloadVersionResult> {
    const version = await getContractReviewVersionByIdDAO(versionId)
    if (!version) return { error: 'version_not_found' as const }

    const snapshot = version.snapshotData as unknown as {
        risks?: ContractRiskEntity[]
        annotations?: ContractAnnotationEntity[]
    }
    if (!snapshot || !Array.isArray(snapshot.risks) || !Array.isArray(snapshot.annotations)) {
        return { error: 'snapshot_invalid' as const }
    }

    // 基底 docx：优先用该版本当时的客户回传原件；没有再回落到 review 的原始合同
    const baseFileId = version.docxFileId ?? review.originalFileId
    if (!baseFileId) return { error: 'origin_file_missing' as const }
    const baseOssFile = await findOssFileByIdDao(baseFileId)
    if (!baseOssFile?.filePath) return { error: 'origin_file_missing' as const }

    const baseBuffer = await downloadFileService(baseOssFile.filePath)

    const riskById = new Map<number, ContractRiskEntity>()
    for (const r of snapshot.risks) riskById.set(r.id, r)

    const exportable: ContractAnnotationForExport[] = []
    for (const a of snapshot.annotations) {
        const risk = riskById.get(a.riskId)
        if (!risk) continue
        if (risk.orphaned) continue
        if (risk.anchorParagraphIndex === null || risk.anchorParagraphIndex === undefined) continue
        exportable.push({
            id: a.id,
            riskId: a.riskId,
            authorType: a.authorType,
            authorName: a.authorName,
            content: a.content,
            parentAnnotationId: a.parentAnnotationId,
            anchorQuote: risk.anchorQuote,
            anchorParagraphIndex: risk.anchorParagraphIndex,
            wordCommentRef: a.wordCommentRef ?? null,
        })
    }

    let injectedBuffer: Buffer
    try {
        const result = await injectAnnotations(baseBuffer, exportable)
        injectedBuffer = Buffer.isBuffer(result.buffer) ? result.buffer : Buffer.from(result.buffer)
    } catch (err) {
        logger.error('[downloadContractReviewVersion] 注入批注失败', {
            reviewId: review.id,
            versionId,
            err,
        })
        return { error: 'inject_failed' as const }
    }

    // 上传到 OSS：contract-review/<userId>/version-<versionId>-<uuid>.docx
    const ossPath = `contract-review/${review.userId}/version-${versionId}-${randomUUID()}.docx`
    let uploadName: string
    try {
        const [uploadResult, storageConfig] = await Promise.all([
            uploadFileService(ossPath, injectedBuffer, {
                contentType: DOCX_MIME,
                userId: review.userId,
            }),
            getDefaultStorageConfigDao(StorageProviderType.ALIYUN_OSS, review.userId),
        ])
        uploadName = uploadResult.name
        const bucketName = storageConfig?.bucket ?? ''

        // 文件名：以原合同名为基底，附 v{版本号}，便于客户识别历史版本
        const baseName = (baseOssFile.fileName ?? '合同审查').replace(/\.docx$/i, '')
        const filename = `${baseName}_v${version.versionNumber}.docx`

        // 落一条 ossFiles 记录用于后续追踪；下载链走 Content-Disposition 带文件名
        await createOssFileDao({
            userId: review.userId,
            bucketName,
            fileName: filename,
            filePath: uploadName,
            fileSize: injectedBuffer.byteLength,
            fileType: DOCX_MIME,
            source: FileSource.CASE_ANALYSIS,
            status: OssFileStatus.UPLOADED,
            encrypted: false,
        })

        const encodedFilename = encodeURIComponent(filename)
        const contentDisposition = `attachment; filename*=UTF-8''${encodedFilename}`
        const downloadUrl = await generateSignedUrlService(uploadName, {
            expires: 3600,
            userId: review.userId,
            response: { contentDisposition },
        })

        return { data: { downloadUrl, filename } }
    } catch (err) {
        // createOssFile / 签名失败 → 清理 OSS 孤儿文件，不覆盖原始错误
        if (uploadName!) {
            await Promise.resolve(deleteFileService(uploadName, { userId: review.userId }))
                .catch((cleanupErr) => {
                    logger.warn('[downloadContractReviewVersion] OSS 孤儿清理失败', {
                        reviewId: review.id,
                        versionId,
                        ossPath: uploadName,
                        cleanupErr: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
                    })
                })
        }
        logger.error('[downloadContractReviewVersion] 上传/签名失败', { reviewId: review.id, versionId, err })
        return { error: 'inject_failed' as const }
    }
}
