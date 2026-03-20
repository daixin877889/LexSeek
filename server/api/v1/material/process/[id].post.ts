/**
 * 处理材料
 *
 * POST /api/v1/material/process/:id
 *
 * 根据材料类型调用对应的处理服务：
 * - PDF：调用 MinerU 服务
 * - 图片：调用 OCR 服务
 * - 音频：调用 ASR 服务
 * Requirements: 3.8, 3.10, 3.11
 */

import { z } from 'zod'
import {
    processMaterialService,
    MaterialProcessError,
} from '~~/server/services/material/materialProcess.service'

// 路径参数验证
const paramsSchema = z.object({
    id: z.coerce.number({ message: '材料 ID 必须为数字' }).int().positive({ message: '材料 ID 必须为正整数' }),
})

// 请求体验证（可选参数）
const bodySchema = z.object({
    /** 是否向量化（默认 true） */
    enableEmbedding: z.boolean().optional().default(true),
    /** MinerU 转换选项 */
    mineruOptions: z.object({
        enableOcr: z.boolean().optional(),
        enableFormula: z.boolean().optional(),
        enableTable: z.boolean().optional(),
        pageRange: z.string().optional(),
    }).optional(),
    /** ASR 转录选项 */
    asrOptions: z.object({
        timestampAlignmentEnabled: z.boolean().optional(),
        languageHints: z.array(z.string()).optional(),
        disfluencyRemovalEnabled: z.boolean().optional(),
        diarizationEnabled: z.boolean().optional(),
    }).optional(),
})

export default defineEventHandler(async (event) => {
    // 认证检查
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 参数验证
    const id = getRouterParam(event, 'id')
    const paramsResult = paramsSchema.safeParse({ id })
    if (!paramsResult.success) {
        return resError(event, 400, parseErrorMessage(paramsResult.error, '参数验证失败'))
    }

    // 请求体解析
    const body = await readBody(event)
    const bodyResult = bodySchema.safeParse(body || {})
    const options = bodyResult.success ? bodyResult.data : { enableEmbedding: true }

    // 调用 service 层
    try {
        const result = await processMaterialService(paramsResult.data.id, user.id, options)
        const message = result.alreadyCompleted
            ? '材料已有内容，无需处理'
            : result.contentLength
                ? '材料处理成功'
                : '材料处理已提交，请稍后查询结果'
        return resSuccess(event, message, result)
    } catch (error: any) {
        if (error instanceof MaterialProcessError) {
            return resError(event, error.code, error.message)
        }
        return resError(event, 500, error.message || '处理材料失败')
    }
})
