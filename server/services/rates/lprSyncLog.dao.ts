/**
 * LPR 同步日志数据访问层
 *
 * 提供 lpr_sync_logs 的创建、更新、查询最近一次。
 */
import type { Prisma } from '#shared/types/prisma'
import type { lprSyncLogs } from '~~/generated/prisma/client'
import { prisma } from '~~/server/utils/db'
type PrismaClient = typeof prisma

export async function createLPRSyncLogDAO(
    data: Prisma.lprSyncLogsCreateInput,
    tx?: PrismaClient,
): Promise<lprSyncLogs> {
    return (tx ?? prisma).lprSyncLogs.create({ data })
}

export async function updateLPRSyncLogDAO(
    id: number,
    data: Prisma.lprSyncLogsUpdateInput,
    tx?: PrismaClient,
): Promise<lprSyncLogs> {
    return (tx ?? prisma).lprSyncLogs.update({ where: { id }, data })
}

export async function findLatestLPRSyncLogDAO(
    tx?: PrismaClient,
): Promise<lprSyncLogs | null> {
    return (tx ?? prisma).lprSyncLogs.findFirst({
        orderBy: { startedAt: 'desc' },
    })
}
