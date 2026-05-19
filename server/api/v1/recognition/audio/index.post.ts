/**
 * 音频识别 API - 提交识别任务
 *
 * 接收客户端上传的 OSS 文件 ID，调用阿里云百炼 ASR 服务进行语音识别
 * POST /api/v1/recognition/audio
 *
 * 支持两种模式：
 * 1. 未加密文件：直接使用 ossFile.filePath 生成签名 URL
 * 2. 加密文件：前端解密后上传到临时目录，传入 tempFilePath 参数
 *
 * Requirements: 6.4.1, 6.7.2
 */

import { z } from 'zod'
import {
    transcribeAudioService,
    SUPPORTED_AUDIO_TYPES,
} from '~~/server/services/material/asr.service'
import { AsrTaskStatus } from '#shared/types/recognition'

// 请求体验证 Schema
const bodySchema = z.object({
    ossFileId: z.number()
        .int()
        .positive('ossFileId 必须为正整数')
        .describe('OSS 文件 ID'),
    audioDuration: z.number()
        .int()
        .positive('audioDuration 必须为正整数')
        .optional()
        .describe('音频时长（秒），如果未提供则使用预估值'),
    tempFilePath: z.string()
        .optional()
        .describe('临时文件路径（加密文件解密后上传的路径）'),
    options: z.object({
        languageHints: z.array(z.string())
            .optional()
            .default(['zh', 'en'])
            .describe('语言提示，默认 ["zh", "en"]'),
        diarizationEnabled: z.boolean()
            .optional()
            .default(true)
            .describe('是否启用说话人分离，默认 true'),
    }).default({
        languageHints: ['zh', 'en'],
        diarizationEnabled: true,
    }),
})

function isTempFilePathBoundToRequest(
    tempFilePath: string,
    userId: number,
    ossFileId: number,
): boolean {
    const normalized = tempFilePath.replace(/^\/+/, '')
    return new RegExp(`(^|/)temp/asr/user${userId}/file${ossFileId}/`).test(normalized)
}

export default defineEventHandler(async (event) => {
    try {
        // 1. 验证用户登录
        const user = event.context.auth?.user
        if (!user) {
            return resError(event, 401, '请先登录')
        }

        // 2. 验证请求参数
        const body = await readBody(event)
        logger.debug('音频识别 API 请求参数', { body, userId: user.id })

        const result = bodySchema.safeParse(body)
        if (!result.success) {
            logger.warn('音频识别 API 参数验证失败', { error: result.error.issues[0]!!.message })
            return resError(event, 400, result.error.issues[0]!!.message)
        }

        const { ossFileId, audioDuration, tempFilePath, options } = result.data

        // 如果前端没有传递音频时长，使用预估值（60 分钟）
        // TODO: 前端应该传递实际的音频时长以进行准确的积分检查
        const estimatedDuration = audioDuration || 3600 // 默认 60 分钟（3600 秒）

        // 3. 验证 OSS 文件是否存在且属于当前用户
        const ossFile = await prisma.ossFiles.findFirst({
            where: {
                id: ossFileId,
                userId: user.id,
                deletedAt: null,
            },
        })

        if (!ossFile) {
            logger.warn('音频识别 API 文件不存在', { ossFileId, userId: user.id })
            return resError(event, 404, '文件不存在或无权访问')
        }

        logger.debug('音频识别 API 文件信息', {
            ossFileId,
            fileName: ossFile.fileName,
            fileType: ossFile.fileType,
            encrypted: ossFile.encrypted,
            tempFilePath: tempFilePath || 'N/A',
        })

        // 4. 验证文件类型是否为支持的音频格式
        if (ossFile.fileType && !SUPPORTED_AUDIO_TYPES.includes(ossFile.fileType.toLowerCase())) {
            logger.warn('音频识别 API 不支持的音频类型', { fileType: ossFile.fileType })
            return resError(
                event,
                400,
                `不支持的音频类型 ${ossFile.fileType}，支持的类型: ${SUPPORTED_AUDIO_TYPES.join(', ')}`
            )
        }

        // 5. 验证临时文件路径格式（如果提供）
        // 临时文件路径必须绑定当前用户和原始文件，防止复用他人的临时对象
        if (tempFilePath) {
            if (!ossFile.encrypted) {
                logger.warn('音频识别 API 非加密文件不允许使用临时路径', { ossFileId })
                return resError(event, 400, '该文件未加密，请直接识别原文件')
            }
            if (!isTempFilePathBoundToRequest(tempFilePath, user.id, ossFileId)) {
                logger.warn('音频识别 API 临时文件路径格式错误', { tempFilePath })
                return resError(event, 400, '临时文件路径格式错误')
            }
        }

        // 6. 调用 ASR 服务提交识别任务
        logger.info('音频识别 API 开始提交任务', {
            ossFileId,
            userId: user.id,
            audioDuration: estimatedDuration,
            audioDurationProvided: !!audioDuration,
            tempFilePath: tempFilePath || 'N/A',
        })
        const submitResult = await transcribeAudioService(
            ossFileId,
            user.id,
            {
                languageHints: options.languageHints,
                diarizationEnabled: options.diarizationEnabled,
            },
            tempFilePath
        )

        // 7. 返回结果
        if (!submitResult.success) {
            logger.warn('音频识别 API 任务提交失败', { error: submitResult.error })
            return resError(event, 400, submitResult.error || '任务提交失败')
        }

        logger.info('音频识别 API 任务提交成功', {
            taskId: submitResult.task?.taskId,
            taskStatus: submitResult.task?.status,
            tempFilePath: tempFilePath || 'N/A',
        })

        return resSuccess(event, '任务已提交', {
            taskId: submitResult.task?.taskId || null,
            taskStatus: submitResult.task?.status || AsrTaskStatus.PROCESSING,
        })
    } catch (error: any) {
        logger.error('音频识别任务提交 API 错误', {
            error: error.message,
            stack: error.stack,
        })
        return resError(event, 500, '任务提交失败，请稍后重试')
    }
})
