/**
 * 微信支付回调接口
 *
 * POST /api/v1/payments/callback/wechat
 *
 * 接收微信支付异步通知
 */
// import { PaymentChannel } from '#shared/types/payment'
// import { handlePaymentCallbackService } from '../../../../services/payment/payment.service'

export default defineEventHandler(async (event) => {
    try {
        // 获取请求头中的签名信息
        const headers = getHeaders(event)
        const signature = headers['wechatpay-signature'] as string
        const timestamp = headers['wechatpay-timestamp'] as string
        const nonce = headers['wechatpay-nonce'] as string
        const serial = headers['wechatpay-serial'] as string

        // 获取请求体
        const body = await readRawBody(event)

        if (!body) {
            logger.error('微信支付回调：请求体为空')
            return { code: 'FAIL', message: '请求体为空' }
        }

        // 处理回调
        const result = await handlePaymentCallbackService(PaymentChannel.WECHAT, {
            raw: body,
            signature,
            timestamp,
            nonce,
            serial,
        })

        if (!result.success) {
            logger.error('微信支付回调处理失败：', result.errorMessage)
            return { code: 'FAIL', message: result.errorMessage }
        }

        // 返回成功响应
        return { code: 'SUCCESS', message: '成功' }
    } catch (error) {
        logger.error('微信支付回调异常：', error)
        return { code: 'FAIL', message: '处理异常' }
    }
})
