/**
 * 模型提供商服务层
 *
 * 提供模型提供商的业务逻辑封装
 */

import type { CreateModelProviderInput, UpdateModelProviderInput } from '#shared/types/model'

/**
 * 创建模型提供商
 * @param data 提供商创建数据
 * @returns 创建的提供商
 */
export const createModelProviderService = async (data: CreateModelProviderInput) => {
    // 检查名称是否已存在
    const existing = await findModelProviderByNameDao(data.name)
    if (existing) {
        throw new Error('提供商名称已存在')
    }

    return await createModelProviderDao(data)
}

/**
 * 获取模型提供商详情
 * @param id 提供商 ID
 * @returns 提供商或 null
 */
export const getModelProviderByIdService = async (id: number) => {
    return await findModelProviderByIdDao(id)
}

/**
 * 获取模型提供商列表（分页）
 * @param options 查询选项
 * @returns 提供商列表和总数
 */
export const getModelProvidersService = async (options: {
    page?: number
    pageSize?: number
    includeDeleted?: boolean
} = {}) => {
    return await findManyModelProvidersDao(options)
}

/**
 * 获取所有模型提供商（不分页）
 * @returns 提供商列表
 */
export const getAllModelProvidersService = async () => {
    return await findAllModelProvidersDao()
}

/**
 * 更新模型提供商
 * @param id 提供商 ID
 * @param data 更新数据
 * @returns 更新后的提供商
 */
export const updateModelProviderService = async (
    id: number,
    data: UpdateModelProviderInput
) => {
    // 检查提供商是否存在
    const existing = await findModelProviderByIdDao(id)
    if (!existing) {
        throw new Error('提供商不存在')
    }

    // 如果更新名称，检查新名称是否已被使用
    if (data.name && data.name !== existing.name) {
        const nameExists = await findModelProviderByNameDao(data.name)
        if (nameExists) {
            throw new Error('提供商名称已存在')
        }
    }

    return await updateModelProviderDao(id, data)
}

/**
 * 删除模型提供商（软删除）
 * @param id 提供商 ID
 */
export const deleteModelProviderService = async (id: number) => {
    // 检查提供商是否存在
    const existing = await findModelProviderByIdDao(id)
    if (!existing) {
        throw new Error('提供商不存在')
    }

    await softDeleteModelProviderDao(id)
}
