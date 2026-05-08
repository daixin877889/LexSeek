/**
 * 管理端订单列表
 * GET /api/v1/admin/orders
 */
import { z } from 'zod'
import { OrderType } from '#shared/types/payment'
import { findOrdersForAdminService } from '~~/server/services/payment/order.admin.service'

const querySchema = z.object({
    keyword: z.string().optional(),
    status: z.coerce.number().int().optional(),
    orderType: z.nativeEnum(OrderType).optional(),
    productId: z.coerce.number().int().optional(),
    startTime: z.string().optional().transform((v) => v ? new Date(v) : undefined),
    endTime: z.string().optional().transform((v) => v ? new Date(v) : undefined),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const parsed = querySchema.safeParse(getQuery(event))
    if (!parsed.success) return resError(event, 400, parsed.error.issues[0]!.message)

    const { page, pageSize, ...query } = parsed.data
    const data = await findOrdersForAdminService(query, { page, pageSize })
    return resSuccess(event, '获取成功', data)
})
