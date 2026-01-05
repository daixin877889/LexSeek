/**
 * 模型提供商数据访问层
 *
 * 提供模型提供商的 CRUD 操作
 */

import type { CreateModelProviderInput, UpdateModelProviderInput } from '#shared/types/model'
import type { Prisma } from '~~/generated/prisma/client'

// 定义 Prisma 客户端类型（支持事务）
type PrismaClient = typeof prisma

/**
 * 创建模型提供商
 * @param data 提供商创建数据
 * @param tx 事务客户端（可选）
 * @returns 创建的提供商
 */
export const createModelProviderDao = async (
    data: CreateModelProviderInput,
    tx?: PrismaClient
) => {
    try {
        const provider = await (tx || prisma).modelProviders.create({
            data: {
                name: data.name,
                baseUrl: data.baseUrl,
                description: data.description,
            },
        })
        return provider
    } catch (error) {
        logger.error('创建模型提供商失败：', error)
        throw error
    }
}

/**
 * 通过 ID 查询模型提供商
 * @param id 提供商 ID
 * @param tx 事务客户端（可选）
 * @returns 提供商或 null
 */
export const findModelProviderByIdDao = async (
    id: number,
    tx?: PrismaClient
) => {
    try {
        const provider = await (tx || prisma).modelProviders.findUnique({
            where: { id, deletedAt: null },
        })
        return provider
    } catch (error) {
        logger.error('通过 ID 查询模型提供商失败：', error)
        throw error
    }
}

/**
 * 通过名称查询模型提供商
 * @param name 提供商名称
 * @param tx 事务客户端（可选）
 * @returns 提供商或 null
 */
export const findModelProviderByNameDao = async (
    name: string,
    tx?: PrismaClient
) => {
    try {
        const provider = await (tx || prisma).modelProviders.findFirst({
            where: { name, deletedAt: null },
        })
        return provider
    } catch (error) {
        logger.error('通过名称查询模型提供商失败：', error)
        throw error
    }
}

/**
 * 查询所有模型提供商
 * @param options 查询选项
 * @param tx 事务客户端（可选）
 * @returns 提供商列表和总数
 */
export const findManyModelProvidersDao = async (
    options: {
        page?: number
        pageSize?: number
        includeDeleted?: boolean
    } = {},
    tx?: PrismaClient
) => {
    try {
        const { page = 1, pageSize = 10, includeDeleted = false } = options
        const skip = (page - 1) * pageSize

        // 构建查询条件
        const where: Prisma.modelProvidersWhereInput = {
            ...(includeDeleted ? {} : { deletedAt: null }),
        }

        // 并行查询列表和总数
        const [list, total] = await Promise.all([
            (tx || prisma).modelProviders.findMany({
                where,
                skip,
                take: pageSize,
                orderBy: { createdAt: 'desc' },
            }),
            (tx || prisma).modelProviders.count({ where }),
        ])

        return { list, total }
    } catch (error) {
        logger.error('查询所有模型提供商失败：', error)
        throw error
    }
}

/**
 * 查询所有模型提供商（不分页）
 * @param tx 事务客户端（可选）
 * @returns 提供商列表
 */
export const findAllModelProvidersDao = async (tx?: PrismaClient) => {
    try {
        const providers = await (tx || prisma).modelProviders.findMany({
            where: { deletedAt: null },
            orderBy: { name: 'asc' },
        })
        return providers
    } catch (error) {
        logger.error('查询所有模型提供商失败：', error)
        throw error
    }
}

/**
 * 更新模型提供商
 * @param id 提供商 ID
 * @param data 更新数据
 * @param tx 事务客户端（可选）
 * @returns 更新后的提供商
 */
export const updateModelProviderDao = async (
    id: number,
    data: UpdateModelProviderInput,
    tx?: PrismaClient
) => {
    try {
        const provider = await (tx || prisma).modelProviders.update({
            where: { id },
            data: {
                ...(data.name !== undefined && { name: data.name }),
                ...(data.baseUrl !== undefined && { baseUrl: data.baseUrl }),
                ...(data.description !== undefined && { description: data.description }),
            },
        })
        return provider
    } catch (error) {
        logger.error('更新模型提供商失败：', error)
        throw error
    }
}

/**
 * 软删除模型提供商
 * @param id 提供商 ID
 * @param tx 事务客户端（可选）
 */
export const softDeleteModelProviderDao = async (
    id: number,
    tx?: PrismaClient
) => {
    try {
        await (tx || prisma).modelProviders.update({
            where: { id },
            data: { deletedAt: new Date() },
        })
    } catch (error) {
        logger.error('删除模型提供商失败：', error)
        throw error
    }
}
