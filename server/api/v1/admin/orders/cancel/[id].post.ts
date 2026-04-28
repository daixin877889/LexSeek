/**
 * 管理端取消订单
 * POST /api/v1/admin/orders/cancel/:id
 */
import { z } from 'zod'
import { cancelOrderByAdminService } from '~~/server/services/payment/order.admin.service'

const bodySchema = z.object({
    reason: z.string().min(1, '请填写取消原因').max(200, '取消原因最多 200 字'),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const id = Number(getRouterParam(event, 'id'))
    if (!id || Number.isNaN(id)) return resError(event, 400, '订单 ID 无效')

    const body = await readBody(event)
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) return resError(event, 400, parsed.error.issues[0]!.message)

    try {
        const order = await cancelOrderByAdminService(event, user.id, id, parsed.data.reason)
        return resSuccess(event, '取消成功', order)
    } catch (error: any) {
        return resError(event, 400, error.message || '取消失败')
    }
})
