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
import { isAnnotationExportable } from './contractAnnotation.service'
import {
    injectAnnotations,
    injectRedlineMarks,
    findMaxSharedId,
    loadDocxZip,
    readTextFromZip,
} from './docx'
import { parseOoxml } from './docx/xmlAst'
import type {
    ContractAnnotationForExport,
    RedlineRisk,
} from './docx'
import type { ContractExportMode } from '#shared/types/contract'
import { findOssFileByIdDao } from '~~/server/services/files/ossFiles.dao'
import {
    downloadFileService,
    generateSignedUrlService,
    deleteFileService,
} from '~~/server/services/storage/storage.service'
import { uploadAndRegisterOssFile } from './utils/uploadAndRegisterOssFile'
import { FileSource } from '#shared/types/file'
import { DOCX_MIME } from '#shared/utils/mime'
import {
    buildContractReviewFilename,
    buildContentDispositionForFilename,
} from './contractReviewFilename'

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
 * review 已被软删（deletedAt != null）或不存在时抛出，handler 转 404。
 * 与其他 service 错误模式（{ error: '...' }）不同——saveVersion 是事务内深路径，
 * 用 throw 配合上层 try/catch 比层层 propagate 错误对象更清晰。
 */
export class ReviewNotFoundError extends Error {
    constructor(reviewId: number) {
        super(`合同审查不存在或已删除：${reviewId}`)
        this.name = 'ReviewNotFoundError'
    }
}

/**
 * 原子操作：递增 maxVersionNo → 创建快照记录 → 更新 currentVersionId
 * 整个过程在 prisma.$transaction 内完成，避免并发冲突
 *
 * 防御：review 已被软删（deletedAt != null）时直接抛 ReviewNotFoundError；
 * 入口先 findFirst 校验避免事务白白递增 maxVersionNo，事务内 update 用
 * updateMany + count 复核避免与软删并发竞态写出僵尸版本。
 */
