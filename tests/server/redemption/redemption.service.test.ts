/**
 * 兑换码服务测试
 *
 * 测试兑换码服务层功能，包括：
 * - 获取兑换码信息
 * - 验证兑换码
 * - 执行兑换
 *
 * **Feature: redemption-service**
 * **Validates: Requirements 1.1, 1.2, 2.1, 2.2, 3.1, 3.2**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import * as fc from 'fast-check'
import {
    getTestPrisma,
    createTestMembershipLevel,
    createTestRedemptionCode,
    createTestUser,
    cleanupTestData,
    createEmptyTestIds,
    disconnectTestDb,
    isTestDbAvailable,
    RedemptionCodeStatus,
    RedemptionCodeType,
    type TestIds,
} from './test-db-helper'

// 导入服务函数
import {
    getRedemptionCodeInfoService,
    validateRedemptionCodeService,
    redeemCodeService,
} from '../../../server/services/redemption/redemption.service'

// 检查数据库是否可用
let dbAvailable = false

describe('兑换码服务测试', () => {
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
            testIds.redemptionCodeIds = []
            testIds.redemptionRecordIds = []
            testIds.userIds = []
            testIds.membershipLevelIds = []
        }
    })

    afterAll(async () => {
        if (dbAvailable) {
            await disconnectTestDb()
        }
    })

    describe('getRedemptionCodeInfoService 测试', () => {
        it('应返回有效兑换码的信息', async () => {
            if (!dbAvailable) return

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const code = await createTestRedemptionCode({
                type: RedemptionCodeType.MEMBERSHIP_ONLY,
                levelId: level.id,
                duration: 30,
                status: RedemptionCodeStatus.ACTIVE,
            })
            testIds.redemptionCodeIds.push(code.id)

            const info = await getRedemptionCodeInfoService(code.code)

            expect(info).not.toBeNull()
            expect(info!.code).toBe(code.code)
            expect(info!.type).toBe(RedemptionCodeType.MEMBERSHIP_ONLY)
            expect(info!.levelId).toBe(level.id)
            expect(info!.duration).toBe(30)
            expect(info!.status).toBe(RedemptionCodeStatus.ACTIVE)
        })

        it('不存在的兑换码应返回 null', async () => {
            if (!dbAvailable) return

            const info = await getRedemptionCodeInfoService('NOT-EXIST-CODE')
            expect(info).toBeNull()
        })

        it('Property: 返回的信息应与创建时一致', async () => {
            if (!dbAvailable) return

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 365 }),
                    fc.integer({ min: 1, max: 10000 }),
                    async (duration, pointAmount) => {
                        const code = await createTestRedemptionCode({
                            type: RedemptionCodeType.MEMBERSHIP_AND_POINTS,
                            levelId: level.id,
                            duration,
                            pointAmount,
                            status: RedemptionCodeStatus.ACTIVE,
                        })
                        testIds.redemptionCodeIds.push(code.id)

                        const info = await getRedemptionCodeInfoService(code.code)

                        expect(info).not.toBeNull()
                        expect(info!.duration).toBe(duration)
                        expect(info!.pointAmount).toBe(pointAmount)

                        return true
                    }
                ),
                { numRuns: 5 }
            )
        })
    })

    describe('validateRedemptionCodeService 测试', () => {
        it('有效兑换码应验证通过', async () => {
            if (!dbAvailable) return

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const code = await createTestRedemptionCode({
                type: RedemptionCodeType.MEMBERSHIP_ONLY,
                levelId: level.id,
                duration: 30,
                status: RedemptionCodeStatus.ACTIVE,
            })
            testIds.redemptionCodeIds.push(code.id)

            const result = await validateRedemptionCodeService(code.code)

            expect(result.valid).toBe(true)
            expect(result.codeInfo).not.toBeUndefined()
            expect(result.codeInfo!.code).toBe(code.code)
        })

        it('已使用的兑换码应验证失败', async () => {
            if (!dbAvailable) return

            const code = await createTestRedemptionCode({
                type: RedemptionCodeType.POINTS_ONLY,
                pointAmount: 100,
                status: RedemptionCodeStatus.USED,
            })
            testIds.redemptionCodeIds.push(code.id)

            const result = await validateRedemptionCodeService(code.code)

            expect(result.valid).toBe(false)
            expect(result.error).toContain('已被使用')
        })

        it('已作废的兑换码应验证失败', async () => {
            if (!dbAvailable) return

            const code = await createTestRedemptionCode({
                type: RedemptionCodeType.POINTS_ONLY,
                pointAmount: 100,
                status: RedemptionCodeStatus.INVALID,
            })
            testIds.redemptionCodeIds.push(code.id)

            const result = await validateRedemptionCodeService(code.code)

            expect(result.valid).toBe(false)
            expect(result.error).toContain('已作废')
        })

        it('已过期的兑换码应验证失败', async () => {
            if (!dbAvailable) return

            const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000)
            const code = await createTestRedemptionCode({
                type: RedemptionCodeType.POINTS_ONLY,
                pointAmount: 100,
                status: RedemptionCodeStatus.ACTIVE,
                expiredAt: pastDate,
            })
            testIds.redemptionCodeIds.push(code.id)

            const result = await validateRedemptionCodeService(code.code)

            expect(result.valid).toBe(false)
            expect(result.error).toContain('已过期')
        })

        it('不存在的兑换码应验证失败', async () => {
            if (!dbAvailable) return

            const result = await validateRedemptionCodeService('NOT-EXIST-CODE')

            expect(result.valid).toBe(false)
            expect(result.error).toContain('不存在')
        })

        it('Property: 只有 ACTIVE 状态的兑换码才能验证通过', async () => {
            if (!dbAvailable) return

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            await fc.assert(
                fc.asyncProperty(
                    fc.constantFrom(
                        RedemptionCodeStatus.ACTIVE,
                        RedemptionCodeStatus.USED,
                        RedemptionCodeStatus.EXPIRED,
                        RedemptionCodeStatus.INVALID
                    ),
                    async (status) => {
                        const code = await createTestRedemptionCode({
                            type: RedemptionCodeType.MEMBERSHIP_ONLY,
                            levelId: level.id,
                            duration: 30,
                            status,
                        })
                        testIds.redemptionCodeIds.push(code.id)

                        const result = await validateRedemptionCodeService(code.code)

                        if (status === RedemptionCodeStatus.ACTIVE) {
                            expect(result.valid).toBe(true)
                        } else {
                            expect(result.valid).toBe(false)
                        }

                        return true
                    }
                ),
                { numRuns: 4 }
            )
        })
    })

    describe('redeemCodeService 测试', () => {
        it('应成功兑换仅会员类型的兑换码', async () => {
            if (!dbAvailable) return

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const code = await createTestRedemptionCode({
                type: RedemptionCodeType.MEMBERSHIP_ONLY,
                levelId: level.id,
                duration: 30,
                status: RedemptionCodeStatus.ACTIVE,
            })
            testIds.redemptionCodeIds.push(code.id)

            const result = await redeemCodeService(user.id, code.code)

            expect(result.success).toBe(true)
            expect(result.membershipId).toBeDefined()
            expect(result.message).toContain('成功')

            // 验证兑换码状态已更新
            const updatedCode = await prisma.redemptionCodes.findUnique({
                where: { id: code.id },
            })
            expect(updatedCode?.status).toBe(RedemptionCodeStatus.USED)
        })

        it('应成功兑换仅积分类型的兑换码', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const code = await createTestRedemptionCode({
                type: RedemptionCodeType.POINTS_ONLY,
                pointAmount: 500,
                status: RedemptionCodeStatus.ACTIVE,
            })
            testIds.redemptionCodeIds.push(code.id)

            const result = await redeemCodeService(user.id, code.code)

            expect(result.success).toBe(true)
            expect(result.pointRecordId).toBeDefined()
            expect(result.message).toContain('成功')
        })

        it('应成功兑换会员和积分类型的兑换码', async () => {
            if (!dbAvailable) return

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const code = await createTestRedemptionCode({
                type: RedemptionCodeType.MEMBERSHIP_AND_POINTS,
                levelId: level.id,
                duration: 30,
                pointAmount: 500,
                status: RedemptionCodeStatus.ACTIVE,
            })
            testIds.redemptionCodeIds.push(code.id)

            const result = await redeemCodeService(user.id, code.code)

            expect(result.success).toBe(true)
            expect(result.membershipId).toBeDefined()
            expect(result.pointRecordId).toBeDefined()
            expect(result.message).toContain('成功')
        })

        it('无效兑换码应兑换失败', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const result = await redeemCodeService(user.id, 'NOT-EXIST-CODE')

            expect(result.success).toBe(false)
            expect(result.message).toContain('不存在')
        })

        it('已使用的兑换码应兑换失败', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const code = await createTestRedemptionCode({
                type: RedemptionCodeType.POINTS_ONLY,
                pointAmount: 100,
                status: RedemptionCodeStatus.USED,
            })
            testIds.redemptionCodeIds.push(code.id)

            const result = await redeemCodeService(user.id, code.code)

            expect(result.success).toBe(false)
            expect(result.message).toContain('已被使用')
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
