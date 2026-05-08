/**
 * 模型配置数据访问层
 *
 * 提供模型配置的 CRUD 操作
 */

import type { CreateModelInput, UpdateModelInput, ModelType } from '#shared/types/model'
import type { Prisma } from '~~/generated/prisma/client'
import type { models } from '~~/generated/prisma/client'

// 定义 Prisma 客户端类型（支持事务）
type PrismaClient = typeof prisma

/**
 * 创建模型
 * @param data 模型创建数据
 * @param tx 事务客户端（可选）
 * @returns 创建的模型
 */
export const createModelDao = async (
    data: CreateModelInput,
    tx?: PrismaClient
) => {
    try {
        const model = await (tx || prisma).models.create({
            data: {
                providerId: data.providerId,
                name: data.name,
                displayName: data.displayName,
                modelType: data.modelType,
                // sdkType 字段：指定模型使用的 LangChain SDK 类型，默认为 'openai'
                sdkType: data.sdkType ?? 'openai',
                modelVersion: data.modelVersion,
                contextWindow: data.contextWindow,
                maxOutputTokens: data.maxOutputTokens,
                dimensions: data.dimensions,
                batchSize: data.batchSize,
                isDefault: data.isDefault ?? false,
                status: data.status ?? 1,
                priority: data.priority ?? 10,
                inputCostPerMillionTokens: data.inputCostPerMillionTokens,
                outputCostPerMillionTokens: data.outputCostPerMillionTokens,
            },
        })
        return model
    } catch (error) {
        logger.error('创建模型失败：', error)
        throw error
    }
}

/**
 * 通过 ID 查询模型
 * @param id 模型 ID
 * @param tx 事务客户端（可选）
 * @returns 模型或 null
 */
export const findModelByIdDao = async (
    id: number,
    tx?: PrismaClient
) => {
    try {
        const model = await (tx || prisma).models.findUnique({
            where: { id, deletedAt: null },
            include: { modelProvider: true },
        })
        return model
    } catch (error) {
        logger.error('通过 ID 查询模型失败：', error)
        throw error
    }
}

/**
 * 通过类型查询模型列表
 * @param modelType 模型类型
 * @param options 查询选项
 * @param tx 事务客户端（可选）
 * @returns 模型列表
 */
export const findModelsByTypeDao = async (
    modelType: ModelType,
    options: {
        status?: number
        orderBy?: 'priority' | 'name' | 'createdAt'
        orderDir?: 'asc' | 'desc'
    } = {},
    tx?: PrismaClient
) => {
    try {
        const { status, orderBy = 'priority', orderDir = 'asc' } = options

        const models = await (tx || prisma).models.findMany({
            where: {
                modelType,
                deletedAt: null,
                ...(status !== undefined && { status }),
            },
            include: { modelProvider: true },
            orderBy: { [orderBy]: orderDir },
        })
        return models
    } catch (error) {
        logger.error('通过类型查询模型列表失败：', error)
        throw error
    }
}

/**
 * 通过提供商 ID 查询模型列表
 * @param providerId 提供商 ID
 * @param tx 事务客户端（可选）
 * @returns 模型列表
 */
export const findModelsByProviderIdDao = async (
    providerId: number,
    tx?: PrismaClient
) => {
    try {
        const models = await (tx || prisma).models.findMany({
            where: { providerId, deletedAt: null },
            include: { modelProvider: true },
            orderBy: [{ modelType: 'asc' }, { priority: 'asc' }],
        })
        return models
    } catch (error) {
        logger.error('通过提供商 ID 查询模型列表失败：', error)
        throw error
    }
}

/**
 * 查询指定类型的默认模型
 * @param modelType 模型类型
 * @param tx 事务客户端（可选）
 * @returns 默认模型或 null
 */
export const findDefaultModelByTypeDao = async (
    modelType: ModelType,
    tx?: PrismaClient
) => {
    try {
        const model = await (tx || prisma).models.findFirst({
            where: {
                modelType,
                isDefault: true,
                status: 1,
                deletedAt: null,
            },
            include: { modelProvider: true },
            // 按优先级升序、创建时间降序排序，确保返回最新设置的高优先级默认模型
            orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
        })
        return model
    } catch (error) {
        logger.error('查询默认模型失败：', error)
        throw error
    }
}

