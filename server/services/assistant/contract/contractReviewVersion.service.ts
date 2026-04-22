/**
 * ContractReviewVersion Service
 *
 * 核心：saveContractReviewVersionService 用 prisma.$transaction 原子递增 maxVersionNo
 * + dump snapshot + 更新 currentVersionId，确保并发安全。
 *
 * **Feature: contract-review-versioning-phase-a**
 */
import type { Prisma } from '~~/generated/prisma/client'
import type {
    VersionSystemLabel,
    ContractReviewVersionSnapshotResponse,
    ContractRiskEntity,
    ContractAnnotationEntity,
    ClauseSnapshotItem,
} from '#shared/types/contract'
import { getContractReviewVersionByIdDAO } from './contractReviewVersion.dao'

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
