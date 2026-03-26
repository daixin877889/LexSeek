/**
 * 音频识别 API - 查询任务状态和结果
 *
 * 根据 ASR 识别记录 ID 查询任务状态和识别结果
 * GET /api/v1/recognition/audio/:id
 *
 * Requirements: 6.4.2
 */

import { z } from 'zod'
import {
    getAsrRecordByIdService,
} from '~~/server/services/material/asr.service'
import { generateSignedUrlService } from '~~/server/services/storage/storage.service'

// 路由参数验证 Schema
const paramsSchema = z.object({
    id: z.string()
        .regex(/^\d+$/, 'id 必须为数字')
        .transform(Number)
        .describe('ASR 识别记录 ID'),
})

/** 说话人信息 */
interface Speaker {
    id: number
    name: string
    color?: string
}

/** 识别结果句子信息 */
interface SentenceResult {
    text: string
    begin_time: number
    end_time: number
    speaker_id: number
    sentence_id: number
}

export default defineEventHandler(async (event) => {
    try {
        // 1. 验证用户登录
        const user = event.context.auth?.user
        if (!user) {
            return resError(event, 401, '请先登录')
        }

        // 2. 验证路由参数
        const params = { id: getRouterParam(event, 'id') }
        const paramsResult = paramsSchema.safeParse(params)
        if (!paramsResult.success) {
            return resError(event, 400, paramsResult.error.issues[0]!.message)
        }

        const { id } = paramsResult.data

        // 3. 查询 ASR 识别记录
        const record = await getAsrRecordByIdService(id)
        if (!record) {
            return resError(event, 404, '识别记录不存在')
        }

        // 4. 验证记录是否属于当前用户
        if (record.userId !== user.id) {
            return resError(event, 403, '无权访问该记录')
        }

        // 5. 获取关联的 OSS 文件信息以生成音频访问 URL
        let audioUrl = record.audioUrl || ''
        if (!audioUrl && record.ossFileId) {
            const ossFile = await prisma.ossFiles.findFirst({
                where: {
                    id: record.ossFileId,
                    deletedAt: null,
                },
            })
            if (ossFile?.filePath) {
                // 生成签名 URL（1 小时有效期）
                audioUrl = await generateSignedUrlService(ossFile.filePath, {
                    expires: 3600,
                })
            }
        }

        // 6. 解析识别结果
        let resultSentences: SentenceResult[] = []
        const resultData = record.result as Record<string, any> | null

        if (resultData && resultData.transcripts) {
            // 从精简后的结果中提取句子列表
            // 结果格式：{ transcripts: [{ sentences: [...] }] }
            for (const transcript of resultData.transcripts) {
                if (Array.isArray(transcript.sentences)) {
                    resultSentences = resultSentences.concat(
                        transcript.sentences.map((sentence: any) => ({
                            text: sentence.text || '',
                            begin_time: sentence.begin_time || 0,
                            end_time: sentence.end_time || 0,
                            speaker_id: sentence.speaker_id ?? 0,
                            sentence_id: sentence.sentence_id ?? 0,
                        }))
                    )
                }
            }
        }

        // 7. 解析说话人信息
        let speakers: Speaker[] = []
        if (Array.isArray(record.speakers)) {
            speakers = (record.speakers as any[]).map((speaker: any) => ({
                id: speaker.id ?? 0,
                name: speaker.name || `说话人 ${(speaker.id ?? 0) + 1}`,
                color: speaker.color || '#3B82F6',
            }))
        }

        // 8. 返回结果
        return resSuccess(event, '查询成功', {
            id: record.id,
            status: record.status,
            audioUrl,
            audioDuration: record.audioDuration || 0,
            speakers,
            result: resultSentences,
        })
    } catch (error: any) {
        logger.error('查询音频识别记录 API 错误', {
            error: error.message,
            stack: error.stack,
        })
        return resError(event, 500, '查询失败，请稍后重试')
    }
})
