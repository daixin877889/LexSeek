/**
 * 统一积分消耗服务层
 * 
 * 提供积分查询、直接扣减、预扣、结算、回滚等核心功能
 * 支持事务参与，通过语义化标识符管理消耗项目
 */

import type { pointConsumptionItems, pointConsumptionRecords } from '~~/generated/prisma/client'
import { v4 as uuidv4 } from 'uuid'
import {
    findConsumptionItemByKeyDao,
    findAvailableConsumptionItemsDao,
    findPreDeductRecordsByBatchIdDao,
    updateConsumptionRecordStatusByBatchIdDao,
    createConsumptionRecordDao,
    updatePointRecordUsageDao,
    findValidPointRecordsForConsumeDao,
} from './pointConsumption.dao'
import { decimalToNumberUtils } from '#shared/utils/decimalToNumber'
import { PointConsumptionItemStatus, PointConsumptionRecordStatus } from '#shared/types/point.types'

// 事务客户端类型（兼容扩展后的 prisma 客户端）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TxClient = any

/**
 * 积分检查结果
 */
export interface PointCheckResult {
    /** 积分是否充足 */
    sufficient: boolean
    /** 需要的积分数量 */
    required: number
    /** 用户可用积分 */
    available: number
    /** 消耗项目 ID */
    itemId: number
    /** 消耗项目名称 */
    itemName: string
    /** 消耗项目单位 */
    itemUnit: string
}

/**
 * 预扣结果
 */
export interface PreDeductResult {
    /** 预扣批次 ID（用于后续结算或回滚） */
    batchId: string
    /** 预扣的积分数量 */
    preDeductAmount: number
}

/**
 * 结算结果
 */
export interface SettleResult {
    /** 实际消耗的积分数量 */
    consumedAmount: number
    /** 消耗记录列表 */
    consumptionRecords: pointConsumptionRecords[]
}

/**
 * 回滚结果
 */
export interface RollbackResult {
    /** 释放的积分数量 */
    releasedAmount: number
}

/**
 * 直接扣减选项
 */
export interface ConsumeOptions {
    /** 关联的业务资源 ID */
    sourceId?: number
    /** 消耗备注 */
    remark?: string
    /** 外部事务客户端 */
    tx?: TxClient
    /** 操作关联标识（聚合展示用），透传落库 */
    operationId?: string
    /** 业务上下文快照（如「劳动合同纠纷案」），透传落库 */
    contextLabel?: string
    /** 计费用量（页/分钟/张），仅按次量场景透传，写第一条记录 */
    usageAmount?: number
}

/**
 * 预扣选项
 */
export interface PreDeductOptions {
    /** 关联的业务资源 ID */
    sourceId?: number
    /** 消耗备注 */
    remark?: string
    /** 外部事务客户端 */
    tx?: TxClient
    /** 业务上下文快照 */
    contextLabel?: string
    /** 计费用量（页/分钟/张） */
    usageAmount?: number
}

/**
 * 计算实际消耗积分（考虑折扣，向上取整）
 */
const calculateConsumeAmount = (item: pointConsumptionItems, quantity: number): number => {
    // 使用 decimalToNumberUtils 处理 Prisma Decimal 类型
    const discount = item.discount ? decimalToNumberUtils(item.discount) : 1
    return Math.ceil(item.pointAmount * quantity * discount)
}

/**
 * 通过标识符获取消耗项目
 * 
 * @param itemKey 消耗项目标识符（数据库中的 key 字段）
 * @param tx 外部事务客户端（可选）
 * @returns 消耗项目配置
 * @throws 消耗项目不存在或已禁用时抛出错误
 */
export const getConsumptionItemByKeyService = async (
    itemKey: string,
    tx?: TxClient
): Promise<pointConsumptionItems> => {
    const item = await findConsumptionItemByKeyDao(itemKey, tx)
    if (!item) {
        throw new Error(`消耗项目不存在: ${itemKey}`)
    }
    if (item.status !== PointConsumptionItemStatus.ENABLED) {
        throw new Error(`消耗项目已禁用: ${itemKey}`)
    }
    return item
}

