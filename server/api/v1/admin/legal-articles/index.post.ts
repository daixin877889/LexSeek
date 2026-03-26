/**
 * 创建法律条文
 * POST /api/v1/admin/legal-articles
 */
import { z } from 'zod'
import { ArticleType } from '#shared/types/legal'

// 请求体验证
const bodySchema = z.object({
    legalId: z.string({ message: '法律 ID 不能为空' }).min(1, '法律 ID 不能为空'),
    type: z.nativeEnum(ArticleType, { message: '无效的条文类型' }),
    l1: z.string().max(100, '层级1标题不能超过100个字符').optional(),
    l1I: z.number({ message: '层级1序号必须是数字' }).int('层级1序号必须是整数').optional(),
    l2: z.string().max(100, '层级2标题不能超过100个字符').optional(),
    l2I: z.number({ message: '层级2序号必须是数字' }).int('层级2序号必须是整数').optional(),
    l3: z.string().max(100, '层级3标题不能超过100个字符').optional(),
    l3I: z.number({ message: '层级3序号必须是数字' }).int('层级3序号必须是整数').optional(),
    l4: z.string().max(100, '层级4标题不能超过100个字符').optional(),
    l4I: z.number({ message: '层级4序号必须是数字' }).int('层级4序号必须是整数').optional(),
    l5: z.string().max(100, '层级5标题不能超过100个字符').optional(),
    l5I: z.number({ message: '层级5序号必须是数字' }).int('层级5序号必须是整数').optional(),
    order: z.number({ message: '排序序号必须是数字' }).int('排序序号必须是整数').optional(),
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
        return resError(event, 400, result.error.issues[0]!!?.message || '参数错误')
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
