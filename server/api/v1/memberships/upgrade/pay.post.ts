/**
 * 会员升级支付接口
 *
 * POST /api/v1/memberships/upgrade/pay
 *
 * 创建升级订单并发起支付，使用计算出的升级差价
 */
import { z } from 'zod'
import { PaymentChannel, PaymentMethod, DurationUnit, OrderType } from '#shared/types/payment'

/** 请求参数验证 */
const upgradePaySchema = z.object({
    /** 目标级别 ID */
    targetLevelId: z.number().int().positive('目标级别 ID 必须为正整数'),
    /** 指定的会员记录 ID（可选） */
    membershipId: z.number().int().positive().optional(),
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

    // 验证请求参数
    const body = await readBody(event)
    const parseResult = upgradePaySchema.safeParse(body)

    if (!parseResult.success) {
        const errorMessage = parseResult.error.issues[0]?.message || '参数错误'
        return resError(event, 400, errorMessage)
    }

    const { targetLevelId, membershipId, paymentChannel, paymentMethod, openid } = parseResult.data

    // 小程序支付需要 openid
    if (paymentMethod === PaymentMethod.MINI_PROGRAM && !openid) {
        return resError(event, 400, '小程序支付需要提供 openid')
    }

    try {
        // 计算升级价格（传入会员记录 ID）
        const calcResult = await calculateUpgradePriceService(user.id, targetLevelId, membershipId)

        if (!calcResult.success || !calcResult.result) {
            return resError(event, 400, calcResult.errorMessage || '计算升级价格失败')
        }

        const { upgradePrice, targetProduct } = calcResult.result

        // 升级价格为 0 时，直接执行升级（免费升级）
        if (upgradePrice <= 0) {
            return resError(event, 400, '升级价格为 0，无需支付')
        }

        // 创建升级订单（使用计算出的升级差价，订单类型为 upgrade）
        // 将 membershipId 存储到 remark 中，供支付成功后使用
        const remarkData = {
            description: `会员升级至${targetProduct.name}`,
            membershipId: membershipId || null,
        }
        const orderResult = await createOrderService({
            userId: user.id,
            productId: targetProduct.id,
            duration: 1,
            durationUnit: DurationUnit.YEAR,
            orderType: OrderType.UPGRADE,
            customAmount: upgradePrice,
            remark: JSON.stringify(remarkData),
        })

        if (!orderResult.success || !orderResult.order) {
            return resError(event, 400, orderResult.errorMessage || '创建订单失败')
        }

        // 获取回调地址
        const config = useRuntimeConfig()
        const notifyUrl = config.wechatPay?.notifyUrl || `${config.public.baseUrl}/api/v1/payments/callback/${paymentChannel}`

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

        return resSuccess(event, '创建升级支付成功', {
            orderNo: orderResult.order.orderNo,
            transactionNo: paymentResult.transactionNo,
            amount: upgradePrice,
            paymentParams: paymentResult.paymentParams,
            codeUrl: paymentResult.codeUrl,
            h5Url: paymentResult.h5Url,
        })
    } catch (error) {
        logger.error('创建升级支付失败：', error)
        return resError(event, 500, '创建升级支付失败')
    }
})
