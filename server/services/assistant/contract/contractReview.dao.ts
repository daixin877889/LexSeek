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
import type {
    AdminReviewDetail,
    AdminReviewListItem,
    ContractOverview,
    ReviewListItem,
    Risk,
} from '#shared/types/contract'
import { computeCounts } from '#shared/utils/contractOverviewScore'

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
 * 软删除审查：把 deletedAt 置为 now，列表读接口自动过滤。
 * 不级联：相关 ossFiles / risks JSON 仍保留（便于超管排查）。
 */
export async function softDeleteContractReviewDAO(id: number): Promise<contractReviews> {
    return prisma.contractReviews.update({
        where: { id },
        data: { deletedAt: new Date(), updatedAt: new Date() },
    })
}

/**
 * PATCH /reviews/:id 的存储实现。
 *
 * 背景：Phase B 引入了 contract_risks 新表，但 PATCH 历史上只写 legacy
 * `contractReviews.risks` JSON 字段。GET /reviews/:id 对已迁移 review
 * （currentVersionId 非 null）**优先读新表**，导致用户编辑 risks 保存后
 * 刷新页面看到的是老数据——静默数据丢失。
 *
 * 这里做双写以修复该 bug：
 *   1. legacy JSON 始终写（GET fallback + rebuildDocxService 兼容）
 *   2. 已迁移 review 同步把新 risks 数组里**已存在的**行 update 到新表
 *      （按 risk.id 匹配，id 能 parseInt 且在本 review 的 contractRisks 里存在）
 *
 * **已知未覆盖**（TODO，P1+ 单独处理）：
 *   - 用户前端"新增自定义风险"时前端生成的 id 不是 Int，insert 需要额外逻辑
 *   - 用户前端"删除风险"时硬删 annotation 的外键级联风险；
 *     建议让前端删除走 PATCH /risks/:id 设 archivedStatus='ignored'，
 *     而非走 PATCH /reviews/:id 整数组替换
 *
 * 事务性：2 步写在 $transaction 里，一损俱损。
 */
