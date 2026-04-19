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

// ==================== 用户端列表（M6.1A Task 4）====================

/** 列表项字段白名单（不含 userId / deletedAt） */
export type ReviewListItem = {
    id: number
    sessionId: string
    contractType: string | null
    partyA: string | null
    partyB: string | null
    stance: string | null
    status: string
    summary: string | null
    originalFileName: string | null
    hasUnsavedDocxChanges: boolean
    createdAt: Date
    updatedAt: Date
}

/** 列表查询入参 */
export interface ListUserReviewsInput {
    userId: number
    skip: number
    take: number
    status?: string
    q?: string
}

const SUMMARY_TRUNCATE = 120

/**
 * 查询当前用户的合同审查列表。
 *
 * - owner-only：where.userId = params.userId；deletedAt: null 过滤软删
 * - status：精确匹配 contract_reviews.status
 * - q：模糊匹配关联 oss_files.file_name（case-insensitive）
 *   contractReviews 未在 prisma 里建 originalFile 关系字段，因此分两步查询：
 *   先 ossFiles.findMany 拿命中的 id 集合，再以 originalFileId IN (...) 过滤 reviews
 * - summary 截断到前 120 字符
 */
export async function listUserReviewsDAO(
    params: ListUserReviewsInput,
): Promise<{ items: ReviewListItem[]; total: number }> {
    const where: Prisma.contractReviewsWhereInput = {
        userId: params.userId,
        deletedAt: null,
    }
    if (params.status) {
        where.status = params.status
    }

    // q：先查 ossFiles 命中的 id 集合（限定到当前用户名下的文件）
    if (params.q) {
        const fileRows = await prisma.ossFiles.findMany({
            where: {
                userId: params.userId,
                deletedAt: null,
                fileName: { contains: params.q, mode: 'insensitive' },
            },
            select: { id: true },
        })
        const fileIds = fileRows.map(f => f.id)
        if (fileIds.length === 0) {
            return { items: [], total: 0 }
        }
        where.originalFileId = { in: fileIds }
    }

    const [rows, total] = await Promise.all([
        prisma.contractReviews.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip: params.skip,
            take: params.take,
        }),
        prisma.contractReviews.count({ where }),
    ])

    // 批量取 fileName：一次 IN 查询，memory join
    const fileIds = Array.from(new Set(rows.map(r => r.originalFileId))).filter(id => id > 0)
    const fileNameMap = new Map<number, string>()
    if (fileIds.length > 0) {
        const files = await prisma.ossFiles.findMany({
            where: { id: { in: fileIds } },
            select: { id: true, fileName: true },
        })
        for (const f of files) {
            fileNameMap.set(f.id, f.fileName)
        }
    }

    const items: ReviewListItem[] = rows.map(r => ({
        id: r.id,
        sessionId: r.sessionId,
        contractType: r.contractType,
        partyA: r.partyA,
        partyB: r.partyB,
        stance: r.stance,
        status: r.status,
        summary: r.summary ? r.summary.slice(0, SUMMARY_TRUNCATE) : null,
        originalFileName: fileNameMap.get(r.originalFileId) ?? null,
        hasUnsavedDocxChanges: r.hasUnsavedDocxChanges,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
    }))

    return { items, total }
}

// ==================== 管理端（M6.1B）====================

/**
 * 管理端列表项：在用户端 ReviewListItem 基础上额外暴露用户归属与软删时间。
 * `userNickname` 取自 users.name（schema 中用户昵称/姓名的实际字段）。
 */
export type AdminReviewListItem = ReviewListItem & {
    userId: number
    userPhone: string | null
    userNickname: string | null
    deletedAt: Date | null
}

/** 管理端详情：summary 完整、risks 原样 JSON 返回，不截断、不解析。 */
export type AdminReviewDetail = {
    id: number
    sessionId: string
    userId: number
    userPhone: string | null
    userNickname: string | null
    originalFileId: number
    originalFileName: string | null
    reviewedFileId: number | null
    reviewedFileName: string | null
    contractType: string | null
    partyA: string | null
    partyB: string | null
    stance: string | null
    status: string
    summary: string | null
    risks: unknown
    hasUnsavedDocxChanges: boolean
    createdAt: Date
    updatedAt: Date
    deletedAt: Date | null
}

export interface ListAdminReviewsInput {
    skip: number
    take: number
    status?: string
    q?: string
    userId?: number
    includeDeleted?: boolean
}

/**
 * 管理端列表。与 listUserReviewsDAO 同构，差异：
 * - 无 owner 过滤；可选 userId filter
 * - includeDeleted=false（默认）仍过滤 deletedAt IS NULL
 * - q 跨用户模糊匹配 ossFiles.fileName，不限制 ossFiles.userId
 * - 附带 user.phone / user.name（作为 userNickname）
 */
