/**
 * 积分消耗记录服务层
 * 
 * 提供积分消耗记录的业务逻辑处理
 */
import { findPointConsumptionRecordsByUserIdDao } from './pointConsumptionRecords.dao'

/**
 * 获取用户积分消耗记录列表（分页）
 * @param userId 用户 ID
 * @param options 查询选项
 * @returns 分页结果
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