export async function patchReviewRisksDAO(
    id: number,
    risks: Risk[],
): Promise<contractReviews> {
    return prisma.$transaction(async (tx) => {
        const updated = await tx.contractReviews.update({
            where: { id, deletedAt: null },
            data: {
                risks: risks as unknown as Prisma.InputJsonValue,
                hasUnsavedDocxChanges: true,
                updatedAt: new Date(),
            },
            select: {
                id: true,
                currentVersionId: true,
                userId: true,
                sessionId: true,
                status: true,
                risks: true,
                summary: true,
                contractType: true,
                partyA: true,
                partyB: true,
                stance: true,
                originalFileId: true,
                reviewedFileId: true,
                maxVersionNo: true,
                hasUnsavedDocxChanges: true,
                playbookSnapshot: true,
                createdAt: true,
                updatedAt: true,
                deletedAt: true,
                caseId: true,
            },
        }) as unknown as contractReviews

        // 已迁移 review 同步写新表；未迁移（currentVersionId=null）只写 legacy JSON
        if (updated.currentVersionId != null) {
            const riskIdsInBody = risks
                .map(r => {
                    const n = Number.parseInt(String(r.id ?? ''), 10)
                    return Number.isFinite(n) && n > 0 ? n : null
                })
                .filter((x): x is number => x !== null)

            if (riskIdsInBody.length > 0) {
                const existing = await tx.contractRisks.findMany({
                    where: { id: { in: riskIdsInBody }, reviewId: id },
                    select: { id: true },
                })
                const existingIds = new Set(existing.map(r => r.id))
                for (const r of risks) {
                    const numId = Number.parseInt(String(r.id ?? ''), 10)
                    if (!Number.isFinite(numId) || !existingIds.has(numId)) continue
                    await tx.contractRisks.update({
                        where: { id: numId },
                        data: {
                            level: r.level,
                            category: r.category,
                            problem: r.problem,
                            legalBasis: r.legalBasis ?? null,
                            analysis: r.analysis,
                            suggestion: r.suggestion,
                        },
                    })
                }
            }
        }

        return updated
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
 *
 * **加状态守卫**：只允许从 rebuilding 转为 completed。这样：
 *   - 如果并发场景下该 review 已被他人改成其它状态（如 'failed'），不会被
 *     本次写入强制翻回 'completed'
 *   - 如果有野代码路径（比如历史曾存在的 download → rebuild 旁路）绕过了
 *     atomicSetRebuildingDAO 占位直接调用本函数，update 会返回 count=0，
 *     抛出明确错误便于定位
 *
 * 用 updateMany + count 断言代替 update，拿到"未命中"信号。
 */
export async function setCompletedAfterRebuildDAO(
    id: number,
    reviewedFileId: number,
): Promise<void> {
    const result = await prisma.contractReviews.updateMany({
        where: { id, deletedAt: null, status: 'rebuilding' },
        data: {
            status: 'completed',
            reviewedFileId,
            hasUnsavedDocxChanges: false,
            updatedAt: new Date(),
        },
    })
    if (result.count !== 1) {
        throw new Error(
            `setCompletedAfterRebuildDAO: review ${id} 不在 rebuilding 状态或已被软删，`
            + `拒绝写入（可能被并发操作抢占，调用方需确认是否先调过 atomicSetRebuildingDAO）`,
        )
    }
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

/** 列表查询入参 */
export interface ListUserReviewsInput {
    userId: number
    skip: number
    take: number
    status?: string
    q?: string
    /** 可选：按 caseId 过滤；未传则不过滤（即返回所有归属状态的 review） */
    caseId?: number
}

const SUMMARY_TRUNCATE = 120
/** q 关键词命中 ossFiles 的上限：防止百万级同名命中被塞进 IN(...) */
const Q_FILE_MATCH_LIMIT = 1000

/**
 * 从 ContractOverview JSON 中提取摘要预览字符串。
 *
 * M6.1 Task 1.3 后 summary 字段存的是 { highlights, overall } JSON。
 * 列表场景仍希望看到一段纯文字预览，这里取 overall 截断；兼容历史脏数据
 * （若恰好是 string 形态则直接截断）。
 */
function extractSummaryPreview(raw: unknown, truncate: number): string | null {
    if (raw == null) return null
    if (typeof raw === 'string') return raw.slice(0, truncate)
    if (typeof raw === 'object' && 'overall' in raw) {
        const overall = (raw as { overall?: unknown }).overall
        if (typeof overall === 'string') return overall.slice(0, truncate)
    }
    return null
}

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
    if (params.caseId !== undefined) {
        where.caseId = params.caseId
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
            take: Q_FILE_MATCH_LIMIT,
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
            select: {
                id: true,
                sessionId: true,
                caseId: true,
                contractType: true,
                partyA: true,
                partyB: true,
                stance: true,
                status: true,
                summary: true,
                // risks 只用于派生 highRiskCount / mediumRiskCount / totalRiskCount，不向前端回传
                risks: true,
                originalFileId: true,
                hasUnsavedDocxChanges: true,
                createdAt: true,
                updatedAt: true,
            },
        }),
        prisma.contractReviews.count({ where }),
    ])

    // 批量取 fileName：一次 IN 查询，memory join
    const fileIds = Array.from(new Set(rows.map(r => r.originalFileId)))
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

    const items: ReviewListItem[] = rows.map((r) => {
        const risksArr = Array.isArray(r.risks) ? r.risks as Risk[] : []
        const counts = computeCounts(risksArr)
        return {
            id: r.id,
            sessionId: r.sessionId,
            caseId: r.caseId,
            contractType: r.contractType,
            partyA: r.partyA,
            partyB: r.partyB,
            stance: r.stance,
            status: r.status,
            summary: extractSummaryPreview(r.summary, SUMMARY_TRUNCATE),
            originalFileName: fileNameMap.get(r.originalFileId) ?? null,
            hasUnsavedDocxChanges: r.hasUnsavedDocxChanges,
            highRiskCount: counts.high,
            mediumRiskCount: counts.medium,
            totalRiskCount: risksArr.length,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
        }
    })

    return { items, total }
}

