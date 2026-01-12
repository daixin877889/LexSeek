/**
 * 重试 MinerU 任务
 *
 * POST /api/v1/admin/mineru-tasks/retry/:id
 * Requirements: 3.1.2.11, 3.1.2.12
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
        const task = await retryMineruTaskService(result.data.id)
        return resSuccess(event, '重试任务成功', task)
    } catch (error) {
        const message = error instanceof Error ? error.message : '重试任务失败'
        logger.error('重试 MinerU 任务失败：', error)
        return resError(event, 500, message)
    }
})
