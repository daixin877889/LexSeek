/**
 * 用户会员服务覆盖率补充测试
 *
 * 覆盖 userMembership.service.ts 中未被测试的路径：
 * - createMembershipService 已有已过期会员时的开始日期计算
 * - getSourceTypeName 各种来源类型映射
 * - getMembershipHistoryService 中 settlementAt 有值的记录
 * - createMembershipService 默认 durationUnit 为 day
 *
 * **Feature: membership-service-coverage**
 * **Validates: Requirements 会员服务模块**
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
    MembershipStatus,
    UserMembershipSourceType,
    type TestIds,
} from './test-db-helper'

import {
    getCurrentMembershipService,
    getMembershipHistoryService,
    createMembershipService,
    getMembershipByIdService,
} from '../../../server/services/membership/userMembership.service'

let dbAvailable = false

describe('用户会员服务 - 覆盖率补充', () => {
    const testIds: TestIds = createEmptyTestIds()
    const prisma = getTestPrisma()

    beforeAll(async () => {
        dbAvailable = await isTestDbAvailable()
        if (dbAvailable) {
            // 全量套件中前序测试可能已消耗 sequence，本套件 beforeAll 局部重置
            await prisma.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('users', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM users), 0), 1000) + 1, false)`)
            await prisma.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('user_memberships', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM user_memberships), 0), 1000) + 1, false)`)
            await prisma.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('membership_levels', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM membership_levels), 0), 1000) + 1, false)`)
        }
    })

    afterEach(async () => {
        if (dbAvailable) {
            // 清理用户权益
            if (testIds.userIds.length > 0) {
                await prisma.userBenefits.deleteMany({
                    where: { userId: { in: testIds.userIds } },
                })
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

    // ==================== createMembershipService 补充 ====================

    describe('createMembershipService - 已过期会员场景', () => {
        it('已过期会员存在时，新会员应从今天开始', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            // 创建一个已过期的会员
            const pastStart = dayjs().subtract(60, 'day').toDate()
            const pastEnd = dayjs().subtract(1, 'day').toDate()
            const expiredMembership = await createTestUserMembership(user.id, level.id, {
                status: MembershipStatus.ACTIVE,
                startDate: pastStart,
                endDate: pastEnd,
            })
            testIds.userMembershipIds.push(expiredMembership.id)

            // 创建新会员
            const newMembership = await createMembershipService({
                userId: user.id,
                levelId: level.id,
                duration: 30,
                durationUnit: 'day',
                sourceType: UserMembershipSourceType.DIRECT_PURCHASE,
            })
            testIds.userMembershipIds.push(newMembership.id)

            // 新会员开始日期应为今天
            const startDayjs = dayjs(newMembership.startDate)
            const today = dayjs().startOf('day')
            expect(startDayjs.diff(today, 'day')).toBeLessThanOrEqual(1)
        })
    })

    describe('createMembershipService - 默认 durationUnit', () => {
        it('不传 durationUnit 时默认按天计算', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const membership = await createMembershipService({
                userId: user.id,
                levelId: level.id,
                duration: 30,
                // 不传 durationUnit
                sourceType: UserMembershipSourceType.DIRECT_PURCHASE,
            })
            testIds.userMembershipIds.push(membership.id)

            const startDate = dayjs(membership.startDate)
            const endDate = dayjs(membership.endDate)
            const diffDays = endDate.startOf('day').diff(startDate.startOf('day'), 'day')
            // 30天 - 1天 = 29天
            expect(diffDays).toBe(29)
        })
    })

    // ==================== getMembershipHistoryService 补充 ====================

    describe('getMembershipHistoryService - settlementAt 有值', () => {
        it('settlementAt 有值时应格式化为字符串', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            // 先创建会员记录
            const membership = await createTestUserMembership(user.id, level.id, {
                status: MembershipStatus.SETTLED,
            })
            testIds.userMembershipIds.push(membership.id)

            // 直接更新 settlementAt 字段
            await prisma.userMemberships.update({
                where: { id: membership.id },
                data: { settlementAt: new Date() },
            })

            const result = await getMembershipHistoryService(user.id)
            expect(result.total).toBeGreaterThanOrEqual(1)

            const record = result.list.find(m => m.id === membership.id)
            expect(record).toBeDefined()
            expect(record!.settlementAt).not.toBeNull()
            expect(record!.settlementAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
        })
    })

    // ==================== getCurrentMembershipService 各种来源类型 ====================

    describe('getCurrentMembershipService - 来源类型名称', () => {
        const sourceTypeNames: Array<[number, string]> = [
            [UserMembershipSourceType.TRIAL, '试用'],
            [UserMembershipSourceType.REGISTRATION_AWARD, '注册赠送'],
            [UserMembershipSourceType.INVITATION_TO_REGISTER, '邀请注册赠送'],
            [UserMembershipSourceType.MEMBERSHIP_UPGRADE, '会员升级'],
            [UserMembershipSourceType.OTHER, '其他'],
        ]

        for (const [sourceType, expectedName] of sourceTypeNames) {
            it(`来源类型 ${sourceType} 应显示为"${expectedName}"`, async () => {
                if (!dbAvailable) return

                const user = await createTestUser()
                testIds.userIds.push(user.id)
                const level = await createTestMembershipLevel()
                testIds.membershipLevelIds.push(level.id)

                const membership = await createTestUserMembership(user.id, level.id, {
                    status: MembershipStatus.ACTIVE,
                    startDate: new Date(),
                    endDate: dayjs().add(30, 'day').toDate(),
                    sourceType,
                })
                testIds.userMembershipIds.push(membership.id)

                const result = await getCurrentMembershipService(user.id)
                expect(result).not.toBeNull()
                expect(result!.sourceTypeName).toBe(expectedName)
            })
        }
    })

    // ==================== getMembershipByIdService 补充 ====================

    describe('getMembershipByIdService - level 不存在', () => {
        it('会员记录的级别不存在时 levelName 为空字符串', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            // 创建一个临时级别
            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const membership = await createTestUserMembership(user.id, level.id)
            testIds.userMembershipIds.push(membership.id)

            // 软删除级别使其"不存在"
            await prisma.membershipLevels.update({
                where: { id: level.id },
                data: { deletedAt: new Date() },
            })

            const result = await getMembershipByIdService(membership.id)

            // 由于 findMembershipLevelByIdDao 查 deletedAt: null，应找不到
            // levelName 应为空字符串
            expect(result).not.toBeNull()
            expect(result!.levelName).toBe('')

            // 恢复级别以便清理
            await prisma.membershipLevels.update({
                where: { id: level.id },
                data: { deletedAt: null },
            })
        })
    })
})
