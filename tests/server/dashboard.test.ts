/**
 * Dashboard 服务层测试
 *
 * **Feature: dashboard**
 * **Validates: Dashboard 核心功能测试**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import dayjs from 'dayjs'
import {
    getTestPrisma,
    createTestUser,
    createTestMembershipLevel,
    createTestUserMembership,
    cleanupTestData,
    createEmptyTestIds,
    disconnectTestDb,
    isTestDbAvailable,
    resetDatabaseSequences,
    MembershipStatus,
    type TestIds,
} from './membership/test-db-helper'
import {
    getDashboardStatistics,
    getDashboardMembership,
    getDashboardData,
} from '../../server/services/dashboard.service'

// 检查数据库是否可用
let dbAvailable = false

describe('Dashboard 服务层测试', () => {
    const testIds: TestIds = createEmptyTestIds()
    const prisma = getTestPrisma()

    // 用于追踪 dashboard 测试中创建的案件 ID
    const dashboardCaseIds: number[] = []

    beforeAll(async () => {
        dbAvailable = await isTestDbAvailable()
        if (!dbAvailable) {
            console.warn('数据库不可用，跳过集成测试')
        } else {
            // 重置数据库序列，避免与种子数据冲突
            await resetDatabaseSequences()
        }
    })

    afterEach(async () => {
        if (dbAvailable) {
            // 先删除 dashboard 测试中创建的案件和分析记录（避免外键约束）
            if (dashboardCaseIds.length > 0) {
                await prisma.caseAnalyses.deleteMany({
                    where: { caseId: { in: dashboardCaseIds } },
                })
                await prisma.caseSessions.deleteMany({
                    where: { caseId: { in: dashboardCaseIds } },
                })
                await prisma.cases.deleteMany({
                    where: { id: { in: dashboardCaseIds } },
                })
                dashboardCaseIds.length = 0
            }
            await cleanupTestData(testIds)
            Object.keys(testIds).forEach(key => {
                (testIds as any)[key] = []
            })
        }
    })

    afterAll(async () => {
        if (dbAvailable) {
            await disconnectTestDb()
        }
    })

    // ==================== getDashboardStatistics 测试 ====================
    describe('getDashboardStatistics 测试', () => {
        it('应正确统计总案件数为 0（无案件时）', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const statistics = await getDashboardStatistics(user.id)

            expect(statistics.totalCases).toBe(0)
            expect(statistics.caseIncrease).toBe(0)
            expect(statistics.totalAnalysis).toBe(0)
            expect(statistics.analysisIncrease).toBe(0)
        })

        it('应正确统计总案件数和本月新增案件', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            // 创建本月案件
            const thisMonthCase = await prisma.cases.create({
                data: {
                    title: '本月测试案件',
                    userId: user.id,
                    caseTypeId: 1,
                    status: 1,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            dashboardCaseIds.push(thisMonthCase.id)

            // 创建上月案件
            const lastMonth = dayjs().subtract(1, 'month').toDate()
            const lastMonthCase = await prisma.cases.create({
                data: {
                    title: '上月测试案件',
                    userId: user.id,
                    caseTypeId: 1,
                    status: 1,
                    createdAt: lastMonth,
                    updatedAt: lastMonth,
                },
            })
            dashboardCaseIds.push(lastMonthCase.id)

            const statistics = await getDashboardStatistics(user.id)

            expect(statistics.totalCases).toBe(2)
            expect(statistics.caseIncrease).toBe(1)
        })

        it('应正确统计总分析次数和本月新增分析', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            // 创建案件
            const testCase = await prisma.cases.create({
                data: {
                    title: '分析测试案件',
                    userId: user.id,
                    caseTypeId: 1,
                    status: 1,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            dashboardCaseIds.push(testCase.id)

            // 创建 session（分析需要关联 session）
            const session = await prisma.caseSessions.create({
                data: {
                    caseId: testCase.id,
                    sessionId: `test-session-stat-${Date.now()}`,
                    status: 1,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })

            // 创建本月分析
            await prisma.caseAnalyses.create({
                data: {
                    caseId: testCase.id,
                    sessionId: session.sessionId,
                    nodeId: 1,
                    analysisType: 'test',
                    status: 2,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })

            // 创建上月分析
            const lastMonth = dayjs().subtract(1, 'month').toDate()
            await prisma.caseAnalyses.create({
                data: {
                    caseId: testCase.id,
                    sessionId: session.sessionId,
                    nodeId: 1,
                    analysisType: 'test',
                    status: 2,
                    createdAt: lastMonth,
                    updatedAt: lastMonth,
                },
            })

            const statistics = await getDashboardStatistics(user.id)

            expect(statistics.totalAnalysis).toBe(2)
            expect(statistics.analysisIncrease).toBe(1)
        })

        it('不应统计已删除的案件和分析', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            // 创建并删除案件
            const deletedCase = await prisma.cases.create({
                data: {
                    title: '已删除案件',
                    userId: user.id,
                    caseTypeId: 1,
                    status: 1,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            dashboardCaseIds.push(deletedCase.id)
            await prisma.cases.update({
                where: { id: deletedCase.id },
                data: { deletedAt: new Date() },
            })

            // 创建正常案件
            const activeCase = await prisma.cases.create({
                data: {
                    title: '正常案件',
                    userId: user.id,
                    caseTypeId: 1,
                    status: 1,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            dashboardCaseIds.push(activeCase.id)

            // 创建 session
            const session = await prisma.caseSessions.create({
                data: {
                    caseId: activeCase.id,
                    sessionId: `test-session-deleted-${Date.now()}`,
                    status: 1,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })

            // 创建已删除的分析
            const deletedAnalysis = await prisma.caseAnalyses.create({
                data: {
                    caseId: activeCase.id,
                    sessionId: session.sessionId,
                    nodeId: 1,
                    analysisType: 'test',
                    status: 2,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            await prisma.caseAnalyses.update({
                where: { id: deletedAnalysis.id },
                data: { deletedAt: new Date() },
            })

            // 创建正常分析
            await prisma.caseAnalyses.create({
                data: {
                    caseId: activeCase.id,
                    sessionId: session.sessionId,
                    nodeId: 1,
                    analysisType: 'test',
                    status: 2,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })

            const statistics = await getDashboardStatistics(user.id)

            expect(statistics.totalCases).toBe(1)
            expect(statistics.totalAnalysis).toBe(1)
        })
    })

    // ==================== getDashboardMembership 测试 ====================
    describe('getDashboardMembership 测试', () => {
        it('无会员时应返回 null', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const membership = await getDashboardMembership(user.id)

            expect(membership).toBeNull()
        })

        it('应返回当前有效会员的 levelName', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const level = await createTestMembershipLevel({
                name: '测试VIP会员',
            })
            testIds.membershipLevelIds.push(level.id)

            const now = new Date()
            const futureDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)

            await createTestUserMembership(user.id, level.id, {
                status: MembershipStatus.ACTIVE,
                startDate: now,
                endDate: futureDate,
            })

            const membership = await getDashboardMembership(user.id)

            expect(membership).not.toBeNull()
            expect(membership!.levelName).toBe('测试VIP会员')
            expect(membership!.levelId).toBe(level.id)
        })

        it('应返回所有未删除会员中最晚的 endDate 作为 expiresAt', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const level1 = await createTestMembershipLevel({
                name: '测试级别1',
            })
            const level2 = await createTestMembershipLevel({
                name: '测试级别2',
            })
            testIds.membershipLevelIds.push(level1.id, level2.id)

            const now = new Date()
            const earlierDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
            const laterDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)

            // 创建较早到期的会员
            await createTestUserMembership(user.id, level1.id, {
                status: MembershipStatus.ACTIVE,
                startDate: now,
                endDate: earlierDate,
            })

            // 创建较晚到期的会员
            await createTestUserMembership(user.id, level2.id, {
                status: MembershipStatus.ACTIVE,
                startDate: now,
                endDate: laterDate,
            })

            const membership = await getDashboardMembership(user.id)

            expect(membership).not.toBeNull()
            expect(membership!.expiresAt).toBe(dayjs(laterDate).format('YYYY-MM-DD'))
        })

        it('不应返回已删除的会员', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const now = new Date()
            const futureDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)

            // 创建并软删除会员
            const deletedMembership = await createTestUserMembership(user.id, level.id, {
                status: MembershipStatus.ACTIVE,
                startDate: now,
                endDate: futureDate,
            })
            await prisma.userMemberships.update({
                where: { id: deletedMembership.id },
                data: { deletedAt: new Date() },
            })

            const membership = await getDashboardMembership(user.id)

            expect(membership).toBeNull()
        })

        it('不应返回已过期的会员', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const now = new Date()
            const pastDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

            // 创建已过期的会员
            await createTestUserMembership(user.id, level.id, {
                status: MembershipStatus.ACTIVE,
                startDate: new Date(pastDate.getTime() - 60 * 24 * 60 * 60 * 1000),
                endDate: pastDate,
            })

            const membership = await getDashboardMembership(user.id)

            expect(membership).toBeNull()
        })
    })

    // ==================== getDashboardData 测试 ====================
    describe('getDashboardData 测试', () => {
        it('应返回完整的 Dashboard 数据', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            // 创建会员
            const level = await createTestMembershipLevel({
                name: '测试完整数据会员',
            })
            testIds.membershipLevelIds.push(level.id)

            const now = new Date()
            const futureDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)

            await createTestUserMembership(user.id, level.id, {
                status: MembershipStatus.ACTIVE,
                startDate: now,
                endDate: futureDate,
            })

            // 创建案件
            const caseData = await prisma.cases.create({
                data: {
                    title: 'Dashboard 完整测试案件',
                    userId: user.id,
                    caseTypeId: 1,
                    status: 1,
                    createdAt: now,
                    updatedAt: now,
                },
            })
            dashboardCaseIds.push(caseData.id)

            // 创建 session
            const session = await prisma.caseSessions.create({
                data: {
                    caseId: caseData.id,
                    sessionId: `dashboard-full-${Date.now()}`,
                    status: 1,
                    createdAt: now,
                    updatedAt: now,
                },
            })

            // 创建分析
            await prisma.caseAnalyses.create({
                data: {
                    caseId: caseData.id,
                    sessionId: session.sessionId,
                    nodeId: 1,
                    analysisType: 'test',
                    status: 2,
                    createdAt: now,
                    updatedAt: now,
                },
            })

            const data = await getDashboardData(user.id)

            // 验证返回结构
            expect(data).toBeDefined()
            expect(data.statistics).toBeDefined()
            expect(data.points).toBeDefined()
            expect(data.membership).toBeDefined()
            expect(data.recentCases).toBeDefined()

            // 验证统计数据
            expect(data.statistics.totalCases).toBe(1)
            expect(data.statistics.totalAnalysis).toBe(1)

            // 验证积分数据
            expect(typeof data.points.remaining).toBe('number')
            expect(typeof data.points.purchasePoint).toBe('number')
            expect(typeof data.points.otherPoint).toBe('number')

            // 验证会员数据
            expect(data.membership).not.toBeNull()
            expect(data.membership!.levelName).toBe('测试完整数据会员')

            // 验证最近案件
            expect(data.recentCases.length).toBeGreaterThan(0)
            expect(data.recentCases[0].title).toBe('Dashboard 完整测试案件')
        })

        it('应正确返回空数据（新建用户）', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const data = await getDashboardData(user.id)

            expect(data.statistics.totalCases).toBe(0)
            expect(data.statistics.totalAnalysis).toBe(0)
            expect(data.membership).toBeNull()
            expect(data.recentCases).toEqual([])
        })

        it('应支持获取其他用户的 Dashboard 数据（数据隔离）', async () => {
            if (!dbAvailable) return

            const user1 = await createTestUser()
            const user2 = await createTestUser()
            testIds.userIds.push(user1.id, user2.id)

            // 为用户1创建案件
            const user1Case = await prisma.cases.create({
                data: {
                    title: '用户1的案件',
                    userId: user1.id,
                    caseTypeId: 1,
                    status: 1,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            dashboardCaseIds.push(user1Case.id)

            // 用户2不应该看到用户1的案件
            const user2Data = await getDashboardData(user2.id)

            expect(user2Data.statistics.totalCases).toBe(0)
            expect(user2Data.statistics.totalAnalysis).toBe(0)
        })
    })
})

describe('Dashboard 数据库连接检查', () => {
    it('检查数据库是否可用', async () => {
        const available = await isTestDbAvailable()
        if (!available) {
            console.log('请确保数据库已启动并配置正确的连接字符串')
        }
        expect(true).toBe(true)
    })
})
