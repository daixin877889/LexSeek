/**
 * 支付管理端业务服务
 */
import type { H3Event } from 'h3'
import dayjs from 'dayjs'
import type { AdminPaymentQuery } from '#shared/types/payment'
import type { PaginationParams } from '#shared/types/rbac'
import {
    PaymentChannelText,
    PaymentMethodText,
    PaymentStatusText,
    PaymentTransactionStatus,
} from '#shared/types/payment'
import { decimalToNumberUtils } from '#shared/utils/decimalToNumber'
import { prisma } from '~~/server/utils/db'
import {
    findPaymentTransactionsForAdminDao,
    findPaymentTransactionForAdminDao,
    updatePaymentTransactionAdminRemarkDao,
    findPaymentTransactionsForAdminExportDao,
} from './paymentTransaction.admin.dao'
import { findAuditLogsByTargetDao } from '~~/server/services/rbac/auditLog.dao'
import { logPaymentRemarkUpdate } from '~~/server/services/rbac/auditLog.service'

export const findPaymentTransactionsForAdminService = async (
    query: AdminPaymentQuery,
    pagination: PaginationParams = {},
) => findPaymentTransactionsForAdminDao(query, pagination)

/** 详情：含 order/user + 审计日志 + 备注修改人昵称 */
export const findPaymentTransactionForAdminService = async (id: number) => {
    const p = await findPaymentTransactionForAdminDao(id)
    if (!p) return null

    const audit = await findAuditLogsByTargetDao('payment_transaction', id, { page: 1, pageSize: 50 })

    let adminRemarkUpdaterName: string | null = null
    if (p.adminRemarkUpdatedBy) {
        const updater = await prisma.users.findUnique({
            where: { id: p.adminRemarkUpdatedBy },
            select: { name: true },
        })
        adminRemarkUpdaterName = updater?.name ?? null
    }

    return { ...p, auditLogs: audit.items, adminRemarkUpdaterName }
}

/** 更新管理员备注 + 审计 */
export const updatePaymentAdminRemarkService = async (
    event: H3Event,
    operatorId: number,
    id: number,
    remark: string | null,
) => {
    return prisma.$transaction(async (tx) => {
        const before = await findPaymentTransactionForAdminDao(id, tx)
        if (!before) throw new Error('支付单不存在')
        await updatePaymentTransactionAdminRemarkDao(id, remark, operatorId, tx)
        await logPaymentRemarkUpdate(event, operatorId, id, {
            oldRemark: before.adminRemark,
            newRemark: remark,
        }, tx)
        return findPaymentTransactionForAdminDao(id, tx)
    })
}

/** 导出支付记录 CSV */
export const exportPaymentTransactionsService = async (
    query: AdminPaymentQuery,
    limit: number,
): Promise<string> => {
    if (limit > 10000) throw new Error('导出条数超过上限 10000，请缩小筛选范围')
    const list = await findPaymentTransactionsForAdminExportDao(query, limit)
    return buildPaymentsCsv(list)
}

// ==================== CSV 工具 ====================

const csvEscape = (v: unknown): string => {
    if (v === null || v === undefined) return '""'
    return `"${String(v).replace(/"/g, '""')}"`
}

const fmtTime = (d: Date | null | undefined): string =>
    d ? dayjs(d).format('YYYY-MM-DD HH:mm:ss') : ''

function buildPaymentsCsv(list: Array<any>): string {
    const headers = [
        '支付单号', '关联订单号', '用户手机号',
        '支付渠道', '支付方式', '金额（元）', '状态',
        '第三方交易号', '创建时间', '支付时间', '管理员备注',
    ]
    const rows = list.map((p) => [
        p.transactionNo,
        p.order?.orderNo ?? '',
        p.order?.user?.phone ?? '',
        PaymentChannelText[p.paymentChannel as keyof typeof PaymentChannelText] ?? p.paymentChannel,
        PaymentMethodText[p.paymentMethod as keyof typeof PaymentMethodText] ?? p.paymentMethod,
        decimalToNumberUtils(p.amount),
        PaymentStatusText[p.status as PaymentTransactionStatus] ?? '',
        p.outTradeNo ?? '',
        fmtTime(p.createdAt),
        fmtTime(p.paidAt),
        p.adminRemark ?? '',
    ])
    const BOM = '﻿'
    return BOM + [headers, ...rows]
        .map((row) => row.map(csvEscape).join(','))
        .join('\n')
}
