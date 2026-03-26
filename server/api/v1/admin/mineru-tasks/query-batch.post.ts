/**
 * 批量查询 MinerU 任务状态
 *
 * POST /api/v1/admin/mineru-tasks/query-batch
 * Requirements: 3.1.2.7, 3.1.2.8, 3.1.2.9
 */

import { z } from 'zod'

/** 请求体验证 */
const bodySchema = z.object({
    ids: z.array(
        z.number({ message: '任务ID必须是数字' }).int('任务ID必须是整数').positive('任务ID必须是正整数')
    ).min(1, '至少选择一个任务').max(100, '最多选择100个任务'),
})

export default defineEventHandler(async (event) => {
    const body = await readBody(event)
    const result = bodySchema.safeParse(body)
    if (!result.success) {
        return resError(event, 400, '参数错误：' + result.error.issues[0]!!.message)
    }

    try {
        const batchResult = await queryMineruTaskStatusBatchService(result.data.ids)
        return resSuccess(event, '批量查询任务状态完成', batchResult)
    } catch (error) {
        logger.error('批量查询 MinerU 任务状态失败：', error)
        return resError(event, 500, '批量查询任务状态失败')
    }
})
