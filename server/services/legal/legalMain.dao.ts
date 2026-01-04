/**
 * 法律法规数据访问层
 *
 * 提供法律法规的 CRUD 操作和分页查询
 */

import type { Prisma } from '#shared/types/prisma'
import type { LegalType } from '#shared/types/legal'

// 定义 Prisma 客户端类型（支持事务）
type PrismaClient = typeof prisma

/** 法律法规列表查询选项 */
interface LegalMainListOptions {
    page?: number
    pageSize?: number
    keyword?: string
    type?: LegalType
    issuingAuthority?: string
    /** 状态筛选：valid-有效，invalid-已失效，pending-未生效 */
    status?: 'valid' | 'invalid' | 'pending'
    sortBy?: 'createdAt' | 'publishDate' | 'effectiveDate' | 'name'
    sortOrder?: 'asc' | 'desc'
}

/**
 * 创建法律法规
 * @param data 法律法规创建数据
 * @param tx 事务客户端（可选）
 * @returns 创建的法律法规
 */
export const createLegalMainDao = async (
    data: Prisma.legalMainCreateInput,
    tx?: PrismaClient
) => {
    try {
        const legal = await (tx || prisma).legalMain.create({
            data: {
                ...data,
                createdAt: new Date(),
                updatedAt: new Date(),
                lastEditedAt: new Date(),
            },
        })
        return legal
    } catch (error) {
        logger.error('创建法律法规失败：', error)
        throw error
    }
}

/**
 * 通过 ID 查询法律法规
 * @param id 法律法规 ID
 * @param tx 事务客户端（可选）
 * @returns 法律法规或 null
 */
export const findLegalMainByIdDao = async (
    id: string,
    tx?: PrismaClient
) => {
    try {
        const legal = await (tx || prisma).legalMain.findUnique({
            where: { id, deletedAt: null },
        })
        return legal
    } catch (error) {
        logger.error('通过 ID 查询法律法规失败：', error)
        throw error
    }
}

/**
 * 通过 ID 查询法律法规（含条文）
 * @param id 法律法规 ID
 * @param tx 事务客户端（可选）
 * @returns 法律法规（含条文）或 null
 */
export const findLegalMainWithArticlesByIdDao = async (
    id: string,
    tx?: PrismaClient
) => {
    try {
        const legal = await (tx || prisma).legalMain.findUnique({
            where: { id, deletedAt: null },
            include: {
                legalArticles: {
                    where: { deletedAt: null },
                    orderBy: { order: 'asc' },
                },
            },
        })
        return legal
    } catch (error) {
        logger.error('通过 ID 查询法律法规（含条文）失败：', error)
        throw error
    }
}

/**
 * 通过代码查询法律法规
 * @param code 法律代码
 * @param tx 事务客户端（可选）
 * @returns 法律法规或 null
 */
export const findLegalMainByCodeDao = async (
    code: string,
    tx?: PrismaClient
) => {
    try {
        const legal = await (tx || prisma).legalMain.findFirst({
            where: { code, deletedAt: null },
        })
        return legal
    } catch (error) {
        logger.error('通过代码查询法律法规失败：', error)
        throw error
    }
}

/**
 * 查询法律法规列表（分页、筛选、排序）
 * @param options 查询选项
 * @param tx 事务客户端（可选）
 * @returns 法律法规列表和总数
 */
