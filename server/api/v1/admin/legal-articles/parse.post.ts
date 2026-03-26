/**
 * 解析法律内容 API
 * 
 * POST /api/v1/admin/legal-articles/parse
 * 
 * 功能：解析法律内容并返回条文数组
 */

import { z } from 'zod'

/**
 * 请求参数验证 Schema
 */
const ParseSchema = z.object({
    /** 法律法规内容（Markdown 格式） */
    content: z.string().min(1, '法律内容不能为空'),
})

export default defineEventHandler(async (event) => {
    // 验证用户权限
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    try {
        // 读取并验证请求参数
        const body = await readBody(event)
        const validationResult = ParseSchema.safeParse(body)

        if (!validationResult.success) {
            const firstError = validationResult.error.issues[0]!
            return resError(event, 400, firstError.message)
        }

        const { content } = validationResult.data

        // 解析法律内容
        let articles
        try {
            articles = parseContent(content)
        } catch (error) {
            logger.error('解析法律内容失败', { error })
            return resError(event, 400, `解析法律内容失败: ${error instanceof Error ? error.message : '未知错误'}`)
        }

        if (articles.length === 0) {
            return resError(event, 400, '解析结果为空，请检查内容格式')
        }

        return resSuccess(event, '解析成功', articles)
    } catch (error) {
        logger.error('解析法律内容 API 异常', { error })
        return resError(event, 500, '服务器内部错误')
    }
})
