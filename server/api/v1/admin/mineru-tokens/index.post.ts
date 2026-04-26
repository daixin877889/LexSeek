/**
 * 创建 MinerU Token
 *
 * POST /api/v1/admin/mineru-tokens
 * Requirements: 3.1.1.2
 */

import { z } from 'zod'
import { createMineruTokenService } from '~~/server/services/material/mineruToken.service'

/** 请求体验证 */
const bodySchema = z.object({
    name: z.string()
        .min(1, 'Token 名称不能为空')
        .max(100, 'Token 名称不能超过100个字符'),
    token: z.string()
        .min(1, 'Token 值不能为空')
        .max(500, 'Token 值不能超过500个字符'),
    remark: z.string()
        .max(255, '备注不能超过255个字符')
        .optional()
        .nullable(),
    status: z.number()
        .int('状态必须是整数')
        .min(0, '状态值无效')
        .max(1, '状态值无效')
        .default(1),
})

export default defineEventHandler(async (event) => {
    const body = await readBody(event)
    const result = bodySchema.safeParse(body)
    if (!result.success) {
        return resError(event, 400, '参数错误：' + result.error.issues[0]!!.message)
    }

    try {
        const token = await createMineruTokenService(result.data)
        return resSuccess(event, '创建 MinerU Token 成功', token)
    } catch (error: any) {
        // 处理业务逻辑错误
        if (error.message === 'Token 名称已存在') {
            return resError(event, 409, error.message)
        }
        logger.error('创建 MinerU Token 失败：', error)
        return resError(event, 500, '创建 MinerU Token 失败')
    }
})
