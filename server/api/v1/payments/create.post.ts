/**
 * 创建支付接口
 *
 * POST /api/v1/payments/create
 *
 * 创建订单并发起支付
 */
// import { z } from 'zod'
// import { PaymentChannel, PaymentMethod, DurationUnit } from '#shared/types/payment'
// import { createOrderService } from '../../../services/payment/order.service'
// import { createPaymentService } from '../../../services/payment/payment.service'

/** 请求参数验证 */
const createPaymentSchema = z.object({
    /** 商品 ID */
    productId: z.number().int().positive('商品 ID 必须为正整数'),
    /** 购买时长 */
    duration: z.number().int().min(1, '购买时长至少为 1'),
    /** 时长单位 */
    durationUnit: z.nativeEnum(DurationUnit, { message: '无效的时长单位' }),
    /** 支付渠道 */
    paymentChannel: z.nativeEnum(PaymentChannel, { message: '无效的支付渠道' }),
    /** 支付方式 */
    paymentMethod: z.nativeEnum(PaymentMethod, { message: '无效的支付方式' }),
    /** 用户标识（小程序支付必填） */
    openid: z.string().optional(),
})

export default defineEventHandler(async (event) => {
    // 获取当前用户
    const user = event.context.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 验证请求参数
    const body = await readBody(event)
    const parseResult = createPaymentSchema.safeParse(body)

    if (!parseResult.success) {
        const errorMessage = parseResult.error.issues[0]?.message || '参数错误'
        return resError(event, 400, errorMessage)
    }

    const { productId, duration, durationUnit, paymentChannel, paymentMethod, openid } = parseResult.data

    // 小程序支付需要 openid
    if (paymentMethod === PaymentMethod.MINI_PROGRAM && !openid) {
        return resError(event, 400, '小程序支付需要提供 openid')
    }

    // 创建订单
    const orderResult = await createOrderService({
        userId: user.id,
        productId,
        duration,
        durationUnit,
    })

    if (!orderResult.success || !orderResult.order) {
        return resError(event, 400, orderResult.errorMessage || '创建订单失败')
    }

    // 获取回调地址
    const config = useRuntimeConfig()
    const notifyUrl = `${config.public.baseUrl}/api/v1/payments/callback/${paymentChannel}`

    // 创建支付
    const paymentResult = await createPaymentService({
        orderId: orderResult.order.id,
        paymentChannel,
        paymentMethod,
        openid,
        notifyUrl,
    })

    if (!paymentResult.success) {
        return resError(event, 400, paymentResult.errorMessage || '创建支付失败')
    }

    return resSuccess(event, '创建支付成功', {
        orderNo: orderResult.order.orderNo,
        transactionNo: paymentResult.transactionNo,
        amount: Number(orderResult.order.amount),
        paymentParams: paymentResult.paymentParams,
        codeUrl: paymentResult.codeUrl,
        h5Url: paymentResult.h5Url,
    })
})
