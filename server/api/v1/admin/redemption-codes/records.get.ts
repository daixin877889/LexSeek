/**
 * 获取兑换记录列表
 * GET /api/v1/admin/redemption-codes/records
 *
 * 支持分页、用户搜索（用户名/姓名/手机号）、码值搜索
 * _Requirements: 4.1-4.4_
 */
import { z } from 'zod'

// 查询参数验证
const querySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    code: z.string().optional(),
    /** 用户关键词搜索（用户名/姓名/手机号） */
    userKeyword: z.string().optional(),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 解析查询参数
    const query = getQuery(event)
    const result = querySchema.safeParse(query)
    if (!result.success) {
        return resError(event, 400, '参数错误')
    }

    const { page, pageSize, code, userKeyword } = result.data

    try {
        const data = await getRedemptionRecordsAdminService({
            page,
            pageSize,
            code,
            userKeyword,
        })

        return resSuccess(event, '获取成功', data)
    } catch (error: any) {
        logger.error('获取兑换记录列表失败：', error)
        return resError(event, 500, error.message || '获取兑换记录列表失败')
    }
})
