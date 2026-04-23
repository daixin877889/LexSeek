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
    try {
        // loadContractFullText 内部已处理 findOssFileByIdDao 不存在时抛错
        const { fullText } = await loadContractFullText(ossFileId)

        // segmentClauses 返回 normalizedText（\r\n→\n）与 segments 同空间
        const { segments, normalizedText } = await segmentClauses(fullText)
        newDocxText = normalizedText
        newClauses = segments.map((s) => ({
            index: s.index,
            text: s.text,
            offsetStart: s.offsetStart,
            offsetEnd: s.offsetEnd,
        }))

        // B2 填充：解析 comments.xml 原始批注（此处预留，不做实现）

        yield { type: 'progress', data: { step: 'parse', status: 'done' } }
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : '解析失败'
        yield { type: 'error', data: { step: 'parse', code: 'PARSE_FAILED', message: msg } }
        return
    }

    // ============ Step 3: 识别正文差异（B2 填充）============
    yield {
        type: 'progress',
        data: { step: 'diff', status: 'done', externalChangeCount: 0, clauseModifiedCount: 0 },
    }

    // ============ Step 4: AI 增量审查（B3 填充）============
    yield { type: 'progress', data: { step: 'ai', status: 'done' } }

    // ============ Step 5: 历史批注锚点迁移（B2 填充，无独立事件，归入 merge 前处理）============

    // ============ Step 6: 写工作区 + 新版本快照 ============
    try {
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
        // B2/B3 填充具体变更统计；B1 阶段 summary 固定描述
        yield {
            type: 'complete',
            data: { newVersionId: newVersion.id, summary: '新版本已就绪' },
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
