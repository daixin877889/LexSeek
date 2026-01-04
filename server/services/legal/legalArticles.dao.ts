/**
 * 法律条文数据访问层
 *
 * 提供法律条文的 CRUD 操作和按法律 ID 查询
 */

import type { Prisma } from '#shared/types/prisma'
import { sortArticlesByHierarchy } from './articleSorting.service'

// 定义 Prisma 客户端类型（支持事务）
type PrismaClient = typeof prisma

/** 法律条文列表查询选项 */
interface LegalArticlesListOptions {
    legalId: string
    page?: number
    pageSize?: number
    /** 条文类型筛选 */
    type?: string
    /** 关键词搜索 */
    keyword?: string
    /** L1 标题筛选 */
    l1?: string
    /** L2 标题筛选 */
    l2?: string
    /** L3 标题筛选 */
    l3?: string
    /** L4 标题筛选 */
    l4?: string
    /** L5 标题筛选 */
    l5?: string
}

/**
 * 创建法律条文
 * @param data 法律条文创建数据
 * @param tx 事务客户端（可选）
 * @returns 创建的法律条文
 */
export const createLegalArticleDao = async (
    data: Prisma.legalArticlesCreateInput,
    tx?: PrismaClient
) => {
    try {
        const article = await (tx || prisma).legalArticles.create({
            data: {
                ...data,
                createdAt: new Date(),
                updatedAt: new Date(),
                lastEditedAt: new Date(),
            },
        })
        return article
    } catch (error) {
        logger.error('创建法律条文失败：', error)
        throw error
    }
}

/**
 * 批量创建法律条文
 * @param data 法律条文创建数据数组
 * @param tx 事务客户端（可选）
 * @returns 创建的条文数量
 */
export const createManyLegalArticlesDao = async (
    data: Prisma.legalArticlesCreateManyInput[],
    tx?: PrismaClient
) => {
    try {
        const now = new Date()
        const result = await (tx || prisma).legalArticles.createMany({
            data: data.map(item => ({
                ...item,
                createdAt: now,
                updatedAt: now,
                lastEditedAt: now,
            })),
        })
        return result.count
    } catch (error) {
        logger.error('批量创建法律条文失败：', error)
        throw error
    }
}

/**
 * 通过 ID 查询法律条文
 * @param id 法律条文 ID
 * @param tx 事务客户端（可选）
 * @returns 法律条文或 null
 */
export const findLegalArticleByIdDao = async (
    id: string,
    tx?: PrismaClient
) => {
    try {
        const article = await (tx || prisma).legalArticles.findUnique({
            where: { id, deletedAt: null },
        })
        return article
    } catch (error) {
        logger.error('通过 ID 查询法律条文失败：', error)
        throw error
    }
}

/**
 * 通过 ID 查询法律条文（含法律法规信息）
 * @param id 法律条文 ID
 * @param tx 事务客户端（可选）
 * @returns 法律条文（含法律法规）或 null
 */
export const findLegalArticleWithLegalByIdDao = async (
    id: string,
    tx?: PrismaClient
) => {
    try {
        const article = await (tx || prisma).legalArticles.findUnique({
            where: { id, deletedAt: null },
            include: {
                legalMain: true,
            },
        })
        return article
    } catch (error) {
        logger.error('通过 ID 查询法律条文（含法律法规）失败：', error)
        throw error
    }
}

/**
 * 查询法律条文列表（按法律 ID）
 * @param options 查询选项
 * @param tx 事务客户端（可选）
 * @returns 法律条文列表和总数
 */
