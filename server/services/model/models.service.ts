/**
 * 模型配置服务层
 *
 * 提供模型配置的业务逻辑封装
 */

import type { CreateModelInput, UpdateModelInput, ModelType } from '#shared/types/model'

/**
 * 创建模型
 * @param data 模型创建数据
 * @returns 创建的模型
 */
export const createModelService = async (data: CreateModelInput) => {
    // 检查提供商是否存在
    const provider = await findModelProviderByIdDao(data.providerId)
    if (!provider) {
        throw new Error('提供商不存在')
    }

    // 如果设置为默认，先取消同类型下其他默认模型
    if (data.isDefault) {
        await prisma.models.updateMany({
            where: {
                modelType: data.modelType,
                isDefault: true,
                deletedAt: null,
            },
            data: { isDefault: false },
        })
    }

    return await createModelDao(data)
}

/**
 * 获取模型详情
 * @param id 模型 ID
 * @returns 模型或 null
 */
export const getModelByIdService = async (id: number) => {
    return await findModelByIdDao(id)
}

/**
 * 获取模型列表（分页）
 * @param options 查询选项
 * @returns 模型列表和总数
 */
export const getModelsService = async (options: {
    page?: number
    pageSize?: number
    modelType?: ModelType
    providerId?: number
    status?: number
    orderBy?: 'priority' | 'name' | 'createdAt'
    orderDir?: 'asc' | 'desc'
} = {}) => {
    return await findManyModelsDao(options)
}

/**
 * 获取指定类型的模型列表
 * @param modelType 模型类型
 * @param options 查询选项
 * @returns 模型列表
 */
export const getModelsByTypeService = async (
    modelType: ModelType,
    options: {
        status?: number
        orderBy?: 'priority' | 'name' | 'createdAt'
        orderDir?: 'asc' | 'desc'
    } = {}
) => {
    return await findModelsByTypeDao(modelType, options)
}

/**
 * 获取提供商的模型列表
 * @param providerId 提供商 ID
 * @returns 模型列表
 */
export const getModelsByProviderIdService = async (providerId: number) => {
    return await findModelsByProviderIdDao(providerId)
}

/**
 * 获取指定类型的默认模型
 * @param modelType 模型类型
 * @returns 默认模型或 null
 */
export const getDefaultModelByTypeService = async (modelType: ModelType) => {
    return await findDefaultModelByTypeDao(modelType)
}

/**
 * 更新模型
 * @param id 模型 ID
 * @param data 更新数据
 * @returns 更新后的模型
 */
export const updateModelService = async (
    id: number,
    data: UpdateModelInput
) => {
    // 检查模型是否存在
    const existing = await findModelByIdDao(id)
    if (!existing) {
        throw new Error('模型不存在')
    }

    // 如果设置为默认，先取消同类型下其他默认模型
    if (data.isDefault) {
        const modelType = (data.modelType || existing.modelType) as ModelType
        await setDefaultModelDao(id, modelType)
        // 移除 isDefault 字段，因为已经在 setDefaultModelDao 中处理
        const { isDefault, ...restData } = data
        if (Object.keys(restData).length > 0) {
            return await updateModelDao(id, restData)
        }
        return await findModelByIdDao(id)
    }

    return await updateModelDao(id, data)
}

/**
 * 设置默认模型
 * @param id 模型 ID
 */
export const setDefaultModelService = async (id: number) => {
    // 检查模型是否存在
    const existing = await findModelByIdDao(id)
    if (!existing) {
        throw new Error('模型不存在')
    }

    await setDefaultModelDao(id, existing.modelType as ModelType)
}

/**
 * 删除模型（软删除）
 * @param id 模型 ID
 */
export const deleteModelService = async (id: number) => {
    // 检查模型是否存在
    const existing = await findModelByIdDao(id)
    if (!existing) {
        throw new Error('模型不存在')
    }

    await softDeleteModelDao(id)
}
