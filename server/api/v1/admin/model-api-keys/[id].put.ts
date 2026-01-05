/**
 * 更新模型 API 密钥
 *
 * PUT /api/v1/admin/model-api-keys/:id
 */

import { z } from 'zod'

/** 路由参数验证 */
const paramsSchema = z.object({
    id: z.coerce.number().int().positive('ID必须是正整数'),
})

/** 请求体验证 */
const bodySchema = z.object({
    name: z.string()
        .min(1, '密钥名称不能为空')
        .max(100, '密钥名称不能超过100个字符')
        .optional(),
    apiKey: z.string()
        .min(1, 'API密钥不能为空')
        .max(255, 'API密钥不能超过255个字符')
        .optional(),
    isDefault: z.boolean().optional(),
    status: z.number()
        .int('状态必须是整数')
        .min(0, '状态值无效')
        .max(1, '状态值无效')
        .optional(),
    dailyLimit: z.number()
        .int('日限制必须是整数')
        .positive('日限制必须是正整数')
        .optional()
        .nullable(),
    monthlyLimit: z.number()
        .int('月限制必须是整数')
        .positive('月限制必须是正整数')
        .optional()
        .nullable(),
})

export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id')
    const paramsResult = paramsSchema.safeParse({ id })
    if (!paramsResult.success) {
        return resError(event, 400, '参数错误：' + paramsResult.error.issues[0].message)
    }

    const body = await readBody(event)
    const bodyResult = bodySchema.safeParse(body)
    if (!bodyResult.success) {
        return resError(event, 400, '参数错误：' + bodyResult.error.issues[0].message)
    }

    try {
        // 检查密钥是否存在
        const existing = await findModelApiKeyByIdDao(paramsResult.data.id)
        if (!existing) {
            return resError(event, 404, 'API密钥不存在')
        }

        const apiKey = await updateModelApiKeyDao(paramsResult.data.id, bodyResult.data)
        return resSuccess(event, '更新API密钥成功', apiKey)
    } catch (error: any) {
        // 处理唯一性约束错误
        if (error.code === 'P2002') {
            return resError(event, 409, '该提供商下已存在同名密钥')
        }
        logger.error('更新API密钥失败：', error)
        return resError(event, 500, '更新API密钥失败')
    }
})
