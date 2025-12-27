/**
 * 订单数据访问层
 *
 * 提供订单的 CRUD 操作
 */
import { Prisma } from '#shared/types/prisma'
import { OrderStatus } from '#shared/types/payment'

// 定义 Prisma 客户端类型（支持事务）
type PrismaClient = typeof prisma

/** 订单包含关联 */
const orderInclude = {
    product: true,
    user: {
        select: { id: true, phone: true, nickname: true },
    },
} as const

/**
 * 生成订单号
 * @returns 订单号（格式：ORD + 年月日时分秒 + 6位随机数）
 */
export const generateOrderNo = (): string => {
    const now = new Date()
    const dateStr = now.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)
    const random = Math.floor(Math.random() * 1000000).toString().padStart(6, '0')
    return `ORD${dateStr}${random}`
}

/**
 * 创建订单
 * @param data 订单创建数据
 * @param tx 事务客户端（可选）
 * @returns 创建的订单
 */
export const createOrderDao = async (
    data: {
        userId: number
        productId: number
        amount: number
        duration: number
        durationUnit: string
        expiredAt: Date
        remark?: string
    },
    tx?: PrismaClient
): Promise<orders> => {
    try {
        const orderNo = generateOrderNo()
        const order = await (tx || prisma).orders.create({
            data: {
                orderNo,
                userId: data.userId,
                productId: data.productId,
                amount: data.amount,
                duration: data.duration,
                durationUnit: data.durationUnit,
                status: OrderStatus.PENDING,
                expiredAt: data.expiredAt,
                remark: data.remark,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })
        return order
    } catch (error) {
        logger.error('创建订单失败：', error)
        throw error
    }
}

/**
 * 通过 ID 查询订单
 * @param id 订单 ID
 * @param tx 事务客户端（可选）
 * @returns 订单或 null
 */
export const findOrderByIdDao = async (
    id: number,
    tx?: PrismaClient
): Promise<(orders & { product: products; user: { id: number; phone: string; nickname: string | null } }) | null> => {
    try {
        const order = await (tx || prisma).orders.findUnique({
            where: { id, deletedAt: null },
            include: orderInclude,
        })
        return order
    } catch (error) {
        logger.error('通过 ID 查询订单失败：', error)
        throw error
    }
}

/**
 * 通过订单号查询订单
 * @param orderNo 订单号
 * @param tx 事务客户端（可选）
 * @returns 订单或 null
 */
export const findOrderByOrderNoDao = async (
    orderNo: string,
    tx?: PrismaClient
): Promise<(orders & { product: products; user: { id: number; phone: string; nickname: string | null } }) | null> => {
    try {
        const order = await (tx || prisma).orders.findUnique({
            where: { orderNo, deletedAt: null },
            include: orderInclude,
        })
        return order
    } catch (error) {
        logger.error('通过订单号查询订单失败：', error)
        throw error
    }
}

/**
 * 查询用户订单列表
 * @param userId 用户 ID
 * @param options 查询选项
 * @param tx 事务客户端（可选）
 * @returns 订单列表和总数
 */
export const findUserOrdersDao = async (
    userId: number,
    options: {
        page?: number
        pageSize?: number
        status?: OrderStatus
    } = {},
    tx?: PrismaClient
): Promise<{ list: (orders & { product: products })[]; total: number }> => {
    try {
        const { page = 1, pageSize = 10, status } = options
        const skip = (page - 1) * pageSize

        const where: Prisma.ordersWhereInput = {
            userId,
            deletedAt: null,
            ...(status !== undefined && { status }),
        }

        const [list, total] = await Promise.all([
            (tx || prisma).orders.findMany({
                where,
                include: { product: true },
                skip,
                take: pageSize,
                orderBy: { createdAt: 'desc' },
            }),
            (tx || prisma).orders.count({ where }),
        ])

        return { list, total }
    } catch (error) {
        logger.error('查询用户订单列表失败：', error)
        throw error
    }
}

/**
 * 更新订单状态
 * @param id 订单 ID
 * @param status 新状态
 * @param paidAt 支付时间（可选）
 * @param tx 事务客户端（可选）
 * @returns 更新后的订单
 */
export const updateOrderStatusDao = async (
    id: number,
    status: OrderStatus,
    paidAt?: Date,
    tx?: PrismaClient
): Promise<orders> => {
    try {
        const order = await (tx || prisma).orders.update({
            where: { id },
            data: {
                status,
                paidAt,
                updatedAt: new Date(),
            },
        })
        return order
    } catch (error) {
        logger.error('更新订单状态失败：', error)
        throw error
    }
}

/**
 * 查询过期未支付订单
 * @param tx 事务客户端（可选）
 * @returns 过期订单列表
 */
export const findExpiredPendingOrdersDao = async (
    tx?: PrismaClient
): Promise<orders[]> => {
    try {
        const orders = await (tx || prisma).orders.findMany({
            where: {
                status: OrderStatus.PENDING,
                expiredAt: { lt: new Date() },
                deletedAt: null,
            },
        })
        return orders
    } catch (error) {
        logger.error('查询过期未支付订单失败：', error)
        throw error
    }
}

/**
 * 批量取消过期订单
 * @param ids 订单 ID 列表
 * @param tx 事务客户端（可选）
 * @returns 更新数量
 */
export const cancelExpiredOrdersDao = async (
    ids: number[],
    tx?: PrismaClient
): Promise<number> => {
    try {
        const result = await (tx || prisma).orders.updateMany({
            where: { id: { in: ids } },
            data: {
                status: OrderStatus.CANCELLED,
                updatedAt: new Date(),
            },
        })
        return result.count
    } catch (error) {
        logger.error('批量取消过期订单失败：', error)
        throw error
    }
}
