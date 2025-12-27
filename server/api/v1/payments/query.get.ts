/**
 * 查询支付状态接口
 *
 * GET /api/v1/payments/query
 *
 * 查询支付单状态，支持主动查询支付结果
 */
import { z } from 'zod'
import { PaymentTransactionStatus } from '#shared/types/payment'
import {
    queryPaymentStatusService,
    queryPaymentResultService,
} from '../../../services/payment/payment.service'

/** 请求参数验证 */
const queryPaymentSchema = z.object({
    /** 支付单号 */
    transactionNo: z.string().min(1, '支付单号不能为空'),
    /** 是否主动查询支付结果 */
    sync: z.string().optional().transform((v) => v === 'true'),
})

export default defineEventHandler(async (event) => {
    // 获取当前用户
    const user = event.context.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 验证请求参数
    const query = getQuery(event)
    const parseResult = queryPaymentSchema.safeParse(query)

    if (!parseResult.success) {
        const errorMessage = parseResult.error.errors[0]?.message || '参数错误'
        return resError(event, 400, errorMessage)
    }

    const { transactionNo, sync } = parseResult.data

    // 如果需要同步查询支付结果
    if (sync) {
        const result = await queryPaymentResultService(transactionNo)

        if (!result.success) {
            return resError(event, 400, result.errorMessage || '查询失败')
        }

        return resSuccess(event, '查询成功', {
            paid: result.paid,
        })
    }

    // 查询支付单状态
    const transaction = await queryPaymentStatusService(transactionNo)

    if (!transaction) {
        return resError(event, 404, '支付单不存在')
    }

    // 权限校验
    if (transaction.order.userId !== user.id) {
        return resError(event, 403, '无权查询此支付单')
    }

    return resSuccess(event, '查询成功', {
        transactionNo: transaction.transactionNo,
        orderId: transaction.orderId,
        amount: Number(transaction.amount),
        paymentChannel: transaction.paymentChannel,
        paymentMethod: transaction.paymentMethod,
        status: transaction.status,
        statusText: getStatusText(transaction.status),
        paidAt: transaction.paidAt,
        expiredAt: transaction.expiredAt,
    })
})

/** 获取状态文本 */
function getStatusText(status: number): string {
    const statusMap: Record<number, string> = {
        [PaymentTransactionStatus.PENDING]: '待支付',
        [PaymentTransactionStatus.SUCCESS]: '支付成功',
        [PaymentTransactionStatus.FAILED]: '支付失败',
        [PaymentTransactionStatus.EXPIRED]: '已过期',
        [PaymentTransactionStatus.REFUNDED]: '已退款',
    }
    return statusMap[status] || '未知状态'
}
