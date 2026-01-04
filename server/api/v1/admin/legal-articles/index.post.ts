/**
 * 创建法律条文
 * POST /api/v1/admin/legal-articles
 */
import { z } from 'zod'
import { ArticleType } from '#shared/types/legal'

// 请求体验证
const bodySchema = z.object({
    legalId: z.string().min(1, '法律 ID 不能为空'),
    type: z.nativeEnum(ArticleType, { message: '无效的条文类型' }),
    l1: z.string().max(100).optional(),
    l1I: z.number().int().optional(),
    l2: z.string().max(100).optional(),
    l2I: z.number().int().optional(),
    l3: z.string().max(100).optional(),
    l3I: z.number().int().optional(),
    l4: z.string().max(100).optional(),
    l4I: z.number().int().optional(),
    l5: z.string().max(100).optional(),
    l5I: z.number().int().optional(),
    order: z.number().int().optional(),
    content: z.string().optional(),
    publishDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '发布日期格式错误').optional(),
    effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '生效日期格式错误').optional(),
    invalidDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '失效日期格式错误').optional(),
})

export default defineEventHandler(async (event) => {
    // 验证用户登录
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 解析请求体
    const body = await readBody(event)
    const result = bodySchema.safeParse(body)
    if (!result.success) {
        return resError(event, 400, result.error.issues[0]?.message || '参数错误')
    }

    try {
        // 调用服务层创建
        const article = await createLegalArticleService(result.data)
        logger.info(`用户 ${user.id} 创建了法律条文: ${article.id}`)
        return resSuccess(event, '创建成功', article)
    } catch (error) {
        const message = error instanceof Error ? error.message : '创建失败'
        if (message.includes('不存在')) {
            return resError(event, 404, message)
        }
        return resError(event, 400, message)
    }
})