/**
 * 获取所有可用的消耗项目标识符
 * 
 * @param tx 外部事务客户端（可选）
 * @returns 消耗项目列表（包含 key、name、pointAmount 等信息）
 */
export const getAvailableConsumptionItemsService = async (
    tx?: TxClient
): Promise<Array<{ key: string; name: string; pointAmount: number; unit: string }>> => {
    const items = await findAvailableConsumptionItemsDao(tx)
    return items
        .filter(item => item.key !== null)
        .map(item => ({
            key: item.key!,
            name: item.name,
            pointAmount: item.pointAmount,
            unit: item.unit,
        }))
}

/**
 * 检查用户积分是否足够
 * 
 * @param userId 用户 ID
 * @param itemKey 消耗项目标识符（数据库中的 key 字段）
 * @param quantity 消耗数量（如页数、分钟数），默认为 1
 * @param tx 外部事务客户端（可选）
 * @returns 积分检查结果
 */
export const checkPointsService = async (
    userId: number,
    itemKey: string,
    quantity: number = 1,
    tx?: TxClient
): Promise<PointCheckResult> => {
    logger.debug('开始检查积分', { userId, itemKey, quantity })

    // 获取消耗项目配置
    const item = await getConsumptionItemByKeyService(itemKey, tx)
    logger.debug('获取消耗项目成功', { itemId: item.id, pointAmount: item.pointAmount, discount: item.discount })

    // 计算所需积分
    const required = calculateConsumeAmount(item, quantity)
    logger.debug('计算所需积分', { required })

    // 查询用户可用积分
    const validRecords = await findValidPointRecordsForConsumeDao(userId, tx)
    const available = validRecords.reduce((sum, r) => sum + r.remaining, 0)

    logger.debug('积分检查结果', { userId, required, available, sufficient: available >= required })

    return {
        sufficient: available >= required,
        required,
        available,
        itemId: item.id,
        itemName: item.name,
        itemUnit: item.unit,
    }
}

/**
 * 直接扣减积分（适用于即时消耗场景）
 * 
 * 按 FIFO 策略优先消耗即将过期的积分
 * 
 * @param userId 用户 ID
 * @param itemKey 消耗项目标识符（数据库中的 key 字段）
 * @param quantity 消耗数量
 * @param options 扣减选项
 * @returns 结算结果
 * @throws 积分不足时抛出错误
 */
export const consumePointsService = async (
    userId: number,
    itemKey: string,
    quantity: number,
    options?: ConsumeOptions
): Promise<SettleResult> => {
    const { sourceId, remark, tx, operationId, contextLabel, usageAmount } = options || {}
    const extra = { operationId, contextLabel, usageAmount }

    // 如果传入了外部事务，直接使用；否则创建新事务
    if (tx) {
        return executeConsume(userId, itemKey, quantity, sourceId, remark, tx, extra)
    }

    return prisma.$transaction(async (txClient) => {
        return executeConsume(userId, itemKey, quantity, sourceId, remark, txClient, extra)
    })
}

/**
 * 执行积分扣减（内部方法）
 */
