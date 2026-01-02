/**
 * 获取兑换码列表
 * GET /api/v1/admin/redemption-codes
 *
 * 支持分页、状态筛选、类型筛选、码值搜索
 * _Requirements: 1.1-1.5_
 */
import { z } from 'zod'
import { RedemptionCodeStatus, RedemptionCodeType } from '#shared/types/redemption'

// 查询参数验证
const querySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    status: z.coerce.number().int().optional(),
    type: z.coerce.number().int().optional(),
    code: z.string().optional(),
    remark: z.string().optional(),
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

    const { page, pageSize, status, type, code, remark } = result.data

    try {
        const data = await getRedemptionCodesAdminService({
            page,
            pageSize,
            status: status as RedemptionCodeStatus | undefined,
            type: type as RedemptionCodeType | undefined,
            code,
            remark,
        })

        return resSuccess(event, '获取成功', data)
    } catch (error: any) {
        logger.error('获取兑换码列表失败：', error)
        return resError(event, 500, error.message || '获取兑换码列表失败')
    }
})
