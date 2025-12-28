/**
 * 获取用户订单列表接口
 *
 * GET /api/v1/payments/orders
 *
 * 获取当前用户的订单列表
 */

/** 请求参数验证 */
const queryOrdersSchema = z.object({
    /** 页码 */
    page: z.string().optional().transform((v) => (v ? parseInt(v, 10) : 1)),
    /** 每页数量 */
    pageSize: z.string().optional().transform((v) => (v ? parseInt(v, 10) : 10)),
    /** 订单状态 */
    status: z.string().optional().transform((v) => {
        if (v === undefined || v === '' || v === 'undefined') return undefined
        const num = parseInt(v, 10)
        return isNaN(num) ? undefined : num
    }),
})

export default defineEventHandler(async (event) => {
    // 获取当前用户
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 验证请求参数
    const query = getQuery(event)
    const parseResult = queryOrdersSchema.safeParse(query)

    if (!parseResult.success) {
        const errorMessage = parseResult.error.issues[0]?.message || '参数错误'
        return resError(event, 400, errorMessage)
    }

    const { page, pageSize, status } = parseResult.data

    // 获取订单列表
    const result = await getUserOrdersService(user.id, {
        page,
        pageSize,
        status,
    })

    // 格式化订单数据
    const list = result.list.map((order) => ({
        id: order.id,
        orderNo: order.orderNo,
        productName: order.product?.name || '未知商品',
        productType: order.product?.type || 0,
        amount: Number(order.amount),
        duration: order.duration,
        durationUnit: order.durationUnit,
        status: order.status,
        paidAt: order.paidAt,
        expiredAt: order.expiredAt,
        createdAt: order.createdAt,
    }))

    return resSuccess(event, '获取成功', {
        list,
        total: result.total,
        page,
        pageSize,
    })
})
