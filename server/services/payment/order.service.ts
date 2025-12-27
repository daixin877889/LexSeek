/**
 * 订单服务
 *
 * 提供订单的业务逻辑处理
 */
import { OrderStatus, DurationUnit } from '#shared/types/payment'
import {
    createOrderDao,
    findOrderByIdDao,
    findOrderByOrderNoDao,
    findUserOrdersDao,
    updateOrderStatusDao,
    findExpiredPendingOrdersDao,
    cancelExpiredOrdersDao,
} from './order.dao'
import { findProductByIdDao } from '../product/product.dao'

// 定义 Prisma 客户端类型（支持事务）
type PrismaClient = typeof prisma

/** 创建订单参数 */
interface CreateOrderParams {
    userId: number
    productId: number
    duration: number
    durationUnit: DurationUnit
}

/** 创建订单结果 */
interface CreateOrderResult {
    success: boolean
    order?: orders & { product: products }
    errorMessage?: string
}

/**
 * 创建订单
 * @param params 创建参数
 * @param tx 事务客户端（可选）
 * @returns 创建结果
 */
export const createOrderService = async (
    params: CreateOrderParams,
    tx?: PrismaClient
): Promise<CreateOrderResult> => {
    try {
        const { userId, productId, duration, durationUnit } = params

        // 查询商品
        const product = await findProductByIdDao(productId, tx)
        if (!product) {
            return { success: false, errorMessage: '商品不存在' }
        }

        // 检查商品状态
        if (product.status !== 1) {
            return { success: false, errorMessage: '商品已下架' }
        }

        // 计算订单金额
        const amount = Number(product.price) * duration

        // 计算订单过期时间（30分钟）
        const expiredAt = new Date(Date.now() + 30 * 60 * 1000)

        // 创建订单
        const order = await createOrderDao(
            {
                userId,
                productId,
                amount,
                duration,
                durationUnit,
                expiredAt,
            },
            tx
        )

        // 查询完整订单信息
        const fullOrder = await findOrderByIdDao(order.id, tx)

        return {
            success: true,
            order: fullOrder as orders & { product: products },
        }
    } catch (error) {
        logger.error('创建订单失败：', error)
        return {
            success: false,
            errorMessage: error instanceof Error ? error.message : '创建订单失败',
        }
    }
}

/**
 * 获取订单详情
 * @param orderId 订单 ID
 * @param userId 用户 ID（用于权限校验）
 * @returns 订单详情或 null
 */
export const getOrderDetailService = async (
    orderId: number,
    userId?: number
): Promise<(orders & { product: products }) | null> => {
    const order = await findOrderByIdDao(orderId)

    // 权限校验
    if (order && userId && order.userId !== userId) {
        return null
    }

    return order as (orders & { product: products }) | null
}

/**
 * 通过订单号获取订单详情
 * @param orderNo 订单号
 * @param userId 用户 ID（用于权限校验）
 * @returns 订单详情或 null
 */
export const getOrderByOrderNoService = async (
    orderNo: string,
    userId?: number
): Promise<(orders & { product: products }) | null> => {
    const order = await findOrderByOrderNoDao(orderNo)

    // 权限校验
    if (order && userId && order.userId !== userId) {
        return null
    }

    return order as (orders & { product: products }) | null
}

/**
 * 获取用户订单列表
 * @param userId 用户 ID
 * @param options 查询选项
 * @returns 订单列表和总数
 */
export const getUserOrdersService = async (
    userId: number,
    options: {
        page?: number
        pageSize?: number
        status?: OrderStatus
    } = {}
): Promise<{ list: (orders & { product: products })[]; total: number }> => {
    return findUserOrdersDao(userId, options)
}

/**
 * 取消订单
 * @param orderId 订单 ID
 * @param userId 用户 ID（用于权限校验）
 * @returns 是否成功
 */
export const cancelOrderService = async (
    orderId: number,
    userId: number
): Promise<{ success: boolean; errorMessage?: string }> => {
    try {
        const order = await findOrderByIdDao(orderId)

        if (!order) {
            return { success: false, errorMessage: '订单不存在' }
        }

        if (order.userId !== userId) {
            return { success: false, errorMessage: '无权操作此订单' }
        }

        if (order.status !== OrderStatus.PENDING) {
            return { success: false, errorMessage: '订单状态不允许取消' }
        }

        await updateOrderStatusDao(orderId, OrderStatus.CANCELLED)

        return { success: true }
    } catch (error) {
        logger.error('取消订单失败：', error)
        return {
            success: false,
            errorMessage: error instanceof Error ? error.message : '取消订单失败',
        }
    }
}

/**
 * 处理订单支付成功
 * @param orderId 订单 ID
 * @param paidAt 支付时间
 * @param tx 事务客户端（可选）
 * @returns 更新后的订单
 */
export const handleOrderPaidService = async (
    orderId: number,
    paidAt: Date,
    tx?: PrismaClient
): Promise<orders> => {
    return updateOrderStatusDao(orderId, OrderStatus.PAID, paidAt, tx)
}

/**
 * 处理过期订单
 * @returns 处理数量
 */
export const handleExpiredOrdersService = async (): Promise<number> => {
    try {
        const expiredOrders = await findExpiredPendingOrdersDao()

        if (expiredOrders.length === 0) {
            return 0
        }

        const ids = expiredOrders.map((o) => o.id)
        const count = await cancelExpiredOrdersDao(ids)

        logger.info(`已取消 ${count} 个过期订单`)

        return count
    } catch (error) {
        logger.error('处理过期订单失败：', error)
        throw error
    }
}

/**
 * 检查订单是否可以支付
 * @param orderId 订单 ID
 * @returns 检查结果
 */
export const checkOrderPayableService = async (
    orderId: number
): Promise<{ payable: boolean; errorMessage?: string }> => {
    const order = await findOrderByIdDao(orderId)

    if (!order) {
        return { payable: false, errorMessage: '订单不存在' }
    }

    if (order.status !== OrderStatus.PENDING) {
        return { payable: false, errorMessage: '订单状态不允许支付' }
    }

    if (new Date(order.expiredAt) < new Date()) {
        return { payable: false, errorMessage: '订单已过期' }
    }

    return { payable: true }
}
