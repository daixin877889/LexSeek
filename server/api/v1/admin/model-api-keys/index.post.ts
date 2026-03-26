/**
 * 创建模型 API 密钥
 *
 * POST /api/v1/admin/model-api-keys
 */

import { z } from 'zod'

/** 请求体验证 */
const bodySchema = z.object({
    providerId: z.number({ error: (issue) => issue.input === undefined ? '提供商ID不能为空' : '提供商ID必须是数字' })
        .int('提供商ID必须是整数')
        .positive('提供商ID必须是正整数'),
    name: z.string({ error: (issue) => issue.input === undefined ? '密钥名称不能为空' : '密钥名称必须是字符串' })
        .min(1, '密钥名称不能为空')
        .max(100, '密钥名称不能超过100个字符'),
    apiKey: z.string({ error: (issue) => issue.input === undefined ? 'API密钥不能为空' : 'API密钥必须是字符串' })
        .min(1, 'API密钥不能为空')
        .max(255, 'API密钥不能超过255个字符'),
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
    const body = await readBody(event)
    const result = bodySchema.safeParse(body)
    if (!result.success) {
        return resError(event, 400, '参数错误：' + result.error.issues[0]!!.message)
    }

    try {
        // 检查提供商是否存在
        const provider = await findModelProviderByIdDao(result.data.providerId)
        if (!provider) {
            return resError(event, 400, '关联的提供商不存在')
        }

        const apiKey = await createModelApiKeyDao(result.data)
        return resSuccess(event, '创建API密钥成功', apiKey)
    } catch (error: any) {
        // 处理唯一性约束错误
        if (error.code === 'P2002') {
            return resError(event, 409, '该提供商下已存在同名密钥')
        }
        logger.error('创建API密钥失败：', error)
        return resError(event, 500, '创建API密钥失败')
    }
})
