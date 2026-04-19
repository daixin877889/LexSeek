/**
 * 合同审查 DAO 层
 *
 * 仅暴露 M3 需要的 CRUD 子集（create / get / findBySessionId / update）。
 * 所有读接口默认过滤 deletedAt IS NULL；如需含软删行请走 prisma 直连。
 *
 * **Feature: contract-review-m3**
 */
import { prisma } from '~~/server/utils/db'
import type { contractReviews, Prisma } from '~~/generated/prisma/client'
import type { Risk } from '#shared/types/contract'

type CreateInput = Omit<Prisma.contractReviewsUncheckedCreateInput, 'id' | 'createdAt' | 'updatedAt'>
type UpdateInput = Prisma.contractReviewsUncheckedUpdateInput

export async function createContractReviewDAO(data: CreateInput): Promise<contractReviews> {
    return prisma.contractReviews.create({ data })
}

export async function getContractReviewDAO(id: number): Promise<contractReviews | null> {
    return prisma.contractReviews.findFirst({
        where: { id, deletedAt: null },
    })
}

export async function findContractReviewBySessionIdDAO(sessionId: string): Promise<contractReviews | null> {
    return prisma.contractReviews.findFirst({
        where: { sessionId, deletedAt: null },
    })
}

export async function updateContractReviewDAO(
    id: number,
    data: UpdateInput,
): Promise<contractReviews> {
    return prisma.contractReviews.update({
        where: { id },
        data: { ...data, updatedAt: new Date() },
    })
}

/**
 * 全量替换 risks 字段（仅 PATCH /reviews/:id 端点调用，status 校验在 handler 层）。
 * where 带 deletedAt: null 守护软删竞态。
 */
export async function patchReviewRisksDAO(
    id: number,
    risks: Risk[],
): Promise<contractReviews> {
    return prisma.contractReviews.update({
        where: { id, deletedAt: null },
        data: { risks: risks as unknown as Prisma.InputJsonValue, updatedAt: new Date() },
    })
}

/**
 * 原子把 status 从 completed 置为 rebuilding（拿占位锁）。
 *
 * 依赖 PostgreSQL 单语句 UPDATE 的行级锁原子性：
 * `UPDATE ... SET status='rebuilding' WHERE id=? AND status='completed' AND deleted_at IS NULL`
 * 多 worker 并发时，只有一条返回 count=1；其余 count=0。
 *
 * 返回 true 仅当本次调用成功占位。
 */
export async function atomicSetRebuildingDAO(id: number): Promise<boolean> {
    const result = await prisma.contractReviews.updateMany({
        where: { id, deletedAt: null, status: 'completed' },
        data: { status: 'rebuilding', updatedAt: new Date() },
    })
    return result.count === 1
}

/**
 * 重生完成：把 status 回到 completed 并覆盖 reviewedFileId。
 * where 带 deletedAt: null 守护软删竞态。
 * 不校验入参 status（调用方负责只在 rebuilding 时调）。
 */
export async function setCompletedAfterRebuildDAO(
    id: number,
    reviewedFileId: number,
): Promise<contractReviews> {
    return prisma.contractReviews.update({
        where: { id, deletedAt: null },
        data: {
            status: 'completed',
            reviewedFileId,
            hasUnsavedDocxChanges: false,
            updatedAt: new Date(),
        },
    })
}

/**
 * 标记 session 的 risks 已编辑但未回写 docx。
 * PATCH /reviews/:id（risks 分支）成功后调用。
 */
export async function setHasUnsavedTrueDAO(reviewId: number): Promise<void> {
    await prisma.contractReviews.update({
        where: { id: reviewId },
        data: { hasUnsavedDocxChanges: true, updatedAt: new Date() },
    })
}

/**
 * 清除 session 的脏位标记。
 * rebuild-docx 成功路径通过 setCompletedAfterRebuildDAO 已原地清零，此方法保留给手动清除 / 回滚等场景。
 */
export async function setHasUnsavedFalseDAO(reviewId: number): Promise<void> {
    await prisma.contractReviews.update({
        where: { id: reviewId },
        data: { hasUnsavedDocxChanges: false, updatedAt: new Date() },
    })
}

/**
 * 重生失败回滚：把 status 从 rebuilding 回滚到 completed（保留旧 reviewedFileId）。
 * 幂等：非 rebuilding 状态下调用 count=0，不做任何修改。
 */
export async function rollbackRebuildDAO(id: number): Promise<void> {
    await prisma.contractReviews.updateMany({
        where: { id, status: 'rebuilding' },
        data: { status: 'completed', updatedAt: new Date() },
    })
}