export async function listAdminReviewsDAO(
    params: ListAdminReviewsInput,
): Promise<{ items: AdminReviewListItem[]; total: number }> {
    const where: Prisma.contractReviewsWhereInput = {}
    if (!params.includeDeleted) {
        where.deletedAt = null
    }
    if (params.status) {
        where.status = params.status
    }
    if (params.userId !== undefined) {
        where.userId = params.userId
    }

    if (params.q) {
        const fileRows = await prisma.ossFiles.findMany({
            where: {
                deletedAt: null,
                fileName: { contains: params.q, mode: 'insensitive' },
            },
            select: { id: true },
        })
        const fileIds = fileRows.map(f => f.id)
        if (fileIds.length === 0) {
            return { items: [], total: 0 }
        }
        where.originalFileId = { in: fileIds }
    }

    const [rows, total] = await Promise.all([
        prisma.contractReviews.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip: params.skip,
            take: params.take,
            include: {
                user: { select: { id: true, phone: true, name: true } },
            },
        }),
        prisma.contractReviews.count({ where }),
    ])

    const fileIds = Array.from(new Set(rows.map(r => r.originalFileId))).filter(id => id > 0)
    const fileNameMap = new Map<number, string>()
    if (fileIds.length > 0) {
        const files = await prisma.ossFiles.findMany({
            where: { id: { in: fileIds } },
            select: { id: true, fileName: true },
        })
        for (const f of files) {
            fileNameMap.set(f.id, f.fileName)
        }
    }

    const items: AdminReviewListItem[] = rows.map(r => ({
        id: r.id,
        sessionId: r.sessionId,
        contractType: r.contractType,
        partyA: r.partyA,
        partyB: r.partyB,
        stance: r.stance,
        status: r.status,
        summary: r.summary ? r.summary.slice(0, SUMMARY_TRUNCATE) : null,
        originalFileName: fileNameMap.get(r.originalFileId) ?? null,
        hasUnsavedDocxChanges: r.hasUnsavedDocxChanges,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        userId: r.userId,
        userPhone: r.user?.phone ?? null,
        userNickname: r.user?.name ?? null,
        deletedAt: r.deletedAt,
    }))

    return { items, total }
}

/**
 * 管理端详情：可查已软删记录；summary 不截断、risks 原样返回。
 * 分两步查 ossFiles 取 originalFileName / reviewedFileName。
 */
export async function getAdminReviewDAO(id: number): Promise<AdminReviewDetail | null> {
    const row = await prisma.contractReviews.findFirst({
        where: { id },
        include: {
            user: { select: { id: true, phone: true, name: true } },
        },
    })
    if (!row) return null

    const fileIdsToLookup: number[] = [row.originalFileId]
    if (row.reviewedFileId) fileIdsToLookup.push(row.reviewedFileId)

    const files = await prisma.ossFiles.findMany({
        where: { id: { in: fileIdsToLookup } },
        select: { id: true, fileName: true },
    })
    const fileNameMap = new Map<number, string>()
    for (const f of files) fileNameMap.set(f.id, f.fileName)

    return {
        id: row.id,
        sessionId: row.sessionId,
        userId: row.userId,
        userPhone: row.user?.phone ?? null,
        userNickname: row.user?.name ?? null,
        originalFileId: row.originalFileId,
        originalFileName: fileNameMap.get(row.originalFileId) ?? null,
        reviewedFileId: row.reviewedFileId,
        reviewedFileName: row.reviewedFileId
            ? fileNameMap.get(row.reviewedFileId) ?? null
            : null,
        contractType: row.contractType,
        partyA: row.partyA,
        partyB: row.partyB,
        stance: row.stance,
        status: row.status,
        summary: row.summary,
        risks: row.risks,
        hasUnsavedDocxChanges: row.hasUnsavedDocxChanges,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        deletedAt: row.deletedAt,
    }
}

/**
 * 管理端软删：
 * - 不存在 → not_found
 * - 已软删 → already_deleted（幂等）
 * - 否则写入 deletedAt → deleted
 */
export async function softDeleteAdminReviewDAO(
    id: number,
): Promise<{ status: 'not_found' } | { status: 'already_deleted' } | { status: 'deleted' }> {
    const row = await prisma.contractReviews.findFirst({
        where: { id },
        select: { id: true, deletedAt: true },
    })
    if (!row) return { status: 'not_found' }
    if (row.deletedAt) return { status: 'already_deleted' }
    await prisma.contractReviews.update({
        where: { id },
        data: { deletedAt: new Date(), updatedAt: new Date() },
    })
    return { status: 'deleted' }
}
