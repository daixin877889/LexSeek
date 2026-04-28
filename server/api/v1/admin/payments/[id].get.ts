/**
 * 管理端支付详情
 * GET /api/v1/admin/payments/:id
 */
import { findPaymentTransactionForAdminService } from '~~/server/services/payment/paymentTransaction.admin.service'

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const id = Number(getRouterParam(event, 'id'))
    if (!id || Number.isNaN(id)) return resError(event, 400, '支付单 ID 无效')

    const p = await findPaymentTransactionForAdminService(id)
    if (!p) return resError(event, 404, '支付单不存在')
    return resSuccess(event, '获取成功', p)
})
