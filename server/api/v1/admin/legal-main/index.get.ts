/**
 * 获取法律法规列表
 * GET /api/v1/admin/legal-main
 */
import { z } from 'zod'
import { LegalType } from '#shared/types/legal'
import { VALIDITY_STATUSES } from '#shared/types/legal-search'

// 查询参数验证
const querySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    keyword: z.string().optional(),
    type: z.nativeEnum(LegalType).optional(),
    issuingAuthority: z.string().optional(),
    status: z.enum(VALIDITY_STATUSES).optional(),
    sortBy: z.enum(['createdAt', 'publishDate', 'effectiveDate', 'name']).optional(),
    sortOrder: z.enum(['asc', 'desc']).optional(),
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

    const { page, pageSize, keyword, type, issuingAuthority, status, sortBy, sortOrder } = result.data

    // 调用服务层获取列表
    const data = await getLegalMainListService({
        page,
        pageSize,
        keyword,
        type,
        issuingAuthority,
        status,
        sortBy,
        sortOrder,
    })

    return resSuccess(event, '获取成功', data)
})
