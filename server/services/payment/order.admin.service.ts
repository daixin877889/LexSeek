/**
 * 订单管理端业务服务
 *
 * 与 order.service.ts（用户端）物理隔离。
 * 含取消订单事务 + CSV 导出。
 */
import type { H3Event } from 'h3'
import dayjs from 'dayjs'
import type { AdminOrderQuery } from '#shared/types/payment'
import type { PaginationParams } from '#shared/types/rbac'
import { OrderStatus, OrderTypeText, OrderStatusText } from '#shared/types/payment'
import { decimalToNumberUtils } from '#shared/utils/decimalToNumber'
import { prisma } from '~~/server/utils/db'
import {
    findOrdersForAdminDao,
    findOrderForAdminDao,
    updateOrderAdminRemarkDao,
    updateOrderForAdminCancelDao,
    findOrdersForAdminExportDao,
} from './order.admin.dao'
import { closePendingPaymentsForOrderDao } from './paymentTransaction.admin.dao'
import { findAuditLogsByTargetDao } from '~~/server/services/rbac/auditLog.dao'
import {
    logOrderCancel,
    logOrderRemarkUpdate,
} from '~~/server/services/rbac/auditLog.service'

// ==================== 业务方法 ====================

export const findOrdersForAdminService = async (
    query: AdminOrderQuery,
    pagination: PaginationParams = {},
) => findOrdersForAdminDao(query, pagination)

/**
 * 详情：含订单 / user / product / 关联支付单 + 审计日志 + 备注修改人昵称
 *
 * 因 admin_remark_updated_by 不建外键（避免高频写入连带），需单独查询 users 表填充
 * adminRemarkUpdaterName。
 */
export const findOrderForAdminService = async (id: number) => {
    const order = await findOrderForAdminDao(id)
    if (!order) return null

    const audit = await findAuditLogsByTargetDao('order', id, { page: 1, pageSize: 50 })

    let adminRemarkUpdaterName: string | null = null
    if (order.adminRemarkUpdatedBy) {
        const updater = await prisma.users.findUnique({
            where: { id: order.adminRemarkUpdatedBy },
            select: { name: true },
        })
        adminRemarkUpdaterName = updater?.name ?? null
    }

    return { ...order, auditLogs: audit.items, adminRemarkUpdaterName }
}

/**
 * 更新管理员备注（含审计日志，事务保证一致性）
 */
export const updateOrderAdminRemarkService = async (
    event: H3Event,
    operatorId: number,
    id: number,
    remark: string | null,
) => {
    return prisma.$transaction(async (tx) => {
        const before = await findOrderForAdminDao(id, tx)
        if (!before) throw new Error('订单不存在')
        await updateOrderAdminRemarkDao(id, remark, operatorId, tx)
        await logOrderRemarkUpdate(event, operatorId, id, {
            oldRemark: before.adminRemark,
            newRemark: remark,
        }, tx)
        return findOrderForAdminDao(id, tx)
    })
}

/**
 * 后台取消订单（事务原子）：
 *  1. 校验状态 == PENDING
 *  2. 订单 → CANCELLED + admin_remark 写 [后台取消] {reason}
 *  3. 关闭该订单下所有 PENDING 支付单 → EXPIRED
 *  4. 写审计日志
 */
export const cancelOrderByAdminService = async (
    event: H3Event,
    operatorId: number,
    id: number,
    reason: string,
) => {
    return prisma.$transaction(async (tx) => {
        const order = await findOrderForAdminDao(id, tx)
        if (!order) throw new Error('订单不存在')
        if (order.status !== OrderStatus.PENDING) {
            throw new Error('仅待支付订单可取消')
        }
        await updateOrderForAdminCancelDao(id, reason, operatorId, tx)
        await closePendingPaymentsForOrderDao(id, tx)
        await logOrderCancel(event, operatorId, id, {
            oldStatus: order.status,
            reason,
        }, tx)
        return findOrderForAdminDao(id, tx)
    })
}

/**
 * 导出订单 CSV（带 BOM，UTF-8）
 */
export const exportOrdersService = async (
    query: AdminOrderQuery,
    limit: number,
): Promise<string> => {
    if (limit > 10000) throw new Error('导出条数超过上限 10000，请缩小筛选范围')
    const orders = await findOrdersForAdminExportDao(query, limit)
    return buildOrdersCsv(orders)
}

// ==================== CSV 工具 ====================

const csvEscape = (v: unknown): string => {
    if (v === null || v === undefined) return '""'
    const s = String(v).replace(/"/g, '""')
    return `"${s}"`
}

const fmtTime = (d: Date | null | undefined): string =>
    d ? dayjs(d).format('YYYY-MM-DD HH:mm:ss') : ''

function buildOrdersCsv(orders: Array<any>): string {
    const headers = [
        '订单号', '用户手机号', '用户昵称', '商品名',
        '订单类型', '金额（元）', '状态',
        '创建时间', '支付时间', '管理员备注',
    ]
    const rows = orders.map((o) => [
        o.orderNo,
        o.user?.phone ?? '',
        o.user?.name ?? '',
        o.product?.name ?? '',
        OrderTypeText[o.orderType as keyof typeof OrderTypeText] ?? o.orderType,
        decimalToNumberUtils(o.amount),
        OrderStatusText[o.status as OrderStatus] ?? '',
        fmtTime(o.createdAt),
        fmtTime(o.paidAt),
        o.adminRemark ?? '',
    ])
    const BOM = '﻿'
    return BOM + [headers, ...rows]
        .map((row) => row.map(csvEscape).join(','))
        .join('\n')
}
