/**
 * 查询 ASR 任务状态 API
 *
 * 根据任务 ID 查询任务的当前状态
 * GET /api/v1/recognition/audio/task/:taskId
 *
 * 返回：
 * - taskId: 任务 ID
 * - status: 任务状态（PROCESSING, SUCCESS, FAILED）
 * - recordId: 识别记录 ID（成功时返回）
 */

import { getAsrTaskByTaskIdService } from '~~/server/services/material/asrTask.service'
import { findAsrRecordsByTaskIdDao } from '~~/server/services/material/asr.dao'

export default defineEventHandler(async (event) => {
    try {
        // 1. 验证用户登录
        const user = event.context.auth?.user
        if (!user) {
            return resError(event, 401, '请先登录')
        }

        // 2. 获取任务 ID
        const taskId = getRouterParam(event, 'taskId')
        if (!taskId) {
            return resError(event, 400, '缺少任务 ID')
        }

        // 3. 查询任务记录
        const task = await getAsrTaskByTaskIdService(taskId)
        if (!task) {
            return resError(event, 404, '任务不存在')
        }

        // 4. 查询识别记录（如果存在）
        const records = await findAsrRecordsByTaskIdDao(task.id)
        const record = records.length > 0 ? records[0] : null

        const taskRawData = task.taskRawData as Record<string, unknown> | null
        const taskUserId = typeof taskRawData?.userId === 'number' ? taskRawData.userId : null
        if (record) {
            if (record.userId !== user.id) {
                return resError(event, 404, '任务不存在')
            }
        } else if (taskUserId !== user.id) {
            return resError(event, 404, '任务不存在')
        }

        // 5. 返回任务状态
        return resSuccess(event, '查询成功', {
            taskId: task.taskId,
            status: task.status,
            recordId: record?.id || null,
            recordStatus: record?.status || null,
        })
    } catch (error: any) {
        logger.error('查询 ASR 任务状态 API 错误', {
            error: error.message,
            stack: error.stack,
        })
        return resError(event, 500, '查询失败，请稍后重试')
    }
})