export async function saveContractReviewVersionService(input: SaveVersionInput) {
    const { reviewId, systemLabel, lawyerNote, createdById } = input

    // 入口快速校验：review 不存在或已软删 → 直接抛错，避免进入事务
    const existing = await prisma.contractReviews.findFirst({
        where: { id: reviewId, deletedAt: null },
        select: { id: true },
    })
    if (!existing) throw new ReviewNotFoundError(reviewId)

    return prisma.$transaction(async (tx) => {
        // 1. 原子递增 + 读当前 currentVersionId 用于继承 docxText
        // 用 updateMany 而非 update，可在事务内复核 deletedAt 仍为 null（防并发软删竞态）
        const incrementResult = await tx.contractReviews.updateMany({
            where: { id: reviewId, deletedAt: null },
            data: { maxVersionNo: { increment: 1 } },
        })
        if (incrementResult.count !== 1) throw new ReviewNotFoundError(reviewId)

        const review = await tx.contractReviews.findUniqueOrThrow({
            where: { id: reviewId },
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

        // 5. 更新 currentVersionId 指向最新版本（updateMany 复核 deletedAt 仍为 null）
        const finalUpdate = await tx.contractReviews.updateMany({
            where: { id: reviewId, deletedAt: null },
            data: { currentVersionId: version.id },
        })
        if (finalUpdate.count !== 1) throw new ReviewNotFoundError(reviewId)

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

    // VER-M3：snapshotData 是 jsonb，as unknown as 直接解析在 DB 数据脏化时会让前端
    // map 处崩溃。用容错策略读取——缺字段补默认值，非数组类型降级为空数组。
    const snapshot = parseSnapshotSafe(version.snapshotData)

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

/**
 * VER-M3：snapshot 容错解析。risks / annotations / clauses 必须是数组，
 * docxText 必须是字符串，否则降级为空。脏数据不至于让前端崩溃。
 */
function parseSnapshotSafe(raw: unknown): {
    risks: ContractRiskEntity[]
    annotations: ContractAnnotationEntity[]
    docxText: string
    clauses: ClauseSnapshotItem[]
} {
    const obj = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {}
    const risks = Array.isArray(obj.risks) ? (obj.risks as ContractRiskEntity[]) : []
    const annotations = Array.isArray(obj.annotations) ? (obj.annotations as ContractAnnotationEntity[]) : []
    const docxText = typeof obj.docxText === 'string' ? obj.docxText : ''
    const clauses = Array.isArray(obj.clauses) ? (obj.clauses as ClauseSnapshotItem[]) : []
    return { risks, annotations, docxText, clauses }
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
 *   - annotation 关联的 risk.clauseParagraphIndex 为 null → 跳过（孤立批注无法注入）
 *   - risk.orphaned === true → 跳过（原文已变更，批注无意义）
 */
export async function downloadContractReviewVersionService(
    review: contractReviews,
    versionId: number,
    opts: { mode?: ContractExportMode } = {},
): Promise<DownloadVersionResult> {
    const mode: ContractExportMode = opts.mode ?? 'comment'

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
    const [baseOssFile, originalOssFile] = await Promise.all([
        findOssFileByIdDao(baseFileId),
        review.originalFileId !== baseFileId ? findOssFileByIdDao(review.originalFileId) : null,
    ])
    if (!baseOssFile?.filePath) return { error: 'origin_file_missing' as const }
    // VER-M2：文件名始终取自原始合同；fallback 显式兜底空串，让 buildContractReviewFilename
    // 不依赖 undefined（filename 生成逻辑可独立测试）
    const contractFileName = (originalOssFile ?? baseOssFile)?.fileName ?? ''

    const baseBuffer = await downloadFileService(baseOssFile.filePath)

    const riskById = new Map<number, ContractRiskEntity>()
    for (const r of snapshot.risks) riskById.set(r.id, r)

    // bug H6：snapshot 里的 wordCommentRef 可能是 null（版本保存时 annotation 还没导出过），
    // 直接传 null 给 injectAnnotations 会当场生成新 rand8 但不回写，下次同版本下载
    // rand8 又变——客户手里的 docx rand8 永远和 DB / audit log 对不上。
    //
    // 修复：snapshot 里 ref 为 null 的，从当前 DB 读取一次 annotation.wordCommentRef
    // 作为兜底。这样"首次触发过 export 之后，所有后续版本下载都会用同一个稳定 rand8"。
    const snapshotNullRefIds = snapshot.annotations
        .filter(a => a.wordCommentRef == null)
        .map(a => a.id)
    const dbRefByAnnId = new Map<number, string | null>()
    if (snapshotNullRefIds.length > 0) {
        const dbAnns = await prisma.contractAnnotations.findMany({
            where: { id: { in: snapshotNullRefIds } },
            select: { id: true, wordCommentRef: true },
        })
        for (const a of dbAnns) dbRefByAnnId.set(a.id, a.wordCommentRef)
    }

    const exportable: ContractAnnotationForExport[] = []
    for (const a of snapshot.annotations) {
        const risk = riskById.get(a.riskId)
        // VER-R3：共享 isAnnotationExportable 谓词（含 deletedAt / suppressInExport /
        // clauseParagraphIndex / orphaned 四条规则），与 rebuild service / middleware 同口径。
        if (!isAnnotationExportable(a, risk)) continue
        if (!risk) continue // 类型守卫：上面已 guard，这里仅缩窄类型
        exportable.push({
            id: a.id,
            riskId: a.riskId,
            authorType: a.authorType,
            authorName: a.authorName,
            content: a.content,
            parentAnnotationId: a.parentAnnotationId,
            anchorQuote: risk.clauseText,                       // commentInjector 入参字段名保留
            // isAnnotationExportable 已 guard clauseParagraphIndex !== null
            anchorParagraphIndex: risk.clauseParagraphIndex!,   // commentInjector 入参字段名保留
            // 优先 snapshot 冻结值；null 时回退到 DB 当前值；仍 null → injectAnnotations
            // 当场生成新的（单次下载内所有 ref 依然一致，只是跨下载会变）
            wordCommentRef: a.wordCommentRef ?? dbRefByAnnId.get(a.id) ?? null,
            createdAt: typeof a.createdAt === 'string' ? new Date(a.createdAt) : (a.createdAt ?? null),
        })
    }

    let injectedBuffer: Buffer
    try {
        if (mode === 'comment') {
            const result = await injectAnnotations(baseBuffer, exportable, review.id)
            injectedBuffer = Buffer.isBuffer(result.buffer) ? result.buffer : Buffer.from(result.buffer)
        }
        else {
            // PR6 §8.2 历史版本下载也支持 redline / both 三模式
            const docAst = parseOoxml(await readTextFromZip(await loadDocxZip(baseBuffer), 'word/document.xml'))
            const idStart = findMaxSharedId(docAst) + 1

            // snapshot 里的 risks 已含 PR2/PR3 的 quote 字段
            const redlineRisks: RedlineRisk[] = snapshot.risks.map(r => ({
                id: r.id,
                clauseText: r.clauseText,
                clauseParagraphIndex: r.clauseParagraphIndex ?? null,
                problematicQuote: r.problematicQuote ?? null,
                quoteCharStart: r.quoteCharStart ?? null,
                quoteCharEnd: r.quoteCharEnd ?? null,
                suggestedClauseText: r.suggestedClauseText ?? null,
            }))
            const redlineResult = await injectRedlineMarks(baseBuffer, redlineRisks, {
                reviewId: review.id, idStart,
            })

            if (mode === 'redline') {
                const skippedSet = new Set(redlineResult.skippedRiskIds)
                const fallback = exportable.filter(a => skippedSet.has(a.riskId))
                if (fallback.length > 0) {
                    const cr = await injectAnnotations(redlineResult.buffer, fallback, review.id, {
                        idStart: redlineResult.nextIdAfter,
                    })
                    injectedBuffer = Buffer.isBuffer(cr.buffer) ? cr.buffer : Buffer.from(cr.buffer)
                }
                else {
                    injectedBuffer = Buffer.isBuffer(redlineResult.buffer) ? redlineResult.buffer : Buffer.from(redlineResult.buffer)
                }
            }
            else {
                // both
                const cr = await injectAnnotations(redlineResult.buffer, exportable, review.id, {
                    idStart: redlineResult.nextIdAfter,
                    wrapTargetByRiskId: redlineResult.spansByRiskId,
                })
                injectedBuffer = Buffer.isBuffer(cr.buffer) ? cr.buffer : Buffer.from(cr.buffer)
            }
        }
    } catch (err) {
        logger.error('[downloadContractReviewVersion] 注入批注失败', {
            reviewId: review.id,
            versionId,
            mode,
            err,
        })
        return { error: 'inject_failed' as const }
    }

    // 文件名：spec §4.4 规范，历史版本必定有版本号，不会走"工作区"分支
    const filename = buildContractReviewFilename({
        originalFileName: contractFileName,
        versionNumber: version.versionNumber,
    })

    // 上传到 OSS：contract-review/<userId>/version-<versionId>-<uuid>.docx
    // CORE-R3：上传 + 落 ossFiles + 失败清孤儿统一走 uploadAndRegisterOssFile。
    const ossPath = `contract-review/${review.userId}/version-${versionId}-${randomUUID()}.docx`
    let uploadName: string
    try {
        const result = await uploadAndRegisterOssFile({
            ossPath,
            buffer: injectedBuffer,
            fileName: filename,
            fileType: DOCX_MIME,
            userId: review.userId,
            source: FileSource.CASE_ANALYSIS,
        })
        uploadName = result.uploadName

        const contentDisposition = buildContentDispositionForFilename(filename)
        const downloadUrl = await generateSignedUrlService(uploadName, {
            expires: 3600,
            userId: review.userId,
            response: { contentDisposition },
        })

        return { data: { downloadUrl, filename } }
    } catch (err) {
        // 上传/落库自身失败时 uploadAndRegisterOssFile 内部已清孤儿；
        // 这里兜底处理"util 成功但后续 generateSignedUrl 失败"的孤儿场景。
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
