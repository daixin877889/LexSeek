/**
 * 统一识别状态查询 API
 *
 * GET /api/v1/recognition/status/:ossFileId
 *
 * 统一查询文档、图像、音频三种识别记录的状态
 * 返回一致的格式，前端只需调用一个接口
 *
 * @requirements 1.1, 1.2, 1.3, 1.4, 5.3, 5.6, 6.4.2
 */

import { z } from 'zod'
import { findDocRecognitionByOssFileIdDao } from '~~/server/services/material/mineru.dao'
import { findImageRecognitionByOssFileIdDao } from '~~/server/services/material/ocr.dao'
import { findAsrRecordByOssFileIdDao } from '~~/server/services/material/asr.dao'
import { getMineruTaskByOssFileIdService } from '~~/server/services/material/mineruTask.service'
import { DocRecognitionStatus, ImageRecognitionStatus, AsrRecordStatus, MineruTaskStatus } from '#shared/types/recognition'

// 路由参数验证 Schema
const paramsSchema = z.object({
    ossFileId: z.string()
        .regex(/^\d+$/, 'ossFileId 必须为数字')
        .transform(Number)
        .describe('OSS 文件 ID'),
})

/** 统一识别状态响应 */
export interface UnifiedRecognitionStatusResponse {
    /** 是否已识别成功 */
    recognized: boolean
    /** 识别状态：0-待处理，1-处理中，2-成功，3-失败 */
    status: number
    /** 识别记录类型：doc-文档识别，image-图像识别，audio-音频识别 */
    recordType: 'doc' | 'image' | 'audio' | 'unknown'
}

export default defineEventHandler(async (event) => {
    try {
        // 1. 验证用户登录
        const user = event.context.auth?.user
        if (!user) {
            return resError(event, 401, '请先登录')
        }

        // 2. 验证路由参数
        const params = { ossFileId: getRouterParam(event, 'ossFileId') }
        const paramsResult = paramsSchema.safeParse(params)
        if (!paramsResult.success) {
            return resError(event, 400, paramsResult.error.issues[0]!?.message)
        }

        const { ossFileId } = paramsResult.data

        // owner-only：仅允许查询自己拥有的 OSS 文件的识别状态
        const ossFile = await prisma.ossFiles.findFirst({
            where: { id: ossFileId, userId: user.id, deletedAt: null },
            select: { id: true },
        })
        if (!ossFile) {
            return resError(event, 404, '文件不存在')
        }

        // 3. 依次查询四种识别相关表
        // 先查询 MinerU 任务表（文档识别的异步任务）
        const mineruTask = await getMineruTaskByOssFileIdService(ossFileId)

        // 再查询文档识别记录（识别成功后的结果）
        const docRecord = await findDocRecognitionByOssFileIdDao(ossFileId)

        // 再查询图像识别记录
        const imageRecord = await findImageRecognitionByOssFileIdDao(ossFileId)

        // 最后查询音频识别记录
        const asrRecord = await findAsrRecordByOssFileIdDao(ossFileId)

        // 4. 找到第一条记录后，根据记录类型返回对应状态
        let response: UnifiedRecognitionStatusResponse

        if (mineruTask) {
            // mineruTask 表无 summary 字段；mineruTask 命中通常说明 docRecord 还未创建
            // 或摘要未生成 → recognized=false 让前端继续轮询
            const isRecognized = false
            const statusMap: Record<number, number> = {
                [MineruTaskStatus.PENDING]: 0,
                [MineruTaskStatus.PROCESSING]: 1,
                [MineruTaskStatus.SUCCESS]: 2,
                [MineruTaskStatus.FAILED]: 3,
            }
            response = {
                recognized: isRecognized,
                status: statusMap[mineruTask.status] ?? 0,
                recordType: 'doc',
            }
        } else if (docRecord) {
            // 文档识别记录
            const isRecognized = docRecord.status === DocRecognitionStatus.SUCCESS && !!docRecord.summary
            response = {
                recognized: isRecognized,
                status: docRecord.status,
                recordType: 'doc',
            }
        } else if (imageRecord) {
            // 图像识别记录
            const isRecognized = imageRecord.status === ImageRecognitionStatus.COMPLETED && !!imageRecord.summary
            response = {
                recognized: isRecognized,
                status: imageRecord.status,
                recordType: 'image',
            }
        } else if (asrRecord) {
            // 音频识别记录
            const isRecognized = asrRecord.status === AsrRecordStatus.SUCCESS && !!asrRecord.summary
            response = {
                recognized: isRecognized,
                status: asrRecord.status,
                recordType: 'audio',
            }
        } else {
            // 没有找到任何识别记录，返回待处理状态
            response = {
                recognized: false,
                status: 0, // PENDING
                recordType: 'unknown',
            }
        }

        return resSuccess(event, '查询成功', response)
    } catch (error: any) {
        logger.error('统一查询识别状态 API 错误', {
            error: error.message,
            stack: error.stack,
        })
        return resError(event, 500, '查询识别状态失败')
    }
})
