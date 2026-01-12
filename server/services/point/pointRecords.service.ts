/**
 * 积分记录服务层
 * 
 * 提供积分记录的业务逻辑处理
 */
import dayjs from 'dayjs'
import { Prisma } from '#shared/types/prisma'

// 显式导入（测试环境需要）
import {
    createPointRecordDao,
    findPointRecordsByUserIdDao,
    sumUserValidPointsDao,
    findValidPointRecordsByUserIdDao,
    updatePointRecordDao,
} from './pointRecords.dao'
import { PointRecordSourceType, PointRecordStatus } from '#shared/types/point.types'
import type { pointRecords } from '../../../generated/prisma/client'
import { prisma } from '../../utils/db'
import { logger } from '../../../shared/utils/logger'

// 定义 Prisma 客户端类型（支持事务）
type PrismaClient = typeof prisma

/**
 * 积分汇总信息接口
 */
export interface PointSummary {
    pointAmount: number    // 总积分
    used: number           // 已使用积分
    remaining: number      // 剩余积分
    purchasePoint: number  // 购买获得的积分
    otherPoint: number     // 其他来源积分
}

/**
 * 创建积分记录参数
    */
export interface CreatePointRecordParams {
    userId: number
    pointAmount: number
    sourceType: PointRecordSourceType
    sourceId?: number | null
    /** 关联的会员记录 ID（会员赠送积分时使用） */
    userMembershipId?: number | null
    /** 生效时间（可选，默认当天） */
    effectiveAt?: Date
    /** 过期时间（可选，默认 1 年后） */
    expiredAt?: Date
    /** 时长（用于计算过期时间，与 durationUnit 配合使用） */
    duration?: number
    /** 时长单位：day-天，month-月，year-年 */
    durationUnit?: 'day' | 'month' | 'year'
    remark?: string | null
}

/**
 * 获取用户积分汇总信息
 * @param userId 用户 ID
 * @returns 积分汇总信息
 */
export const getUserPointSummary = async (userId: number): Promise<PointSummary> => {
    return await sumUserValidPointsDao(userId)
}

/**
 * 获取用户积分记录列表（分页）
 * @param userId 用户 ID
 * @param options 查询选项
 * @returns 分页结果
 */
export const getUserPointRecords = async (
    userId: number,
    options: {
        page?: number
        pageSize?: number
        sourceType?: number
    }
): Promise<{
    list: pointRecords[]
    total: number
    page: number
    pageSize: number
}> => {
    const { page = 1, pageSize = 10 } = options
    const result = await findPointRecordsByUserIdDao(userId, options)
    return {
        ...result,
        page,
        pageSize,
    }
}


/**
 * 创建积分记录（统一入口）
 * 
 * 支持多种场景：
 * - 购买积分：传入 duration + durationUnit
 * - 会员赠送积分：传入 effectiveAt + expiredAt（跟随会员日期）
 * - 兑换码积分：传入 duration（按天计算）或 effectiveAt + expiredAt
 * 
 * @param params 创建参数
 * @param tx 事务客户端（可选）
 * @returns 创建的积分记录
 */
