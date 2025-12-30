/**
 * 积分状态处理 Composable
 * 提供积分记录可用性和生效状态判断方法
 */

/** 积分记录接口（用于状态判断） */
export interface PointRecord {
    effectiveAt: string
    expiredAt: string
}

export const usePointStatus = () => {
    /**
     * 判断积分记录是否可用
     * 当前时间在 effectiveAt 和 expiredAt 之间时可用
     * @param record 积分记录
     * @returns 是否可用
     */
    const isAvailable = (record: PointRecord): boolean => {
        const now = new Date()
        const effectiveAt = new Date(record.effectiveAt)
        const expiredAt = new Date(record.expiredAt)
        // 检查日期有效性
        if (isNaN(effectiveAt.getTime()) || isNaN(expiredAt.getTime())) {
            return false
        }
        return effectiveAt < now && expiredAt > now
    }

    /**
     * 判断积分记录是否未生效
     * effectiveAt 在当前时间之后时未生效
     * @param record 积分记录
     * @returns 是否未生效
     */
    const isNotEffective = (record: PointRecord): boolean => {
        const now = new Date()
        const effectiveAt = new Date(record.effectiveAt)
        // 检查日期有效性
        if (isNaN(effectiveAt.getTime())) {
            return false
        }
        return effectiveAt > now
    }

    return {
        isAvailable,
        isNotEffective,
    }
}
