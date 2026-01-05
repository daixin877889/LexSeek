/**
 * 模型 API 密钥服务层
 *
 * 提供模型 API 密钥的业务逻辑封装
 */

import type { CreateModelApiKeyInput, UpdateModelApiKeyInput } from '#shared/types/model'

/**
 * 创建 API 密钥
 * @param data 密钥创建数据
 * @returns 创建的密钥
 */
export const createModelApiKeyService = async (data: CreateModelApiKeyInput) => {
    // 检查提供商是否存在
    const provider = await findModelProviderByIdDao(data.providerId)
    if (!provider) {
        throw new Error('提供商不存在')
    }

    // 如果设置为默认，先取消同提供商下其他默认密钥
    if (data.isDefault) {
        await prisma.modelApiKeys.updateMany({
            where: {
                providerId: data.providerId,
                isDefault: true,
                deletedAt: null,
            },
            data: { isDefault: false },
        })
    }

    return await createModelApiKeyDao(data)
}

/**
 * 获取 API 密钥详情
 * @param id 密钥 ID
 * @returns 密钥或 null
 */
export const getModelApiKeyByIdService = async (id: number) => {
    return await findModelApiKeyByIdDao(id)
}

/**
 * 获取 API 密钥列表（分页）
 * @param options 查询选项
 * @returns 密钥列表和总数
 */
export const getModelApiKeysService = async (options: {
    page?: number
    pageSize?: number
    providerId?: number
    status?: number
} = {}) => {
    return await findManyModelApiKeysDao(options)
}

/**
 * 获取提供商的 API 密钥列表
 * @param providerId 提供商 ID
 * @returns 密钥列表
 */
export const getModelApiKeysByProviderIdService = async (providerId: number) => {
    return await findModelApiKeysByProviderIdDao(providerId)
}

/**
 * 获取提供商的默认 API 密钥
 * @param providerId 提供商 ID
 * @returns 默认密钥或 null
 */
export const getDefaultModelApiKeyService = async (providerId: number) => {
    return await findDefaultModelApiKeyByProviderIdDao(providerId)
}

/**
 * 更新 API 密钥
 * @param id 密钥 ID
 * @param data 更新数据
 * @returns 更新后的密钥
 */
export const updateModelApiKeyService = async (
    id: number,
    data: UpdateModelApiKeyInput
) => {
    // 检查密钥是否存在
    const existing = await findModelApiKeyByIdDao(id)
    if (!existing) {
        throw new Error('API 密钥不存在')
    }

    // 如果设置为默认，先取消同提供商下其他默认密钥
    if (data.isDefault) {
        await setDefaultModelApiKeyDao(id, existing.providerId)
        // 移除 isDefault 字段，因为已经在 setDefaultModelApiKeyDao 中处理
        const { isDefault, ...restData } = data
        if (Object.keys(restData).length > 0) {
            return await updateModelApiKeyDao(id, restData)
        }
        return await findModelApiKeyByIdDao(id)
    }

    return await updateModelApiKeyDao(id, data)
}

/**
 * 设置默认 API 密钥
 * @param id 密钥 ID
 */
export const setDefaultModelApiKeyService = async (id: number) => {
    // 检查密钥是否存在
    const existing = await findModelApiKeyByIdDao(id)
    if (!existing) {
        throw new Error('API 密钥不存在')
    }

    await setDefaultModelApiKeyDao(id, existing.providerId)
}

/**
 * 删除 API 密钥（软删除）
 * @param id 密钥 ID
 */
export const deleteModelApiKeyService = async (id: number) => {
    // 检查密钥是否存在
    const existing = await findModelApiKeyByIdDao(id)
    if (!existing) {
        throw new Error('API 密钥不存在')
    }

    await softDeleteModelApiKeyDao(id)
}
