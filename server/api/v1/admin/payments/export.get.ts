/**
 * 管理端支付记录 CSV 导出
 * GET /api/v1/admin/payments/export
 */
import { z } from 'zod'
import { PaymentChannel, PaymentMethod } from '#shared/types/payment'
import { exportPaymentTransactionsService } from '~~/server/services/payment/paymentTransaction.admin.service'

const querySchema = z.object({
    keyword: z.string().optional(),
    status: z.coerce.number().int().optional(),
    paymentChannel: z.nativeEnum(PaymentChannel).optional(),
    paymentMethod: z.nativeEnum(PaymentMethod).optional(),
    startTime: z.string().optional().transform((v) => v ? new Date(v) : undefined),
    endTime: z.string().optional().transform((v) => v ? new Date(v) : undefined),
    limit: z.coerce.number().int().min(1).max(10000).default(10000),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const parsed = querySchema.safeParse(getQuery(event))
    if (!parsed.success) return resError(event, 400, parsed.error.issues[0]!.message)

    const { limit, ...query } = parsed.data
    try {
        const csv = await exportPaymentTransactionsService(query, limit)
        setResponseHeader(event, 'Content-Type', 'text/csv; charset=utf-8')
        setResponseHeader(event, 'Content-Disposition', `attachment; filename="payments-${Date.now()}.csv"`)
        logger.info(`管理员 ${user.id} 导出支付记录`)
        return csv
    } catch (error: any) {
        return resError(event, 400, error.message || '导出失败')
    }
})
