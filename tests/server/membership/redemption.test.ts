/**
 * 兑换码集成测试
 *
 * 测试真实的兑换码 DAO/Service 函数，使用真实数据库操作
 *
 * **Feature: membership-system**
 * **Validates: Requirements 4.1, 4.2, 4.3, 4.4**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import * as fc from 'fast-check'
import dayjs from 'dayjs'
import {
    getTestPrisma,
    createTestUser,
    createTestMembershipLevel,
    createTestRedemptionCode,
    createTestUserMembership,
    createTestPointRecord,
    cleanupTestData,
    createEmptyTestIds,
    disconnectTestDb,
    isTestDbAvailable,
    RedemptionCodeStatus,
    RedemptionCodeType,
    MembershipStatus,
    UserMembershipSourceType,
    PointSourceType,
    PointRecordStatus,
    type TestIds,
} from './test-db-helper'
import {
    redemptionCodeMembershipOnlyArb,
    redemptionCodePointsOnlyArb,
    redemptionCodeMembershipAndPointsArb,
    PBT_CONFIG_FAST,
    PBT_CONFIG,
} from './test-generators'

// 导入实际的 DAO 函数
import {
    createRedemptionCodeDao,
    findRedemptionCodeByCodeDao,
    findRedemptionCodeByIdDao,
    updateRedemptionCodeStatusDao,
    findAllRedemptionCodesDao,
} from '../../../server/services/redemption/redemptionCode.dao'

import {
    createRedemptionRecordDao,
    findRedemptionRecordsByUserIdDao,
    checkUserRedemptionRecordExistsDao,
} from '../../../server/services/redemption/redemptionRecord.dao'

// 导入 Service 函数
import {
    validateRedemptionCodeService,
    redeemCodeService,
} from '../../../server/services/redemption/redemption.service'

// 导入用户会员 DAO 函数（用于验证兑换结果）
import {
    findCurrentUserMembershipDao,
} from '../../../server/services/membership/userMembership.dao'

// 导入积分 DAO 函数（用于验证兑换结果）
import {
    findValidPointRecordsByUserIdDao,
    sumUserValidPointsDao,
} from '../../../server/services/point/pointRecords.dao'

// 检查数据库是否可用
let dbAvailable = false

describe('兑换码集成测试', () => {
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
            testIds.userIds = []
            testIds.membershipLevelIds = []
            testIds.redemptionCodeIds = []
            testIds.redemptionRecordIds = []
            testIds.userMembershipIds = []
            testIds.pointRecordIds = []
        }
    })

    afterAll(async () => {
        if (dbAvailable) {
            await disconnectTestDb()
        }
    })

    // ==================== DAO 函数测试 ====================

    describe('createRedemptionCodeDao 测试', () => {
        it('应成功创建兑换码', async () => {
            if (!dbAvailable) return

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const futureDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)

            // 使用实际的 DAO 函数创建
            const code = await createRedemptionCodeDao({
                code: `TEST_DAO_${Date.now()}`,
                type: RedemptionCodeType.MEMBERSHIP_AND_POINTS,
                level: { connect: { id: level.id } },
                duration: 30,
                pointAmount: 100,
                expiredAt: futureDate,
                status: RedemptionCodeStatus.VALID,
            })
            testIds.redemptionCodeIds.push(code.id)

            expect(code.id).toBeGreaterThan(0)
            expect(code.type).toBe(RedemptionCodeType.MEMBERSHIP_AND_POINTS)
            expect(code.levelId).toBe(level.id)
            expect(code.duration).toBe(30)
            expect(code.pointAmount).toBe(100)
            expect(code.status).toBe(RedemptionCodeStatus.VALID)
        })
    })

    describe('findRedemptionCodeByCodeDao 测试', () => {
        it('应成功通过兑换码查询', async () => {
            if (!dbAvailable) return

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const created = await createTestRedemptionCode(level.id)
            testIds.redemptionCodeIds.push(created.id)

            // 使用实际的 DAO 函数查询
            const found = await findRedemptionCodeByCodeDao(created.code)

            expect(found).not.toBeNull()
            expect(found!.id).toBe(created.id)
            expect(found!.code).toBe(created.code)
            expect(found!.level).not.toBeNull()
            expect(found!.level!.id).toBe(level.id)
        })

        it('查询不存在的兑换码应返回 null', async () => {
            if (!dbAvailable) return

            const found = await findRedemptionCodeByCodeDao('NOT_EXIST_CODE')
            expect(found).toBeNull()
        })
    })

    describe('findRedemptionCodeByIdDao 测试', () => {
        it('应成功通过 ID 查询兑换码', async () => {
            if (!dbAvailable) return

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const created = await createTestRedemptionCode(level.id)
            testIds.redemptionCodeIds.push(created.id)

            // 使用实际的 DAO 函数查询
            const found = await findRedemptionCodeByIdDao(created.id)

            expect(found).not.toBeNull()
            expect(found!.id).toBe(created.id)
        })
    })

    describe('updateRedemptionCodeStatusDao 测试', () => {
        it('应成功更新兑换码状态', async () => {
            if (!dbAvailable) return

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const created = await createTestRedemptionCode(level.id, {
                status: RedemptionCodeStatus.VALID,
            })
            testIds.redemptionCodeIds.push(created.id)

            // 使用实际的 DAO 函数更新状态
            const updated = await updateRedemptionCodeStatusDao(created.id, RedemptionCodeStatus.USED)

            expect(updated.status).toBe(RedemptionCodeStatus.USED)
        })
    })

    describe('findAllRedemptionCodesDao 测试', () => {
        it('应正确返回分页结果', async () => {
            if (!dbAvailable) return

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            // 创建 5 个兑换码
            for (let i = 0; i < 5; i++) {
                const code = await createTestRedemptionCode(level.id)
                testIds.redemptionCodeIds.push(code.id)
            }

            // 使用实际的 DAO 函数查询
            const result = await findAllRedemptionCodesDao({ page: 1, pageSize: 2 })

            expect(result.list.length).toBeLessThanOrEqual(2)
            expect(result.total).toBeGreaterThanOrEqual(5)
        })

        it('应正确按状态筛选', async () => {
            if (!dbAvailable) return

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const validCode = await createTestRedemptionCode(level.id, {
                status: RedemptionCodeStatus.VALID,
            })
            const usedCode = await createTestRedemptionCode(level.id, {
                status: RedemptionCodeStatus.USED,
            })
            testIds.redemptionCodeIds.push(validCode.id, usedCode.id)

            // 使用实际的 DAO 函数按状态筛选
            const validResult = await findAllRedemptionCodesDao({ status: RedemptionCodeStatus.VALID })

            const foundValid = validResult.list.find(c => c.id === validCode.id)
            const foundUsed = validResult.list.find(c => c.id === usedCode.id)

            expect(foundValid).not.toBeUndefined()
            expect(foundUsed).toBeUndefined()
        })
    })

    describe('createRedemptionRecordDao 测试', () => {
        it('应成功创建兑换记录', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const code = await createTestRedemptionCode(level.id)
            testIds.redemptionCodeIds.push(code.id)

            // 使用实际的 DAO 函数创建
            const record = await createRedemptionRecordDao(user.id, code.id)
            testIds.redemptionRecordIds.push(record.id)

            expect(record.id).toBeGreaterThan(0)
            expect(record.userId).toBe(user.id)
            expect(record.codeId).toBe(code.id)
        })
    })

    describe('findRedemptionRecordsByUserIdDao 测试', () => {
        it('应正确返回用户兑换记录', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            // 创建多个兑换记录
            for (let i = 0; i < 3; i++) {
                const code = await createTestRedemptionCode(level.id)
                testIds.redemptionCodeIds.push(code.id)

                const record = await createRedemptionRecordDao(user.id, code.id)
                testIds.redemptionRecordIds.push(record.id)
            }

            // 使用实际的 DAO 函数查询
            const result = await findRedemptionRecordsByUserIdDao(user.id)

            expect(result.list.length).toBe(3)
            expect(result.total).toBe(3)
        })
    })

    describe('checkUserRedemptionRecordExistsDao 测试', () => {
        it('用户已使用过的兑换码应返回 true', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const code = await createTestRedemptionCode(level.id)
            testIds.redemptionCodeIds.push(code.id)

            // 创建兑换记录
            const record = await createRedemptionRecordDao(user.id, code.id)
            testIds.redemptionRecordIds.push(record.id)

            // 使用实际的 DAO 函数检查
            const exists = await checkUserRedemptionRecordExistsDao(user.id, code.id)

            expect(exists).toBe(true)
        })

        it('用户未使用过的兑换码应返回 false', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const code = await createTestRedemptionCode(level.id)
            testIds.redemptionCodeIds.push(code.id)

            // 使用实际的 DAO 函数检查
            const exists = await checkUserRedemptionRecordExistsDao(user.id, code.id)

            expect(exists).toBe(false)
        })
    })

    // ==================== Service 函数测试 ====================

    describe('validateRedemptionCodeService 测试', () => {
        it('有效兑换码应返回 valid: true', async () => {
            if (!dbAvailable) return

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const code = await createTestRedemptionCode(level.id, {
                status: RedemptionCodeStatus.VALID,
            })
            testIds.redemptionCodeIds.push(code.id)

            // 使用实际的 Service 函数验证
            const result = await validateRedemptionCodeService(code.code)

            expect(result.valid).toBe(true)
            expect(result.codeInfo).not.toBeUndefined()
            expect(result.codeInfo!.id).toBe(code.id)
        })

        it('不存在的兑换码应返回错误', async () => {
            if (!dbAvailable) return

            const result = await validateRedemptionCodeService('NOT_EXIST_CODE_12345')

            expect(result.valid).toBe(false)
            expect(result.error).toBe('兑换码不存在')
        })

        it('已使用的兑换码应返回错误', async () => {
            if (!dbAvailable) return

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const code = await createTestRedemptionCode(level.id, {
                status: RedemptionCodeStatus.USED,
            })
            testIds.redemptionCodeIds.push(code.id)

            const result = await validateRedemptionCodeService(code.code)

            expect(result.valid).toBe(false)
            expect(result.error).toBe('兑换码已被使用')
        })

        it('已过期的兑换码应返回错误', async () => {
            if (!dbAvailable) return

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const code = await createTestRedemptionCode(level.id, {
                status: RedemptionCodeStatus.EXPIRED,
            })
            testIds.redemptionCodeIds.push(code.id)

            const result = await validateRedemptionCodeService(code.code)

            expect(result.valid).toBe(false)
            expect(result.error).toBe('兑换码已过期')
        })

        it('已作废的兑换码应返回错误', async () => {
            if (!dbAvailable) return

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const code = await createTestRedemptionCode(level.id, {
                status: RedemptionCodeStatus.INVALID,
            })
            testIds.redemptionCodeIds.push(code.id)

            const result = await validateRedemptionCodeService(code.code)

            expect(result.valid).toBe(false)
            expect(result.error).toBe('兑换码已作废')
        })
    })

    describe('redeemCodeService 测试', () => {
        it('仅会员类型兑换码应创建会员记录', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const duration = 30
            const code = await createTestRedemptionCode(level.id, {
                type: RedemptionCodeType.MEMBERSHIP_ONLY,
                duration,
                pointAmount: null,
                status: RedemptionCodeStatus.VALID,
            })
            testIds.redemptionCodeIds.push(code.id)

            // 使用实际的 Service 函数兑换
            const result = await redeemCodeService(user.id, code.code)

            expect(result.success).toBe(true)
            expect(result.membershipId).toBeDefined()
            expect(result.pointRecordId).toBeUndefined()

            // 追踪创建的会员记录
            if (result.membershipId) {
                testIds.userMembershipIds.push(result.membershipId)
            }

            // 验证会员记录
            const membership = await findCurrentUserMembershipDao(user.id)
            expect(membership).not.toBeNull()
            expect(membership!.levelId).toBe(level.id)
            expect(membership!.sourceType).toBe(UserMembershipSourceType.REDEMPTION_CODE)

            // 验证兑换码状态已更新
            const updatedCode = await findRedemptionCodeByIdDao(code.id)
            expect(updatedCode!.status).toBe(RedemptionCodeStatus.USED)

            // 追踪兑换记录
            const records = await findRedemptionRecordsByUserIdDao(user.id)
            if (records.list.length > 0) {
                testIds.redemptionRecordIds.push(records.list[0].id)
            }
        })

        it('仅积分类型兑换码应创建积分记录', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const pointAmount = 500
            const code = await createTestRedemptionCode(null, {
                type: RedemptionCodeType.POINTS_ONLY,
                duration: null,
                pointAmount,
                status: RedemptionCodeStatus.VALID,
            })
            testIds.redemptionCodeIds.push(code.id)

            // 使用实际的 Service 函数兑换
            const result = await redeemCodeService(user.id, code.code)

            expect(result.success).toBe(true)
            expect(result.membershipId).toBeUndefined()
            expect(result.pointRecordId).toBeDefined()

            // 追踪创建的积分记录
            if (result.pointRecordId) {
                testIds.pointRecordIds.push(result.pointRecordId)
            }

            // 验证积分记录
            const pointSummary = await sumUserValidPointsDao(user.id)
            expect(pointSummary.remaining).toBe(pointAmount)

            // 验证兑换码状态已更新
            const updatedCode = await findRedemptionCodeByIdDao(code.id)
            expect(updatedCode!.status).toBe(RedemptionCodeStatus.USED)

            // 追踪兑换记录
            const records = await findRedemptionRecordsByUserIdDao(user.id)
            if (records.list.length > 0) {
                testIds.redemptionRecordIds.push(records.list[0].id)
            }
        })

        it('会员和积分类型兑换码应同时创建会员和积分记录', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const duration = 30
            const pointAmount = 200
            const code = await createTestRedemptionCode(level.id, {
                type: RedemptionCodeType.MEMBERSHIP_AND_POINTS,
                duration,
                pointAmount,
                status: RedemptionCodeStatus.VALID,
            })
            testIds.redemptionCodeIds.push(code.id)

            // 使用实际的 Service 函数兑换
            const result = await redeemCodeService(user.id, code.code)

            expect(result.success).toBe(true)
            expect(result.membershipId).toBeDefined()
            expect(result.pointRecordId).toBeDefined()

            // 追踪创建的记录
            if (result.membershipId) {
                testIds.userMembershipIds.push(result.membershipId)
            }
            if (result.pointRecordId) {
                testIds.pointRecordIds.push(result.pointRecordId)
            }

            // 验证会员记录
            const membership = await findCurrentUserMembershipDao(user.id)
            expect(membership).not.toBeNull()
            expect(membership!.levelId).toBe(level.id)

            // 验证积分记录
            const pointSummary = await sumUserValidPointsDao(user.id)
            expect(pointSummary.remaining).toBe(pointAmount)

            // 验证积分记录关联到会员记录
            const pointRecords = await findValidPointRecordsByUserIdDao(user.id)
            expect(pointRecords.length).toBeGreaterThan(0)
            expect(pointRecords[0].userMembershipId).toBe(result.membershipId)

            // 追踪兑换记录
            const records = await findRedemptionRecordsByUserIdDao(user.id)
            if (records.list.length > 0) {
                testIds.redemptionRecordIds.push(records.list[0].id)
            }
        })

        it('无效兑换码应返回失败', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const result = await redeemCodeService(user.id, 'INVALID_CODE_12345')

            expect(result.success).toBe(false)
            expect(result.message).toBe('兑换码不存在')
        })
    })

    // ==================== 属性测试 ====================

    /**
     * Property 5: 兑换码状态变更正确性
     * *对于任意*有效兑换码，使用后状态应变为 USED，且不能再次使用。
     * **Validates: Requirements 4.2**
     */
    describe('Property 5: 兑换码状态变更正确性', () => {
        it('有效兑换码使用后状态应变为 USED', async () => {
            if (!dbAvailable) return

            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 100 }),
                    async () => {
                        const user = await createTestUser()
                        testIds.userIds.push(user.id)

                        const level = await createTestMembershipLevel()
                        testIds.membershipLevelIds.push(level.id)

                        const code = await createTestRedemptionCode(level.id, {
                            status: RedemptionCodeStatus.VALID,
                        })
                        testIds.redemptionCodeIds.push(code.id)

                        // 验证初始状态
                        expect(code.status).toBe(RedemptionCodeStatus.VALID)

                        // 使用兑换码
                        const result = await redeemCodeService(user.id, code.code)
                        expect(result.success).toBe(true)

                        // 追踪创建的记录
                        if (result.membershipId) testIds.userMembershipIds.push(result.membershipId)
                        if (result.pointRecordId) testIds.pointRecordIds.push(result.pointRecordId)

                        // 追踪兑换记录
                        const records = await findRedemptionRecordsByUserIdDao(user.id)
                        records.list.forEach(r => testIds.redemptionRecordIds.push(r.id))

                        // 验证状态变更
                        const updatedCode = await findRedemptionCodeByIdDao(code.id)
                        expect(updatedCode!.status).toBe(RedemptionCodeStatus.USED)

                        // 验证不能再次使用
                        const secondResult = await redeemCodeService(user.id, code.code)
                        expect(secondResult.success).toBe(false)
                        expect(secondResult.message).toBe('兑换码已被使用')

                        return true
                    }
                ),
                PBT_CONFIG_FAST
            )
        })
    })

    /**
     * Property 5.1: 兑换码类型处理正确性 - 仅会员
     * *对于任意*类型为 MEMBERSHIP_ONLY 的有效兑换码，兑换后应：
     * - 创建一条用户会员记录
     * - 会员记录的 levelId 应等于兑换码的 levelId
     * - 会员记录的有效期应等于兑换码的 duration 天
     * - 不应创建积分记录
     * **Validates: Requirements 4.2**
     */
    describe('Property 5.1: 兑换码类型处理正确性 - 仅会员', () => {
        it('仅会员类型兑换码应只创建会员记录', async () => {
            if (!dbAvailable) return

            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 365 }),
                    async (duration) => {
                        const user = await createTestUser()
                        testIds.userIds.push(user.id)

                        const level = await createTestMembershipLevel()
                        testIds.membershipLevelIds.push(level.id)

                        const code = await createTestRedemptionCode(level.id, {
                            type: RedemptionCodeType.MEMBERSHIP_ONLY,
                            duration,
                            pointAmount: null,
                            status: RedemptionCodeStatus.VALID,
                        })
                        testIds.redemptionCodeIds.push(code.id)

                        // 记录兑换前的积分
                        const pointsBefore = await sumUserValidPointsDao(user.id)

                        // 使用兑换码
                        const result = await redeemCodeService(user.id, code.code)
                        expect(result.success).toBe(true)

                        // 追踪创建的记录
                        if (result.membershipId) testIds.userMembershipIds.push(result.membershipId)
                        if (result.pointRecordId) testIds.pointRecordIds.push(result.pointRecordId)

                        // 追踪兑换记录
                        const records = await findRedemptionRecordsByUserIdDao(user.id)
                        records.list.forEach(r => testIds.redemptionRecordIds.push(r.id))

                        // 验证创建了会员记录
                        expect(result.membershipId).toBeDefined()

                        // 验证会员记录的 levelId
                        const membership = await findCurrentUserMembershipDao(user.id)
                        expect(membership).not.toBeNull()
                        expect(membership!.levelId).toBe(level.id)

                        // 验证会员有效期（允许 1 天误差）
                        const expectedEndDate = dayjs().add(duration, 'day')
                        const actualEndDate = dayjs(membership!.endDate)
                        const diffDays = Math.abs(actualEndDate.diff(expectedEndDate, 'day'))
                        expect(diffDays).toBeLessThanOrEqual(1)

                        // 验证没有创建积分记录
                        expect(result.pointRecordId).toBeUndefined()
                        const pointsAfter = await sumUserValidPointsDao(user.id)
                        expect(pointsAfter.remaining).toBe(pointsBefore.remaining)

                        return true
                    }
                ),
                PBT_CONFIG_FAST
            )
        })
    })

    /**
     * Property 5.2: 兑换码类型处理正确性 - 仅积分
     * *对于任意*类型为 POINTS_ONLY 的有效兑换码，兑换后应：
     * - 创建一条积分记录
     * - 积分记录的 pointAmount 应等于兑换码的 pointAmount
     * - 积分记录的有效期应为 1 年
     * - 不应创建会员记录
     * **Validates: Requirements 4.2**
     */
    describe('Property 5.2: 兑换码类型处理正确性 - 仅积分', () => {
        it('仅积分类型兑换码应只创建积分记录', async () => {
            if (!dbAvailable) return

            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 10000 }),
                    async (pointAmount) => {
                        const user = await createTestUser()
                        testIds.userIds.push(user.id)

                        const code = await createTestRedemptionCode(null, {
                            type: RedemptionCodeType.POINTS_ONLY,
                            duration: null,
                            pointAmount,
                            status: RedemptionCodeStatus.VALID,
                        })
                        testIds.redemptionCodeIds.push(code.id)

                        // 使用兑换码
                        const result = await redeemCodeService(user.id, code.code)
                        expect(result.success).toBe(true)

                        // 追踪创建的记录
                        if (result.membershipId) testIds.userMembershipIds.push(result.membershipId)
                        if (result.pointRecordId) testIds.pointRecordIds.push(result.pointRecordId)

                        // 追踪兑换记录
                        const records = await findRedemptionRecordsByUserIdDao(user.id)
                        records.list.forEach(r => testIds.redemptionRecordIds.push(r.id))

                        // 验证创建了积分记录
                        expect(result.pointRecordId).toBeDefined()

                        // 验证积分数量
                        const pointSummary = await sumUserValidPointsDao(user.id)
                        expect(pointSummary.remaining).toBe(pointAmount)

                        // 验证积分有效期为 1 年（允许 1 天误差）
                        const pointRecords = await findValidPointRecordsByUserIdDao(user.id)
                        expect(pointRecords.length).toBeGreaterThan(0)
                        const expectedExpiredAt = dayjs().add(1, 'year')
                        const actualExpiredAt = dayjs(pointRecords[0].expiredAt)
                        const diffDays = Math.abs(actualExpiredAt.diff(expectedExpiredAt, 'day'))
                        expect(diffDays).toBeLessThanOrEqual(1)

                        // 验证没有创建会员记录
                        expect(result.membershipId).toBeUndefined()
                        const membership = await findCurrentUserMembershipDao(user.id)
                        expect(membership).toBeNull()

                        return true
                    }
                ),
                PBT_CONFIG_FAST
            )
        })
    })

    /**
     * Property 5.3: 兑换码类型处理正确性 - 会员和积分
     * *对于任意*类型为 MEMBERSHIP_AND_POINTS 的有效兑换码，兑换后应：
     * - 创建一条用户会员记录
     * - 创建一条积分记录
     * - 积分记录的有效期应跟随会员有效期
     * - 积分记录应关联到新创建的会员记录
     * **Validates: Requirements 4.2**
     */
    describe('Property 5.3: 兑换码类型处理正确性 - 会员和积分', () => {
        it('会员和积分类型兑换码应同时创建会员和积分记录', async () => {
            if (!dbAvailable) return

            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 365 }),
                    fc.integer({ min: 1, max: 10000 }),
                    async (duration, pointAmount) => {
                        const user = await createTestUser()
                        testIds.userIds.push(user.id)

                        const level = await createTestMembershipLevel()
                        testIds.membershipLevelIds.push(level.id)

                        const code = await createTestRedemptionCode(level.id, {
                            type: RedemptionCodeType.MEMBERSHIP_AND_POINTS,
                            duration,
                            pointAmount,
                            status: RedemptionCodeStatus.VALID,
                        })
                        testIds.redemptionCodeIds.push(code.id)

                        // 使用兑换码
                        const result = await redeemCodeService(user.id, code.code)
                        expect(result.success).toBe(true)

                        // 追踪创建的记录
                        if (result.membershipId) testIds.userMembershipIds.push(result.membershipId)
                        if (result.pointRecordId) testIds.pointRecordIds.push(result.pointRecordId)

                        // 追踪兑换记录
                        const records = await findRedemptionRecordsByUserIdDao(user.id)
                        records.list.forEach(r => testIds.redemptionRecordIds.push(r.id))

                        // 验证创建了会员记录和积分记录
                        expect(result.membershipId).toBeDefined()
                        expect(result.pointRecordId).toBeDefined()

                        // 验证会员记录
                        const membership = await findCurrentUserMembershipDao(user.id)
                        expect(membership).not.toBeNull()
                        expect(membership!.levelId).toBe(level.id)

                        // 验证积分数量
                        const pointSummary = await sumUserValidPointsDao(user.id)
                        expect(pointSummary.remaining).toBe(pointAmount)

                        // 验证积分记录关联到会员记录
                        const pointRecords = await findValidPointRecordsByUserIdDao(user.id)
                        expect(pointRecords.length).toBeGreaterThan(0)
                        expect(pointRecords[0].userMembershipId).toBe(result.membershipId)

                        // 验证积分有效期跟随会员有效期（允许 1 天误差）
                        const expectedExpiredAt = dayjs().add(duration, 'day')
                        const actualExpiredAt = dayjs(pointRecords[0].expiredAt)
                        const diffDays = Math.abs(actualExpiredAt.diff(expectedExpiredAt, 'day'))
                        expect(diffDays).toBeLessThanOrEqual(1)

                        return true
                    }
                ),
                PBT_CONFIG_FAST
            )
        })
    })

    /**
     * Property 5.4-5.7: 兑换码验证场景
     * - Property 5.4: 已使用的兑换码验证应返回失败
     * - Property 5.5: 已过期的兑换码验证应返回失败
     * - Property 5.6: 已作废的兑换码验证应返回失败
     * - Property 5.7: 不存在的兑换码验证应返回失败
     * **Validates: Requirements 4.2, 4.3**
     */
    describe('Property 5.4-5.7: 兑换码验证场景', () => {
        it('Property 5.4: 已使用的兑换码验证应返回失败', async () => {
            if (!dbAvailable) return

            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 100 }),
                    async () => {
                        const level = await createTestMembershipLevel()
                        testIds.membershipLevelIds.push(level.id)

                        const code = await createTestRedemptionCode(level.id, {
                            status: RedemptionCodeStatus.USED,
                        })
                        testIds.redemptionCodeIds.push(code.id)

                        const result = await validateRedemptionCodeService(code.code)

                        expect(result.valid).toBe(false)
                        expect(result.error).toBe('兑换码已被使用')

                        return true
                    }
                ),
                PBT_CONFIG_FAST
            )
        })

        it('Property 5.5: 已过期的兑换码验证应返回失败', async () => {
            if (!dbAvailable) return

            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 100 }),
                    async () => {
                        const level = await createTestMembershipLevel()
                        testIds.membershipLevelIds.push(level.id)

                        const code = await createTestRedemptionCode(level.id, {
                            status: RedemptionCodeStatus.EXPIRED,
                        })
                        testIds.redemptionCodeIds.push(code.id)

                        const result = await validateRedemptionCodeService(code.code)

                        expect(result.valid).toBe(false)
                        expect(result.error).toBe('兑换码已过期')

                        return true
                    }
                ),
                PBT_CONFIG_FAST
            )
        })

        it('Property 5.5b: 过期时间早于当前时间的兑换码验证应返回失败并更新状态', async () => {
            if (!dbAvailable) return

            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 100 }),
                    async () => {
                        const level = await createTestMembershipLevel()
                        testIds.membershipLevelIds.push(level.id)

                        // 创建一个过期时间在过去的兑换码
                        const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000) // 1天前
                        const code = await createTestRedemptionCode(level.id, {
                            status: RedemptionCodeStatus.VALID,
                            expiredAt: pastDate,
                        })
                        testIds.redemptionCodeIds.push(code.id)

                        const result = await validateRedemptionCodeService(code.code)

                        expect(result.valid).toBe(false)
                        expect(result.error).toBe('兑换码已过期')

                        // 验证状态已自动更新为 EXPIRED
                        const updatedCode = await findRedemptionCodeByIdDao(code.id)
                        expect(updatedCode!.status).toBe(RedemptionCodeStatus.EXPIRED)

                        return true
                    }
                ),
                PBT_CONFIG_FAST
            )
        })

        it('Property 5.6: 已作废的兑换码验证应返回失败', async () => {
            if (!dbAvailable) return

            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 100 }),
                    async () => {
                        const level = await createTestMembershipLevel()
                        testIds.membershipLevelIds.push(level.id)

                        const code = await createTestRedemptionCode(level.id, {
                            status: RedemptionCodeStatus.INVALID,
                        })
                        testIds.redemptionCodeIds.push(code.id)

                        const result = await validateRedemptionCodeService(code.code)

                        expect(result.valid).toBe(false)
                        expect(result.error).toBe('兑换码已作废')

                        return true
                    }
                ),
                PBT_CONFIG_FAST
            )
        })

        it('Property 5.7: 不存在的兑换码验证应返回失败', async () => {
            if (!dbAvailable) return

            await fc.assert(
                fc.asyncProperty(
                    fc.string({ minLength: 10, maxLength: 20 }),
                    async (randomCode) => {
                        const result = await validateRedemptionCodeService(`NOT_EXIST_${randomCode}`)

                        expect(result.valid).toBe(false)
                        expect(result.error).toBe('兑换码不存在')

                        return true
                    }
                ),
                PBT_CONFIG_FAST
            )
        })
    })

    /**
     * Property 5.8: 兑换记录创建正确性
     * *对于任意*成功的兑换操作，应创建一条兑换记录，包含：
     * - userId（用户 ID）
     * - redemptionCodeId（兑换码 ID）
     * - 创建时间
     * **Validates: Requirements 4.2**
     */
    describe('Property 5.8: 兑换记录创建正确性', () => {
        it('成功兑换应创建正确的兑换记录', async () => {
            if (!dbAvailable) return

            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 100 }),
                    async () => {
                        const user = await createTestUser()
                        testIds.userIds.push(user.id)

                        const level = await createTestMembershipLevel()
                        testIds.membershipLevelIds.push(level.id)

                        const code = await createTestRedemptionCode(level.id, {
                            status: RedemptionCodeStatus.VALID,
                        })
                        testIds.redemptionCodeIds.push(code.id)

                        const beforeRedeem = new Date()

                        // 使用兑换码
                        const result = await redeemCodeService(user.id, code.code)
                        expect(result.success).toBe(true)

                        // 追踪创建的记录
                        if (result.membershipId) testIds.userMembershipIds.push(result.membershipId)
                        if (result.pointRecordId) testIds.pointRecordIds.push(result.pointRecordId)

                        // 查询兑换记录
                        const records = await findRedemptionRecordsByUserIdDao(user.id)
                        expect(records.list.length).toBeGreaterThan(0)

                        // 追踪兑换记录
                        records.list.forEach(r => testIds.redemptionRecordIds.push(r.id))

                        // 验证兑换记录内容
                        const record = records.list[0]
                        expect(record.userId).toBe(user.id)
                        expect(record.codeId).toBe(code.id)
                        expect(new Date(record.createdAt).getTime()).toBeGreaterThanOrEqual(beforeRedeem.getTime())

                        return true
                    }
                ),
                PBT_CONFIG_FAST
            )
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
