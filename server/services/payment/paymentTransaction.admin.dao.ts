/**
 * 支付单管理端数据访问层
 *
 * 与 paymentTransaction.dao.ts（用户端 / 业务侧）物理隔离，不做 owner 过滤。
 */
import type { Prisma } from '#shared/types/prisma'
import type { AdminPaymentQuery } from '#shared/types/payment'
import type { PaginationParams } from '#shared/types/rbac'
import { PaymentTransactionStatus } from '#shared/types/payment'
import { prisma } from '~~/server/utils/db'

const paymentInclude = {
    order: {
        include: {
            user: { select: { id: true, phone: true, name: true } },
        },
    },
} satisfies Prisma.paymentTransactionsInclude

const buildWhere = (q: AdminPaymentQuery): Prisma.paymentTransactionsWhereInput => {
    const where: Prisma.paymentTransactionsWhereInput = { deletedAt: null }
    if (q.keyword) {
        where.OR = [
            { transactionNo: { contains: q.keyword } },
            { outTradeNo: { contains: q.keyword } },
            { order: { orderNo: { contains: q.keyword } } },
            { order: { user: { phone: { contains: q.keyword } } } },
            { order: { user: { name: { contains: q.keyword } } } },
        ]
    }
    if (q.status !== undefined) where.status = q.status
    if (q.paymentChannel) where.paymentChannel = q.paymentChannel
    if (q.paymentMethod) where.paymentMethod = q.paymentMethod
    if (q.startTime || q.endTime) {
        where.createdAt = {}
        if (q.startTime) where.createdAt.gte = q.startTime
        if (q.endTime) where.createdAt.lte = q.endTime
    }
    return where
}

/** 列表（分页 + 筛选） */
export const findPaymentTransactionsForAdminDao = async (
    query: AdminPaymentQuery,
    pagination: PaginationParams = {},
    tx?: Prisma.TransactionClient,
) => {
    const { page = 1, pageSize = 20 } = pagination
    const where = buildWhere(query)
    const client = tx ?? prisma
    const [items, total] = await Promise.all([
        client.paymentTransactions.findMany({
            where,
            include: paymentInclude,
            skip: (page - 1) * pageSize,
            take: pageSize,
            orderBy: { createdAt: 'desc' },
        }),
        client.paymentTransactions.count({ where }),
    ])
    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) }
}

/** 导出查询（无分页） */
export const findPaymentTransactionsForAdminExportDao = async (
    query: AdminPaymentQuery,
    limit: number,
    tx?: Prisma.TransactionClient,
) => {
    return (tx ?? prisma).paymentTransactions.findMany({
        where: buildWhere(query),
        include: paymentInclude,
        take: limit,
        orderBy: { createdAt: 'desc' },
    })
}

/** 详情 */
export const findPaymentTransactionForAdminDao = async (
    id: number,
    tx?: Prisma.TransactionClient,
) => {
    return (tx ?? prisma).paymentTransactions.findFirst({
        where: { id, deletedAt: null },
        include: paymentInclude,
    })
}

/** 更新管理员备注 */
export const updatePaymentTransactionAdminRemarkDao = async (
    id: number,
    remark: string | null,
    operatorId: number,
    tx?: Prisma.TransactionClient,
) => {
    return (tx ?? prisma).paymentTransactions.update({
        where: { id },
        data: {
            adminRemark: remark,
            adminRemarkUpdatedBy: operatorId,
            adminRemarkUpdatedAt: new Date(),
        },
    })
}

/** 关闭某订单下所有"待支付"状态的支付单（取消订单事务调用） */
export const closePendingPaymentsForOrderDao = async (
    orderId: number,
    tx?: Prisma.TransactionClient,
): Promise<number> => {
    const result = await (tx ?? prisma).paymentTransactions.updateMany({
        where: { orderId, status: PaymentTransactionStatus.PENDING, deletedAt: null },
        data: { status: PaymentTransactionStatus.EXPIRED },
    })
    return result.count
}
