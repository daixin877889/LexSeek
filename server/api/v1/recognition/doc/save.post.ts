/**
 * 保存文档识别结果 API
 *
 * POST /api/v1/recognition/doc/save
 *
 * 保存浏览器端识别的 docx 文件内容，并进行向量嵌入
 * 嵌入时不需要 caseId 和 sessionId，使用通用元数据结构
 *
 * @requirements 4.1, 4.2, 4.3, 4.4
 */

import { z } from 'zod'
import { embedDocumentService } from '~~/server/services/material/materialEmbedding.service'
import { sanitizeRichHtml } from '~~/server/utils/htmlSanitizer'
import { DocRecognitionStatus } from '#shared/types/recognition'
import { createDocRecognitionRecordDao, findDocRecognitionByOssFileIdDao, updateDocRecognitionRecordByIdAndUserIdDao } from '~~/server/services/material/mineru.dao'
import { findOssFilesByIdsAndUserIdDao } from '~~/server/services/files/ossFiles.dao'

// 请求体验证
const bodySchema = z.object({
    /** OSS 文件 ID */
    ossFileId: z.number().int().positive('ossFileId 必须是正整数'),
    /** HTML 内容 */
    htmlContent: z.string().min(1, 'htmlContent 不能为空'),
    /** Markdown 内容 */
    markdownContent: z.string().min(1, 'markdownContent 不能为空'),
    /** 原始文件名（用于嵌入元数据） */
    fileName: z.string().optional(),
})

/**
 * 保存识别结果响应
 */
interface SaveRecognitionResponse {
    /** 识别记录 ID */
    id: number
    /** 向量 ID 列表 */
    vectorIds: string[]
    /** 嵌入时间 */
    lastEmbeddingAt: string | null
}

export default defineEventHandler(async (event) => {
    // 验证用户登录
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 验证请求体
    const body = await readBody(event)
    const bodyResult = bodySchema.safeParse(body)
    if (!bodyResult.success) {
        return resError(event, 400, bodyResult.error.issues[0]!?.message || '参数错误')
    }

    const { ossFileId, markdownContent, fileName } = bodyResult.data
    // 净化客户端提交的 HTML，防止存储型 XSS
    const htmlContent = sanitizeRichHtml(bodyResult.data.htmlContent)

    try {
        // owner-only：仅允许向属于当前用户的 OSS 文件写入识别结果
        const ownedFiles = await findOssFilesByIdsAndUserIdDao([ossFileId], user.id)
        const ossFile = ownedFiles[0]

        if (!ossFile) {
            return resError(event, 404, '文件不存在')
        }

        // 使用传入的文件名或从 OSS 文件记录获取
        const actualFileName = fileName || ossFile.fileName

        // 查询是否已有识别记录
        let record = await findDocRecognitionByOssFileIdDao(ossFileId)

        if (record && record.userId !== user.id) {
            logger.warn('文档识别记录归属异常，拒绝保存', {
                ossFileId,
                recordId: record.id,
                recordUserId: record.userId,
                requestUserId: user.id,
            })
            return resError(event, 409, '识别记录归属异常，请重新上传文件')
        }

        if (record) {
            // 更新现有记录
            record = await updateDocRecognitionRecordByIdAndUserIdDao(record.id, user.id, {
                status: DocRecognitionStatus.SUCCESS,
                htmlContent,
                markdownContent,
            })
            if (!record) {
                logger.warn('文档识别记录归属异常，拒绝更新', {
                    ossFileId,
                    requestUserId: user.id,
                })
                return resError(event, 409, '识别记录归属异常，请重新上传文件')
            }
        } else {
            // 创建新记录
            record = await createDocRecognitionRecordDao({
                userId: user.id,
                ossFileId,
                status: DocRecognitionStatus.SUCCESS,
            })

            // 更新内容
            record = await updateDocRecognitionRecordByIdAndUserIdDao(record.id, user.id, {
                htmlContent,
                markdownContent,
            })
            if (!record) {
                logger.warn('文档识别记录创建后归属异常，拒绝保存', {
                    ossFileId,
                    requestUserId: user.id,
                })
                return resError(event, 409, '识别记录归属异常，请重新上传文件')
            }
        }

        // 进行向量嵌入（使用新的通用元数据结构，不需要 caseId 和 sessionId）
        let vectorIds: string[] = []
        let lastEmbeddingAt: Date | null = null

        try {
            const embeddingResult = await embedDocumentService({
                content: markdownContent,
                userId: user.id,
                ossFileId,
                fileName: actualFileName,
            })

            vectorIds = embeddingResult.ids
            lastEmbeddingAt = new Date(embeddingResult.lastEmbeddingAt)

            // 更新记录的向量信息
            const embeddingRecord = await updateDocRecognitionRecordByIdAndUserIdDao(record.id, user.id, {
                vectorIds,
                lastEmbeddingAt,
            })
            if (!embeddingRecord) {
                logger.warn('文档识别记录归属异常，跳过向量信息更新', {
                    ossFileId,
                    recordId: record.id,
                    requestUserId: user.id,
                })
                vectorIds = []
                lastEmbeddingAt = null
            }

            logger.info(`文档 ${ossFileId} 嵌入完成`, {
                chunkCount: embeddingResult.chunkCount,
                vectorIds: vectorIds.length,
            })
        } catch (embeddingError) {
            // 向量嵌入失败不影响识别结果保存，记录日志
            logger.error('向量嵌入失败:', embeddingError)
        }

        const response: SaveRecognitionResponse = {
            id: record.id,
            vectorIds,
            lastEmbeddingAt: lastEmbeddingAt?.toISOString() || null,
        }

        return resSuccess(event, '保存成功', response)
    } catch (error) {
        logger.error('保存文档识别结果失败:', error)
        return resError(event, 500, '保存识别结果失败')
    }
})
