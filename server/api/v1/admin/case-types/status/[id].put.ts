/**
 * 切换案件类型状态
 *
 * PUT /api/v1/admin/case-types/status/:id
 * Requirements: 11.1
 */

import { z } from 'zod'

/** 路由参数验证 */
const paramsSchema = z.object({
    id: z.coerce.number().int().positive('ID必须是正整数'),
})

/** 请求体验证 */
const bodySchema = z.object({
    status: z.number()
        .int('状态必须是整数')
        .min(0, '状态值无效')
        .max(1, '状态值无效'),
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
        const caseType = await updateCaseTypeStatusService(
            paramsResult.data.id,
            bodyResult.data.status
        )
        return resSuccess(event, '更新案件类型状态成功', caseType)
    } catch (error: any) {
        // 处理业务逻辑错误
        if (error.message === '案件类型不存在') {
            return resError(event, 404, error.message)
        }
        logger.error('更新案件类型状态失败：', error)
        return resError(event, 500, '更新案件类型状态失败')
    }
})