export const createPointRecordService = async (
    params: CreatePointRecordParams,
    tx?: PrismaClient
): Promise<pointRecords> => {
    const {
        userId,
        pointAmount,
        sourceType,
        sourceId,
        userMembershipId,
        effectiveAt,
        expiredAt,
        duration,
        durationUnit = 'day',
        remark,
    } = params

    // 计算生效时间（默认当天）
    const finalEffectiveAt = effectiveAt || dayjs().startOf('day').toDate()

    // 计算过期时间
    let finalExpiredAt: Date
    if (expiredAt) {
        // 直接使用传入的过期时间
        finalExpiredAt = expiredAt
    } else if (duration) {
        // 根据时长计算过期时间
        // 规则：生效日期 + duration - 1 天
        const effectiveDayjs = dayjs(finalEffectiveAt)
        if (durationUnit === 'month') {
            finalExpiredAt = effectiveDayjs.add(duration, 'month').subtract(1, 'day').endOf('day').toDate()
        } else if (durationUnit === 'year') {
            finalExpiredAt = effectiveDayjs.add(duration, 'year').subtract(1, 'day').endOf('day').toDate()
        } else {
            finalExpiredAt = effectiveDayjs.add(duration, 'day').subtract(1, 'day').endOf('day').toDate()
        }
    } else {
        // 默认 1 年有效期
        finalExpiredAt = dayjs(finalEffectiveAt).add(1, 'year').subtract(1, 'day').endOf('day').toDate()
    }

    logger.info(`创建积分记录：用户 ${userId}，积分 ${pointAmount}，生效 ${dayjs(finalEffectiveAt).format('YYYY-MM-DD')}，过期 ${dayjs(finalExpiredAt).format('YYYY-MM-DD')}`)

    // 创建时自动设置 remaining = pointAmount, used = 0
    const createData: Prisma.pointRecordsCreateInput = {
        users: { connect: { id: userId } },
        pointAmount,
        used: 0,
        remaining: pointAmount,
        sourceType,
        sourceId,
        userMembership: userMembershipId ? { connect: { id: userMembershipId } } : undefined,
        effectiveAt: finalEffectiveAt,
        expiredAt: finalExpiredAt,
        status: PointRecordStatus.VALID,
        remark,
    }

    return await createPointRecordDao(createData, tx)
}

/**
 * 创建积分记录（旧接口，保持兼容）
 * @deprecated 请使用 createPointRecordService
 */
export const createPointRecord = async (
    data: {
        userId: number
        pointAmount: number
        sourceType: PointRecordSourceType
        sourceId?: number | null
        userMembershipId?: number | null
        effectiveAt: Date
        expiredAt: Date
        remark?: string | null
    },
    tx?: PrismaClient
): Promise<pointRecords> => {
    return createPointRecordService({
        userId: data.userId,
        pointAmount: data.pointAmount,
        sourceType: data.sourceType,
        sourceId: data.sourceId,
        userMembershipId: data.userMembershipId,
        effectiveAt: data.effectiveAt,
        expiredAt: data.expiredAt,
        remark: data.remark,
    }, tx)
}

/**
 * 转移积分记录到新会员
 * @param fromMembershipId 原会员记录 ID
 * @param toMembershipId 新会员记录 ID
 * @param tx 事务客户端（可选）
 * @returns 转移结果
 */
export const transferPointsToNewMembership = async (
    fromMembershipId: number,
    toMembershipId: number,
    tx?: PrismaClient
): Promise<{ success: boolean; transferredCount: number }> => {
    try {
        const count = await transferPointRecordsDao(fromMembershipId, toMembershipId, tx)
        logger.info(`积分转移成功：从会员 ${fromMembershipId} 转移到会员 ${toMembershipId}，共 ${count} 条记录`)
        return { success: true, transferredCount: count }
    } catch (error) {
        logger.error('转移积分记录失败：', error)
        throw error
    }
}

/**
 * 获取用户会员关联的积分汇总
 * @param userMembershipId 用户会员记录 ID
 * @returns 积分汇总
 */
export const getMembershipPointSummary = async (
    userMembershipId: number
): Promise<{ total: number; remaining: number }> => {
    return await sumPointsByMembershipIdDao(userMembershipId)
}

/**
 * 按来源类型获取用户积分
 * @param userId 用户 ID
 * @param sourceTypes 来源类型数组
 * @returns 积分记录列表和汇总
 */
export const getPointsBySourceTypes = async (
    userId: number,
    sourceTypes: number[]
): Promise<{
    records: pointRecords[]
    total: number
    remaining: number
}> => {
    const records = await findPointRecordsBySourceTypesDao(userId, sourceTypes)
    const total = records.reduce((sum, r) => sum + r.pointAmount, 0)
    const remaining = records.reduce((sum, r) => sum + r.remaining, 0)
    return { records, total, remaining }
}
