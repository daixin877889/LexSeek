/**
 * 预览渲染提示词
 *
 * POST /api/v1/admin/prompts/preview
 * Requirements: 15.8
 *
 * 输入测试变量并预览渲染结果（不保存）
 */

import { z } from 'zod'
import type { PreviewPromptInput } from '#shared/types/node'

/** 请求体验证 */
const bodySchema = z.object({
    content: z.string()
        .min(1, '提示词内容不能为空'),
    variables: z.object({}).passthrough().default({}),
})

export default defineEventHandler(async (event) => {
    const body = await readBody(event)
    const result = bodySchema.safeParse(body)
    if (!result.success) {
        return resError(event, 400, '参数错误：' + result.error.issues[0]!!.message)
    }

    try {
        // 构建输入参数
        const input: PreviewPromptInput = {
            content: result.data.content,
            variables: result.data.variables as Record<string, string>,
        }
        const preview = previewPromptService(input)
        return resSuccess(event, '预览渲染成功', preview)
    } catch (error) {
        logger.error('预览渲染失败：', error)
        return resError(event, 500, '预览渲染失败')
    }
})
