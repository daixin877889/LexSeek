/**
 * 获取法律条文列表
 * GET /api/v1/admin/legal-articles
 */
import { z } from 'zod'

// 查询参数验证
const querySchema = z.object({
    legalId: z.string().min(1, '法律 ID 不能为空'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(500).default(100),
    // 筛选参数
    type: z.string().optional(),
    keyword: z.string().optional(),
    l1: z.string().optional(),
    l2: z.string().optional(),
    l3: z.string().optional(),
    l4: z.string().optional(),
    l5: z.string().optional(),
})

export default defineEventHandler(async (event) => {
    // 验证用户登录
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 解析查询参数
    const query = getQuery(event)
    const result = querySchema.safeParse(query)
    if (!result.success) {
        return resError(event, 400, result.error.issues[0]?.message || '参数错误')
    }

    const { legalId, page, pageSize, type, keyword, l1, l2, l3, l4, l5 } = result.data

    try {
        // 调用服务层获取列表
        const data = await getLegalArticlesListService({
            legalId,
            page,
            pageSize,
            type: type as any,
            keyword,
            l1,
            l2,
            l3,
            l4,
            l5,
        })
        return resSuccess(event, '获取成功', data)
    } catch (error) {
        const message = error instanceof Error ? error.message : '获取失败'
        if (message.includes('不存在')) {
            return resError(event, 404, message)
        }
        return resError(event, 400, message)
    }
})
