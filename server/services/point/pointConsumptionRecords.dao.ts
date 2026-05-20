/**
 * 积分消耗记录数据访问层
 * 
 * 提供积分消耗记录的 CRUD 操作
 */

import type { Prisma } from '#shared/types/prisma'
import type { pointConsumptionItems, pointConsumptionRecords } from '~~/generated/prisma/client'
// 定义 Prisma 客户端类型（支持事务）
type PrismaClient = typeof prisma

/**
 * 创建积分消耗记录
 * @param data 积分消耗记录创建数据
 * @param tx 事务客户端（可选）
 * @returns 创建的积分消耗记录
 */
export const createPointConsumptionRecordDao = async (
    data: Prisma.pointConsumptionRecordsCreateInput,
    tx?: PrismaClient
): Promise<pointConsumptionRecords> => {
    try {
        const record = await (tx || prisma).pointConsumptionRecords.create({
            data: {
                ...data,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })
        return record
    } catch (error) {
        logger.error('创建积分消耗记录失败：', error)
        throw error
    }
}

/**
 * 查询用户积分消耗记录列表（分页，关联消耗项目）
 * @param userId 用户 ID
 * @param options 查询选项
 * @param tx 事务客户端（可选）
 * @returns 积分消耗记录列表和总数
 */
export const findPointConsumptionRecordsByUserIdDao = async (
    userId: number,
    options: {
        page?: number
        pageSize?: number
    },
    tx?: PrismaClient
): Promise<{
    list: (pointConsumptionRecords & { pointConsumptionItems: pointConsumptionItems })[]
    total: number
}> => {
    try {
        const { page = 1, pageSize = 10 } = options
        const skip = (page - 1) * pageSize

        const where: Prisma.pointConsumptionRecordsWhereInput = {
            userId,
            deletedAt: null,
        }

        // 并行查询列表和总数
        const [list, total] = await Promise.all([
            (tx || prisma).pointConsumptionRecords.findMany({
                where,
                skip,
                take: pageSize,
                orderBy: { createdAt: 'desc' },
                include: {
                    pointConsumptionItems: true,
                },
            }),
            (tx || prisma).pointConsumptionRecords.count({ where }),
        ])

        return { list, total }
    } catch (error) {
        logger.error('查询用户积分消耗记录列表失败：', error)
        throw error
    }
}

/**
 * 统计积分记录关联的消耗记录总量
 * @param pointRecordId 积分记录 ID
 * @param tx 事务客户端（可选）
 * @returns 消耗积分总量
 */
export const sumConsumptionByPointRecordIdDao = async (
    pointRecordId: number,
    tx?: PrismaClient
): Promise<number> => {
    try {
        const result = await (tx || prisma).pointConsumptionRecords.aggregate({
            where: {
                pointRecordId,
                deletedAt: null,
            },
            _sum: {
                pointAmount: true,
            },
        })
        return result._sum.pointAmount || 0
    } catch (error) {
        logger.error('统计积分记录关联的消耗记录总量失败：', error)
        throw error
    }
}

/** 聚合后的消耗记录行（一次操作一行） */
export interface AggregatedConsumptionRow {
    /** 聚合分组键（operationId，或旧记录的 single-<id>），前端用作稳定 rowKey */
    groupKey: string
    itemId: number
    /** 用户友好场景名（displayName 优先，回退 name） */
    sceneName: string
    /** 业务上下文快照 */
    contextLabel: string | null
    /** 计量单位 */
    unit: string
    /** 计费模式 */
    billingMode: number
    /** 合计消耗积分 */
    totalPoints: number
    /** 合计用量（按次量模式才有意义） */
    totalUsage: number
    /** 聚合状态：0-异常，1-处理中，2-已完成 */
    status: number
    /** 最早记录时间 */
    earliestAt: Date
    /** 该操作下的碎记录数 */
    recordCount: number
}

/**
 * 查询用户消耗记录（按 operationId 聚合，分页）。
 * operationId 为空的旧记录各自独立成行（分组键 single-<id>）。
 */
export const findAggregatedConsumptionRecordsByUserIdDao = async (
    userId: number,
    options: { page?: number; pageSize?: number },
    tx?: PrismaClient,
): Promise<{ list: AggregatedConsumptionRow[]; total: number }> => {
    try {
        const { page = 1, pageSize = 10 } = options
        const offset = (page - 1) * pageSize
        const db = tx || prisma

        const rows = await db.$queryRaw<Array<{
            group_key: string
            item_id: number
            scene_name: string
            context_label: string | null
            unit: string
            billing_mode: number
            total_points: number
            total_usage: number
            has_invalid: boolean
            has_prededuct: boolean
            earliest_at: Date
            record_count: number
        }>>`
            SELECT
                COALESCE(r.operation_id, 'single-' || r.id::text) AS group_key,
                r.item_id,
                COALESCE(i.display_name, i.name) AS scene_name,
                MAX(r.context_label) AS context_label,
                i.unit,
                i.billing_mode,
                SUM(r.point_amount)::int AS total_points,
                SUM(COALESCE(r.usage_amount, 0))::int AS total_usage,
                BOOL_OR(r.status = 0) AS has_invalid,
                BOOL_OR(r.status = 1) AS has_prededuct,
                MIN(r.created_at) AS earliest_at,
                COUNT(*)::int AS record_count
            FROM point_consumption_records r
            JOIN point_consumption_items i ON i.id = r.item_id
            WHERE r.user_id = ${userId} AND r.deleted_at IS NULL
            GROUP BY COALESCE(r.operation_id, 'single-' || r.id::text), r.item_id, i.display_name, i.name, i.unit, i.billing_mode
            ORDER BY earliest_at DESC
            LIMIT ${pageSize} OFFSET ${offset}
        `

        const totalRows = await db.$queryRaw<Array<{ count: bigint }>>`
            SELECT COUNT(*)::bigint AS count FROM (
                SELECT 1
                FROM point_consumption_records r
                WHERE r.user_id = ${userId} AND r.deleted_at IS NULL
                GROUP BY COALESCE(r.operation_id, 'single-' || r.id::text), r.item_id
            ) t
        `

        const list: AggregatedConsumptionRow[] = rows.map(row => ({
            groupKey: row.group_key,
            itemId: row.item_id,
            sceneName: row.scene_name,
            contextLabel: row.context_label,
            unit: row.unit,
            billingMode: row.billing_mode,
            totalPoints: row.total_points,
            totalUsage: row.total_usage,
            // 处理中优先于异常优先于已完成
            status: row.has_prededuct ? 1 : (row.has_invalid ? 0 : 2),
            earliestAt: row.earliest_at,
            recordCount: row.record_count,
        }))

        return { list, total: Number(totalRows[0]?.count ?? 0n) }
    } catch (error) {
        logger.error('聚合查询用户消耗记录失败：', error)
        throw error
    }
}
