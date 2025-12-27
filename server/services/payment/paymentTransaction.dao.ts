/**
 * 支付单数据访问层
 *
 * 提供支付单的 CRUD 操作
 */
import { Prisma } from '#shared/types/prisma'
import { PaymentTransactionStatus } from '#shared/types/payment'

// 定义 Prisma 客户端类型（支持事务）
type PrismaClient = typeof prisma

/**
 * 生成支付单号
 * @returns 支付单号（格式：PAY + 年月日时分秒 + 6位随机数）
 */
export const generateTransactionNo = (): string => {
    const now = new Date()
    const dateStr = now.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)
    const random = Math.floor(Math.random() * 1000000).toString().padStart(6, '0')
    return `PAY${dateStr}${random}`
}

/**
 * 创建支付单
 * @param data 支付单创建数据
 * @param tx 事务客户端（可选）
 * @returns 创建的支付单
 */
export const createPaymentTransactionDao = async (
    data: {
        orderId: number
        amount: number
        paymentChannel: string
        paymentMethod: string
        prepayId?: string
        expiredAt: Date
        remark?: string
    },
    tx?: PrismaClient
): Promise<paymentTransactions> => {
    try {
        const transactionNo = generateTransactionNo()
        const transaction = await (tx || prisma).paymentTransactions.create({
            data: {
                transactionNo,
                orderId: data.orderId,
                amount: data.amount,
                paymentChannel: data.paymentChannel,
                paymentMethod: data.paymentMethod,
                prepayId: data.prepayId,
                status: PaymentTransactionStatus.PENDING,
                expiredAt: data.expiredAt,
                remark: data.remark,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })
        return transaction
    } catch (error) {
        logger.error('创建支付单失败：', error)
        throw error
    }
}

/**
 * 通过 ID 查询支付单
 * @param id 支付单 ID
 * @param tx 事务客户端（可选）
 * @returns 支付单或 null
 */
export const findPaymentTransactionByIdDao = async (
    id: number,
    tx?: PrismaClient
): Promise<(paymentTransactions & { order: orders }) | null> => {
    try {
        const transaction = await (tx || prisma).paymentTransactions.findUnique({
            where: { id, deletedAt: null },
            include: { order: true },
        })
        return transaction
    } catch (error) {
        logger.error('通过 ID 查询支付单失败：', error)
        throw error
    }
}

/**
 * 通过支付单号查询支付单
 * @param transactionNo 支付单号
 * @param tx 事务客户端（可选）
 * @returns 支付单或 null
 */
export const findPaymentTransactionByNoDao = async (
    transactionNo: string,
    tx?: PrismaClient
): Promise<(paymentTransactions & { order: orders }) | null> => {
    try {
        const transaction = await (tx || prisma).paymentTransactions.findUnique({
            where: { transactionNo, deletedAt: null },
            include: { order: true },
        })
        return transaction
    } catch (error) {
        logger.error('通过支付单号查询支付单失败：', error)
        throw error
    }
}

/**
 * 通过订单 ID 查询支付单列表
 * @param orderId 订单 ID
 * @param tx 事务客户端（可选）
 * @returns 支付单列表
 */
export const findPaymentTransactionsByOrderIdDao = async (
    orderId: number,
    tx?: PrismaClient
): Promise<paymentTransactions[]> => {
    try {
        const transactions = await (tx || prisma).paymentTransactions.findMany({
            where: { orderId, deletedAt: null },
            orderBy: { createdAt: 'desc' },
        })
        return transactions
    } catch (error) {
        logger.error('通过订单 ID 查询支付单列表失败：', error)
        throw error
    }
}

/**
 * 查询订单的待支付支付单
 * @param orderId 订单 ID
 * @param tx 事务客户端（可选）
 * @returns 待支付支付单或 null
 */
export const findPendingTransactionByOrderIdDao = async (
    orderId: number,
    tx?: PrismaClient
): Promise<paymentTransactions | null> => {
    try {
        const transaction = await (tx || prisma).paymentTransactions.findFirst({
            where: {
                orderId,
                status: PaymentTransactionStatus.PENDING,
                expiredAt: { gt: new Date() },
                deletedAt: null,
            },
            orderBy: { createdAt: 'desc' },
        })
        return transaction
    } catch (error) {
        logger.error('查询订单的待支付支付单失败：', error)
        throw error
    }
}

/**
 * 更新支付单状态
 * @param id 支付单 ID
 * @param data 更新数据
 * @param tx 事务客户端（可选）
 * @returns 更新后的支付单
 */
export const updatePaymentTransactionDao = async (
    id: number,
    data: {
        status?: PaymentTransactionStatus
        outTradeNo?: string
        prepayId?: string
        paidAt?: Date
        callbackData?: Prisma.InputJsonValue
        errorMessage?: string
    },
    tx?: PrismaClient
): Promise<paymentTransactions> => {
    try {
        const transaction = await (tx || prisma).paymentTransactions.update({
            where: { id },
            data: {
                ...data,
                updatedAt: new Date(),
            },
        })
        return transaction
    } catch (error) {
        logger.error('更新支付单状态失败：', error)
        throw error
    }
}

/**
 * 通过第三方交易号查询支付单
 * @param outTradeNo 第三方交易号
 * @param tx 事务客户端（可选）
 * @returns 支付单或 null
 */
export const findPaymentTransactionByOutTradeNoDao = async (
    outTradeNo: string,
    tx?: PrismaClient
): Promise<(paymentTransactions & { order: orders }) | null> => {
    try {
        const transaction = await (tx || prisma).paymentTransactions.findFirst({
            where: { outTradeNo, deletedAt: null },
            include: { order: true },
        })
        return transaction
    } catch (error) {
        logger.error('通过第三方交易号查询支付单失败：', error)
        throw error
    }
}

/**
 * 查询过期未支付的支付单
 * @param tx 事务客户端（可选）
 * @returns 过期支付单列表
 */
export const findExpiredPendingTransactionsDao = async (
    tx?: PrismaClient
): Promise<paymentTransactions[]> => {
    try {
        const transactions = await (tx || prisma).paymentTransactions.findMany({
            where: {
                status: PaymentTransactionStatus.PENDING,
                expiredAt: { lt: new Date() },
                deletedAt: null,
            },
        })
        return transactions
    } catch (error) {
        logger.error('查询过期未支付的支付单失败：', error)
        throw error
    }
}

/**
 * 批量更新过期支付单状态
 * @param ids 支付单 ID 列表
 * @param tx 事务客户端（可选）
 * @returns 更新数量
 */
export const expirePaymentTransactionsDao = async (
    ids: number[],
    tx?: PrismaClient
): Promise<number> => {
    try {
        const result = await (tx || prisma).paymentTransactions.updateMany({
            where: { id: { in: ids } },
            data: {
                status: PaymentTransactionStatus.EXPIRED,
                updatedAt: new Date(),
            },
        })
        return result.count
    } catch (error) {
        logger.error('批量更新过期支付单状态失败：', error)
        throw error
    }
}
