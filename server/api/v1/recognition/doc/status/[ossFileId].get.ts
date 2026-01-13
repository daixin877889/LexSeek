/**
 * 检查文档识别状态 API
 *
 * GET /api/v1/recognition/doc/status/:ossFileId
 *
 * 检查指定 OSS 文件的识别状态，返回是否已识别及识别记录详情
 *
 * @requirements 1.1, 1.2, 1.3, 1.4
 */

import { z } from 'zod'
import { DocRecognitionStatus } from '~~/server/services/material/mineru.service'

// 路由参数验证
const paramsSchema = z.object({
    ossFileId: z.string().regex(/^\d+$/, 'ossFileId 必须是数字').transform(Number),
})

/**
 * 识别状态响应
 */
interface CheckStatusResponse {
    /** 是否已识别成功 */
    recognized: boolean
    /** 识别状态：0-待处理，1-处理中，2-成功，3-失败 */
    status?: number
    /** 识别记录（如果存在） */
    record?: {
        id: number
        htmlContent?: string | null
        markdownContent?: string | null
        vectorIds?: string[]
        lastEmbeddingAt?: string | null
    }
}

export default defineEventHandler(async (event) => {
    // 验证用户登录
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 验证路由参数
    const params = getRouterParams(event)
    const paramsResult = paramsSchema.safeParse(params)
    if (!paramsResult.success) {
        return resError(event, 400, paramsResult.error.issues[0]?.message || '参数错误')
    }

    const { ossFileId } = paramsResult.data

    try {
        // 查询识别记录
        const record = await findDocRecognitionByOssFileIdDao(ossFileId)

        // 如果不存在记录
        if (!record) {
            return resSuccess(event, '查询成功', {
                recognized: false,
            } as CheckStatusResponse)
        }

        // 根据状态判断是否已识别
        const isRecognized = record.status === DocRecognitionStatus.SUCCESS

        // 构建响应
        const response: CheckStatusResponse = {
            recognized: isRecognized,
            status: record.status,
        }

        // 如果存在记录，返回详情
        if (record) {
            response.record = {
                id: record.id,
                htmlContent: record.htmlContent,
                markdownContent: record.markdownContent,
                vectorIds: (record.vectorIds as string[]) || [],
                lastEmbeddingAt: record.lastEmbeddingAt?.toISOString() || null,
            }
        }

        return resSuccess(event, '查询成功', response)
    } catch (error) {
        logger.error('查询文档识别状态失败:', error)
        return resError(event, 500, '查询识别状态失败')
    }
})