export const findLegalArticlesListDao = async (
    options: LegalArticlesListOptions,
    tx?: PrismaClient
) => {
    try {
        const { legalId, page = 1, pageSize = 100, type, keyword, l1, l2, l3, l4, l5 } = options
        const skip = (page - 1) * pageSize

        // 构建查询条件
        const where: Prisma.legalArticlesWhereInput = {
            legalId,
            deletedAt: null,
        }

        // 条文类型筛选
        if (type) {
            where.type = type
        }

        // L1-L5 标题筛选
        if (l1) {
            where.l1 = { contains: l1, mode: 'insensitive' }
        }
        if (l2) {
            where.l2 = { contains: l2, mode: 'insensitive' }
        }
        if (l3) {
            where.l3 = { contains: l3, mode: 'insensitive' }
        }
        if (l4) {
            where.l4 = { contains: l4, mode: 'insensitive' }
        }
        if (l5) {
            where.l5 = { contains: l5, mode: 'insensitive' }
        }

        // 关键词搜索（搜索内容、L1-L5 标题）
        if (keyword) {
            where.OR = [
                { content: { contains: keyword, mode: 'insensitive' } },
                { l1: { contains: keyword, mode: 'insensitive' } },
                { l2: { contains: keyword, mode: 'insensitive' } },
                { l3: { contains: keyword, mode: 'insensitive' } },
                { l4: { contains: keyword, mode: 'insensitive' } },
                { l5: { contains: keyword, mode: 'insensitive' } },
            ]
        }

        // 并行查询列表和总数
        const [list, total] = await Promise.all([
            (tx || prisma).legalArticles.findMany({
                where,
                skip,
                take: pageSize,
                // 先按 order 排序，然后在应用层按层级结构重新排序
                orderBy: { order: 'asc' },
            }),
            (tx || prisma).legalArticles.count({ where }),
        ])

        // 按层级结构排序
        const sortedList = sortArticlesByHierarchy(list)

        return { list: sortedList, total }
    } catch (error) {
        logger.error('查询法律条文列表失败：', error)
        throw error
    }
}

/**
 * 查询法律的所有条文（不分页）
 * @param legalId 法律 ID
 * @param tx 事务客户端（可选）
 * @returns 法律条文列表
 */
export const findAllLegalArticlesDao = async (
    legalId: string,
    tx?: PrismaClient
) => {
    try {
        const articles = await (tx || prisma).legalArticles.findMany({
            where: {
                legalId,
                deletedAt: null,
            },
            // 先按 order 排序，然后在应用层按层级结构重新排序
            orderBy: { order: 'asc' },
        })

        // 按层级结构排序
        return sortArticlesByHierarchy(articles)
    } catch (error) {
        logger.error('查询法律所有条文失败：', error)
        throw error
    }
}

/**
 * 更新法律条文
 * @param id 法律条文 ID
 * @param data 更新数据
 * @param tx 事务客户端（可选）
 * @returns 更新后的法律条文
 */
export const updateLegalArticleDao = async (
    id: string,
    data: Prisma.legalArticlesUpdateInput,
    tx?: PrismaClient
) => {
    try {
        const article = await (tx || prisma).legalArticles.update({
            where: { id },
            data: {
                ...data,
                updatedAt: new Date(),
                lastEditedAt: new Date(),
            },
        })
        return article
    } catch (error) {
        logger.error('更新法律条文失败：', error)
        throw error
    }
}

/**
 * 更新法律条文的最后嵌入时间
 * @param id 法律条文 ID
 * @param tx 事务客户端（可选）
 * @returns 更新后的法律条文
 */
export const updateLegalArticleEmbeddingTimeDao = async (
    id: string,
    tx?: PrismaClient
) => {
    try {
        const article = await (tx || prisma).legalArticles.update({
            where: { id },
            data: {
                lastEmbeddingAt: new Date(),
                updatedAt: new Date(),
            },
        })
        return article
    } catch (error) {
        logger.error('更新法律条文嵌入时间失败：', error)
        throw error
    }
}

/**
 * 批量更新法律条文的失效日期
 * @param legalId 法律 ID
 * @param invalidDate 失效日期
 * @param tx 事务客户端（可选）
 * @returns 更新的条文数量
 */