export const findLegalMainListDao = async (
    options: LegalMainListOptions = {},
    tx?: PrismaClient
) => {
    try {
        const {
            page = 1,
            pageSize = 10,
            keyword,
            type,
            issuingAuthority,
            status,
            sortBy = 'createdAt',
            sortOrder = 'desc',
        } = options
        const skip = (page - 1) * pageSize
        const now = new Date()

        // 构建状态筛选条件
        let statusCondition: Prisma.legalMainWhereInput = {}
        if (status === 'invalid') {
            // 已失效：失效日期存在且早于当前时间
            statusCondition = {
                invalidDate: { lt: now },
            }
        } else if (status === 'pending') {
            // 未生效：生效日期存在且晚于当前时间
            statusCondition = {
                effectiveDate: { gt: now },
            }
        } else if (status === 'valid') {
            // 有效：（无失效日期 或 失效日期晚于当前时间）且（无生效日期 或 生效日期早于等于当前时间）
            statusCondition = {
                OR: [
                    { invalidDate: null },
                    { invalidDate: { gte: now } },
                ],
                AND: [
                    {
                        OR: [
                            { effectiveDate: null },
                            { effectiveDate: { lte: now } },
                        ],
                    },
                ],
            }
        }

        // 构建查询条件
        const where: Prisma.legalMainWhereInput = {
            deletedAt: null,
            ...(type && { type }),
            ...(issuingAuthority && { issuingAuthority: { contains: issuingAuthority } }),
            ...(keyword && {
                OR: [
                    { name: { contains: keyword } },
                    { code: { contains: keyword } },
                    { documentNumber: { contains: keyword } },
                ],
            }),
            ...statusCondition,
        }

        // 构建排序条件
        const orderBy: Prisma.legalMainOrderByWithRelationInput = {
            [sortBy]: sortOrder,
        }

        // 并行查询列表和总数
        const [list, total] = await Promise.all([
            (tx || prisma).legalMain.findMany({
                where,
                skip,
                take: pageSize,
                orderBy,
                select: {
                    id: true,
                    name: true,
                    code: true,
                    type: true,
                    category: true,
                    issuingAuthority: true,
                    documentNumber: true,
                    publishDate: true,
                    effectiveDate: true,
                    invalidDate: true,
                    lastEditedAt: true,
                    lastEmbeddingAt: true,
                    createdAt: true,
                },
            }),
            (tx || prisma).legalMain.count({ where }),
        ])

        return { list, total }
    } catch (error) {
        logger.error('查询法律法规列表失败：', error)
        throw error
    }
}

/**
 * 更新法律法规
 * @param id 法律法规 ID
 * @param data 更新数据
 * @param tx 事务客户端（可选）
 * @returns 更新后的法律法规
 */
export const updateLegalMainDao = async (
    id: string,
    data: Prisma.legalMainUpdateInput,
    tx?: PrismaClient
) => {
    try {
        const legal = await (tx || prisma).legalMain.update({
            where: { id },
            data: {
                ...data,
                updatedAt: new Date(),
                lastEditedAt: new Date(),
            },
        })
        return legal
    } catch (error) {
        logger.error('更新法律法规失败：', error)
        throw error
    }
}

/**
 * 更新法律法规的最后嵌入时间
 * @param id 法律法规 ID
 * @param tx 事务客户端（可选）
 * @returns 更新后的法律法规
 */
export const updateLegalMainEmbeddingTimeDao = async (
    id: string,
    tx?: PrismaClient
) => {
    try {
        const legal = await (tx || prisma).legalMain.update({
            where: { id },
            data: {
                lastEmbeddingAt: new Date(),
                updatedAt: new Date(),
            },
        })
        return legal
    } catch (error) {
        logger.error('更新法律法规嵌入时间失败：', error)
        throw error
    }
}

/**
 * 软删除法律法规
 * @param id 法律法规 ID
 * @param tx 事务客户端（可选）
 */
export const deleteLegalMainDao = async (
    id: string,
    tx?: PrismaClient
) => {
    try {
        await (tx || prisma).legalMain.update({
            where: { id },
            data: {
                deletedAt: new Date(),
                updatedAt: new Date(),
            },
        })
    } catch (error) {
        logger.error('删除法律法规失败：', error)
        throw error
    }
}

/**
 * 查询已失效的法律法规 ID 列表
 * @param tx 事务客户端（可选）
 * @returns 已失效的法律法规 ID 列表
 */
export const findInvalidLegalMainIdsDao = async (
    tx?: PrismaClient
) => {
    try {
        const now = new Date()
        const legals = await (tx || prisma).legalMain.findMany({
            where: {
                deletedAt: null,
                invalidDate: { lte: now },
            },
            select: { id: true },
        })
        return legals.map(l => l.id)
    } catch (error) {
        logger.error('查询已失效的法律法规失败：', error)
        throw error
    }
}
