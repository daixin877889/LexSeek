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
 * CORE-H1：body 里 id 在 DB 中查无，PATCH 拒绝整数组替换。
 * handler 据此区分 400。
 */
export class PatchReviewRisksUnknownIdsError extends Error {
    constructor(public readonly unknownIds: string[]) {
        super(`PATCH /reviews body 含未知 risk id：${unknownIds.join(', ')}（请用 POST 子接口新增、PATCH /risks/:id 软处置）`)
        this.name = 'PatchReviewRisksUnknownIdsError'
    }
}

/**
 * PATCH /reviews/:id 的存储实现（CORE-H1 修复后）。
 *
 * 背景：Phase B 引入 contract_risks 新表，PATCH 旧实现只写 legacy
 * `contractReviews.risks` JSON。已迁移 review GET 优先读新表 →
 * "前端整数组 PATCH 后刷新看到旧数据"静默丢失。
 *
 * 三向 diff 行为（已迁移 review，currentVersionId != null）：
 *   - keep（body 里 id 在 DB）：update 全字段（level/category/problem/...）
 *   - new（body 里 id 解析失败 / 不在 DB）：直接抛 PatchReviewRisksUnknownIdsError
 *     让 handler 转 400 提示前端"新增请走 POST /risks，不要混在整数组里"
 *   - removed（DB 里有 id 但 body 漏了）：把 archivedStatus 置为 'ignored'
 *     （决策 11 铁律：批注永不物理删；删 risk 等于软处置）
 *
 * 未迁移 review（currentVersionId == null）：legacy JSON 单写，不走三向 diff，
 * 兼容 Phase A 数据。
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

        // 未迁移 review：只写 legacy JSON，不走三向 diff（Phase A 数据兼容）
        if (updated.currentVersionId == null) return updated

        // 已迁移：先收集 DB 现有 risks（含已处置），用于 diff
        const dbRisks = await tx.contractRisks.findMany({
            where: { reviewId: id },
            select: { id: true, archivedStatus: true },
        })
        const dbActiveIdSet = new Set(
            dbRisks.filter(r => r.archivedStatus === null).map(r => r.id),
        )
        const dbAllIdSet = new Set(dbRisks.map(r => r.id))

        // 解析 body 里每条 risk 的 id：
        //   - 解析为正整数且属于本 review → keep
        //   - 否则 → unknown（new / 非法 id）
        const bodyKeepIds = new Set<number>()
        const unknownIds: string[] = []
        for (const r of risks) {
            const numId = Number.parseInt(String(r.id ?? ''), 10)
            if (Number.isFinite(numId) && numId > 0 && dbAllIdSet.has(numId)) {
                bodyKeepIds.add(numId)
            } else {
                unknownIds.push(String(r.id ?? '<empty>'))
            }
        }
        if (unknownIds.length > 0) {
            throw new PatchReviewRisksUnknownIdsError(unknownIds)
        }

        // keep：update 全字段
        for (const r of risks) {
            const numId = Number.parseInt(String(r.id ?? ''), 10)
            if (!bodyKeepIds.has(numId)) continue
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

        // removed：DB 里有未处置 risk 但 body 漏了 → archivedStatus='ignored' 软处置
        // （未处置且 body 没传 = 用户删除意图。已 archived 的不回滚）
        const removedIds: number[] = []
        for (const dbId of dbActiveIdSet) {
            if (!bodyKeepIds.has(dbId)) removedIds.push(dbId)
        }
        if (removedIds.length > 0) {
            await tx.contractRisks.updateMany({
                where: { id: { in: removedIds }, reviewId: id, archivedStatus: null },
                data: { archivedStatus: 'ignored', archivedAt: new Date() },
            })
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
 * 批量按 originalFileId 查 ossFiles.fileName，返回 id → name Map。
 *
 * 用户列表 / 管理列表 / 详情等多处都要这一步；抽出来避免重复
 * 写"去重 → IN 查询 → for-loop 灌 Map"样板。
 */
async function loadFileNameMap(
    originalFileIds: number[],
): Promise<Map<number, string>> {
    const map = new Map<number, string>()
    const fileIds = Array.from(new Set(originalFileIds))
    if (fileIds.length === 0) return map
    const files = await prisma.ossFiles.findMany({
        where: { id: { in: fileIds } },
        select: { id: true, fileName: true },
    })
    for (const f of files) map.set(f.id, f.fileName)
    return map
}

/**
 * 用户列表与管理列表共有的 ListItem 字段构造（17 字段）。
 *
 * 管理列表在此基础上叠加 userId / userPhone / userNickname / deletedAt，由调用方 spread。
 */
interface BaseReviewRow {
    id: number
    sessionId: string
    caseId: number | null
    contractType: string | null
    partyA: string | null
    partyB: string | null
    stance: string
    status: string
    summary: unknown
    risks: unknown
    originalFileId: number
    hasUnsavedDocxChanges: boolean
    createdAt: Date
    updatedAt: Date
}

function buildBaseReviewListItem(row: BaseReviewRow, fileName: string | null) {
    const risksArr = Array.isArray(row.risks) ? row.risks as Risk[] : []
    const counts = computeCounts(risksArr)
    return {
        id: row.id,
        sessionId: row.sessionId,
        caseId: row.caseId,
        contractType: row.contractType,
        partyA: row.partyA,
        partyB: row.partyB,
        stance: row.stance,
        status: row.status,
        summary: extractSummaryPreview(row.summary, SUMMARY_TRUNCATE),
        originalFileName: fileName,
        hasUnsavedDocxChanges: row.hasUnsavedDocxChanges,
        highRiskCount: counts.high,
        mediumRiskCount: counts.medium,
        totalRiskCount: risksArr.length,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
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

    const fileNameMap = await loadFileNameMap(rows.map(r => r.originalFileId))

    const items: ReviewListItem[] = rows.map(r =>
        buildBaseReviewListItem(r, fileNameMap.get(r.originalFileId) ?? null),
    )

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

    const fileNameMap = await loadFileNameMap(rows.map(r => r.originalFileId))

    const items: AdminReviewListItem[] = rows.map(r => ({
        ...buildBaseReviewListItem(r, fileNameMap.get(r.originalFileId) ?? null),
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
 *
 * CORE-H3 留档：本仓库目前没有 server/tasks 调度框架接入这个 DAO（grep 全仓
 * 仅 dao 自身和测试引用），属于孤儿。短期保留以便接入 cron 时复用；如果到 M8
 * 仍未接入，应考虑删除以避免误用。
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
