/**
 * 管理端支付记录列表
 * GET /api/v1/admin/payments
 */
import { z } from 'zod'
import { findPaymentTransactionsForAdminService } from '~~/server/services/payment/paymentTransaction.admin.service'

const querySchema = z.object({
    keyword: z.string().optional(),
    status: z.coerce.number().int().optional(),
    paymentChannel: z.enum(['wechat', 'alipay']).optional(),
    paymentMethod: z.enum(['mini_program', 'scan_code', 'wap', 'app', 'pc']).optional(),
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
    const data = await findPaymentTransactionsForAdminService(query, { page, pageSize })
    return resSuccess(event, '获取成功', data)
})
