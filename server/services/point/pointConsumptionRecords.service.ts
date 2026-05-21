/**
 * 积分消耗记录服务层
 *
 * 提供积分消耗记录的业务逻辑处理
 */
import {
    findPointConsumptionRecordsByUserIdDao,
    findAggregatedConsumptionRecordsByUserIdDao,
    type AggregatedConsumptionRow,
} from './pointConsumptionRecords.dao'
import type { pointConsumptionItems, pointConsumptionRecords } from '~~/generated/prisma/client'
import { BillingMode } from '#shared/types/point.types'

/**
 * 获取用户积分消耗记录列表（分页，未聚合）。
 * 历史接口，保留供其它内部场景使用；用户端展示请用聚合版本。
 */
export const getUserConsumptionRecords = async (
    userId: number,
    options: {
        page?: number
        pageSize?: number
    }
): Promise<{
    list: (pointConsumptionRecords & { pointConsumptionItems: pointConsumptionItems })[]
    total: number
    page: number
    pageSize: number
}> => {
    const { page = 1, pageSize = 10 } = options
    const result = await findPointConsumptionRecordsByUserIdDao(userId, options)
    return {
        ...result,
        page,
        pageSize,
    }
}

/**
 * 获取用户消耗记录（按操作聚合，对外展示用）。
 * - 按 token 计费的行不返回用量，仅返回积分（避免用户拿 token 对标成本）
 * - 按次量计费的行返回合计用量 + 单位
 */
export const getUserAggregatedConsumptionRecordsService = async (
    userId: number,
    options: { page?: number; pageSize?: number },
): Promise<{
    list: Array<{
        /** 稳定行键，前端展开/收起用 */
        key: string
        sceneName: string
        contextLabel: string | null
        totalPoints: number
        /** 按次量模式的用量描述，如「8 页」；token 模式为 null */
        usageText: string | null
        status: number
        time: Date
    }>
    total: number
    page: number
    pageSize: number
}> => {
    const { page = 1, pageSize = 10 } = options
    const result = await findAggregatedConsumptionRecordsByUserIdDao(userId, options)
    const list = result.list.map((row: AggregatedConsumptionRow) => ({
        key: row.groupKey,
        sceneName: row.sceneName,
        contextLabel: row.contextLabel,
        totalPoints: row.totalPoints,
        usageText: row.billingMode === BillingMode.TOKEN
            ? null
            : (row.totalUsage > 0 ? `${row.totalUsage} ${row.unit}` : null),
        status: row.status,
        time: row.earliestAt,
    }))
    return { list, total: result.total, page, pageSize }
}