// ==================== 管理端（M6.1B）====================

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
            take: Q_FILE_MATCH_LIMIT,
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
            select: {
                id: true,
                sessionId: true,
                caseId: true,
                userId: true,
                contractType: true,
                partyA: true,
                partyB: true,
                stance: true,
                status: true,
                summary: true,
                risks: true,
                originalFileId: true,
                hasUnsavedDocxChanges: true,
                createdAt: true,
                updatedAt: true,
                deletedAt: true,
                user: { select: { phone: true, name: true } },
            },
        }),
        prisma.contractReviews.count({ where }),
    ])

    const fileIds = Array.from(new Set(rows.map(r => r.originalFileId)))
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

    const items: AdminReviewListItem[] = rows.map((r) => {
        const risksArr = Array.isArray(r.risks) ? r.risks as Risk[] : []
        const counts = computeCounts(risksArr)
        return {
            id: r.id,
            sessionId: r.sessionId,
            caseId: r.caseId,
            contractType: r.contractType,
            partyA: r.partyA,
            partyB: r.partyB,
            stance: r.stance,
            status: r.status,
            summary: extractSummaryPreview(r.summary, SUMMARY_TRUNCATE),
            originalFileName: fileNameMap.get(r.originalFileId) ?? null,
            hasUnsavedDocxChanges: r.hasUnsavedDocxChanges,
            highRiskCount: counts.high,
            mediumRiskCount: counts.medium,
            totalRiskCount: risksArr.length,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
            userId: r.userId,
            userPhone: r.user?.phone ?? null,
            userNickname: r.user?.name ?? null,
            deletedAt: r.deletedAt,
        }
    })

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
        // M6.1 Task 1.3：DB 字段已是 Json，管理端详情返回结构化 ContractOverview
        summary: row.summary as ContractOverview | null,
        risks: row.risks,
        hasUnsavedDocxChanges: row.hasUnsavedDocxChanges,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        deletedAt: row.deletedAt,
    }
}

/**
 * 查找 status=reviewing 且 updatedAt 早于阈值的僵死审查。
 * bug #14：进程崩溃 / SSE 异常断开会把 review 永久卡在 reviewing，
 * 此函数配合 cron 兜底，只返回 id 列表供 updateMany 使用。
 */
export async function findReviewingTimeoutDAO(thresholdMs: number): Promise<number[]> {
    const cutoff = new Date(Date.now() - thresholdMs)
    const rows = await prisma.contractReviews.findMany({
        where: {
            status: 'reviewing',
            updatedAt: { lt: cutoff },
            deletedAt: null,
        },
        select: { id: true },
    })
    return rows.map((r) => r.id)
}

/**
 * 管理端软删：
 * - 不存在 → not_found
 * - 已软删 → already_deleted（幂等）
 * - 否则写入 deletedAt → deleted
 *
 * 优先走 updateMany 原子写入（只更新 deletedAt=null 的行），count=1 表示本次写入成功；
 * count=0 时再做一次 findFirst 区分 not_found / already_deleted。
 * 单语句原子性避开 TOCTOU，也省掉 happy path 的第二次查询。
 */
export async function softDeleteAdminReviewDAO(
    id: number,
): Promise<{ status: 'not_found' } | { status: 'already_deleted' } | { status: 'deleted' }> {
    const now = new Date()
    const result = await prisma.contractReviews.updateMany({
        where: { id, deletedAt: null },
        data: { deletedAt: now, updatedAt: now },
    })
    if (result.count === 1) return { status: 'deleted' }

    const exists = await prisma.contractReviews.findFirst({
        where: { id },
        select: { id: true },
    })
    return exists ? { status: 'already_deleted' } : { status: 'not_found' }
}