/**
 * 查询所有模型
 * @param options 查询选项
 * @param tx 事务客户端（可选）
 * @returns 模型列表和总数
 */
export const findManyModelsDao = async (
    options: {
        page?: number
        pageSize?: number
        modelType?: ModelType
        providerId?: number
        status?: number
        orderBy?: 'priority' | 'name' | 'createdAt'
        orderDir?: 'asc' | 'desc'
    } = {},
    tx?: PrismaClient
) => {
    try {
        const {
            page = 1,
            pageSize = 10,
            modelType,
            providerId,
            status,
            orderBy = 'priority',
            orderDir = 'asc',
        } = options
        const skip = (page - 1) * pageSize

        // 构建查询条件
        const where: Prisma.modelsWhereInput = {
            deletedAt: null,
            ...(modelType !== undefined && { modelType }),
            ...(providerId !== undefined && { providerId }),
            ...(status !== undefined && { status }),
        }

        // 并行查询列表和总数
        const [list, total] = await Promise.all([
            (tx || prisma).models.findMany({
                where,
                skip,
                take: pageSize,
                include: { modelProvider: true },
                orderBy: { [orderBy]: orderDir },
            }),
            (tx || prisma).models.count({ where }),
        ])

        return { list, total }
    } catch (error) {
        logger.error('查询所有模型失败：', error)
        throw error
    }
}

/**
 * 更新模型
 * @param id 模型 ID
 * @param data 更新数据
 * @param tx 事务客户端（可选）
 * @returns 更新后的模型
 */
export const updateModelDao = async (
    id: number,
    data: UpdateModelInput,
    tx?: PrismaClient
) => {
    try {
        const model = await (tx || prisma).models.update({
            where: { id },
            data: {
                ...(data.name !== undefined && { name: data.name }),
                ...(data.displayName !== undefined && { displayName: data.displayName }),
                ...(data.modelType !== undefined && { modelType: data.modelType }),
                // sdkType 字段：支持更新模型使用的 LangChain SDK 类型
                ...(data.sdkType !== undefined && { sdkType: data.sdkType }),
                ...(data.modelVersion !== undefined && { modelVersion: data.modelVersion }),
                ...(data.contextWindow !== undefined && { contextWindow: data.contextWindow }),
                ...(data.maxOutputTokens !== undefined && { maxOutputTokens: data.maxOutputTokens }),
                ...(data.dimensions !== undefined && { dimensions: data.dimensions }),
                ...(data.batchSize !== undefined && { batchSize: data.batchSize }),
                ...(data.isDefault !== undefined && { isDefault: data.isDefault }),
                ...(data.status !== undefined && { status: data.status }),
                ...(data.priority !== undefined && { priority: data.priority }),
                ...(data.inputCostPerMillionTokens !== undefined && {
                    inputCostPerMillionTokens: data.inputCostPerMillionTokens,
                }),
                ...(data.outputCostPerMillionTokens !== undefined && {
                    outputCostPerMillionTokens: data.outputCostPerMillionTokens,
                }),
            },
        })
        return model
    } catch (error) {
        logger.error('更新模型失败：', error)
        throw error
    }
}

/**
 * 设置默认模型（同时取消同类型下其他默认模型）
 * @param id 模型 ID
 * @param modelType 模型类型
 * @param tx 事务客户端（可选）
 */
export const setDefaultModelDao = async (
    id: number,
    modelType: ModelType,
    tx?: PrismaClient
) => {
    const client = tx || prisma
    try {
        // 使用事务确保原子性
        await client.$transaction(async (txClient) => {
            // 取消同类型下其他默认模型
            await txClient.models.updateMany({
                where: {
                    modelType,
                    isDefault: true,
                    deletedAt: null,
                    id: { not: id },
                },
                data: { isDefault: false },
            })
            // 设置当前模型为默认
            await txClient.models.update({
                where: { id },
                data: { isDefault: true },
            })
        })
    } catch (error) {
        logger.error('设置默认模型失败：', error)
        throw error
    }
}

/**
 * 软删除模型
 * @param id 模型 ID
 * @param tx 事务客户端（可选）
 */
export const softDeleteModelDao = async (
    id: number,
    tx?: PrismaClient
) => {
    try {
        await (tx || prisma).models.update({
            where: { id },
            data: { deletedAt: new Date() },
        })
    } catch (error) {
        logger.error('删除模型失败：', error)
        throw error
    }
}
