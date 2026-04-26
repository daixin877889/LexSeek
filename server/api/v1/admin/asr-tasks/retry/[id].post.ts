/**
 * 重试 ASR 任务
 *
 * POST /api/v1/admin/asr-tasks/retry/:id
 * Requirements: 3.2.1.11, 3.2.1.12
 */

import { z } from 'zod'
import { retryAsrTaskService } from '~~/server/services/material/asrTask.service'

/** 路由参数验证 */
const paramsSchema = z.object({
    id: z.coerce.number().int().positive('ID必须是正整数'),
})

export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id')
    const result = paramsSchema.safeParse({ id })
    if (!result.success) {
        return resError(event, 400, '参数错误：' + result.error.issues[0]!!.message)
    }

    try {
        const task = await retryAsrTaskService(result.data.id)
        return resSuccess(event, '重试任务成功', task)
    } catch (error) {
        const message = error instanceof Error ? error.message : '重试任务失败'
        logger.error('重试 ASR 任务失败：', error)
        return resError(event, 500, message)
    }
})
