/**
 * 积分记录服务层
 * 
 * 提供积分记录的业务逻辑处理
 */
import { Prisma } from '#shared/types/prisma'

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
 * 积分消耗结果接口
 */
export interface PointConsumptionResult {
    success: boolean
    consumedAmount: number
    consumptionRecords: pointConsumptionRecords[]
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
 * 创建积分记录
 * @param data 创建数据
 * @param tx 事务客户端（可选）
 * @returns 创建的积分记录
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
    // 创建时自动设置 remaining = pointAmount, used = 0
    const createData: Prisma.pointRecordsCreateInput = {
        users: { connect: { id: data.userId } },
        pointAmount: data.pointAmount,
        used: 0,
        remaining: data.pointAmount,
        sourceType: data.sourceType,
        sourceId: data.sourceId,
        // 使用 connect 语法关联用户会员记录
        userMembership: data.userMembershipId ? { connect: { id: data.userMembershipId } } : undefined,
        effectiveAt: data.effectiveAt,
        expiredAt: data.expiredAt,
        status: PointRecordStatus.VALID,
        remark: data.remark,
    }

    return await createPointRecordDao(createData, tx)
}

/**
 * 消耗积分（FIFO 策略）
 * 
 * 按过期时间升序依次从积分记录中扣除，直到完全抵扣所需积分
 * 
 * @param userId 用户 ID
 * @param itemId 消耗项目 ID
 * @param amount 消耗数量（可选，默认使用项目配置的积分数量）
 * @param sourceId 资源 ID（可选）
 * @returns 消耗结果
 */
export const consumePoints = async (
    userId: number,
    itemId: number,
    amount?: number,
    sourceId?: number
): Promise<PointConsumptionResult> => {
    // 使用事务确保原子性
    return await prisma.$transaction(async (tx) => {
        // 1. 查询消耗项目
        const item = await tx.pointConsumptionItems.findUnique({
            where: { id: itemId, deletedAt: null },
        })
        if (!item) {
            throw new Error('消耗项目不存在')
        }
        if (item.status !== PointConsumptionItemStatus.ENABLED) {
            throw new Error('消耗项目已禁用')
        }

        // 计算实际消耗积分（考虑折扣）
        const baseAmount = amount ?? item.pointAmount
        const discount = item.discount ? Number(item.discount) : 1
        const consumeAmount = Math.ceil(baseAmount * discount)

        // 2. 查询用户有效积分记录（按过期时间升序）
        const now = new Date()
        const validRecords = await tx.pointRecords.findMany({
            where: {
                userId,
                status: PointRecordStatus.VALID,
                remaining: { gt: 0 },
                expiredAt: { gt: now },
                deletedAt: null,
            },
            orderBy: { expiredAt: 'asc' },
        })

        // 3. 计算用户可用积分总额
        const totalRemaining = validRecords.reduce((sum, r) => sum + r.remaining, 0)
        if (totalRemaining < consumeAmount) {
            throw new Error('积分不足')
        }

        // 4. FIFO 消耗逻辑
        let remainingToConsume = consumeAmount
        const consumptionRecords: pointConsumptionRecords[] = []

        for (const record of validRecords) {
            if (remainingToConsume <= 0) break

            const consumeFromRecord = Math.min(record.remaining, remainingToConsume)

            // 更新积分记录
            await tx.pointRecords.update({
                where: { id: record.id },
                data: {
                    used: record.used + consumeFromRecord,
                    remaining: record.remaining - consumeFromRecord,
                    updatedAt: new Date(),
                },
            })

            // 创建消耗记录
            const consumptionRecord = await tx.pointConsumptionRecords.create({
                data: {
                    users: { connect: { id: userId } },
                    pointRecords: { connect: { id: record.id } },
                    pointConsumptionItems: { connect: { id: itemId } },
                    pointAmount: consumeFromRecord,
                    status: PointConsumptionRecordStatus.SETTLED,
                    sourceId,
                    remark: `消耗积分：${item.name}`,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            consumptionRecords.push(consumptionRecord)

            remainingToConsume -= consumeFromRecord
        }

        return {
            success: true,
            consumedAmount: consumeAmount,
            consumptionRecords,
        }
    })
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
