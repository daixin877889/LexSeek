/**
 * 更新 MinerU Token
 *
 * PUT /api/v1/admin/mineru-tokens/:id
 * Requirements: 3.1.1.3
 */

import { z } from 'zod'

/** 路由参数验证 */
const paramsSchema = z.object({
    id: z.coerce.number().int().positive('ID必须是正整数'),
})

/** 请求体验证 */
const bodySchema = z.object({
    name: z.string()
        .min(1, 'Token 名称不能为空')
        .max(100, 'Token 名称不能超过100个字符')
        .optional(),
    token: z.string()
        .min(1, 'Token 值不能为空')
        .max(500, 'Token 值不能超过500个字符')
        .optional(),
    remark: z.string()
        .max(255, '备注不能超过255个字符')
        .optional()
        .nullable(),
    status: z.number()
        .int('状态必须是整数')
        .min(0, '状态值无效')
        .max(1, '状态值无效')
        .optional(),
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
        const token = await updateMineruTokenService(paramsResult.data.id, bodyResult.data)
        return resSuccess(event, '更新 MinerU Token 成功', token)
    } catch (error: any) {
        // 处理业务逻辑错误
        if (error.message === 'Token 不存在') {
            return resError(event, 404, error.message)
        }
        if (error.message === 'Token 名称已存在') {
            return resError(event, 409, error.message)
        }
        logger.error('更新 MinerU Token 失败：', error)
        return resError(event, 500, '更新 MinerU Token 失败')
    }
})
