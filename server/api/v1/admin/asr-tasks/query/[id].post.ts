/**
 * 查询单个 ASR 任务状态
 *
 * POST /api/v1/admin/asr-tasks/query/:id
 * Requirements: 3.2.1.4, 3.2.1.5, 3.2.1.6
 */

import { z } from 'zod'

/** 路由参数验证 */
const paramsSchema = z.object({
    id: z.coerce.number().int().positive('ID必须是正整数'),
})

export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id')
    const result = paramsSchema.safeParse({ id })
    if (!result.success) {
        return resError(event, 400, '参数错误：' + result.error.issues[0].message)
    }

    try {
        const task = await queryAsrTaskStatusService(result.data.id)
        return resSuccess(event, '查询任务状态成功', task)
    } catch (error) {
        const message = error instanceof Error ? error.message : '查询任务状态失败'
        logger.error('查询 ASR 任务状态失败：', error)
        return resError(event, 500, message)
    }
})
