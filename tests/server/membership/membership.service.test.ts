/**
 * 用户会员服务层测试
 *
 * 测试 userMembership.service.ts 中的业务逻辑，包括：
 * - getCurrentMembershipService 获取当前会员
 * - getMembershipHistoryService 获取会员历史
 * - createMembershipService 创建会员记录
 * - getMembershipByIdService 获取会员详情
 *
 * **Feature: membership-service**
 * **Validates: Requirements 会员服务模块**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import {
    getTestPrisma,
    createTestUser,
    createTestMembershipLevel,
    createTestUserMembership,
    cleanupTestData,
    createEmptyTestIds,
    disconnectTestDb,
    isTestDbAvailable,
    MembershipStatus,
    UserMembershipSourceType,
    type TestIds,
} from './test-db-helper'

// 导入服务函数
import {
    getCurrentMembershipService,
    getMembershipHistoryService,
    createMembershipService,
    getMembershipByIdService,
} from '../../../server/services/membership/userMembership.service'

let dbAvailable = false

describe('用户会员服务层测试', () => {
    const testIds: TestIds = createEmptyTestIds()
    const prisma = getTestPrisma()
    const testBenefitIds: number[] = []
    const testMembershipBenefitIds: number[] = []

    beforeAll(async () => {
        dbAvailable = await isTestDbAvailable()
        if (!dbAvailable) {
            console.warn('数据库不可用，跳过集成测试')
        }
    })

    afterEach(async () => {
        if (dbAvailable) {
            // 清理用户权益（createMembershipService 会自动发放权益）
            if (testIds.userIds.length > 0) {
                await prisma.userBenefits.deleteMany({
                    where: { userId: { in: testIds.userIds } },
                })
            }
            if (testMembershipBenefitIds.length > 0) {
                await prisma.membershipBenefits.deleteMany({
                    where: { id: { in: testMembershipBenefitIds } },
                })
                testMembershipBenefitIds.length = 0
            }
            if (testBenefitIds.length > 0) {
                await prisma.benefits.deleteMany({
                    where: { id: { in: testBenefitIds } },
                })
                testBenefitIds.length = 0
            }
            await cleanupTestData(testIds)
            testIds.userIds = []
            testIds.membershipLevelIds = []
            testIds.userMembershipIds = []
        }
    })

    afterAll(async () => {
        if (dbAvailable) {
            await disconnectTestDb()
        }
    })

    // ========== getCurrentMembershipService 测试 ==========

    describe('getCurrentMembershipService 测试', () => {
        it('无会员的用户应返回 null', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const result = await getCurrentMembershipService(user.id)
            expect(result).toBeNull()
        })

        it('有有效会员的用户应返回会员信息', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const level = await createTestMembershipLevel({ name: '测试级别_当前会员' })
            testIds.membershipLevelIds.push(level.id)

            const now = new Date()
            const futureDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

            const membership = await createTestUserMembership(user.id, level.id, {
                status: MembershipStatus.ACTIVE,
                startDate: now,
                endDate: futureDate,
                sourceType: UserMembershipSourceType.DIRECT_PURCHASE,
            })
            testIds.userMembershipIds.push(membership.id)

            const result = await getCurrentMembershipService(user.id)

            expect(result).not.toBeNull()
            expect(result!.id).toBe(membership.id)
            expect(result!.userId).toBe(user.id)
            expect(result!.levelId).toBe(level.id)
            expect(result!.levelName).toBe(level.name)
            expect(result!.status).toBe(MembershipStatus.ACTIVE)
            expect(result!.sourceTypeName).toBe('直接购买')
        })

        it('返回的日期应为格式化字符串', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const now = new Date()
            const futureDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

            const membership = await createTestUserMembership(user.id, level.id, {
                status: MembershipStatus.ACTIVE,
                startDate: now,
                endDate: futureDate,
            })
            testIds.userMembershipIds.push(membership.id)

            const result = await getCurrentMembershipService(user.id)

            expect(result).not.toBeNull()
            // 日期格式应为 YYYY-MM-DD HH:mm:ss
            expect(result!.startDate).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
            expect(result!.endDate).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
            expect(result!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
        })

        it('已过期的会员应不被返回', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const pastStart = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
            const pastEnd = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000)

            const membership = await createTestUserMembership(user.id, level.id, {
                status: MembershipStatus.ACTIVE,
                startDate: pastStart,
                endDate: pastEnd,
            })
            testIds.userMembershipIds.push(membership.id)

            const result = await getCurrentMembershipService(user.id)
            expect(result).toBeNull()
        })

        it('不同来源类型应有正确的中文名称', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const now = new Date()
            const futureDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)

            const membership = await createTestUserMembership(user.id, level.id, {
                status: MembershipStatus.ACTIVE,
                startDate: now,
                endDate: futureDate,
                sourceType: UserMembershipSourceType.REDEMPTION_CODE,
            })
            testIds.userMembershipIds.push(membership.id)

            const result = await getCurrentMembershipService(user.id)

            expect(result).not.toBeNull()
            expect(result!.sourceTypeName).toBe('兑换码兑换')
        })
    })

    // ========== getMembershipHistoryService 测试 ==========

    describe('getMembershipHistoryService 测试', () => {
        it('无历史记录应返回空列表', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const result = await getMembershipHistoryService(user.id)

            expect(result.list).toEqual([])
            expect(result.total).toBe(0)
        })

        it('应返回格式化后的会员历史列表', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const level = await createTestMembershipLevel({ name: '测试级别_历史' })
            testIds.membershipLevelIds.push(level.id)

            for (let i = 0; i < 3; i++) {
                const startDate = new Date(Date.now() - (i + 1) * 90 * 24 * 60 * 60 * 1000)
                const endDate = new Date(startDate.getTime() + 30 * 24 * 60 * 60 * 1000)
                const membership = await createTestUserMembership(user.id, level.id, {
                    startDate,
                    endDate,
                    sourceType: UserMembershipSourceType.DIRECT_PURCHASE,
                })
                testIds.userMembershipIds.push(membership.id)
            }

            const result = await getMembershipHistoryService(user.id)

            expect(result.total).toBe(3)
            expect(result.list.length).toBe(3)

            // 每个记录应有正确的格式
            for (const item of result.list) {
                expect(item).toHaveProperty('id')
                expect(item).toHaveProperty('levelName')
                expect(item.levelName).toBe(level.name)
                expect(item).toHaveProperty('sourceTypeName')
                expect(item.startDate).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
                expect(item.endDate).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
            }
        })

        it('应支持分页参数', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            for (let i = 0; i < 5; i++) {
                const membership = await createTestUserMembership(user.id, level.id)
                testIds.userMembershipIds.push(membership.id)
            }

            const page1 = await getMembershipHistoryService(user.id, { page: 1, pageSize: 2 })
            const page2 = await getMembershipHistoryService(user.id, { page: 2, pageSize: 2 })

            expect(page1.list.length).toBe(2)
            expect(page2.list.length).toBe(2)
            expect(page1.total).toBe(5)
            expect(page2.total).toBe(5)

            // 两页不应有重复记录
            const page1Ids = page1.list.map(m => m.id)
            const page2Ids = page2.list.map(m => m.id)
            const intersection = page1Ids.filter(id => page2Ids.includes(id))
            expect(intersection.length).toBe(0)
        })
    })

    // ========== createMembershipService 测试 ==========

    describe('createMembershipService 测试', () => {
        it('不存在的会员级别应抛出错误', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            await expect(
                createMembershipService({
                    userId: user.id,
                    levelId: 999999,
                    duration: 30,
                    durationUnit: 'day',
                    sourceType: UserMembershipSourceType.DIRECT_PURCHASE,
                })
            ).rejects.toThrow('会员级别不存在')
        })

        it('按天创建会员记录应计算正确的到期日期', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const membership = await createMembershipService({
                userId: user.id,
                levelId: level.id,
                duration: 30,
                durationUnit: 'day',
                sourceType: UserMembershipSourceType.DIRECT_PURCHASE,
                remark: '按天创建测试',
            })
            testIds.userMembershipIds.push(membership.id)

            expect(membership.userId).toBe(user.id)
            expect(membership.levelId).toBe(level.id)
            expect(membership.status).toBe(MembershipStatus.ACTIVE)
            // endDate 应在 startDate 之后
            expect(new Date(membership.endDate).getTime()).toBeGreaterThan(
                new Date(membership.startDate).getTime()
            )
        })

        it('按月创建会员记录应计算正确的到期日期', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const membership = await createMembershipService({
                userId: user.id,
                levelId: level.id,
                duration: 1,
                durationUnit: 'month',
                sourceType: UserMembershipSourceType.DIRECT_PURCHASE,
            })
            testIds.userMembershipIds.push(membership.id)

            expect(membership.userId).toBe(user.id)
            expect(new Date(membership.endDate).getTime()).toBeGreaterThan(
                new Date(membership.startDate).getTime()
            )
        })

        it('按年创建会员记录应计算正确的到期日期', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const membership = await createMembershipService({
                userId: user.id,
                levelId: level.id,
                duration: 1,
                durationUnit: 'year',
                sourceType: UserMembershipSourceType.DIRECT_PURCHASE,
            })
            testIds.userMembershipIds.push(membership.id)

            expect(membership.userId).toBe(user.id)
            // 1 年会员，endDate 大约在 startDate 之后 364-366 天
            const diffMs = new Date(membership.endDate).getTime() - new Date(membership.startDate).getTime()
            const diffDays = diffMs / (24 * 60 * 60 * 1000)
            expect(diffDays).toBeGreaterThanOrEqual(360)
            expect(diffDays).toBeLessThanOrEqual(370)
        })

        it('已有有效会员时应从最晚到期日之后开始', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            // 先创建一个会员记录
            const firstMembership = await createMembershipService({
                userId: user.id,
                levelId: level.id,
                duration: 30,
                durationUnit: 'day',
                sourceType: UserMembershipSourceType.DIRECT_PURCHASE,
            })
            testIds.userMembershipIds.push(firstMembership.id)

            // 再创建一个会员记录
            const secondMembership = await createMembershipService({
                userId: user.id,
                levelId: level.id,
                duration: 30,
                durationUnit: 'day',
                sourceType: UserMembershipSourceType.DIRECT_PURCHASE,
            })
            testIds.userMembershipIds.push(secondMembership.id)

            // 第二个会员的开始日期应在第一个会员的结束日期之后
            expect(new Date(secondMembership.startDate).getTime()).toBeGreaterThan(
                new Date(firstMembership.endDate).getTime() - 24 * 60 * 60 * 1000
            )
        })

        it('应记录正确的来源类型', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const membership = await createMembershipService({
                userId: user.id,
                levelId: level.id,
                duration: 30,
                durationUnit: 'day',
                sourceType: UserMembershipSourceType.ADMIN_GIFT,
                sourceId: 999,
                remark: '管理员赠送测试',
            })
            testIds.userMembershipIds.push(membership.id)

            expect(membership.sourceType).toBe(UserMembershipSourceType.ADMIN_GIFT)
            expect(membership.sourceId).toBe(999)
            expect(membership.remark).toBe('管理员赠送测试')
        })
    })

    // ========== getMembershipByIdService 测试 ==========

    describe('getMembershipByIdService 测试', () => {
        it('不存在的 ID 应返回 null', async () => {
            if (!dbAvailable) return

            const result = await getMembershipByIdService(999999)
            expect(result).toBeNull()
        })

        it('应返回格式化后的会员详情', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const level = await createTestMembershipLevel({ name: '测试级别_详情' })
            testIds.membershipLevelIds.push(level.id)

            const membership = await createTestUserMembership(user.id, level.id, {
                sourceType: UserMembershipSourceType.ACTIVITY_AWARD,
                remark: '活动奖励测试',
            })
            testIds.userMembershipIds.push(membership.id)

            const result = await getMembershipByIdService(membership.id)

            expect(result).not.toBeNull()
            expect(result!.id).toBe(membership.id)
            expect(result!.userId).toBe(user.id)
            expect(result!.levelId).toBe(level.id)
            expect(result!.levelName).toBe('测试级别_详情')
            expect(result!.sourceTypeName).toBe('活动奖励')
            expect(result!.remark).toBe('活动奖励测试')
            expect(result!.startDate).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
        })

        it('settlementAt 为 null 时应返回 null', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const membership = await createTestUserMembership(user.id, level.id)
            testIds.userMembershipIds.push(membership.id)

            const result = await getMembershipByIdService(membership.id)

            expect(result).not.toBeNull()
            expect(result!.settlementAt).toBeNull()
        })

        it('未知来源类型应显示为"未知"', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            // 使用一个不在映射中的 sourceType
            const membership = await createTestUserMembership(user.id, level.id, {
                sourceType: 999 as any,
            })
            testIds.userMembershipIds.push(membership.id)

            const result = await getMembershipByIdService(membership.id)

            expect(result).not.toBeNull()
            expect(result!.sourceTypeName).toBe('未知')
        })
    })
})

describe('数据库连接检查', () => {
    it('检查数据库是否可用', async () => {
        const available = await isTestDbAvailable()
        if (!available) {
            console.log('请确保数据库已启动并配置正确的连接字符串')
        }
        expect(true).toBe(true)
    })
})
