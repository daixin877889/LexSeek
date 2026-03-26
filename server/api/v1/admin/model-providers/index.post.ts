/**
 * 创建模型提供商
 *
 * POST /api/v1/admin/model-providers
 */

import { z } from 'zod'

/** 请求体验证 */
const bodySchema = z.object({
    name: z.string({ error: (issue) => issue.input === undefined ? '名称不能为空' : '名称必须是字符串' })
        .min(1, '名称不能为空')
        .max(100, '名称不能超过100个字符'),
    baseUrl: z.string({ error: (issue) => issue.input === undefined ? 'API基础URL不能为空' : 'API基础URL必须是字符串' })
        .url('请输入有效的URL地址')
        .max(255, 'URL不能超过255个字符'),
    description: z.string()
        .max(500, '描述不能超过500个字符')
        .optional(),
})

export default defineEventHandler(async (event) => {
    const body = await readBody(event)
    const result = bodySchema.safeParse(body)
    if (!result.success) {
        return resError(event, 400, '参数错误：' + result.error.issues[0]!!.message)
    }

    try {
        // 检查名称是否已存在
        const existing = await findModelProviderByNameDao(result.data.name)
        if (existing) {
            return resError(event, 409, '提供商名称已存在')
        }

        const provider = await createModelProviderDao(result.data)
        return resSuccess(event, '创建模型提供商成功', provider)
    } catch (error) {
        logger.error('创建模型提供商失败：', error)
        return resError(event, 500, '创建模型提供商失败')
    }
})