export const updateLegalArticlesInvalidDateDao = async (
    legalId: string,
    invalidDate: Date | null,
    tx?: PrismaClient
) => {
    try {
        const result = await (tx || prisma).legalArticles.updateMany({
            where: {
                legalId,
                deletedAt: null,
            },
            data: {
                invalidDate,
                updatedAt: new Date(),
            },
        })
        return result.count
    } catch (error) {
        logger.error('批量更新法律条文失效日期失败：', error)
        throw error
    }
}

/**
 * 软删除法律条文
 * @param id 法律条文 ID
 * @param tx 事务客户端（可选）
 */
export const deleteLegalArticleDao = async (
    id: string,
    tx?: PrismaClient
) => {
    try {
        await (tx || prisma).legalArticles.update({
            where: { id },
            data: {
                deletedAt: new Date(),
                updatedAt: new Date(),
            },
        })
    } catch (error) {
        logger.error('删除法律条文失败：', error)
        throw error
    }
}

/**
 * 批量软删除法律条文（按法律 ID）
 * @param legalId 法律 ID
 * @param tx 事务客户端（可选）
 * @returns 删除的条文数量
 */
export const deleteLegalArticlesByLegalIdDao = async (
    legalId: string,
    tx?: PrismaClient
) => {
    try {
        const result = await (tx || prisma).legalArticles.updateMany({
            where: {
                legalId,
                deletedAt: null,
            },
            data: {
                deletedAt: new Date(),
                updatedAt: new Date(),
            },
        })
        return result.count
    } catch (error) {
        logger.error('批量删除法律条文失败：', error)
        throw error
    }
}

/**
 * 查询需要重新嵌入的条文（lastEditedAt > lastEmbeddingAt）
 * @param legalId 法律 ID（可选，不传则查询所有）
 * @param tx 事务客户端（可选）
 * @returns 需要重新嵌入的条文列表
 */
export const findArticlesNeedingEmbeddingDao = async (
    legalId?: string,
    tx?: PrismaClient
) => {
    try {
        const articles = await (tx || prisma).legalArticles.findMany({
            where: {
                deletedAt: null,
                ...(legalId && { legalId }),
                OR: [
                    { lastEmbeddingAt: null },
                    {
                        lastEditedAt: {
                            gt: prisma.legalArticles.fields.lastEmbeddingAt,
                        },
                    },
                ],
            },
            include: {
                legalMain: true,
            },
            orderBy: { order: 'asc' },
        })
        return articles
    } catch (error) {
        logger.error('查询需要重新嵌入的条文失败：', error)
        throw error
    }
}


/**
 * 查询法律条文用于构建排序树
 * @param legalId 法律 ID
 * @param tx 事务客户端（可选）
 * @returns 法律条文列表（只包含排序需要的字段）
 */
export const findLegalArticlesForSortTreeDao = async (
    legalId: string,
    tx?: PrismaClient
) => {
    try {
        logger.info(`查询法律条文排序树，legalId: ${legalId}`)

        const articles = await (tx || prisma).legalArticles.findMany({
            where: {
                legalId,
                deletedAt: null,
            },
            select: {
                id: true,
                type: true,
                l1: true,
                l2: true,
                l3: true,
                l4: true,
                l5: true,
                order: true,
                content: true,
            },
            orderBy: { order: 'asc' },
        })

        logger.info(`查询到 ${articles.length} 条法律条文`)

        return articles
    } catch (error) {
        logger.error('查询法律条文排序树失败：', error)
        throw error
    }
}

/**
 * 批量更新法律条文排序
 * @param items 排序项列表
 * @param tx 事务客户端（可选）
 * @returns 更新的条文数量
 */
export const batchUpdateLegalArticlesOrderDao = async (
    items: { id: string; order: number }[],
    tx?: PrismaClient
) => {
    try {
        const client = tx || prisma
        const now = new Date()

        // 使用事务批量更新
        const updates = items.map(item =>
            client.legalArticles.update({
                where: { id: item.id },
                data: {
                    order: item.order,
                    updatedAt: now,
                },
            })
        )

        await client.$transaction(updates)
        return items.length
    } catch (error) {
        logger.error('批量更新法律条文排序失败：', error)
        throw error
    }
}


