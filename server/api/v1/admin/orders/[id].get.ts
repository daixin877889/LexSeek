/**
 * 管理端订单详情
 * GET /api/v1/admin/orders/:id
 */
import { findOrderForAdminService } from '~~/server/services/payment/order.admin.service'

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const id = Number(getRouterParam(event, 'id'))
    if (!id || Number.isNaN(id)) return resError(event, 400, '订单 ID 无效')

    const order = await findOrderForAdminService(id)
    if (!order) return resError(event, 404, '订单不存在')
    return resSuccess(event, '获取成功', order)
})
