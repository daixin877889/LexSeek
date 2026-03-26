/**
 * 图片识别 API（base64 方式）
 *
 * 接收客户端上传的 base64 图片数据，调用豆包多模态模型进行识别
 * POST /api/v1/recognition/image
 */

import { z } from 'zod'
import {
    createImageRecognitionByBase64Service,
    SUPPORTED_IMAGE_TYPES,
} from '~~/server/services/material/ocr.service'

// 请求体验证 Schema
const bodySchema = z.object({
    base64Data: z.string()
        .min(1, 'base64Data 不能为空')
        .describe('图片 base64 数据（不含 data:image/xxx;base64, 前缀）'),
    mimeType: z.string()
        .min(1, 'mimeType 不能为空')
        .refine(
            (val) => SUPPORTED_IMAGE_TYPES.includes(val.toLowerCase()),
            `不支持的图片类型，支持的类型: ${SUPPORTED_IMAGE_TYPES.join(', ')}`
        )
        .describe('图片 MIME 类型（如 image/jpeg）'),
    ossFileId: z.number()
        .int()
        .positive('ossFileId 必须为正整数')
        .describe('关联的 OSS 文件 ID'),
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
        const result = bodySchema.safeParse(body)
        if (!result.success) {
            return resError(event, 400, result.error.issues[0]!!.message)
        }

        const { base64Data, mimeType, ossFileId } = result.data

        // 3. 调用识别服务
        const ocrResult = await createImageRecognitionByBase64Service(
            base64Data,
            mimeType,
            ossFileId,
            user.id
        )

        // 4. 返回结果
        if (!ocrResult.success) {
            // 如果有记录但识别失败，返回错误信息
            if (ocrResult.record) {
                return resError(event, 500, ocrResult.error || '图片识别失败')
            }
            return resError(event, 400, ocrResult.error || '图片识别失败')
        }

        return resSuccess(event, '图片识别成功', {
            id: ocrResult.record.id,
            imageType: ocrResult.record.imageType,
            markdownContent: ocrResult.record.markdownContent,
            htmlContent: ocrResult.record.htmlContent,
        })
    } catch (error: any) {
        logger.error('图片识别 API 错误', {
            error: error.message,
            stack: error.stack,
        })
        return resError(event, 500, '图片识别失败，请稍后重试')
    }
})
