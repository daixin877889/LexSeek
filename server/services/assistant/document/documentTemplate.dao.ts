/**
 * DocumentTemplate DAO
 *
 * 操作 document_templates 表。
 * 所有查询默认过滤 deletedAt=null。
 * 方法命名规范：后缀大写 DAO（与 assistant 域约定一致）。
 *
 * 参见 spec §2.1 - 文书模板 DAO
 */

import type { Prisma } from '#shared/types/prisma'

// ==================== 类型定义 ====================

/** 创建模板输入 */
export interface CreateDocumentTemplateInput {
    name: string
    category: string
    scope: 'global' | 'user'
    userId: number | null
    ossFileId: number
    placeholders: Array<{ name: string; firstContext?: string }>
    description?: string
    priority?: number
}

/** 更新模板输入（partial） */
export interface UpdateDocumentTemplateInput {
    name?: string
    category?: string
    description?: string | null
    status?: number
    priority?: number
}

/** 列表查询过滤参数 */
export interface ListDocumentTemplatesInput {
    scope?: 'global' | 'user'
    category?: string
    /** name ILIKE 模糊搜索 */
    q?: string
    skip: number
    take: number
}

// ==================== DAO 方法 ====================

/**
 * 创建文书模板。
 * @param tx 可选事务客户端，由 Service 层在 $transaction 内传入
 */
export async function createDocumentTemplateDAO(
    input: CreateDocumentTemplateInput,
    tx?: Prisma.TransactionClient,
) {
    const db = tx ?? prisma
    return db.documentTemplates.create({
        data: {
            name: input.name,
            category: input.category,
            scope: input.scope,
            userId: input.userId,
            ossFileId: input.ossFileId,
            placeholders: input.placeholders as any,
            description: input.description ?? null,
            priority: input.priority ?? 100,
        },
    })
}

/**
 * 按 id 查询单条模板（deletedAt=null）。
 * 不存在或已软删返回 null。
 */
export async function getDocumentTemplateDAO(id: number) {
    return prisma.documentTemplates.findFirst({
        where: {
            id,
            deletedAt: null,
        },
    })
}

/**
 * 查询模板列表（支持 scope/category/q/分页）。
 * 默认过滤 deletedAt=null，按 priority asc, createdAt desc 排序。
 */
export async function listDocumentTemplatesDAO(input: ListDocumentTemplatesInput) {
    const where: Prisma.documentTemplatesWhereInput = { deletedAt: null }

    if (input.scope) where.scope = input.scope
    if (input.category) where.category = input.category
    if (input.q) where.name = { contains: input.q, mode: 'insensitive' }

    const [list, total] = await Promise.all([
        prisma.documentTemplates.findMany({
            where,
            orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
            skip: input.skip,
            take: input.take,
        }),
        prisma.documentTemplates.count({ where }),
    ])

    return { list, total }
}

/**
 * 按 id 更新模板字段（partial update）。
 * 返回更新后的记录。
 */
export async function updateDocumentTemplateDAO(id: number, input: UpdateDocumentTemplateInput) {
    return prisma.documentTemplates.update({
        where: { id },
        data: {
            ...(input.name !== undefined && { name: input.name }),
            ...(input.category !== undefined && { category: input.category }),
            ...(input.description !== undefined && { description: input.description }),
            ...(input.status !== undefined && { status: input.status }),
            ...(input.priority !== undefined && { priority: input.priority }),
            updatedAt: new Date(),
        },
    })
}

/**
 * 软删模板（设置 deletedAt）。
 * 已软删的模板再次调用不报错（幂等）。
 */
export async function softDeleteDocumentTemplateDAO(id: number): Promise<void> {
    await prisma.documentTemplates.update({
        where: { id },
        data: { deletedAt: new Date() },
    })
}

/**
 * 统计特定用户的个人模板数量（scope='user', deletedAt=null）。
 * 用于配额校验（Task 2.2）。
 * @param tx 可选事务客户端，由 Service 层在 $transaction 内传入
 */
export async function countUserTemplatesDAO(userId: number, tx?: Prisma.TransactionClient): Promise<number> {
    const db = tx ?? prisma
    return db.documentTemplates.count({
        where: {
            scope: 'user',
            userId,
            deletedAt: null,
        },
    })
}
