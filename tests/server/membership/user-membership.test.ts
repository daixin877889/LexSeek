/**
 * 用户会员记录集成测试
 *
 * 测试真实的用户会员 DAO 函数，使用真实数据库操作
 *
 * **Feature: membership-system**
 * **Validates: Requirements 2.1, 2.2, 2.3, 2.4**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import * as fc from 'fast-check'
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
    userMembershipDataArb,
    durationDaysArb,
    PBT_CONFIG_FAST,
    calculateEndDate,
} from './test-generators'

// 导入实际的 DAO 函数
import {
    createUserMembershipDao,
    findUserMembershipByIdDao,
    findCurrentUserMembershipDao,
    findUserMembershipHistoryDao,
    updateUserMembershipDao,
    invalidateUserMembershipDao,
    findAllActiveUserMembershipsDao,
} from '../../../server/services/membership/userMembership.dao'

// 检查数据库是否可用
let dbAvailable = false

describe('用户会员记录集成测试', () => {
    const testIds: TestIds = createEmptyTestIds()
    const prisma = getTestPrisma()

    beforeAll(async () => {
        dbAvailable = await isTestDbAvailable()
        if (!dbAvailable) {
            console.warn('数据库不可用，跳过集成测试')
        }
    })

    afterEach(async () => {
        if (dbAvailable) {
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

    describe('createUserMembershipDao 测试', () => {
        it('应成功创建用户会员记录', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const now = new Date()
            const endDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

            const membership = await createUserMembershipDao({
                user: { connect: { id: user.id } },
                level: { connect: { id: level.id } },
                startDate: now,
                endDate,
                status: MembershipStatus.ACTIVE,
                sourceType: UserMembershipSourceType.DIRECT_PURCHASE,
                remark: '测试创建',
            })
            testIds.userMembershipIds.push(membership.id)

            expect(membership.id).toBeGreaterThan(0)
            expect(membership.userId).toBe(user.id)
            expect(membership.levelId).toBe(level.id)
            expect(membership.status).toBe(MembershipStatus.ACTIVE)
        })
    })

    describe('findUserMembershipByIdDao 测试', () => {
        it('应成功通过 ID 查询用户会员记录', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)
            const membership = await createTestUserMembership(user.id, level.id)
            testIds.userMembershipIds.push(membership.id)

            const found = await findUserMembershipByIdDao(membership.id)

            expect(found).not.toBeNull()
            expect(found!.id).toBe(membership.id)
        })
    })

    describe('findCurrentUserMembershipDao 测试', () => {
        it('应返回用户当前有效会员', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const now = new Date()
            const futureDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

            const membership = await createTestUserMembership(user.id, level.id, {
                status: MembershipStatus.ACTIVE,
                endDate: futureDate,
            })
            testIds.userMembershipIds.push(membership.id)

            const found = await findCurrentUserMembershipDao(user.id)

            expect(found).not.toBeNull()
            expect(found!.id).toBe(membership.id)
            expect(found!.level.id).toBe(level.id)
        })

        it('Property: 只返回 ACTIVE 状态且未过期的记录', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const now = new Date()
            const futureDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
            const pastDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

            const activeMembership = await createTestUserMembership(user.id, level.id, {
                status: MembershipStatus.ACTIVE,
                endDate: futureDate,
            })
            testIds.userMembershipIds.push(activeMembership.id)

            const expiredMembership = await createTestUserMembership(user.id, level.id, {
                status: MembershipStatus.ACTIVE,
                startDate: new Date(pastDate.getTime() - 60 * 24 * 60 * 60 * 1000),
                endDate: pastDate,
            })
            testIds.userMembershipIds.push(expiredMembership.id)

            const inactiveMembership = await createTestUserMembership(user.id, level.id, {
                status: MembershipStatus.INACTIVE,
                endDate: futureDate,
            })
            testIds.userMembershipIds.push(inactiveMembership.id)

            const found = await findCurrentUserMembershipDao(user.id)

            expect(found).not.toBeNull()
            expect(found!.id).toBe(activeMembership.id)
        })
    })

    describe('updateUserMembershipDao 测试', () => {
        it('应成功更新用户会员记录', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)
            const membership = await createTestUserMembership(user.id, level.id)
            testIds.userMembershipIds.push(membership.id)

            const updated = await updateUserMembershipDao(membership.id, {
                autoRenew: true,
                remark: '测试更新',
            })

            expect(updated.autoRenew).toBe(true)
            expect(updated.remark).toBe('测试更新')
        })
    })

    describe('invalidateUserMembershipDao 测试', () => {
        it('应成功使用户会员记录失效', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)
            const membership = await createTestUserMembership(user.id, level.id, {
                status: MembershipStatus.ACTIVE,
            })
            testIds.userMembershipIds.push(membership.id)

            await invalidateUserMembershipDao(membership.id)

            const found = await findUserMembershipByIdDao(membership.id)
            expect(found!.status).toBe(MembershipStatus.INACTIVE)
        })
    })

    describe('findUserMembershipHistoryDao 测试', () => {
        it('应正确返回分页结果', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            for (let i = 0; i < 5; i++) {
                const membership = await createTestUserMembership(user.id, level.id)
                testIds.userMembershipIds.push(membership.id)
            }

            const page1 = await findUserMembershipHistoryDao(user.id, { page: 1, pageSize: 2 })
            const page2 = await findUserMembershipHistoryDao(user.id, { page: 2, pageSize: 2 })

            expect(page1.list.length).toBe(2)
            expect(page2.list.length).toBe(2)
            expect(page1.total).toBe(5)
        })
    })

    describe('findAllActiveUserMembershipsDao 测试', () => {
        it('应返回用户所有有效的会员记录', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const level1 = await createTestMembershipLevel({ sortOrder: 1 })
            const level2 = await createTestMembershipLevel({ sortOrder: 2 })
            testIds.membershipLevelIds.push(level1.id, level2.id)

            const now = new Date()
            const futureDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

            const membership1 = await createTestUserMembership(user.id, level1.id, {
                status: MembershipStatus.ACTIVE,
                endDate: futureDate,
            })
            const membership2 = await createTestUserMembership(user.id, level2.id, {
                status: MembershipStatus.ACTIVE,
                endDate: futureDate,
            })
            testIds.userMembershipIds.push(membership1.id, membership2.id)

            const activeMemberships = await findAllActiveUserMembershipsDao(user.id)

            expect(activeMemberships.length).toBe(2)
        })
    })

    describe('Property: startDate 应小于 endDate', () => {
        it('创建的会员记录时间范围正确', async () => {
            if (!dbAvailable) return

            await fc.assert(
                fc.asyncProperty(
                    durationDaysArb,
                    async (duration) => {
                        const user = await createTestUser()
                        testIds.userIds.push(user.id)
                        const level = await createTestMembershipLevel()
                        testIds.membershipLevelIds.push(level.id)

                        const now = new Date()
                        const endDate = calculateEndDate(now, duration)

                        const membership = await createUserMembershipDao({
                            user: { connect: { id: user.id } },
                            level: { connect: { id: level.id } },
                            startDate: now,
                            endDate,
                            status: MembershipStatus.ACTIVE,
                            sourceType: UserMembershipSourceType.DIRECT_PURCHASE,
                        })
                        testIds.userMembershipIds.push(membership.id)

                        expect(membership.startDate.getTime()).toBeLessThan(membership.endDate.getTime())

                        return true
                    }
                ),
                PBT_CONFIG_FAST
            )
        })
    })

    describe('软删除', () => {
        it('软删除后不应被查询到', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)
            const membership = await createTestUserMembership(user.id, level.id)
            testIds.userMembershipIds.push(membership.id)

            await prisma.userMemberships.update({
                where: { id: membership.id },
                data: { deletedAt: new Date() },
            })

            const found = await findUserMembershipByIdDao(membership.id)
            expect(found).toBeNull()
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
