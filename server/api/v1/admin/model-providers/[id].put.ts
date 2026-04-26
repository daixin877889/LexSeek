/**
 * 更新模型提供商
 *
 * PUT /api/v1/admin/model-providers/:id
 */

import { z } from 'zod'
import { findModelProviderByIdDao, findModelProviderByNameDao, updateModelProviderDao } from '~~/server/services/model/modelProviders.dao'

/** 路由参数验证 */
const paramsSchema = z.object({
    id: z.coerce.number().int().positive('ID必须是正整数'),
})

/** 请求体验证 */
const bodySchema = z.object({
    name: z.string()
        .min(1, '名称不能为空')
        .max(100, '名称不能超过100个字符')
        .optional(),
    baseUrl: z.string()
        .url('请输入有效的URL地址')
        .max(255, 'URL不能超过255个字符')
        .optional(),
    description: z.string()
        .max(500, '描述不能超过500个字符')
        .optional()
        .nullable(),
})

export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id')
    const paramsResult = paramsSchema.safeParse({ id })
    if (!paramsResult.success) {
        return resError(event, 400, '参数错误：' + paramsResult.error.issues[0]!.message)
    }

    const body = await readBody(event)
    const bodyResult = bodySchema.safeParse(body)
    if (!bodyResult.success) {
        return resError(event, 400, '参数错误：' + bodyResult.error.issues[0]!.message)
    }

    try {
        // 检查提供商是否存在
        const existing = await findModelProviderByIdDao(paramsResult.data.id)
        if (!existing) {
            return resError(event, 404, '模型提供商不存在')
        }

        // 如果更新名称，检查名称是否已被其他提供商使用
        if (bodyResult.data.name && bodyResult.data.name !== existing.name) {
            const nameExists = await findModelProviderByNameDao(bodyResult.data.name)
            if (nameExists) {
                return resError(event, 409, '提供商名称已存在')
            }
        }

        const provider = await updateModelProviderDao(paramsResult.data.id, bodyResult.data)
        return resSuccess(event, '更新模型提供商成功', provider)
    } catch (error) {
        logger.error('更新模型提供商失败：', error)
        return resError(event, 500, '更新模型提供商失败')
    }
})
