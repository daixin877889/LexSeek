/**
 * 模型 API 密钥数据访问层
 *
 * 提供模型 API 密钥的 CRUD 操作
 */

import type { CreateModelApiKeyInput, UpdateModelApiKeyInput } from '#shared/types/model'
import type { Prisma } from '~~/generated/prisma/client'

// 定义 Prisma 客户端类型（支持事务）
type PrismaClient = typeof prisma

/**
 * 创建 API 密钥
 * @param data 密钥创建数据
 * @param tx 事务客户端（可选）
 * @returns 创建的密钥
 */
export const createModelApiKeyDao = async (
    data: CreateModelApiKeyInput,
    tx?: PrismaClient
) => {
    try {
        const apiKey = await (tx || prisma).modelApiKeys.create({
            data: {
                providerId: data.providerId,
                name: data.name,
                apiKey: data.apiKey,
                isDefault: data.isDefault ?? false,
                status: data.status ?? 1,
                dailyLimit: data.dailyLimit,
                monthlyLimit: data.monthlyLimit,
            },
        })
        return apiKey
    } catch (error) {
        logger.error('创建 API 密钥失败：', error)
        throw error
    }
}

/**
 * 通过 ID 查询 API 密钥
 * @param id 密钥 ID
 * @param tx 事务客户端（可选）
 * @returns 密钥或 null
 */
export const findModelApiKeyByIdDao = async (
    id: number,
    tx?: PrismaClient
) => {
    try {
        const apiKey = await (tx || prisma).modelApiKeys.findUnique({
            where: { id, deletedAt: null },
            include: { modelProvider: true },
        })
        return apiKey
    } catch (error) {
        logger.error('通过 ID 查询 API 密钥失败：', error)
        throw error
    }
}

/**
 * 通过提供商 ID 查询 API 密钥列表
 * @param providerId 提供商 ID
 * @param tx 事务客户端（可选）
 * @returns 密钥列表
 */
export const findModelApiKeysByProviderIdDao = async (
    providerId: number,
    tx?: PrismaClient
) => {
    try {
        const apiKeys = await (tx || prisma).modelApiKeys.findMany({
            where: { providerId, deletedAt: null },
            include: { modelProvider: true },
            orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
        })
        return apiKeys
    } catch (error) {
        logger.error('通过提供商 ID 查询 API 密钥列表失败：', error)
        throw error
    }
}

/**
 * 查询提供商的默认 API 密钥
 * @param providerId 提供商 ID
 * @param tx 事务客户端（可选）
 * @returns 默认密钥或 null
 */
export const findDefaultModelApiKeyByProviderIdDao = async (
    providerId: number,
    tx?: PrismaClient
) => {
    try {
        const apiKey = await (tx || prisma).modelApiKeys.findFirst({
            where: {
                providerId,
                isDefault: true,
                status: 1,
                deletedAt: null,
            },
        })
        return apiKey
    } catch (error) {
        logger.error('查询默认 API 密钥失败：', error)
        throw error
    }
}

/**
 * 批量按提供商 ID 查询默认 API 密钥
 * 一次查多个 providerId，返回 providerId → apiKey 的 Map（同 providerId 可能多个 default，仅取首个）
 */
export const findDefaultModelApiKeysByProviderIdsDao = async (
    providerIds: number[],
    tx?: PrismaClient
) => {
    if (providerIds.length === 0) return new Map<number, Awaited<ReturnType<typeof findDefaultModelApiKeyByProviderIdDao>>>()
    try {
        const apiKeys = await (tx || prisma).modelApiKeys.findMany({
            where: {
                providerId: { in: providerIds },
                isDefault: true,
                status: 1,
                deletedAt: null,
            },
        })
        const map = new Map<number, typeof apiKeys[number]>()
        for (const k of apiKeys) {
            if (!map.has(k.providerId)) map.set(k.providerId, k)
        }
        return map
    } catch (error) {
        logger.error('批量查询默认 API 密钥失败：', error)
        throw error
    }
}

/**
 * 查询所有 API 密钥
 * @param options 查询选项
 * @param tx 事务客户端（可选）
 * @returns 密钥列表和总数
 */
export const findManyModelApiKeysDao = async (
    options: {
        page?: number
        pageSize?: number
        providerId?: number
        status?: number
    } = {},
    tx?: PrismaClient
) => {
    try {
        const { page = 1, pageSize = 10, providerId, status } = options
        const skip = (page - 1) * pageSize

        // 构建查询条件
        const where: Prisma.modelApiKeysWhereInput = {
            deletedAt: null,
            ...(providerId !== undefined && { providerId }),
            ...(status !== undefined && { status }),
        }

        // 并行查询列表和总数
        const [list, total] = await Promise.all([
            (tx || prisma).modelApiKeys.findMany({
                where,
                skip,
                take: pageSize,
                include: { modelProvider: true },
                orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
            }),
            (tx || prisma).modelApiKeys.count({ where }),
        ])

        return { list, total }
    } catch (error) {
        logger.error('查询所有 API 密钥失败：', error)
        throw error
    }
}

/**
 * 更新 API 密钥
 * @param id 密钥 ID
 * @param data 更新数据
 * @param tx 事务客户端（可选）
 * @returns 更新后的密钥
 */
export const updateModelApiKeyDao = async (
    id: number,
    data: UpdateModelApiKeyInput,
    tx?: PrismaClient
) => {
    try {
        const apiKey = await (tx || prisma).modelApiKeys.update({
            where: { id },
            data: {
                ...(data.name !== undefined && { name: data.name }),
                ...(data.apiKey !== undefined && { apiKey: data.apiKey }),
                ...(data.isDefault !== undefined && { isDefault: data.isDefault }),
                ...(data.status !== undefined && { status: data.status }),
                ...(data.dailyLimit !== undefined && { dailyLimit: data.dailyLimit }),
                ...(data.monthlyLimit !== undefined && { monthlyLimit: data.monthlyLimit }),
            },
        })
        return apiKey
    } catch (error) {
        logger.error('更新 API 密钥失败：', error)
        throw error
    }
}

/**
 * 设置默认 API 密钥（同时取消同提供商下其他默认密钥）
 * @param id 密钥 ID
 * @param providerId 提供商 ID
 * @param tx 事务客户端（可选）
 */
export const setDefaultModelApiKeyDao = async (
    id: number,
    providerId: number,
    tx?: PrismaClient
) => {
    const client = tx || prisma
    try {
        // 使用事务确保原子性
        await client.$transaction(async (txClient) => {
            // 取消同提供商下其他默认密钥
            await txClient.modelApiKeys.updateMany({
                where: {
                    providerId,
                    isDefault: true,
                    deletedAt: null,
                    id: { not: id },
                },
                data: { isDefault: false },
            })
            // 设置当前密钥为默认
            await txClient.modelApiKeys.update({
                where: { id },
                data: { isDefault: true },
            })
        })
    } catch (error) {
        logger.error('设置默认 API 密钥失败：', error)
        throw error
    }
}

/**
 * 软删除 API 密钥
 * @param id 密钥 ID
 * @param tx 事务客户端（可选）
 */
export const softDeleteModelApiKeyDao = async (
    id: number,
    tx?: PrismaClient
) => {
    try {
        await (tx || prisma).modelApiKeys.update({
            where: { id },
            data: { deletedAt: new Date() },
        })
    } catch (error) {
        logger.error('删除 API 密钥失败：', error)
        throw error
    }
}
