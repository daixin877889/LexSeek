/**
 * 支付服务
 *
 * 提供支付的业务逻辑处理
 */
import { PaymentChannel, PaymentMethod, PaymentTransactionStatus, OrderStatus } from '#shared/types/payment'
import { getPaymentAdapter } from '../../lib/payment'
import type { CallbackData } from '../../lib/payment'
import {
    createPaymentTransactionDao,
    findPaymentTransactionByIdDao,
    findPaymentTransactionByNoDao,
    findPendingTransactionByOrderIdDao,
    updatePaymentTransactionDao,
    findPaymentTransactionByOutTradeNoDao,
    findExpiredPendingTransactionsDao,
    expirePaymentTransactionsDao,
} from './paymentTransaction.dao'
import { findOrderByIdDao, updateOrderStatusDao } from './order.dao'
import { handlePaymentSuccess } from './handlers/index'

// 定义 Prisma 客户端类型（支持事务）
type PrismaClient = typeof prisma

/** 创建支付参数 */
interface CreatePaymentParams {
    orderId: number
    paymentChannel: PaymentChannel
    paymentMethod: PaymentMethod
    openid?: string
    notifyUrl: string
}

/** 创建支付结果 */
interface CreatePaymentResult {
    success: boolean
    transactionNo?: string
    paymentParams?: Record<string, unknown>
    codeUrl?: string
    h5Url?: string
    errorMessage?: string
}

/**
 * 创建支付
 * @param params 创建参数
 * @returns 创建结果
 */
export const createPaymentService = async (
    params: CreatePaymentParams
): Promise<CreatePaymentResult> => {
    try {
        const { orderId, paymentChannel, paymentMethod, openid, notifyUrl } = params

        // 查询订单
        const order = await findOrderByIdDao(orderId)
        if (!order) {
            return { success: false, errorMessage: '订单不存在' }
        }

        // 检查订单状态
        if (order.status !== OrderStatus.PENDING) {
            return { success: false, errorMessage: '订单状态不允许支付' }
        }

        // 检查订单是否过期
        if (new Date(order.expiredAt) < new Date()) {
            return { success: false, errorMessage: '订单已过期' }
        }

        // 检查是否有未过期的待支付支付单
        const pendingTransaction = await findPendingTransactionByOrderIdDao(orderId)
        if (pendingTransaction) {
            // 如果支付渠道和方式相同，返回已有的支付单
            if (
                pendingTransaction.paymentChannel === paymentChannel &&
                pendingTransaction.paymentMethod === paymentMethod
            ) {
                return {
                    success: true,
                    transactionNo: pendingTransaction.transactionNo,
                    // 需要重新获取支付参数
                }
            }
            // 否则将旧支付单设为过期
            await updatePaymentTransactionDao(pendingTransaction.id, {
                status: PaymentTransactionStatus.EXPIRED,
            })
        }

        // 获取支付适配器
        const adapter = getPaymentAdapter(paymentChannel)

        // 计算支付单过期时间（30分钟）
        const expiredAt = new Date(Date.now() + 30 * 60 * 1000)

        // 创建支付单
        const transaction = await createPaymentTransactionDao({
            orderId,
            amount: Number(order.amount),
            paymentChannel,
            paymentMethod,
            expiredAt,
        })

        // 调用支付适配器创建支付
        const paymentResult = await adapter.createPayment({
            orderNo: transaction.transactionNo,
            amount: Math.round(Number(order.amount) * 100), // 转换为分
            description: order.product.name,
            method: paymentMethod,
            openid,
            notifyUrl,
            expireMinutes: 30,
        })

        if (!paymentResult.success) {
            // 更新支付单状态为失败
            await updatePaymentTransactionDao(transaction.id, {
                status: PaymentTransactionStatus.FAILED,
                errorMessage: paymentResult.errorMessage,
            })
            return {
                success: false,
                errorMessage: paymentResult.errorMessage || '创建支付失败',
            }
        }

        // 更新支付单的预支付 ID
        if (paymentResult.prepayId) {
            await updatePaymentTransactionDao(transaction.id, {
                prepayId: paymentResult.prepayId,
            })
        }

        return {
            success: true,
            transactionNo: transaction.transactionNo,
            paymentParams: paymentResult.paymentParams,
            codeUrl: paymentResult.codeUrl,
            h5Url: paymentResult.h5Url,
        }
    } catch (error) {
        logger.error('创建支付失败：', error)
        return {
            success: false,
            errorMessage: error instanceof Error ? error.message : '创建支付失败',
        }
    }
}

/**
 * 处理支付回调
 * @param channel 支付渠道
 * @param data 回调数据
 * @returns 处理结果
 */
