/**
 * 客户回传 docx 上传处理链路（6 步）。
 *
 * B1 实现：Step 1 备份 + Step 2 解析 + Step 6 merge 快照（diff 和 AI 步骤占位）。
 * B2 填充：Step 3 diff + Step 5 锚点迁移。
 * B3 填充：Step 4 AI 增量审查 + 全局复核。
 *
 * 编排函数通过 AsyncGenerator 吐出进度事件，handler（Task 1.6）把事件转成 SSE。
 *
 * **Feature: contract-review-versioning-phase-b**
 */
import type { contractReviews } from '~~/generated/prisma/client'
import type {
    UploadVersionProgressData,
    UploadVersionCompleteData,
    UploadVersionErrorData,
    ClauseSnapshotItem,
} from '#shared/types/contract'
import { loadContractFullText } from './docx/loadContractFullText'
import { segmentClauses } from './docx/clauseSegmenter'
import { saveContractReviewVersionService } from './contractReviewVersion.service'
import { diffClauses } from './utils/clauseDiff'
import { migrateAnchor } from './utils/anchorMigrate'
import { parseWordComments, type ParsedWordComment } from './docx/wordCommentParser'
import { parseWordCommentRef } from './utils/wordCommentRef'
import { findOssFileByIdDao } from '~~/server/services/files/ossFiles.dao'
import { downloadFileService } from '~~/server/services/storage/storage.service'

type UploadEvent =
    | { type: 'progress'; data: UploadVersionProgressData }
    | { type: 'complete'; data: UploadVersionCompleteData }
    | { type: 'error'; data: UploadVersionErrorData }

/**
 * 客户回传 docx 上传六步处理链路。
 *
 * @param params.review    合同审查记录（含 id 和 currentVersionId）
 * @param params.ossFileId 客户回传的 docx 在 OSS 的文件 ID
 * @param params.userId    操作人 userId（owner 校验由 handler 层负责，service 不重复校验）
 */
