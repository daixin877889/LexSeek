/**
 * DocumentDraft DAO
 *
 * 操作 document_drafts 表。
 * 所有查询默认过滤 deletedAt=null。
 * 方法命名规范：后缀大写 DAO（与 assistant 域约定一致）。
 *
 * 参见 spec §3.10 - 文书草稿 DAO
 */

import type { Prisma } from '#shared/types/prisma'

// ==================== 类型定义 ====================

/** 创建草稿输入 */
export interface CreateDocumentDraftInput {
    userId: number
    templateId: number
    sessionId: string
    status: string
    values: Record<string, unknown>
    sourceRef: Record<string, unknown> | null
    metadata: Record<string, unknown> | null
    caseId: number | null
}

/** 列表查询过滤参数 */
export interface ListDocumentDraftsInput {
    userId: number
    caseId?: number
    skip: number
    take: number
}

// ==================== DAO 方法 ====================

/**
 * 创建文书草稿记录。
 * @param input 草稿输入数据
 * @param tx 可选事务客户端
 */
export async function createDocumentDraftDAO(
    input: CreateDocumentDraftInput,
    tx?: Prisma.TransactionClient,
) {
    const db = tx ?? prisma
    return db.documentDrafts.create({
        data: {
            userId: input.userId,
            templateId: input.templateId,
            sessionId: input.sessionId,
            status: input.status,
            values: input.values as any,
            sourceRef: input.sourceRef as any,
            metadata: input.metadata as any,
            caseId: input.caseId,
        },
    })
}

/**
 * 按 id 查询单条草稿（deletedAt=null）。
 * 不存在或已软删返回 null。
 * @param id 草稿 ID
 * @param tx 可选事务客户端
 */
export async function getDocumentDraftDAO(id: number, tx?: Prisma.TransactionClient) {
    const db = tx ?? prisma
    return db.documentDrafts.findFirst({
        where: {
            id,
            deletedAt: null,
        },
    })
}

/**
 * 按 sessionId 查询草稿（唯一索引，deletedAt=null）。
 * @param sessionId 会话 ID
 * @param tx 可选事务客户端
 */
export async function findDraftBySessionIdDAO(sessionId: string, tx?: Prisma.TransactionClient) {
    const db = tx ?? prisma
    return db.documentDrafts.findFirst({
        where: {
            sessionId,
            deletedAt: null,
        },
    })
}

/**
 * 按 id 更新草稿字段（partial update）。
 * 返回更新后的记录。
 * @param id 草稿 ID
 * @param data 要更新的字段
 * @param tx 可选事务客户端
 */
export async function updateDocumentDraftDAO(
    id: number,
    data: Prisma.documentDraftsUpdateInput,
    tx?: Prisma.TransactionClient,
) {
    const db = tx ?? prisma
    return db.documentDrafts.update({
        where: { id },
        data: {
            ...data,
            updatedAt: new Date(),
        },
    })
}

/**
 * 查询草稿列表（支持 userId/caseId/分页）。
 * 默认过滤 deletedAt=null，按 createdAt desc 排序。
 * @param filters 查询过滤参数
 * @param tx 可选事务客户端
 */
export async function listDocumentDraftsDAO(
    filters: ListDocumentDraftsInput,
    tx?: Prisma.TransactionClient,
) {
    const db = tx ?? prisma
    const where: Prisma.documentDraftsWhereInput = {
        userId: filters.userId,
        deletedAt: null,
    }

    if (filters.caseId !== undefined) {
        where.caseId = filters.caseId
    }

    const [list, total] = await Promise.all([
        db.documentDrafts.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip: filters.skip,
            take: filters.take,
        }),
        db.documentDrafts.count({ where }),
    ])

    return { list, total }
}

/**
 * 软删除草稿：设置 deletedAt=now。
 * 归属校验由 Service 层负责；DAO 层只负责按 id 打标。
 * @param id 草稿 ID
 * @param tx 可选事务客户端
 */
export async function softDeleteDocumentDraftDAO(id: number, tx?: Prisma.TransactionClient) {
    const db = tx ?? prisma
    return db.documentDrafts.update({
        where: { id },
        data: { deletedAt: new Date() },
    })
}