const executeConsume = async (
    userId: number,
    itemKey: string,
    quantity: number,
    sourceId: number | undefined,
    remark: string | undefined,
    tx: TxClient,
    extra: { operationId?: string; contextLabel?: string; usageAmount?: number } = {}
): Promise<SettleResult> => {
    // 获取消耗项目配置
    const item = await getConsumptionItemByKeyService(itemKey, tx)

    // 计算所需积分
    const consumeAmount = calculateConsumeAmount(item, quantity)

    // 查询用户有效积分记录（按过期时间升序）
    const validRecords = await findValidPointRecordsForConsumeDao(userId, tx)
    const totalRemaining = validRecords.reduce((sum, r) => sum + r.remaining, 0)

    if (totalRemaining < consumeAmount) {
        throw new Error(`积分不足，需要 ${consumeAmount}，可用 ${totalRemaining}`)
    }

    // FIFO 消耗逻辑
    let remainingToConsume = consumeAmount
    const consumptionRecords: pointConsumptionRecords[] = []
    // operationId/contextLabel 写每条；usageAmount 只写第一条，避免拆分到多条积分记录时被重复求和
    let isFirstRecord = true

    for (const record of validRecords) {
        if (remainingToConsume <= 0) break

        const consumeFromRecord = Math.min(record.remaining, remainingToConsume)

        // 更新积分记录
        await updatePointRecordUsageDao(
            record.id,
            record.used + consumeFromRecord,
            record.remaining - consumeFromRecord,
            tx
        )

        // 创建消耗记录（状态为已结算）
        const consumptionRecord = await createConsumptionRecordDao({
            userId,
            pointRecordId: record.id,
            itemId: item.id,
            pointAmount: consumeFromRecord,
            status: PointConsumptionRecordStatus.SETTLED,
            sourceId,
            remark: remark || `消耗积分：${item.name}`,
            operationId: extra.operationId ?? null,
            contextLabel: extra.contextLabel ?? null,
            usageAmount: isFirstRecord ? (extra.usageAmount ?? null) : null,
        }, tx)

        consumptionRecords.push(consumptionRecord)
        remainingToConsume -= consumeFromRecord
        isFirstRecord = false
    }

    return {
        consumedAmount: consumeAmount,
        consumptionRecords,
    }
}


/**
 * 预扣积分（适用于异步任务场景）
 * 
 * 在任务开始前锁定积分，防止任务执行期间积分被其他操作消耗
 * 
 * @param userId 用户 ID
 * @param itemKey 消耗项目标识符（数据库中的 key 字段）
 * @param quantity 预扣数量
 * @param options 预扣选项
 * @returns 预扣结果
 * @throws 积分不足时抛出错误
 */
export const preDeductPointsService = async (
    userId: number,
    itemKey: string,
    quantity: number,
    options?: PreDeductOptions
): Promise<PreDeductResult> => {
    const { sourceId, remark, tx, contextLabel, usageAmount } = options || {}
    const extra = { contextLabel, usageAmount }

    if (tx) {
        return executePreDeduct(userId, itemKey, quantity, sourceId, remark, tx, extra)
    }

    return prisma.$transaction(async (txClient) => {
        return executePreDeduct(userId, itemKey, quantity, sourceId, remark, txClient, extra)
    })
}

/**
 * 执行预扣积分（内部方法）
 */
const executePreDeduct = async (
    userId: number,
    itemKey: string,
    quantity: number,
    sourceId: number | undefined,
    remark: string | undefined,
    tx: TxClient,
    extra: { contextLabel?: string; usageAmount?: number } = {}
): Promise<PreDeductResult> => {
    // 获取消耗项目配置
    const item = await getConsumptionItemByKeyService(itemKey, tx)

    // 计算所需积分
    const preDeductAmount = calculateConsumeAmount(item, quantity)

    // 查询用户有效积分记录（按过期时间升序）
    const validRecords = await findValidPointRecordsForConsumeDao(userId, tx)
    const totalRemaining = validRecords.reduce((sum, r) => sum + r.remaining, 0)

    if (totalRemaining < preDeductAmount) {
        throw new Error(`积分不足，需要 ${preDeductAmount}，可用 ${totalRemaining}`)
    }

    // 生成批次 ID
    const batchId = uuidv4()

    // FIFO 预扣逻辑
    let remainingToDeduct = preDeductAmount
    // operationId 取 batchId 写每条；usageAmount 只写第一条
    let isFirstRecord = true

    for (const record of validRecords) {
        if (remainingToDeduct <= 0) break

        const deductFromRecord = Math.min(record.remaining, remainingToDeduct)

        // 更新积分记录（预扣时也要更新 used 和 remaining）
        await updatePointRecordUsageDao(
            record.id,
            record.used + deductFromRecord,
            record.remaining - deductFromRecord,
            tx
        )

        // 创建预扣记录（状态为预扣）
        await createConsumptionRecordDao({
            userId,
            pointRecordId: record.id,
            itemId: item.id,
            batchId,
            pointAmount: deductFromRecord,
            status: PointConsumptionRecordStatus.PRE_DEDUCT,
            sourceId,
            remark: remark || `预扣积分：${item.name}`,
            operationId: batchId,
            contextLabel: extra.contextLabel ?? null,
            usageAmount: isFirstRecord ? (extra.usageAmount ?? null) : null,
        }, tx)

        remainingToDeduct -= deductFromRecord
        isFirstRecord = false
    }

    return {
        batchId,
        preDeductAmount,
    }
}

