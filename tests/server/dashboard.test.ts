import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getDashboardStatistics, getDashboardPoints, getDashboardMembership, getDashboardRecentCases, getDashboardData } from '../../server/services/dashboard.service'

vi.mock('../../server/services/point/pointRecords.service', () => ({
  getUserPointSummary: vi.fn(async () => ({
    remaining: 100,
    purchasePoint: 50,
    otherPoint: 50,
  })),
}))

vi.mock('../../server/services/membership/userMembership.service', () => ({
  getCurrentMembershipService: vi.fn(async () => ({
    levelId: 1,
    levelName: '青铜会员',
  })),
}))

vi.mock('../../server/services/case/case.service', () => ({
  getUserCasesService: vi.fn(async () => ({
    list: [
      { id: 1, title: '案件1', updatedAt: new Date(), caseType: { name: '民事' }, status: 1 },
      { id: 2, title: '案件2', updatedAt: new Date(), caseType: { name: '刑事' }, status: 5 },
    ],
  })),
}))

describe('dashboard.service · 仪表板服务', () => {
  const userId = 123

  beforeEach(() => {
    global.prisma = {
      cases: {
        count: vi.fn(async () => 10),
      },
      caseAnalyses: {
        count: vi.fn(async () => 5),
      },
      userMemberships: {
        findFirst: vi.fn(async () => ({ endDate: new Date('2025-12-31') })),
      },
    } as any
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('getDashboardStatistics · 获取统计数据', () => {
    it('应该返回案件和分析的统计数据', async () => {
      const stats = await getDashboardStatistics(userId)

      expect(stats).toHaveProperty('totalCases')
      expect(stats).toHaveProperty('caseIncrease')
      expect(stats).toHaveProperty('totalAnalysis')
      expect(stats).toHaveProperty('analysisIncrease')
    })

    it('统计数据应该都是数字', async () => {
      const stats = await getDashboardStatistics(userId)

      expect(typeof stats.totalCases).toBe('number')
      expect(typeof stats.caseIncrease).toBe('number')
      expect(typeof stats.totalAnalysis).toBe('number')
      expect(typeof stats.analysisIncrease).toBe('number')
    })

    it('应该查询用户相关的数据', async () => {
      await getDashboardStatistics(userId)

      const mockCaseCount = global.prisma.cases.count as any
      expect(mockCaseCount).toHaveBeenCalled()
      const firstCall = mockCaseCount.mock.calls[0][0]
      expect(firstCall.where.userId).toBe(userId)
    })
  })

  describe('getDashboardPoints · 获取积分信息', () => {
    it('应该返回积分信息', async () => {
      const points = await getDashboardPoints(userId)

      expect(points).toHaveProperty('remaining')
      expect(points).toHaveProperty('purchasePoint')
      expect(points).toHaveProperty('otherPoint')
    })

    it('积分值应该都是数字', async () => {
      const points = await getDashboardPoints(userId)

      expect(typeof points.remaining).toBe('number')
      expect(typeof points.purchasePoint).toBe('number')
      expect(typeof points.otherPoint).toBe('number')
    })

    it('积分值应该是非负数', async () => {
      const points = await getDashboardPoints(userId)

      expect(points.remaining).toBeGreaterThanOrEqual(0)
      expect(points.purchasePoint).toBeGreaterThanOrEqual(0)
      expect(points.otherPoint).toBeGreaterThanOrEqual(0)
    })
  })

  describe('getDashboardMembership · 获取会员信息', () => {
    it('应该返回会员信息对象或 null', async () => {
      const membership = await getDashboardMembership(userId)

      if (membership) {
        expect(membership).toHaveProperty('levelId')
        expect(membership).toHaveProperty('levelName')
        expect(membership).toHaveProperty('expiresAt')
      } else {
        expect(membership).toBeNull()
      }
    })

    it('会员信息应该包含正确的数据', async () => {
      const membership = await getDashboardMembership(userId)

      if (membership) {
        expect(typeof membership.levelId).toBe('number')
        expect(typeof membership.levelName).toBe('string')
        expect(membership.expiresAt).toMatch(/\d{4}-\d{2}-\d{2}/)
      }
    })
  })

  describe('getDashboardRecentCases · 获取最近案件', () => {
    it('应该返回案件列表数组', async () => {
      const cases = await getDashboardRecentCases(userId)

      expect(Array.isArray(cases)).toBe(true)
      expect(cases.length).toBeGreaterThan(0)
    })

    it('每个案件应该包含必要字段', async () => {
      const cases = await getDashboardRecentCases(userId)

      cases.forEach((c) => {
        expect(c).toHaveProperty('id')
        expect(c).toHaveProperty('title')
        expect(c).toHaveProperty('date')
        expect(c).toHaveProperty('type')
        expect(c).toHaveProperty('status')
      })
    })

    it('应该接受自定义 limit 参数', async () => {
      const cases = await getDashboardRecentCases(userId, 10)

      expect(Array.isArray(cases)).toBe(true)
    })

    it('状态应该是数字型案件状态', async () => {
      const cases = await getDashboardRecentCases(userId)

      cases.forEach((c) => {
        expect(typeof c.status).toBe('number')
      })
    })
  })

  describe('getDashboardData · 获取聚合数据', () => {
    it('应该返回包含四个部分的聚合数据', async () => {
      const data = await getDashboardData(userId)

      expect(data).toHaveProperty('statistics')
      expect(data).toHaveProperty('points')
      expect(data).toHaveProperty('membership')
      expect(data).toHaveProperty('recentCases')
    })

    it('聚合数据应该包含完整的 dashboard 信息', async () => {
      const data = await getDashboardData(userId)

      // 统计数据
      expect(data.statistics).toHaveProperty('totalCases')
      // 积分数据
      expect(data.points).toHaveProperty('remaining')
      // 会员数据（可能为 null）
      if (data.membership) {
        expect(data.membership).toHaveProperty('levelName')
      }
      // 案件列表
      expect(Array.isArray(data.recentCases)).toBe(true)
    })
  })
})
