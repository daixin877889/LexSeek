/**
 * 获取 ASR 任务详情
 *
 * GET /api/v1/admin/asr-tasks/:id
 * Requirements: 3.2.1.10
 */

import { z } from 'zod'
import { getAsrTaskByIdService } from '~~/server/services/material/asrTask.service'

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
        const task = await getAsrTaskByIdService(result.data.id)
        if (!task) {
            return resError(event, 404, '任务不存在')
        }
        return resSuccess(event, '获取 ASR 任务详情成功', task)
    } catch (error) {
        logger.error('获取 ASR 任务详情失败：', error)
        return resError(event, 500, '获取 ASR 任务详情失败')
    }
})
