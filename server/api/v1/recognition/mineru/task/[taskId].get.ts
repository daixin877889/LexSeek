/**
 * 查询 MinerU 任务状态 API
 *
 * 根据任务 ID 查询任务的当前状态
 * GET /api/v1/recognition/mineru/task/:taskId
 *
 * 返回：
 * - taskId: 任务 ID
 * - status: 任务状态（PROCESSING, SUCCESS, FAILED）
 * - recordId: 识别记录 ID（成功时返回）
 * - errorMsg: 错误信息（失败时返回）
 */

import { z } from 'zod'
import { getMineruTaskByTaskIdService, getMineruTaskByIdService } from '~~/server/services/material/mineruTask.service'
import { findDocRecognitionByOssFileIdDao } from '~~/server/services/material/mineru.dao'
import { MineruTaskStatus } from '#shared/types/recognition'

// 路由参数验证
const paramsSchema = z.object({
    taskId: z.string().min(1, 'taskId 不能为空'),
})

/** 任务状态响应 */
interface TaskStatusResponse {
    /** 任务 ID */
    taskId: string
    /** 任务状态 */
    status: number
    /** 识别记录 ID（成功时返回） */
    recordId: number | null
    /** 错误信息（失败时返回） */
    errorMsg: string | null
}

export default defineEventHandler(async (event) => {
    try {
        // 1. 验证用户登录
        const user = event.context.auth?.user
        if (!user) {
            return resError(event, 401, '请先登录')
        }

        // 2. 验证路由参数
        const params = getRouterParams(event)
        const paramsResult = paramsSchema.safeParse(params)
        if (!paramsResult.success) {
            return resError(event, 400, paramsResult.error.issues[0]!?.message || '参数错误')
        }

        const { taskId: taskIdParam } = paramsResult.data

        // 3. 查询任务记录
        // 支持两种查询方式：
        // - 数字：通过数据库 ID 查询（前端提交后返回的 ID）
        // - 字符串：通过 MinerU taskId 查询（回调时使用）
        let task: any = null

        if (/^\d+$/.test(taskIdParam)) {
            // 数字 ID：通过数据库 ID 查询
            const id = parseInt(taskIdParam, 10)
            task = await getMineruTaskByIdService(id)
        } else {
            // 字符串 ID：通过 MinerU taskId 查询
            task = await getMineruTaskByTaskIdService(taskIdParam)
        }

        if (!task) {
            return resError(event, 404, '任务不存在')
        }

        // owner-only：任务必须属于当前用户
        if (task.userId !== user.id) {
            return resError(event, 404, '任务不存在')
        }

        // 4. 查询识别记录（如果任务成功）
        let recordId: number | null = null
        if (task.status === MineruTaskStatus.SUCCESS) {
            const record = await findDocRecognitionByOssFileIdDao(task.ossFileId)
            recordId = record?.id || null
        }

        // 5. 返回任务状态
        const response: TaskStatusResponse = {
            taskId: task.id.toString(),
            status: task.status,
            recordId,
            errorMsg: task.errorMsg || null,
        }

        return resSuccess(event, '查询成功', response)
    } catch (error: any) {
        logger.error('查询 MinerU 任务状态 API 错误', {
            error: error.message,
            stack: error.stack,
        })
        return resError(event, 500, '查询失败，请稍后重试')
    }
})