/**
 * 结算预扣积分
 * 
 * 任务完成后将预扣积分转为已消耗，支持实际消耗与预扣数量不同的情况
 * 
 * @param batchId 预扣批次 ID
 * @param actualQuantity 实际消耗数量（可选，不传则使用预扣数量）
 * @param tx 外部事务客户端（可选）
 * @returns 结算结果
 * @throws 预扣批次不存在或已处理时抛出错误
 */
export const settlePointsService = async (
    batchId: string,
    actualQuantity?: number,
    tx?: TxClient
): Promise<SettleResult> => {
    if (tx) {
        return executeSettle(batchId, actualQuantity, tx)
    }

    return prisma.$transaction(async (txClient) => {
        return executeSettle(batchId, actualQuantity, txClient)
    })
}

/**
 * 执行结算（内部方法）
 */
const executeSettle = async (
    batchId: string,
    actualQuantity: number | undefined,
    tx: TxClient
): Promise<SettleResult> => {
    // 查询预扣记录
    const preDeductRecords = await findPreDeductRecordsByBatchIdDao(batchId, tx)

    if (preDeductRecords.length === 0) {
        throw new Error(`预扣批次不存在: ${batchId}`)
    }

    // 检查状态（只有预扣状态才能结算）
    const firstRecord = preDeductRecords[0]!
    if (firstRecord.status !== PointConsumptionRecordStatus.PRE_DEDUCT) {
        throw new Error(`预扣批次已处理: ${batchId}`)
    }

    // 计算预扣总量
    const preDeductTotal = preDeductRecords.reduce((sum, r) => sum + r.pointAmount, 0)

    // 获取消耗项目配置
    const item = firstRecord.pointConsumptionItems!

    // 计算实际消耗积分
    let actualConsumeAmount: number
    if (actualQuantity !== undefined) {
        actualConsumeAmount = calculateConsumeAmount(item, actualQuantity)
    } else {
        actualConsumeAmount = preDeductTotal
    }

    const diff = actualConsumeAmount - preDeductTotal

    if (diff > 0) {
        // 实际消耗 > 预扣数量，需要补扣
        const userId = firstRecord.userId
        const validRecords = await findValidPointRecordsForConsumeDao(userId, tx)
        const totalRemaining = validRecords.reduce((sum, r) => sum + r.remaining, 0)

        if (totalRemaining < diff) {
            throw new Error(`补扣积分不足，需要补扣 ${diff}，可用 ${totalRemaining}`)
        }

        // 补扣积分
        let remainingToDeduct = diff
        for (const record of validRecords) {
            if (remainingToDeduct <= 0) break

            const deductFromRecord = Math.min(record.remaining, remainingToDeduct)

            await updatePointRecordUsageDao(
                record.id,
                record.used + deductFromRecord,
                record.remaining - deductFromRecord,
                tx
            )

            // 创建补扣记录（继承原预扣批次的 operationId 与 contextLabel）
            await createConsumptionRecordDao({
                userId,
                pointRecordId: record.id,
                itemId: item.id,
                batchId,
                pointAmount: deductFromRecord,
                status: PointConsumptionRecordStatus.SETTLED,
                remark: `结算补扣：${item.name}`,
                operationId: batchId,
                contextLabel: firstRecord.contextLabel ?? null,
            }, tx)

            remainingToDeduct -= deductFromRecord
        }
    } else if (diff < 0) {
        // 实际消耗 < 预扣数量，需要退还
        const refundAmount = Math.abs(diff)
        let remainingToRefund = refundAmount

        // 按预扣记录倒序退还（后扣的先退）
        const reversedRecords = [...preDeductRecords].reverse()

        for (const consumptionRecord of reversedRecords) {
            if (remainingToRefund <= 0) break

            const refundFromRecord = Math.min(consumptionRecord.pointAmount, remainingToRefund)
            const pointRecord = consumptionRecord.pointRecords

            // 恢复积分记录
            await updatePointRecordUsageDao(
                pointRecord.id,
                pointRecord.used - refundFromRecord,
                pointRecord.remaining + refundFromRecord,
                tx
            )

            remainingToRefund -= refundFromRecord
        }
    }

    // 更新所有预扣记录状态为已结算
    await updateConsumptionRecordStatusByBatchIdDao(batchId, PointConsumptionRecordStatus.SETTLED, tx)

    // 重新查询更新后的记录
    const settledRecords = await findPreDeductRecordsByBatchIdDao(batchId, tx)

    return {
        consumedAmount: actualConsumeAmount,
        consumptionRecords: settledRecords,
    }
}

