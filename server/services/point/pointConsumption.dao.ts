/**
 * 统一积分消耗数据访问层
 * 
 * 提供积分消耗相关的数据库操作，包括消耗项目查询、预扣记录管理等
 */

import type { Prisma, pointConsumptionItems, pointConsumptionRecords, pointRecords } from '~~/generated/prisma/client'

// 事务客户端类型（兼容扩展后的 prisma 客户端）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TxClient = any

/**
 * 通过 key 查询消耗项目
 * @param key 消耗项目标识符
 * @param tx 事务客户端（可选）
 * @returns 消耗项目或 null
 */
export const findConsumptionItemByKeyDao = async (
    key: string,
    tx?: TxClient
): Promise<pointConsumptionItems | null> => {
    try {
        logger.debug('查询消耗项目', { key })
        // 使用 findFirst 而不是 findUnique，因为需要同时检查 deletedAt
        const item = await (tx || prisma).pointConsumptionItems.findFirst({
            where: { key, deletedAt: null },
        })
        logger.debug('查询消耗项目结果', { key, found: !!item, itemId: item?.id, itemStatus: item?.status })
        return item
    } catch (error) {
        logger.error('通过 key 查询消耗项目失败：', error)
        throw error
    }
}

// findPointConsumptionItemByIdDao 已移至 pointConsumptionItems.dao.ts，避免重复导出

/**
 * 查询所有启用的消耗项目
 * @param tx 事务客户端（可选）
 * @returns 启用的消耗项目列表
 */
export const findAvailableConsumptionItemsDao = async (
    tx?: TxClient
): Promise<pointConsumptionItems[]> => {
    try {
        const items = await (tx || prisma).pointConsumptionItems.findMany({
            where: {
                status: PointConsumptionItemStatus.ENABLED,
                deletedAt: null,
                key: { not: null },
            },
            orderBy: { id: 'asc' },
        })
        return items
    } catch (error) {
        logger.error('查询启用的消耗项目列表失败：', error)
        throw error
    }
}

/**
 * 通过批次 ID 查询预扣记录
 * @param batchId 预扣批次 ID
 * @param tx 事务客户端（可选）
 * @returns 预扣记录列表
 */
export const findPreDeductRecordsByBatchIdDao = async (
    batchId: string,
    tx?: TxClient
): Promise<(pointConsumptionRecords & { pointRecords: pointRecords; pointConsumptionItems: pointConsumptionItems })[]> => {
    try {
        const records = await (tx || prisma).pointConsumptionRecords.findMany({
            where: {
                batchId,
                deletedAt: null,
            },
            include: {
                pointRecords: true,
                pointConsumptionItems: true,
            },
            orderBy: { id: 'asc' },
        })
        return records
    } catch (error) {
        logger.error('通过批次 ID 查询预扣记录失败：', error)
        throw error
    }
}

/**
 * 批量更新消耗记录状态
 * @param batchId 预扣批次 ID
 * @param status 新状态
 * @param tx 事务客户端（可选）
 * @returns 更新的记录数量
 */
export const updateConsumptionRecordStatusByBatchIdDao = async (
    batchId: string,
    status: number,
    tx?: TxClient
): Promise<number> => {
    try {
        const result = await (tx || prisma).pointConsumptionRecords.updateMany({
            where: {
                batchId,
                deletedAt: null,
            },
            data: {
                status,
                updatedAt: new Date(),
            },
        })
        return result.count
    } catch (error) {
        logger.error('批量更新消耗记录状态失败：', error)
        throw error
    }
}

/**
 * 创建积分消耗记录
 * @param data 消耗记录数据
 * @param tx 事务客户端（可选）
 * @returns 创建的消耗记录
 */
