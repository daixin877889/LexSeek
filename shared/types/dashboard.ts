/**
 * Dashboard 类型定义
 */

/** Dashboard 统计数据 */
export interface DashboardStatistics {
    /** 总案件数（未删除） */
    totalCases: number
    /** 本月新增案件 */
    caseIncrease: number
    /** 总分析次数（默认不包含软删除） */
    totalAnalysis: number
    /** 本月新增分析（默认不包含软删除） */
    analysisIncrease: number
}

/** Dashboard 积分信息 */
export interface DashboardPoints {
    /** 可用积分 */
    remaining: number
    /** 购买积分 */
    purchasePoint: number
    /** 赠送积分 */
    otherPoint: number
}

/** Dashboard 会员信息 */
export interface DashboardMembership {
    levelId: number
    /** 无有效会员时显示 "免费版" */
    levelName: string
    /** 无会员时为 null，前端显示 "-" */
    expiresAt: string | null
}

/** Dashboard 最近案件项 */
export interface DashboardRecentCase {
    id: number
    title: string
    /** 案件创建日期，格式 YYYY-MM-DD */
    date: string
    /** 案件类型名称 */
    type: string
    /** 案件状态值（CaseStatus 枚举值） */
    status: number
    /** 是否演示案件 */
    isDemo: boolean
}

/** Dashboard 聚合响应 */
export interface DashboardResponse {
    statistics: DashboardStatistics
    points: DashboardPoints
    membership: DashboardMembership | null
    recentCases: DashboardRecentCase[]
}
