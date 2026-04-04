/**
 * Dashboard 服务层
 *
 * 提供 Dashboard 页面的聚合数据接口
 */
import dayjs from 'dayjs'
import type { DashboardStatistics, DashboardPoints, DashboardMembership, DashboardRecentCase, DashboardResponse } from '#shared/types/dashboard'
import type { CaseWithRelations } from './case/case.dao'
import type { PointSummary } from './point/pointRecords.service'
import type { UserMembershipInfo } from '#shared/types/membership'
import { CaseStatus } from '#shared/types/case'
import { getUserPointSummary } from './point/pointRecords.service'
import { getCurrentMembershipService } from './membership/userMembership.service'
import { getUserCasesService } from './case/case.service'

/**
 * 获取 Dashboard 统计数据
 *
 * @param userId 用户 ID
 * @returns 统计数据
 */
export const getDashboardStatistics = async (userId: number): Promise<DashboardStatistics> => {
    const monthStart = dayjs().startOf('month').toDate()

    const [totalCases, caseIncrease, totalAnalysis, analysisIncrease] = await Promise.all([
        prisma.cases.count({
            where: { userId, deletedAt: null },
        }),
        prisma.cases.count({
            where: { userId, deletedAt: null, createdAt: { gte: monthStart } },
        }),
        prisma.caseAnalyses.count({
            where: { case: { userId }, deletedAt: null },
        }),
        prisma.caseAnalyses.count({
            where: { case: { userId }, deletedAt: null, createdAt: { gte: monthStart } },
        }),
    ])

    return {
        totalCases,
        caseIncrease,
        totalAnalysis,
        analysisIncrease,
    }
}

/**
 * 获取 Dashboard 积分信息
 *
 * @param userId 用户 ID
 * @returns 积分信息
 */
export const getDashboardPoints = async (userId: number): Promise<DashboardPoints> => {
    const summary: PointSummary = await getUserPointSummary(userId)

    return {
        remaining: summary.remaining,
        purchasePoint: summary.purchasePoint,
        otherPoint: summary.otherPoint,
    }
}

/**
 * 获取 Dashboard 会员信息
 *
 * @param userId 用户 ID
 * @returns 会员信息，无有效会员时返回 null
 */
export const getDashboardMembership = async (userId: number): Promise<DashboardMembership | null> => {
    const membership: UserMembershipInfo | null = await getCurrentMembershipService(userId)

    if (!membership) {
        return null
    }

    // expiresAt 取所有未删除会员中最晚的 endDate（与 levelName 无关）
    const latestMembership = await prisma.userMemberships.findFirst({
        where: { userId, deletedAt: null },
        orderBy: { endDate: 'desc' },
        select: { endDate: true },
    })

    return {
        levelId: membership.levelId,
        levelName: membership.levelName,
        expiresAt: latestMembership?.endDate ? dayjs(latestMembership.endDate).format('YYYY-MM-DD') : null,
    }
}

/**
 * 获取 Dashboard 最近案件列表
 *
 * @param userId 用户 ID
 * @param limit 返回数量，默认 5
 * @returns 最近案件列表
 */
export const getDashboardRecentCases = async (userId: number, limit: number = 5): Promise<DashboardRecentCase[]> => {
    const { list } = await getUserCasesService(userId, {
        page: 1,
        pageSize: limit,
        orderBy: 'updatedAt',
        orderDir: 'desc',
    })

    return list.map((c: CaseWithRelations) => ({
        id: c.id,
        title: c.title,
        date: dayjs(c.updatedAt).format('YYYY-MM-DD HH:mm'),
        type: c.caseType?.name ?? '',
        status: c.status === CaseStatus.COMPLETED ? 'completed' as const : 'in_progress' as const,
    }))
}

/**
 * 获取 Dashboard 聚合数据
 *
 * @param userId 用户 ID
 * @returns 聚合响应
 */
export const getDashboardData = async (userId: number): Promise<DashboardResponse> => {
    const [statistics, points, membership, recentCases] = await Promise.all([
        getDashboardStatistics(userId),
        getDashboardPoints(userId),
        getDashboardMembership(userId),
        getDashboardRecentCases(userId),
    ])

    return {
        statistics,
        points,
        membership,
        recentCases,
    }
}