export async function* uploadClientVersionService(params: {
    review: contractReviews
    ossFileId: number
    userId: number
}): AsyncGenerator<UploadEvent> {
    const { review, ossFileId, userId } = params

    // ============ Step 1: 自动备份当前工作区 ============
    try {
        const hasUnsaved = await detectUnsavedEdits(review.id, review.currentVersionId)
        if (hasUnsaved) {
            await saveContractReviewVersionService({
                reviewId: review.id,
                systemLabel: 'auto_backup',
                createdById: userId,
            })
        }
        yield { type: 'progress', data: { step: 'backup', status: 'done' } }
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : '备份失败'
        yield { type: 'error', data: { step: 'backup', code: 'BACKUP_FAILED', message: msg } }
        return
    }

    // ============ Step 2: 解析新上传 docx ============
    let newDocxText: string
    let newClauses: ClauseSnapshotItem[]
    let newComments: ParsedWordComment[] = []
    try {
        const { fullText } = await loadContractFullText(ossFileId)
        const { segments, normalizedText } = await segmentClauses(fullText)
        newDocxText = normalizedText
        newClauses = segments.map((s) => ({
            index: s.index,
            text: s.text,
            offsetStart: s.offsetStart,
            offsetEnd: s.offsetEnd,
        }))

        // 下载 docx Buffer 解析原生 Word 批注；解析失败不阻断主流程，降级为空批注列表
        try {
            const ossFile = await findOssFileByIdDao(ossFileId)
            if (ossFile?.filePath) {
                const docxBuffer = await downloadFileService(ossFile.filePath)
                newComments = await parseWordComments(docxBuffer)
            }
        } catch {
            newComments = []
        }

        yield { type: 'progress', data: { step: 'parse', status: 'done' } }
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : '解析失败'
        yield { type: 'error', data: { step: 'parse', code: 'PARSE_FAILED', message: msg } }
        return
    }

    // ============ Step 3: 识别正文差异 + 批注变更 ============
    const [dbAnnotations, dbRisks, currentVersion] = await Promise.all([
        prisma.contractAnnotations.findMany({ where: { reviewId: review.id, deletedAt: null } }),
        prisma.contractRisks.findMany({ where: { reviewId: review.id } }),
        review.currentVersionId
            ? prisma.contractReviewVersions.findUnique({
                where: { id: review.currentVersionId },
                select: { snapshotData: true },
            })
            : Promise.resolve(null),
    ])
    const oldClauses: ClauseSnapshotItem[] =
        ((currentVersion?.snapshotData as { clauses?: ClauseSnapshotItem[] } | null)?.clauses ?? [])

    // 建 annotationId → ParsedWordComment 映射（仅 LEXSEEK 格式）
    const annById = new Map(dbAnnotations.map((a) => [a.id, a]))
    const commentByAnnId = new Map<number, ParsedWordComment>()
    for (const c of newComments) {
        const ref = parseWordCommentRef(c.wInitials)
        if (ref && annById.has(ref.annotationId)) {
            commentByAnnId.set(ref.annotationId, c)
        }
    }

    // 客户删除：workspace annotation 在 newComments 里找不到命中
    const removedAnnIds: number[] = []
    for (const a of dbAnnotations) {
        if (!commentByAnnId.has(a.id)) removedAnnIds.push(a.id)
    }

    // 客户回复：父 comment 命中 LEXSEEK，子 comment 无 LEXSEEK 格式
    const replies: Array<{ parentAnnId: number; c: ParsedWordComment }> = []
    for (const c of newComments) {
        if (c.parentWId == null) continue
        const parent = newComments.find((p) => p.wId === c.parentWId)
        if (!parent) continue
        const parentRef = parseWordCommentRef(parent.wInitials)
        if (!parentRef) continue
        if (parseWordCommentRef(c.wInitials)) continue
        replies.push({ parentAnnId: parentRef.annotationId, c })
    }

    // 客户新增独立批注：no parent + non-LEXSEEK
    const newIndependent: ParsedWordComment[] = []
    for (const c of newComments) {
        if (c.parentWId != null) continue
        if (parseWordCommentRef(c.wInitials)) continue
        newIndependent.push(c)
    }

    const clauseDiffResult = diffClauses(oldClauses, newClauses)
    const externalChangeCount = removedAnnIds.length + replies.length + newIndependent.length
    const clauseModifiedCount = clauseDiffResult.modified.length

    yield {
        type: 'progress',
        data: { step: 'diff', status: 'done', externalChangeCount, clauseModifiedCount },
    }

    // ============ Step 4: AI 增量审查（B3 填充）============
    yield { type: 'progress', data: { step: 'ai', status: 'done' } }

    // ============ Step 5+6: 一次事务写入 + 保存快照 ============
    try {
        await prisma.$transaction(async (tx) => {
            // 标记客户删除的批注
            if (removedAnnIds.length > 0) {
                await tx.contractAnnotations.updateMany({
                    where: { id: { in: removedAnnIds } },
                    data: { removedByClient: true, suppressInExport: true },
                })
            }

            // 客户回复：升格为 external annotation
            for (const { parentAnnId, c } of replies) {
                const parent = annById.get(parentAnnId)!
                await tx.contractAnnotations.create({
                    data: {
                        reviewId: review.id,
                        riskId: parent.riskId,
                        parentAnnotationId: parentAnnId,
                        authorType: 'external',
                        authorName: c.wAuthor.replace(/^LS:/, '') || '客户',
                        content: c.content,
                    },
                })
            }

            // 客户新增独立批注 → external_new risk + external annotation
            for (const c of newIndependent) {
                const risk = await tx.contractRisks.create({
                    data: {
                        reviewId: review.id,
                        source: 'external_new',
                        level: 'medium',
                        stance: 'balanced',
                        category: '外部批注',
                        problem: c.content.slice(0, 100),
                        anchorQuote: c.content.slice(0, 50),
                        anchorParagraphIndex: 0,
                    },
                })
                await tx.contractAnnotations.create({
                    data: {
                        reviewId: review.id,
                        riskId: risk.id,
                        authorType: 'external',
                        authorName: c.wAuthor.replace(/^LS:/, '') || '客户',
                        content: c.content,
                    },
                })
            }

            // 锚点迁移：modified / removed / unchanged 三种情况
            for (const r of dbRisks) {
                if (r.anchorParagraphIndex == null) continue
                const isModified = clauseDiffResult.modified.some((m) => m.oldIndex === r.anchorParagraphIndex)
                const isRemoved = clauseDiffResult.removed.includes(r.anchorParagraphIndex)

                if (isModified || isRemoved) {
                    const result = migrateAnchor({
                        oldAnchorQuote: r.anchorQuote ?? '',
                        oldParagraphIndex: r.anchorParagraphIndex,
                        newClauses,
                    })
                    if (result) {
                        await tx.contractRisks.update({
                            where: { id: r.id },
                            data: {
                                anchorParagraphIndex: result.newClauseIndex,
                                anchorCharStart: result.newCharStart,
                                anchorCharEnd: result.newCharEnd,
                                anchorQuote: newClauses[result.newClauseIndex]!.text.slice(
                                    result.newCharStart,
                                    result.newCharEnd,
                                ),
                                ...(r.originalAnchorQuote ? {} : { originalAnchorQuote: r.anchorQuote }),
                            },
                        })
                    } else {
                        await tx.contractRisks.update({
                            where: { id: r.id },
                            data: {
                                orphaned: true,
                                ...(r.originalAnchorQuote ? {} : { originalAnchorQuote: r.anchorQuote }),
                            },
                        })
                    }
                } else {
                    // unchanged clause：位置可能变化，更新 anchorParagraphIndex
                    const mapping = clauseDiffResult.unchanged.find(
                        (u) => u.oldIndex === r.anchorParagraphIndex,
                    )
                    if (mapping && mapping.newIndex !== r.anchorParagraphIndex) {
                        await tx.contractRisks.update({
                            where: { id: r.id },
                            data: { anchorParagraphIndex: mapping.newIndex },
                        })
                    }
                }
            }
        })

        const summary = `本轮变化：${externalChangeCount} 处外部变更 · ${clauseModifiedCount} 处条款修改 · AI 已重审`
        const newVersion = await saveContractReviewVersionService({
            reviewId: review.id,
            systemLabel: 'client_return',
            docxFileId: ossFileId,
            createdById: userId,
            docxText: newDocxText,
            clauses: newClauses,
        })

        yield {
            type: 'progress',
            data: { step: 'merge', status: 'done', newVersionId: newVersion.id },
        }
        yield {
            type: 'complete',
            data: { newVersionId: newVersion.id, summary },
        }
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : '合并失败'
        yield { type: 'error', data: { step: 'merge', code: 'MERGE_FAILED', message: msg } }
    }
}

