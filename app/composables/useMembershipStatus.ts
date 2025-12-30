/**
 * 会员状态处理 Composable
 * 提供会员生效状态和级别判断方法
 */
import dayjs from 'dayjs'
import type { Ref } from 'vue'

/** 会员级别接口 */
export interface MembershipLevel {
    id: number
    name: string
    sortOrder: number
}

export const useMembershipStatus = (membershipLevels: Ref<MembershipLevel[]>) => {
    /**
     * 判断会员是否未生效（startDate > now）
     * @param startDate 开始日期字符串
     * @returns 是否未生效
     */
    const isNotEffective = (startDate: string | null | undefined): boolean => {
        if (!startDate) return false
        const date = dayjs(startDate)
        if (!date.isValid()) return false
        return date.isAfter(dayjs())
    }

    /**
     * 判断是否是最高级别
     * 只考虑真正的会员级别（基础版、专业版、旗舰版），排除测试数据
     * @param levelId 会员级别 ID
     * @returns 是否为最高级别
     */
    const isHighestLevel = (levelId: number): boolean => {
        if (membershipLevels.value.length === 0) return false
        // 只考虑真正的会员级别
        const realLevels = membershipLevels.value.filter((l) =>
            l.id === 1 || l.id === 2 || l.id === 3 ||
            l.name === '基础版' || l.name === '专业版' || l.name === '旗舰版'
        )
        if (realLevels.length === 0) return false
        const maxSortOrder = Math.max(...realLevels.map((l) => l.sortOrder))
        const currentLevel = membershipLevels.value.find((l) => l.id === levelId)
        return currentLevel ? currentLevel.sortOrder >= maxSortOrder : false
    }

    return {
        isNotEffective,
        isHighestLevel,
    }
}
