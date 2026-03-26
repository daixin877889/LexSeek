/**
 * 获取法律条文列表
 * GET /api/v1/admin/legal-articles
 */
import { z } from 'zod'

// 查询参数验证
const querySchema = z.object({
    legalId: z.string({ message: '法律 ID 必须是字符串' }).min(1, '法律 ID 不能为空'),
    page: z.coerce.number({ message: '页码必须是数字' }).int('页码必须是整数').min(1, '页码最小为1').default(1),
    pageSize: z.coerce.number({ message: '每页数量必须是数字' }).int('每页数量必须是整数').min(1, '每页数量最小为1').max(500, '每页数量最大为500').default(100),
    // 筛选参数
    type: z.string({ message: '类型必须是字符串' }).optional(),
    keyword: z.string({ message: '关键词必须是字符串' }).optional(),
    l1: z.string({ message: 'l1 必须是字符串' }).optional(),
    l2: z.string({ message: 'l2 必须是字符串' }).optional(),
    l3: z.string({ message: 'l3 必须是字符串' }).optional(),
    l4: z.string({ message: 'l4 必须是字符串' }).optional(),
    l5: z.string({ message: 'l5 必须是字符串' }).optional(),
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
        return resError(event, 400, result.error.issues[0]!!?.message || '参数错误')
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
