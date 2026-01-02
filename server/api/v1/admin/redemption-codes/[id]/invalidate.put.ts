/**
 * 作废兑换码
 * PUT /api/v1/admin/redemption-codes/:id/invalidate
 *
 * _Requirements: 3.1-3.4_
 */
import { z } from 'zod'

// 路由参数验证
const paramsSchema = z.object({
    id: z.coerce.number().int().min(1),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 解析路由参数
    const id = getRouterParam(event, 'id')
    const result = paramsSchema.safeParse({ id })
    if (!result.success) {
        return resError(event, 400, '参数错误')
    }

    try {
        await invalidateRedemptionCodeService(result.data.id)
        logger.info(`用户 ${user.id} 作废了兑换码 ${result.data.id}`)
        return resSuccess(event, '作废成功', {})
    } catch (error: any) {
        logger.error('作废兑换码失败：', error)
        return resError(event, 500, error.message || '作废兑换码失败')
    }
})
