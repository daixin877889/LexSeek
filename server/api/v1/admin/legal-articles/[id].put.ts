/**
 * 更新法律条文
 * PUT /api/v1/admin/legal-articles/:id
 */
import { z } from 'zod'
import { ArticleType, type UpdateLegalArticleRequest } from '#shared/types/legal'
import { updateLegalArticleService } from '~~/server/services/legal/legalArticles.service'

// 请求体验证
const bodySchema = z.object({
    type: z.nativeEnum(ArticleType, { message: '无效的条文类型' }).optional(),
    l1: z.string().max(100, '层级1标题不能超过100个字符').nullable().optional(),
    l1I: z.number({ message: '层级1序号必须是数字' }).int('层级1序号必须是整数').nullable().optional(),
    l2: z.string().max(100, '层级2标题不能超过100个字符').nullable().optional(),
    l2I: z.number({ message: '层级2序号必须是数字' }).int('层级2序号必须是整数').nullable().optional(),
    l3: z.string().max(100, '层级3标题不能超过100个字符').nullable().optional(),
    l3I: z.number({ message: '层级3序号必须是数字' }).int('层级3序号必须是整数').nullable().optional(),
    l4: z.string().max(100, '层级4标题不能超过100个字符').nullable().optional(),
    l4I: z.number({ message: '层级4序号必须是数字' }).int('层级4序号必须是整数').nullable().optional(),
    l5: z.string().max(100, '层级5标题不能超过100个字符').nullable().optional(),
    l5I: z.number({ message: '层级5序号必须是数字' }).int('层级5序号必须是整数').nullable().optional(),
    order: z.number({ message: '排序序号必须是数字' }).int('排序序号必须是整数').nullable().optional(),
    content: z.string().nullable().optional(),
    publishDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '发布日期格式错误').nullable().optional(),
    effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '生效日期格式错误').nullable().optional(),
    invalidDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '失效日期格式错误').nullable().optional(),
})

export default defineEventHandler(async (event) => {
    // 验证用户登录
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 获取路由参数
    const id = getRouterParam(event, 'id')
    if (!id) {
        return resError(event, 400, '无效的条文 ID')
    }

    // 解析请求体
    const body = await readBody(event)
    const result = bodySchema.safeParse(body)
    if (!result.success) {
        return resError(event, 400, result.error.issues[0]!!?.message || '参数错误')
    }

    // 检查是否有更新内容
    if (Object.keys(result.data).length === 0) {
        return resError(event, 400, '没有需要更新的内容')
    }

    try {
        // 调用服务层更新（类型断言处理 null 和 undefined 的兼容性）
        const article = await updateLegalArticleService(id, result.data as UpdateLegalArticleRequest)
        logger.info(`用户 ${user.id} 更新了法律条文: ${article.id}`)
        return resSuccess(event, '更新成功', article)
    } catch (error) {
        const message = error instanceof Error ? error.message : '更新失败'
        if (message.includes('不存在')) {
            return resError(event, 404, message)
        }
        return resError(event, 400, message)
    }
})
