/**
 * 管理端更新订单备注
 * PATCH /api/v1/admin/orders/remark/:id
 */
import { z } from 'zod'
import { updateOrderAdminRemarkService } from '~~/server/services/payment/order.admin.service'

const bodySchema = z.object({
    remark: z.string().max(500).nullable(),
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
        const order = await updateOrderAdminRemarkService(event, user.id, id, parsed.data.remark)
        return resSuccess(event, '更新成功', order)
    } catch (error: any) {
        return resError(event, 400, error.message || '更新失败')
    }
})
