/**
 * 临时文件上传签名 API
 *
 * 为加密音频文件解密后上传到临时目录生成签名
 * 临时文件不创建 ossFiles 记录，识别完成后自动删除
 *
 * POST /api/v1/recognition/audio/temp-upload
 *
 * Requirements: 6.7.1
 */

import { z } from 'zod'
import { v7 as uuidv7 } from 'uuid'
import dayjs from 'dayjs'
import { StorageProviderType } from '~~/server/lib/storage/types'
import { SUPPORTED_AUDIO_TYPES } from '~~/server/services/material/asr.service'
import { getExtensionFromFileName } from '#shared/utils/file'
import { mime } from '#shared/utils/mime'
import { generatePostSignatureService } from '~~/server/services/storage/storage.service'
import { buildStorageDir } from '~~/server/utils/storagePath'
import { FileSource } from '#shared/types/file'

// 请求体验证 Schema
const bodySchema = z.object({
    ossFileId: z.number()
        .int()
        .positive('ossFileId 必须为正整数')
        .describe('原始加密文件的 OSS 文件 ID'),
    fileName: z.string()
        .min(1, '文件名不能为空')
        .describe('原始文件名（用于获取扩展名）'),
    fileSize: z.number()
        .int()
        .positive('文件大小必须为正整数')
        .describe('解密后文件大小（字节）'),
    mimeType: z.string()
        .min(1, 'MIME 类型不能为空')
        .describe('音频 MIME 类型'),
})

export default defineEventHandler(async (event) => {
    try {
        // 1. 验证用户登录
        const user = event.context.auth?.user
        if (!user) {
            return resError(event, 401, '请先登录')
        }

        // 2. 验证请求参数
        const body = await readBody(event)
        logger.debug('临时文件上传签名 API 请求参数', { body, userId: user.id })

        const result = bodySchema.safeParse(body)
        if (!result.success) {
            logger.warn('临时文件上传签名 API 参数验证失败', {
                error: result.error.issues[0]!!.message,
            })
            return resError(event, 400, result.error.issues[0]!!.message)
        }

        const { ossFileId, fileName, fileSize, mimeType } = result.data

        // 3. 验证 MIME 类型是否为支持的音频格式
        if (!SUPPORTED_AUDIO_TYPES.includes(mimeType.toLowerCase())) {
            logger.warn('临时文件上传签名 API 不支持的音频类型', { mimeType })
            return resError(
                event,
                400,
                `不支持的音频类型 ${mimeType}，支持的类型: ${SUPPORTED_AUDIO_TYPES.join(', ')}`
            )
        }

        // 4. 验证原始 OSS 文件是否存在且属于当前用户
        const ossFile = await prisma.ossFiles.findFirst({
            where: {
                id: ossFileId,
                userId: user.id,
                deletedAt: null,
            },
        })

        if (!ossFile) {
            logger.warn('临时文件上传签名 API 原始文件不存在', {
                ossFileId,
                userId: user.id,
            })
            return resError(event, 404, '原始文件不存在或无权访问')
        }

        // 5. 验证原始文件是否为加密文件
        if (!ossFile.encrypted) {
            logger.warn('临时文件上传签名 API 文件未加密，无需使用临时上传', {
                ossFileId,
                encrypted: ossFile.encrypted,
            })
            return resError(event, 400, '该文件未加密，请直接使用音频识别 API')
        }

        // 6. 获取并验证原始文件的 MIME 类型
        // 优先使用数据库中的 originalMimeType，这是加密前的真实 MIME 类型
        const actualMimeType = ossFile.originalMimeType || mimeType
        if (!actualMimeType || !SUPPORTED_AUDIO_TYPES.includes(actualMimeType.toLowerCase())) {
            logger.warn('临时文件上传签名 API 原始文件不是音频类型', {
                ossFileId,
                originalMimeType: ossFile.originalMimeType,
                requestMimeType: mimeType,
            })
            return resError(event, 400, '原始文件不是支持的音频类型')
        }

        // 7. 生成临时文件路径
        const now = dayjs()
        const year = now.format('YYYY')
        const month = now.format('MM')
        const day = now.format('DD')

        // 从文件名获取扩展名，或从 MIME 类型推断
        const extension = getExtensionFromFileName(fileName) || mime.getExtension(actualMimeType) || 'mp3'
        const tempFileName = `${uuidv7()}.${extension}`
        const tempDir = buildStorageDir({
            scope: 'temp',
            source: FileSource.ASR,
            subDir: `user${user.id}/file${ossFileId}/${year}/${month}/${day}`,
        })
        const tempFilePath = `${tempDir}${tempFileName}`

        logger.debug('临时文件上传签名 API 生成临时路径', {
            ossFileId,
            tempFilePath,
            extension,
            actualMimeType,
        })

        // 8. 生成上传签名（不创建 ossFiles 记录）
        // 临时文件不需要回调，直接上传即可
        const signature = await generatePostSignatureService({
            dir: tempDir,
            fileKey: {
                originalFileName: fileName,
                strategy: 'custom',
                customFileName: tempFileName,
            },
            expirationMinutes: 30, // 临时上传签名有效期 30 分钟
            conditions: {
                // 限制文件大小（允许 10% 的误差，因为解密后大小可能略有不同）
                contentLengthRange: [0, Math.ceil(fileSize * 1.1)],
                // 使用实际的音频 MIME 类型
                contentType: [actualMimeType],
            },
            // 不设置回调，临时文件不需要回调处理
            userId: user.id,
            type: StorageProviderType.ALIYUN_OSS,
        })

        logger.info('临时文件上传签名 API 生成签名成功', {
            ossFileId,
            userId: user.id,
            tempFilePath,
            actualMimeType,
        })

        // 9. 返回签名结果，包含临时文件路径和实际 MIME 类型
        return resSuccess(event, '获取临时上传签名成功', {
            ...signature,
            key: tempFilePath, // 确保返回完整的临时文件路径
            mimeType: actualMimeType, // 返回实际的 MIME 类型，前端上传时使用
        })
    } catch (error: any) {
        logger.error('临时文件上传签名 API 错误', {
            error: error.message,
            stack: error.stack,
        })
        return resError(event, 500, '获取临时上传签名失败，请稍后重试')
    }
})