export const handlePaymentCallbackService = async (
    channel: PaymentChannel,
    data: CallbackData
): Promise<{ success: boolean; errorMessage?: string }> => {
    try {
        // 获取支付适配器
        const adapter = getPaymentAdapter(channel)

        // 验证回调
        const verifyResult = await adapter.verifyCallback(data)
        if (!verifyResult.success) {
            logger.error('支付回调验证失败：', verifyResult.errorMessage)
            return { success: false, errorMessage: verifyResult.errorMessage }
        }

        const { orderNo, transactionId, amount, paidAt } = verifyResult

        // 查询支付单
        const transaction = await findPaymentTransactionByNoDao(orderNo!)
        if (!transaction) {
            logger.error('支付单不存在：', orderNo)
            return { success: false, errorMessage: '支付单不存在' }
        }

        // 检查是否已处理（幂等）
        if (transaction.status === PaymentTransactionStatus.SUCCESS) {
            logger.info('支付单已处理，跳过：', orderNo)
            return { success: true }
        }

        // 检查金额是否匹配
        const expectedAmount = Math.round(Number(transaction.amount) * 100)
        if (amount !== expectedAmount) {
            logger.error('支付金额不匹配：', { expected: expectedAmount, actual: amount })
            return { success: false, errorMessage: '支付金额不匹配' }
        }

        // 使用事务处理支付成功
        await prisma.$transaction(async (tx) => {
            // 更新支付单状态
            await updatePaymentTransactionDao(
                transaction.id,
                {
                    status: PaymentTransactionStatus.SUCCESS,
                    outTradeNo: transactionId,
                    paidAt: paidAt || new Date(),
                    callbackData: data.raw as object,
                },
                tx as unknown as PrismaClient
            )

            // 更新订单状态
            await updateOrderStatusDao(
                transaction.orderId,
                OrderStatus.PAID,
                paidAt || new Date(),
                tx as unknown as PrismaClient
            )

            // 处理支付成功后的业务逻辑
            await handlePaymentSuccess(transaction.order, tx as unknown as PrismaClient)
        })

        logger.info('支付回调处理成功：', orderNo)
        return { success: true }
    } catch (error) {
        logger.error('处理支付回调失败：', error)
        return {
            success: false,
            errorMessage: error instanceof Error ? error.message : '处理回调失败',
        }
    }
}

/**
 * 查询支付状态
 * @param transactionNo 支付单号
 * @returns 支付单信息（包含订单）
 */
export const queryPaymentStatusService = async (transactionNo: string) => {
    return findPaymentTransactionByNoDao(transactionNo)
}

/**
 * 主动查询支付结果
 * @param transactionNo 支付单号
 * @returns 查询结果
 */
export const queryPaymentResultService = async (
    transactionNo: string
): Promise<{ success: boolean; paid: boolean; errorMessage?: string }> => {
    try {
        const transaction = await findPaymentTransactionByNoDao(transactionNo)
        if (!transaction) {
            return { success: false, paid: false, errorMessage: '支付单不存在' }
        }

        // 如果已经是成功状态，直接返回
        if (transaction.status === PaymentTransactionStatus.SUCCESS) {
            return { success: true, paid: true }
        }

        // 如果不是待支付状态，返回未支付
        if (transaction.status !== PaymentTransactionStatus.PENDING) {
            return { success: true, paid: false }
        }

        // 调用支付适配器查询订单
        const adapter = getPaymentAdapter(transaction.paymentChannel as PaymentChannel)
        const queryResult = await adapter.queryOrder({ orderNo: transactionNo })

        if (!queryResult.success) {
            return { success: false, paid: false, errorMessage: queryResult.errorMessage }
        }

        // 如果支付成功，处理支付成功逻辑
        if (queryResult.tradeState === 'SUCCESS') {
            await prisma.$transaction(async (tx) => {
                await updatePaymentTransactionDao(
                    transaction.id,
                    {
                        status: PaymentTransactionStatus.SUCCESS,
                        outTradeNo: queryResult.transactionId,
                        paidAt: queryResult.paidAt || new Date(),
                    },
                    tx as unknown as PrismaClient
                )

                await updateOrderStatusDao(
                    transaction.orderId,
                    OrderStatus.PAID,
                    queryResult.paidAt || new Date(),
                    tx as unknown as PrismaClient
                )

                await handlePaymentSuccess(transaction.order, tx as unknown as PrismaClient)
            })

            return { success: true, paid: true }
        }

        return { success: true, paid: false }
    } catch (error) {
        logger.error('查询支付结果失败：', error)
        return {
            success: false,
            paid: false,
            errorMessage: error instanceof Error ? error.message : '查询失败',
        }
    }
}

/**
 * 处理过期支付单
 * @returns 处理数量
 */
export const handleExpiredPaymentTransactionsService = async (): Promise<number> => {
    try {
        const expiredTransactions = await findExpiredPendingTransactionsDao()

        if (expiredTransactions.length === 0) {
            return 0
        }

        const ids = expiredTransactions.map((t) => t.id)
        const count = await expirePaymentTransactionsDao(ids)

        logger.info(`已处理 ${count} 个过期支付单`)

        return count
    } catch (error) {
        logger.error('处理过期支付单失败：', error)
        throw error
    }
}
