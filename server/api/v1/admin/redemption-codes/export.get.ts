/**
 * 导出兑换码 CSV
 * GET /api/v1/admin/redemption-codes/export
 *
 * _Requirements: 5.1-5.4_
 */
import { z } from 'zod'
import { RedemptionCodeStatus, RedemptionCodeType } from '#shared/types/redemption'

// 查询参数验证
const querySchema = z.object({
    status: z.coerce.number().int().optional(),
    type: z.coerce.number().int().optional(),
    code: z.string().optional(),
    remark: z.string().optional(),
    ids: z.string().optional(), // 逗号分隔的 ID 列表
    limit: z.coerce.number().int().min(1).max(10000).default(10000),
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

    const { status, type, code, remark, ids, limit } = result.data

    // 解析 ID 列表
    const idList = ids ? ids.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id)) : undefined

    try {
        const csv = await exportRedemptionCodesService({
            status: status as RedemptionCodeStatus | undefined,
            type: type as RedemptionCodeType | undefined,
            code,
            remark,
            ids: idList,
            limit,
        })

        // 设置响应头
        setResponseHeader(event, 'Content-Type', 'text/csv; charset=utf-8')
        setResponseHeader(event, 'Content-Disposition', `attachment; filename="redemption-codes-${Date.now()}.csv"`)

        logger.info(`用户 ${user.id} 导出了兑换码`)
        return csv
    } catch (error: any) {
        logger.error('导出兑换码失败：', error)
        return resError(event, 500, error.message || '导出兑换码失败')
    }
})
