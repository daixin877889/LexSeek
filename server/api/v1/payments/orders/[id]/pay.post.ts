/**
 * 为已有订单创建支付
 *
 * POST /api/v1/payments/orders/:id/pay
 *
 * 为待支付状态的订单创建支付
 */

/** 请求参数验证 */
const payOrderSchema = z.object({
    /** 支付渠道 */
    paymentChannel: z.nativeEnum(PaymentChannel, { message: '无效的支付渠道' }),
    /** 支付方式 */
    paymentMethod: z.nativeEnum(PaymentMethod, { message: '无效的支付方式' }),
    /** 用户标识（小程序支付必填） */
    openid: z.string().optional(),
})

export default defineEventHandler(async (event) => {
    // 获取当前用户
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 获取订单 ID
    const orderId = Number(getRouterParam(event, 'id'))
    if (isNaN(orderId) || orderId <= 0) {
        return resError(event, 400, '无效的订单 ID')
    }

    // 验证请求参数
    const body = await readBody(event)
    const parseResult = payOrderSchema.safeParse(body)

    if (!parseResult.success) {
        const errorMessage = parseResult.error.issues[0]?.message || '参数错误'
        return resError(event, 400, errorMessage)
    }

    const { paymentChannel, paymentMethod, openid } = parseResult.data

    // 小程序支付需要 openid
    if (paymentMethod === PaymentMethod.MINI_PROGRAM && !openid) {
        return resError(event, 400, '小程序支付需要提供 openid')
    }

    // 检查订单是否可支付
    const checkResult = await checkOrderPayableService(orderId)
    if (!checkResult.payable) {
        return resError(event, 400, checkResult.errorMessage || '订单不可支付')
    }

    // 获取订单详情（用于权限校验）
    const order = await getOrderDetailService(orderId, user.id)
    if (!order) {
        return resError(event, 404, '订单不存在或无权访问')
    }

    // 获取回调地址
    const config = useRuntimeConfig()
    const notifyUrl = config.wechatPay?.notifyUrl || `${config.public.baseUrl}/api/v1/payments/callback/${paymentChannel}`

    // 创建支付
    const paymentResult = await createPaymentService({
        orderId,
        paymentChannel,
        paymentMethod,
        openid,
        notifyUrl,
    })

    if (!paymentResult.success) {
        return resError(event, 400, paymentResult.errorMessage || '创建支付失败')
    }

    return resSuccess(event, '创建支付成功', {
        orderNo: order.orderNo,
        transactionNo: paymentResult.transactionNo,
        amount: Number(order.amount),
        paymentParams: paymentResult.paymentParams,
        codeUrl: paymentResult.codeUrl,
        h5Url: paymentResult.h5Url,
    })
})
