/**
 * 订单管理端数据访问层
 *
 * 与 order.dao.ts（用户端）物理隔离，不做 owner 过滤。
 */
import type { Prisma } from '#shared/types/prisma'
import type { AdminOrderQuery } from '#shared/types/payment'
import type { PaginationParams } from '#shared/types/rbac'
import { OrderStatus } from '#shared/types/payment'
import { prisma } from '~~/server/utils/db'

const orderInclude = {
    user: { select: { id: true, phone: true, name: true } },
    product: { select: { id: true, name: true, type: true } },
    paymentTransactions: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' as const },
    },
} satisfies Prisma.ordersInclude

const buildWhere = (q: AdminOrderQuery): Prisma.ordersWhereInput => {
    const where: Prisma.ordersWhereInput = { deletedAt: null }
    if (q.keyword) {
        where.OR = [
            { orderNo: { contains: q.keyword } },
            { user: { phone: { contains: q.keyword } } },
            { user: { name: { contains: q.keyword } } },
        ]
    }
    if (q.status !== undefined) where.status = q.status
    if (q.orderType) where.orderType = q.orderType
    if (q.productId) where.productId = q.productId
    if (q.startTime || q.endTime) {
        where.createdAt = {}
        if (q.startTime) where.createdAt.gte = q.startTime
        if (q.endTime) where.createdAt.lte = q.endTime
    }
    return where
}

/** 列表（分页 + 筛选） */
export const findOrdersForAdminDao = async (
    query: AdminOrderQuery,
    pagination: PaginationParams = {},
    tx?: Prisma.TransactionClient,
) => {
    const { page = 1, pageSize = 20 } = pagination
    const where = buildWhere(query)
    const client = tx ?? prisma
    const [items, total] = await Promise.all([
        client.orders.findMany({
            where,
            include: orderInclude,
            skip: (page - 1) * pageSize,
            take: pageSize,
            orderBy: { createdAt: 'desc' },
        }),
        client.orders.count({ where }),
    ])
    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) }
}

/** 导出查询（无分页，按 limit 限制条数） */
export const findOrdersForAdminExportDao = async (
    query: AdminOrderQuery,
    limit: number,
    tx?: Prisma.TransactionClient,
) => {
    return (tx ?? prisma).orders.findMany({
        where: buildWhere(query),
        include: orderInclude,
        take: limit,
        orderBy: { createdAt: 'desc' },
    })
}

/** 详情（含关联） */
export const findOrderForAdminDao = async (id: number, tx?: Prisma.TransactionClient) => {
    return (tx ?? prisma).orders.findFirst({
        where: { id, deletedAt: null },
        include: orderInclude,
    })
}

/** 更新管理员备注 */
export const updateOrderAdminRemarkDao = async (
    id: number,
    remark: string | null,
    operatorId: number,
    tx?: Prisma.TransactionClient,
) => {
    return (tx ?? prisma).orders.update({
        where: { id },
        data: {
            adminRemark: remark,
            adminRemarkUpdatedBy: operatorId,
            adminRemarkUpdatedAt: new Date(),
        },
    })
}

/** 后台取消订单（写状态 + admin_remark 含取消原因） */
export const updateOrderForAdminCancelDao = async (
    id: number,
    reason: string,
    operatorId: number,
    tx?: Prisma.TransactionClient,
) => {
    return (tx ?? prisma).orders.update({
        where: { id },
        data: {
            status: OrderStatus.CANCELLED,
            adminRemark: `[后台取消] ${reason}`,
            adminRemarkUpdatedBy: operatorId,
            adminRemarkUpdatedAt: new Date(),
        },
    })
}