export const createConsumptionRecordDao = async (
    data: {
        userId: number
        pointRecordId: number
        itemId: number
        batchId?: string | null
        pointAmount: number
        status: number
        sourceId?: number | null
        remark?: string | null
    },
    tx?: TxClient
): Promise<pointConsumptionRecords> => {
    try {
        const record = await (tx || prisma).pointConsumptionRecords.create({
            data: {
                users: { connect: { id: data.userId } },
                pointRecords: { connect: { id: data.pointRecordId } },
                pointConsumptionItems: { connect: { id: data.itemId } },
                batchId: data.batchId,
                pointAmount: data.pointAmount,
                status: data.status,
                sourceId: data.sourceId,
                remark: data.remark,
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
 * 更新积分记录的已使用和剩余积分
 * @param id 积分记录 ID
 * @param used 新的已使用积分
 * @param remaining 新的剩余积分
 * @param tx 事务客户端（可选）
 * @returns 更新后的积分记录
 */
export const updatePointRecordUsageDao = async (
    id: number,
    used: number,
    remaining: number,
    tx?: TxClient
): Promise<pointRecords> => {
    try {
        const record = await (tx || prisma).pointRecords.update({
            where: { id },
            data: {
                used,
                remaining,
                updatedAt: new Date(),
            },
        })
        return record
    } catch (error) {
        logger.error('更新积分记录使用量失败：', error)
        throw error
    }
}

/**
 * 查询用户有效积分记录（按过期时间升序，用于 FIFO 消耗）
 * @param userId 用户 ID
 * @param tx 事务客户端（可选）
 * @returns 有效积分记录列表
 */
export const findValidPointRecordsForConsumeDao = async (
    userId: number,
    tx?: TxClient
): Promise<pointRecords[]> => {
    try {
        const now = new Date()
        logger.debug('查询用户有效积分记录', { userId, now: now.toISOString() })
        const records = await (tx || prisma).pointRecords.findMany({
            where: {
                userId,
                status: PointRecordStatus.VALID,
                remaining: { gt: 0 },
                effectiveAt: { lte: now },
                expiredAt: { gt: now },
                deletedAt: null,
            },
            orderBy: { expiredAt: 'asc' },
        })
        logger.debug('查询用户有效积分记录结果', {
            userId,
            count: records.length,
            totalRemaining: records.reduce((sum: number, r: pointRecords) => sum + r.remaining, 0),
        })
        return records
    } catch (error) {
        logger.error('查询用户有效积分记录失败：', error)
        throw error
    }
}

/**
 * 查询消耗记录（支持多条件筛选）
 * @param options 查询选项
 * @param tx 事务客户端（可选）
 * @returns 消耗记录列表和总数
 */
export const findConsumptionRecordsDao = async (
    options: {
        userId?: number
        itemId?: number
        startTime?: Date
        endTime?: Date
        status?: number
        page?: number
        pageSize?: number
    },
    tx?: TxClient
): Promise<{
    list: (pointConsumptionRecords & { pointRecords: pointRecords; pointConsumptionItems: pointConsumptionItems })[]
    total: number
}> => {
    try {
        const { userId, itemId, startTime, endTime, status, page = 1, pageSize = 10 } = options
        const skip = (page - 1) * pageSize

        const where: Prisma.pointConsumptionRecordsWhereInput = {
            deletedAt: null,
            ...(userId !== undefined && { userId }),
            ...(itemId !== undefined && { itemId }),
            ...(status !== undefined && { status }),
            ...(startTime && { createdAt: { gte: startTime } }),
            ...(endTime && { createdAt: { lte: endTime } }),
        }

        const [list, total] = await Promise.all([
            (tx || prisma).pointConsumptionRecords.findMany({
                where,
                skip,
                take: pageSize,
                orderBy: { createdAt: 'desc' },
                include: {
                    pointRecords: true,
                    pointConsumptionItems: true,
                },
            }),
            (tx || prisma).pointConsumptionRecords.count({ where }),
        ])

        return { list, total }
    } catch (error) {
        logger.error('查询消耗记录失败：', error)
        throw error
    }
}