/**
 * 判断工作区相对 currentVersion 是否有未保存编辑。
 *
 * 判断依据（Phase A §4.3.1 自动备份幂等规则）：
 * - 取工作区最新 risk.updatedAt 和最新 annotation.updatedAt 中的较大值
 * - 若大于 currentVersion.createdAt，则认为有未保存编辑
 *
 * 注意：annotation 不过滤 deletedAt——软删（deletedAt 被设置）也属于律师"编辑"，
 * 应触发 auto_backup，避免丢失该编辑动作。
 *
 * 当 currentVersionId 为 null（尚未创建过快照）时，保守返回 false，
 * 不触发备份（此场景本就没有可备份的基线版本）。
 */
async function detectUnsavedEdits(
    reviewId: number,
    currentVersionId: number | null,
): Promise<boolean> {
    if (currentVersionId == null) return false

    const [latestRisk, latestAnn, currentVer] = await Promise.all([
        prisma.contractRisks.findFirst({
            where: { reviewId },
            orderBy: { updatedAt: 'desc' },
            select: { updatedAt: true },
        }),
        prisma.contractAnnotations.findFirst({
            where: { reviewId },
            orderBy: { updatedAt: 'desc' },
            select: { updatedAt: true },
        }),
        prisma.contractReviewVersions.findUnique({
            where: { id: currentVersionId },
            select: { createdAt: true },
        }),
    ])

    if (!currentVer) return false

    const latestEditMs = Math.max(
        latestRisk?.updatedAt?.getTime() ?? 0,
        latestAnn?.updatedAt?.getTime() ?? 0,
    )
    return latestEditMs > currentVer.createdAt.getTime()
}