/**
 * 回滚预扣积分
 * 
 * 任务失败时将预扣的积分返还给用户
 * 
 * @param batchId 预扣批次 ID
 * @param tx 外部事务客户端（可选）
 * @returns 回滚结果
 * @throws 预扣批次不存在时抛出错误
 */
export const rollbackPreDeductService = async (
    batchId: string,
    tx?: TxClient
): Promise<RollbackResult> => {
    if (tx) {
        return executeRollback(batchId, tx)
    }

    return prisma.$transaction(async (txClient) => {
        return executeRollback(batchId, txClient)
    })
}

/**
 * 执行回滚（内部方法）
 */
const executeRollback = async (
    batchId: string,
    tx: TxClient
): Promise<RollbackResult> => {
    // 查询预扣记录
    const preDeductRecords = await findPreDeductRecordsByBatchIdDao(batchId, tx)

    if (preDeductRecords.length === 0) {
        throw new Error(`预扣批次不存在: ${batchId}`)
    }

    // 检查状态（已处理的批次支持幂等回滚）
    const firstRecord = preDeductRecords[0]!
    if (firstRecord.status === PointConsumptionRecordStatus.INVALID) {
        // 已回滚，幂等返回
        return { releasedAmount: 0 }
    }

    if (firstRecord.status === PointConsumptionRecordStatus.SETTLED) {
        throw new Error(`预扣批次已结算，无法回滚: ${batchId}`)
    }

    // 计算释放总量
    const releasedAmount = preDeductRecords.reduce((sum, r) => sum + r.pointAmount, 0)

    // 恢复积分记录
    for (const consumptionRecord of preDeductRecords) {
        const pointRecord = consumptionRecord.pointRecords

        await updatePointRecordUsageDao(
            pointRecord.id,
            pointRecord.used - consumptionRecord.pointAmount,
            pointRecord.remaining + consumptionRecord.pointAmount,
            tx
        )
    }

    // 更新所有预扣记录状态为无效
    await updateConsumptionRecordStatusByBatchIdDao(batchId, PointConsumptionRecordStatus.INVALID, tx)

    return { releasedAmount }
}

/**
 * 查询消耗记录
 * 
 * @param options 查询选项
 * @param tx 外部事务客户端（可选）
 * @returns 消耗记录列表和总数
 */
export const getConsumptionRecordsService = async (
    options: {
        userId?: number
        itemKey?: string
        startTime?: Date
        endTime?: Date
        status?: number
        page?: number
        pageSize?: number
    },
    tx?: TxClient
): Promise<{
    list: pointConsumptionRecords[]
    total: number
}> => {
    const { itemKey, ...restOptions } = options

    // 如果传入了 itemKey，先查询对应的 itemId
    let itemId: number | undefined
    if (itemKey) {
        const item = await findConsumptionItemByKeyDao(itemKey, tx)
        if (item) {
            itemId = item.id
        }
    }

    const { findConsumptionRecordsDao } = await import('./pointConsumption.dao')
    return findConsumptionRecordsDao({ ...restOptions, itemId }, tx)
}
