/**
 * 统一计费服务
 *
 * 在三阶段消耗引擎（pointConsumption.service）之上做"配置感知"封装：
 * - 读消耗项目配置，停用则跳过扣减
 * - 按 billingMode 把用量换算成消耗数量
 * - 透传 operationId / contextLabel / usageAmount 落库
 */

import { v4 as uuidv4 } from 'uuid'
import { findConsumptionItemByKeyDao } from './pointConsumption.dao'
import {
    checkPointsService,
    consumePointsService,
    preDeductPointsService,
    settlePointsService,
    rollbackPreDeductService,
} from './pointConsumption.service'
import { BillingMode, PointConsumptionItemStatus } from '#shared/types/point.types'

/** 计费用量：按 token 计费传 tokens，按次量计费传 units */
export interface BillingUsage {
    tokens?: number
    units?: number
}

/** 计费上下文 */
export interface BillingContext {
    /** 业务上下文快照标签（如「劳动合同纠纷案」） */
    contextLabel?: string
    /** 关联业务资源 ID */
    sourceId?: number
    /** 操作关联标识；不传则自动生成 */
    operationId?: string
}

/** 直接扣结果 */
export interface BillResult {
    /** 是否因配置停用而跳过 */
    skipped: boolean
    /** 实际消耗积分 */
    consumedAmount: number
    /** 操作关联标识 */
    operationId: string
}

/** 预扣结果 */
export interface BillReserveResult {
    skipped: boolean
    /** 预扣批次 ID（停用时为空字符串） */
    batchId: string
    /** 预扣积分 */
    preDeductAmount: number
}

/** 积分检查结果 */
export interface BillCheckResult {
    skipped: boolean
    sufficient: boolean
    required: number
    available: number
}

/**
 * 按计费模式把用量换算成消耗数量。
 * 缺对应度量时降级用另一个并告警，保证不崩。
 */
const resolveQuantity = (
    billingMode: number,
    usage: BillingUsage,
): { quantity: number; usageUnits: number | null } => {
    if (billingMode === BillingMode.TOKEN) {
        if (usage.tokens != null) {
            return { quantity: Math.ceil(usage.tokens / 1000), usageUnits: null }
        }
        logger.warn('计费模式为 TOKEN 但缺少 tokens，降级用 units', { usage })
        return { quantity: usage.units ?? 0, usageUnits: usage.units ?? null }
    }
    // COUNT
    if (usage.units != null) {
        return { quantity: usage.units, usageUnits: usage.units }
    }
    logger.warn('计费模式为 COUNT 但缺少 units，降级用 tokens', { usage })
    return {
        quantity: usage.tokens != null ? Math.ceil(usage.tokens / 1000) : 0,
        usageUnits: null,
    }
}

/**
 * 检查积分是否够本次计费。停用项直接放行。
 */
export const billCheckService = async (
    userId: number,
    itemKey: string,
    usage: BillingUsage,
): Promise<BillCheckResult> => {
    const item = await findConsumptionItemByKeyDao(itemKey)
    if (!item) throw new Error(`消耗项目不存在: ${itemKey}`)
    if (item.status !== PointConsumptionItemStatus.ENABLED) {
        return { skipped: true, sufficient: true, required: 0, available: 0 }
    }
    const { quantity } = resolveQuantity(item.billingMode, usage)
    const check = await checkPointsService(userId, itemKey, quantity)
    return {
        skipped: false,
        sufficient: check.sufficient,
        required: check.required,
        available: check.available,
    }
}

/**
 * 直接扣减。停用项跳过；积分不足时由底层抛出错误，调用方按场景决定拦截或忽略。
 */
export const billDirectService = async (
    userId: number,
    itemKey: string,
    usage: BillingUsage,
    context?: BillingContext,
): Promise<BillResult> => {
    const item = await findConsumptionItemByKeyDao(itemKey)
    if (!item) throw new Error(`消耗项目不存在: ${itemKey}`)
    const operationId = context?.operationId ?? uuidv4()
    if (item.status !== PointConsumptionItemStatus.ENABLED) {
        logger.debug('消耗项目已停用，跳过扣减', { itemKey })
        return { skipped: true, consumedAmount: 0, operationId }
    }
    const { quantity, usageUnits } = resolveQuantity(item.billingMode, usage)
    if (quantity <= 0) {
        return { skipped: true, consumedAmount: 0, operationId }
    }
    const result = await consumePointsService(userId, itemKey, quantity, {
        sourceId: context?.sourceId,
        operationId,
        contextLabel: context?.contextLabel,
        usageAmount: usageUnits ?? undefined,
    })
    return { skipped: false, consumedAmount: result.consumedAmount, operationId }
}

/**
 * 预扣。停用项跳过；返回批次 ID 供后续结算或回滚。
 */
export const billReserveService = async (
    userId: number,
    itemKey: string,
    usage: BillingUsage,
    context?: BillingContext,
): Promise<BillReserveResult> => {
    const item = await findConsumptionItemByKeyDao(itemKey)
    if (!item) throw new Error(`消耗项目不存在: ${itemKey}`)
    if (item.status !== PointConsumptionItemStatus.ENABLED) {
        logger.debug('消耗项目已停用，跳过预扣', { itemKey })
        return { skipped: true, batchId: '', preDeductAmount: 0 }
    }
    const { quantity, usageUnits } = resolveQuantity(item.billingMode, usage)
    if (quantity <= 0) {
        return { skipped: true, batchId: '', preDeductAmount: 0 }
    }
    const result = await preDeductPointsService(userId, itemKey, quantity, {
        sourceId: context?.sourceId,
        contextLabel: context?.contextLabel,
        usageAmount: usageUnits ?? undefined,
    })
    return { skipped: false, batchId: result.batchId, preDeductAmount: result.preDeductAmount }
}

/**
 * 结算预扣批次。actualUnits 为实际用量（按次量场景的真实页数/分钟数），
 * 不传则按预扣量结算。
 */
export const billSettleService = async (
    batchId: string,
    actualUnits?: number,
): Promise<{ consumedAmount: number }> => {
    if (!batchId) return { consumedAmount: 0 }
    const result = await settlePointsService(batchId, actualUnits)
    return { consumedAmount: result.consumedAmount }
}

/**
 * 回滚预扣批次。
 */
export const billRollbackService = async (
    batchId: string,
): Promise<{ releasedAmount: number }> => {
    if (!batchId) return { releasedAmount: 0 }
    const result = await rollbackPreDeductService(batchId)
    return { releasedAmount: result.releasedAmount }
}
