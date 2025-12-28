/**
 * 取消订单接口
 *
 * POST /api/v1/payments/orders/:id/cancel
 *
 * 取消指定订单
 */

export default defineEventHandler(async (event) => {
    // 获取当前用户
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 获取订单 ID
    const orderId = parseInt(getRouterParam(event, 'id') || '', 10)
    if (isNaN(orderId)) {
        return resError(event, 400, '无效的订单 ID')
    }

    // 取消订单
    const result = await cancelOrderService(orderId, user.id)

    if (!result.success) {
        return resError(event, 400, result.errorMessage || '取消订单失败')
    }

    return resSuccess(event, '订单已取消', null)
})
