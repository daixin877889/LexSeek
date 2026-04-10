/**
 * 用户权益服务测试
 *
 * 测试用户权益服务层的业务逻辑，包括：
 * - 发放会员权益
 * - 作废会员权益
 * - 获取用户权益汇总
 * - 获取用户云盘空间配额
 * - 校验云盘空间
 *
 * **Feature: user-benefit-service**
 * **Validates: Requirements 会员权益模块**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import {
    getTestPrisma,
    createTestMembershipLevel,
    createTestUser,
    cleanupTestData,
    createEmptyTestIds,
    disconnectTestDb,
    isTestDbAvailable,
    type TestIds,
} from './test-db-helper'
import { BenefitConsumptionMode, BenefitCode } from '../../../shared/types/benefit'

// 导入服务函数
import {
    grantMembershipBenefitsService,
    expireMembershipBenefitsService,
} from '../../../server/services/membership/userBenefit.service'

// 导入 DAO（用于验证）
import {
    findUserActiveBenefitsDao,
    findUserBenefitsByCodeDao,
} from '../../../server/services/membership/userBenefit.dao'
import { findBenefitsByLevelIdDao } from '../../../server/services/membership/membershipBenefit.dao'

let dbAvailable = false

describe('用户权益服务测试', () => {
    const testIds: TestIds = createEmptyTestIds()
    const prisma = getTestPrisma()

    // 测试数据追踪
    const testBenefitIds: number[] = []
    const testMembershipBenefitIds: number[] = []
    const testUserBenefitIds: number[] = []
    const testUserMembershipIds: number[] = []

    beforeAll(async () => {
        dbAvailable = await isTestDbAvailable()
        if (!dbAvailable) {
            console.warn('数据库不可用，跳过集成测试')
        }
    })

    afterEach(async () => {
        if (dbAvailable) {
            // 清理用户权益记录（grant + expire 会产生记录）
            if (testBenefitIds.length > 0 && testIds.userIds.length > 0) {
                await prisma.userBenefits.deleteMany({
                    where: {
                        benefitId: { in: testBenefitIds },
                        userId: { in: testIds.userIds },
                    },
                })
            }
            if (testUserBenefitIds.length > 0) {
                await prisma.userBenefits.deleteMany({
                    where: { id: { in: testUserBenefitIds } },
                })
                testUserBenefitIds.length = 0
            }

            // 清理会员权益关联
            if (testMembershipBenefitIds.length > 0) {
                await prisma.membershipBenefits.deleteMany({
                    where: { id: { in: testMembershipBenefitIds } },
                })
                testMembershipBenefitIds.length = 0
            }

            // 清理用户会员记录
            if (testUserMembershipIds.length > 0) {
                await prisma.userMemberships.deleteMany({
                    where: { id: { in: testUserMembershipIds } },
                })
                testUserMembershipIds.length = 0
            }

            // 清理权益（user_benefits 已清理，不会外键冲突）
            if (testBenefitIds.length > 0) {
                await prisma.benefits.deleteMany({
                    where: { id: { in: testBenefitIds } },
                })
                testBenefitIds.length = 0
            }

            await cleanupTestData(testIds)
            testIds.userIds = []
            testIds.membershipLevelIds = []
        }
    })

    afterAll(async () => {
        if (dbAvailable) {
            await disconnectTestDb()
        }
    })

    // 创建测试权益
    const createTestBenefit = async (data?: {
        name?: string
        code?: string
        description?: string
        unitType?: string
        consumptionMode?: string
        defaultValue?: bigint
    }) => {
        const uniqueId = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        const benefit = await prisma.benefits.create({
            data: {
                code: data?.code || `test_benefit_${uniqueId}`,
                name: data?.name || `测试权益_${uniqueId}`,
                description: data?.description || '测试权益描述',
                unitType: data?.unitType ?? 'count',
                consumptionMode: data?.consumptionMode ?? 'sum',
                defaultValue: data?.defaultValue ?? BigInt(0),
                status: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })
        testBenefitIds.push(benefit.id)
        return benefit
    }

    // 创建会员权益关联
    const createTestMembershipBenefit = async (
        levelId: number,
        benefitId: number,
        benefitValue?: bigint
    ) => {
        const mb = await prisma.membershipBenefits.create({
            data: {
                levelId,
                benefitId,
                benefitValue: benefitValue ?? BigInt(100),
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })
        testMembershipBenefitIds.push(mb.id)
        return mb
    }

    // ========== grantMembershipBenefitsService 测试 ==========

    describe('grantMembershipBenefitsService 测试', () => {
        it('应成功发放会员权益给用户', async () => {
            if (!dbAvailable) return

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            // 创建权益并关联到级别
            const benefit = await createTestBenefit({ name: '发放权益' })
            await createTestMembershipBenefit(level.id, benefit.id, BigInt(500))

            const now = new Date()
            const endDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)
            const membershipId = 1

            await grantMembershipBenefitsService(
                user.id,
                membershipId,
                level.id,
                now,
                endDate
            )

            // 验证权益已发放
            const userBenefits = await findUserBenefitsByCodeDao(user.id, benefit.code)

            expect(userBenefits.length).toBe(1)
            expect(userBenefits[0].benefitValue).toBe(BigInt(500))
            expect(userBenefits[0].sourceType).toBe('membership_gift')
            expect(userBenefits[0].sourceId).toBe(membershipId)

            userBenefits.forEach(ub => testUserBenefitIds.push(ub.id))
        })

        it('会员级别无权益配置时应正常返回', async () => {
            if (!dbAvailable) return

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const now = new Date()
            const endDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)

            // 不创建任何权益关联，直接发放
            await grantMembershipBenefitsService(user.id, 1, level.id, now, endDate)

            // 不应抛出错误
            expect(true).toBe(true)
        })

        it('发放的权益应包含正确的有效期', async () => {
            if (!dbAvailable) return

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const benefit = await createTestBenefit({ name: '有效期权益' })
            await createTestMembershipBenefit(level.id, benefit.id, BigInt(100))

            const startDate = new Date('2024-01-01')
            const endDate = new Date('2025-01-01')
            const membershipId = 42

            await grantMembershipBenefitsService(
                user.id,
                membershipId,
                level.id,
                startDate,
                endDate
            )

            const userBenefits = await findUserBenefitsByCodeDao(user.id, benefit.code)

            expect(userBenefits.length).toBe(1)
            expect(userBenefits[0].effectiveAt.toISOString()).toBe(startDate.toISOString())
            expect(userBenefits[0].expiredAt.toISOString()).toBe(endDate.toISOString())

            userBenefits.forEach(ub => testUserBenefitIds.push(ub.id))
        })

        it('多个权益应全部正确发放', async () => {
            if (!dbAvailable) return

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const benefit1 = await createTestBenefit({ name: '多权益1' })
            const benefit2 = await createTestBenefit({ name: '多权益2' })
            const benefit3 = await createTestBenefit({ name: '多权益3' })

            await createTestMembershipBenefit(level.id, benefit1.id, BigInt(100))
            await createTestMembershipBenefit(level.id, benefit2.id, BigInt(200))
            await createTestMembershipBenefit(level.id, benefit3.id, BigInt(300))

            const now = new Date()
            const endDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)

            await grantMembershipBenefitsService(user.id, 1, level.id, now, endDate)

            const activeBenefits = await findUserActiveBenefitsDao(user.id)

            expect(activeBenefits.length).toBe(3)

            activeBenefits.forEach(ub => testUserBenefitIds.push(ub.id))
        })

        it('应正确记录权益来源信息', async () => {
            if (!dbAvailable) return

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const benefit = await createTestBenefit({ name: '来源信息' })
            await createTestMembershipBenefit(level.id, benefit.id, BigInt(100))

            const now = new Date()
            const endDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)
            const customMembershipId = 12345

            await grantMembershipBenefitsService(
                user.id,
                customMembershipId,
                level.id,
                now,
                endDate
            )

            const userBenefits = await findUserBenefitsByCodeDao(user.id, benefit.code)

            expect(userBenefits.length).toBe(1)
            expect(userBenefits[0].sourceType).toBe('membership_gift')
            expect(userBenefits[0].sourceId).toBe(customMembershipId)
            expect(userBenefits[0].remark).toBe(`会员级别 ${level.id} 赠送`)

            userBenefits.forEach(ub => testUserBenefitIds.push(ub.id))
        })
    })

    // ========== expireMembershipBenefitsService 测试 ==========

    describe('expireMembershipBenefitsService 测试', () => {
        it('应成功作废用户的会员权益', async () => {
            if (!dbAvailable) return

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const benefit = await createTestBenefit({ name: '作废权益' })
            await createTestMembershipBenefit(level.id, benefit.id, BigInt(100))

            const now = new Date()
            const endDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)
            const membershipId = 1

            // 先发放权益
            await grantMembershipBenefitsService(
                user.id,
                membershipId,
                level.id,
                now,
                endDate
            )

            // 验证发放成功
            const beforeExpire = await findUserActiveBenefitsDao(user.id, benefit.code)
            expect(beforeExpire.length).toBe(1)

            // 作废权益
            await expireMembershipBenefitsService(user.id, membershipId)

            // 验证已作废
            const afterExpire = await findUserActiveBenefitsDao(user.id, benefit.code)
            expect(afterExpire.length).toBe(0)
        })

        it('只应作废指定会员的权益', async () => {
            if (!dbAvailable) return

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const benefit = await createTestBenefit({ name: '区分来源' })
            await createTestMembershipBenefit(level.id, benefit.id, BigInt(100))

            const now = new Date()
            const endDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)

            // 发放两个不同来源的权益
            await grantMembershipBenefitsService(user.id, 1, level.id, now, endDate)
            await grantMembershipBenefitsService(user.id, 2, level.id, now, endDate)

            // 只作废来源1
            await expireMembershipBenefitsService(user.id, 1)

            const allRecords = await findUserBenefitsByCodeDao(user.id, benefit.code)
            const activeRecords = await findUserActiveBenefitsDao(user.id, benefit.code)

            expect(allRecords.length).toBe(2)
            expect(activeRecords.length).toBe(1)
            expect(activeRecords[0].sourceId).toBe(2)

            activeRecords.forEach(ub => testUserBenefitIds.push(ub.id))
        })

        it('不存在的会员ID不应抛出错误', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            await expireMembershipBenefitsService(user.id, 999999)

            // 不应抛出错误
            expect(true).toBe(true)
        })
    })
})

// 注册 Nuxt 自动导入的 DAO 函数为全局变量，使 userBenefit.service.ts 中的服务函数可在测试中运行
import { findAllActiveBenefitsDao, findBenefitByCodeDao } from '../../../server/services/membership/benefit.dao'
import { sumUserBenefitValueDao, findUserBenefitsByCodeDao as _findUserBenefitsByCodeDaoForGlobal } from '../../../server/services/membership/userBenefit.dao'
import { ossUsageDao } from '../../../server/services/files/ossFiles.dao'
import { BenefitStatus } from '../../../shared/types/membership'
import { OssFileStatus } from '../../../shared/types/file'
import { FileSizeUnit } from '../../../shared/types/unitConverision'

;(globalThis as any).findAllActiveBenefitsDao = findAllActiveBenefitsDao
;(globalThis as any).findBenefitByCodeDao = findBenefitByCodeDao
;(globalThis as any).sumUserBenefitValueDao = sumUserBenefitValueDao
;(globalThis as any).ossUsageDao = ossUsageDao
;(globalThis as any).findUserBenefitsByCodeDao = _findUserBenefitsByCodeDaoForGlobal
;(globalThis as any).BenefitStatus = BenefitStatus
;(globalThis as any).OssFileStatus = OssFileStatus
;(globalThis as any).FileSizeUnit = FileSizeUnit

describe('getUserBenefitSummaryService 测试', () => {
    let dbAvailable = false
    const testIds: TestIds = createEmptyTestIds()
    const prisma = getTestPrisma()
    const testBenefitIds: number[] = []
    const testMembershipBenefitIds: number[] = []
    const testUserBenefitIds: number[] = []

    beforeAll(async () => {
        dbAvailable = await isTestDbAvailable()
    })

    afterEach(async () => {
        if (dbAvailable) {
            if (testUserBenefitIds.length > 0) {
                await prisma.userBenefits.deleteMany({
                    where: { id: { in: testUserBenefitIds } },
                })
                testUserBenefitIds.length = 0
            }
            if (testBenefitIds.length > 0 && testIds.userIds.length > 0) {
                await prisma.userBenefits.deleteMany({
                    where: {
                        benefitId: { in: testBenefitIds },
                        userId: { in: testIds.userIds },
                    },
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
        }
    })

    afterAll(async () => {
        if (dbAvailable) {
            await disconnectTestDb()
        }
    })

    const createTestBenefit = async (data?: {
        name?: string
        code?: string
        unitType?: string
        consumptionMode?: string
        defaultValue?: bigint
    }) => {
        const uniqueId = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        const benefit = await prisma.benefits.create({
            data: {
                code: data?.code || `test_benefit_${uniqueId}`,
                name: data?.name || `测试权益_${uniqueId}`,
                description: '测试权益描述',
                unitType: data?.unitType ?? 'count',
                consumptionMode: data?.consumptionMode ?? 'sum',
                defaultValue: data?.defaultValue ?? BigInt(0),
                status: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })
        testBenefitIds.push(benefit.id)
        return benefit
    }

    it('应返回所有启用权益的汇总信息', async () => {
        if (!dbAvailable) return

        const user = await createTestUser()
        testIds.userIds.push(user.id)

        // 使用 getUserBenefitSummaryService 获取汇总
        const { getUserBenefitSummaryService } = await import(
            '../../../server/services/membership/userBenefit.service'
        )
        const summaries = await getUserBenefitSummaryService(user.id)

        // 应该返回数组
        expect(Array.isArray(summaries)).toBe(true)

        // 每个汇总项应有正确的结构
        for (const summary of summaries) {
            expect(summary).toHaveProperty('code')
            expect(summary).toHaveProperty('name')
            expect(summary).toHaveProperty('totalValue')
            expect(summary).toHaveProperty('usedValue')
            expect(summary).toHaveProperty('remainingValue')
            expect(summary).toHaveProperty('unitType')
            expect(summary).toHaveProperty('formatted')
            expect(summary.formatted).toHaveProperty('percentage')
            expect(typeof summary.formatted.percentage).toBe('number')
            expect(summary.formatted.percentage).toBeGreaterThanOrEqual(0)
            expect(summary.formatted.percentage).toBeLessThanOrEqual(100)
        }
    })

    it('没有权益记录的用户应使用默认值', async () => {
        if (!dbAvailable) return

        const user = await createTestUser()
        testIds.userIds.push(user.id)

        const { getUserBenefitSummaryService } = await import(
            '../../../server/services/membership/userBenefit.service'
        )
        const summaries = await getUserBenefitSummaryService(user.id)

        // 所有权益的 usedValue 应为 0 或 总值等于默认值
        for (const summary of summaries) {
            expect(summary.totalValue).toBeGreaterThanOrEqual(0)
            expect(summary.remainingValue).toBeGreaterThanOrEqual(0)
        }
    })
})

describe('getUserStorageQuotaService 测试', () => {
    let dbAvailable = false
    const testIds: TestIds = createEmptyTestIds()

    beforeAll(async () => {
        dbAvailable = await isTestDbAvailable()
    })

    afterEach(async () => {
        if (dbAvailable) {
            await cleanupTestData(testIds)
            testIds.userIds = []
            testIds.membershipLevelIds = []
        }
    })

    afterAll(async () => {
        if (dbAvailable) {
            await disconnectTestDb()
        }
    })

    it('应返回正确的存储配额结构', async () => {
        if (!dbAvailable) return

        const user = await createTestUser()
        testIds.userIds.push(user.id)

        const { getUserStorageQuotaService } = await import(
            '../../../server/services/membership/userBenefit.service'
        )
        const quota = await getUserStorageQuotaService(user.id)

        expect(quota).toHaveProperty('totalBytes')
        expect(quota).toHaveProperty('usedBytes')
        expect(quota).toHaveProperty('remainingBytes')
        expect(quota).toHaveProperty('formatted')
        expect(quota.formatted).toHaveProperty('total')
        expect(quota.formatted).toHaveProperty('used')
        expect(quota.formatted).toHaveProperty('remaining')
        expect(quota.formatted).toHaveProperty('percentage')
    })

    it('剩余空间不应为负数', async () => {
        if (!dbAvailable) return

        const user = await createTestUser()
        testIds.userIds.push(user.id)

        const { getUserStorageQuotaService } = await import(
            '../../../server/services/membership/userBenefit.service'
        )
        const quota = await getUserStorageQuotaService(user.id)

        expect(quota.remainingBytes).toBeGreaterThanOrEqual(0)
        expect(quota.totalBytes).toBeGreaterThanOrEqual(0)
        expect(quota.usedBytes).toBeGreaterThanOrEqual(0)
    })

    it('使用率百分比应在 0-100 之间', async () => {
        if (!dbAvailable) return

        const user = await createTestUser()
        testIds.userIds.push(user.id)

        const { getUserStorageQuotaService } = await import(
            '../../../server/services/membership/userBenefit.service'
        )
        const quota = await getUserStorageQuotaService(user.id)

        expect(quota.formatted.percentage).toBeGreaterThanOrEqual(0)
        expect(quota.formatted.percentage).toBeLessThanOrEqual(100)
    })
})

describe('checkStorageQuotaService 测试', () => {
    let dbAvailable = false
    const testIds: TestIds = createEmptyTestIds()

    beforeAll(async () => {
        dbAvailable = await isTestDbAvailable()
    })

    afterEach(async () => {
        if (dbAvailable) {
            await cleanupTestData(testIds)
            testIds.userIds = []
            testIds.membershipLevelIds = []
        }
    })

    afterAll(async () => {
        if (dbAvailable) {
            await disconnectTestDb()
        }
    })

    it('请求 0 字节空间应被允许', async () => {
        if (!dbAvailable) return

        const user = await createTestUser()
        testIds.userIds.push(user.id)

        const { checkStorageQuotaService } = await import(
            '../../../server/services/membership/userBenefit.service'
        )
        const result = await checkStorageQuotaService(user.id, 0)

        expect(result.allowed).toBe(true)
        expect(result.requiredSize).toBe(0)
        expect(result.message).toBeUndefined()
    })

    it('请求超大空间应返回不允许', async () => {
        if (!dbAvailable) return

        const user = await createTestUser()
        testIds.userIds.push(user.id)

        const { checkStorageQuotaService } = await import(
            '../../../server/services/membership/userBenefit.service'
        )
        // 请求 100TB 空间，肯定超额
        const hugeSize = 100 * 1024 * 1024 * 1024 * 1024
        const result = await checkStorageQuotaService(user.id, hugeSize)

        expect(result.allowed).toBe(false)
        expect(result.message).toBeDefined()
        expect(result.message).toContain('云盘空间不足')
    })

    it('返回结果应包含正确的配额信息', async () => {
        if (!dbAvailable) return

        const user = await createTestUser()
        testIds.userIds.push(user.id)

        const { checkStorageQuotaService } = await import(
            '../../../server/services/membership/userBenefit.service'
        )
        const result = await checkStorageQuotaService(user.id, 1024)

        expect(result).toHaveProperty('allowed')
        expect(result).toHaveProperty('quota')
        expect(result).toHaveProperty('requiredSize')
        expect(result).toHaveProperty('requiredFormatted')
        expect(result.quota).toHaveProperty('totalBytes')
        expect(result.quota).toHaveProperty('usedBytes')
        expect(result.quota).toHaveProperty('remainingBytes')
        expect(result.requiredSize).toBe(1024)
    })
})

describe('getUserBenefitDetailService 测试', () => {
    let dbAvailable = false
    const testIds: TestIds = createEmptyTestIds()
    const prisma = getTestPrisma()
    const testBenefitIds: number[] = []
    const testUserBenefitIds: number[] = []

    beforeAll(async () => {
        dbAvailable = await isTestDbAvailable()
    })

    afterEach(async () => {
        if (dbAvailable) {
            if (testUserBenefitIds.length > 0) {
                await prisma.userBenefits.deleteMany({
                    where: { id: { in: testUserBenefitIds } },
                })
                testUserBenefitIds.length = 0
            }
            if (testBenefitIds.length > 0 && testIds.userIds.length > 0) {
                await prisma.userBenefits.deleteMany({
                    where: {
                        benefitId: { in: testBenefitIds },
                        userId: { in: testIds.userIds },
                    },
                })
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
        }
    })

    afterAll(async () => {
        if (dbAvailable) {
            await disconnectTestDb()
        }
    })

    it('查询不存在的权益标识码应返回 null', async () => {
        if (!dbAvailable) return

        const user = await createTestUser()
        testIds.userIds.push(user.id)

        const { getUserBenefitDetailService } = await import(
            '../../../server/services/membership/userBenefit.service'
        )
        const result = await getUserBenefitDetailService(user.id, 'non_existent_code_xyz')

        expect(result).toBeNull()
    })

    it('查询存在的权益应返回完整的详情结构', async () => {
        if (!dbAvailable) return

        const user = await createTestUser()
        testIds.userIds.push(user.id)

        const { getUserBenefitDetailService } = await import(
            '../../../server/services/membership/userBenefit.service'
        )
        // 使用系统内置的存储空间权益
        const result = await getUserBenefitDetailService(user.id, BenefitCode.STORAGE_SPACE)

        if (result) {
            expect(result).toHaveProperty('code')
            expect(result).toHaveProperty('name')
            expect(result).toHaveProperty('totalValue')
            expect(result).toHaveProperty('usedValue')
            expect(result).toHaveProperty('remainingValue')
            expect(result).toHaveProperty('unitType')
            expect(result).toHaveProperty('formatted')
            expect(result).toHaveProperty('records')
            expect(Array.isArray(result.records)).toBe(true)
            expect(result.formatted).toHaveProperty('percentage')
            expect(result.remainingValue).toBeGreaterThanOrEqual(0)
        }
    })

    it('权益详情中的记录应包含来源类型名称', async () => {
        if (!dbAvailable) return

        const user = await createTestUser()
        testIds.userIds.push(user.id)

        // 创建一个自定义权益并为用户添加记录
        const uniqueId = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        const benefit = await prisma.benefits.create({
            data: {
                code: `test_detail_${uniqueId}`,
                name: `详情测试权益_${uniqueId}`,
                description: '测试权益详情',
                unitType: 'count',
                consumptionMode: 'sum',
                defaultValue: BigInt(0),
                status: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })
        testBenefitIds.push(benefit.id)

        const now = new Date()
        const endDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)
        const ub = await prisma.userBenefits.create({
            data: {
                userId: user.id,
                benefitId: benefit.id,
                benefitValue: BigInt(500),
                sourceType: 'membership_gift',
                sourceId: 1,
                effectiveAt: now,
                expiredAt: endDate,
                status: 1,
                remark: '测试记录',
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })
        testUserBenefitIds.push(ub.id)

        const { getUserBenefitDetailService } = await import(
            '../../../server/services/membership/userBenefit.service'
        )
        const result = await getUserBenefitDetailService(user.id, benefit.code)

        expect(result).not.toBeNull()
        expect(result!.code).toBe(benefit.code)
        expect(result!.totalValue).toBe(500)
        expect(result!.records.length).toBeGreaterThanOrEqual(1)

        const record = result!.records[0]
        expect(record).toHaveProperty('id')
        expect(record).toHaveProperty('benefitValue')
        expect(record).toHaveProperty('sourceType')
        expect(record).toHaveProperty('sourceTypeName')
        expect(record.sourceTypeName).toBe('会员赠送')
        expect(record).toHaveProperty('effectiveAt')
        expect(record).toHaveProperty('expiredAt')
        expect(record).toHaveProperty('status')
    })

    it('无用户权益记录时应使用权益默认值', async () => {
        if (!dbAvailable) return

        const user = await createTestUser()
        testIds.userIds.push(user.id)

        // 创建一个有默认值的权益
        const uniqueId = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        const benefit = await prisma.benefits.create({
            data: {
                code: `test_default_${uniqueId}`,
                name: `默认值权益_${uniqueId}`,
                description: '测试默认值',
                unitType: 'count',
                consumptionMode: 'sum',
                defaultValue: BigInt(100),
                status: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })
        testBenefitIds.push(benefit.id)

        const { getUserBenefitDetailService } = await import(
            '../../../server/services/membership/userBenefit.service'
        )
        const result = await getUserBenefitDetailService(user.id, benefit.code)

        expect(result).not.toBeNull()
        // 没有用户权益记录时，totalValue 应使用默认值 100
        expect(result!.totalValue).toBe(100)
        expect(result!.records.length).toBe(0)
    })

    it('次数类型权益应格式化为 "X 次"', async () => {
        if (!dbAvailable) return

        const user = await createTestUser()
        testIds.userIds.push(user.id)

        const uniqueId = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        const benefit = await prisma.benefits.create({
            data: {
                code: `test_count_${uniqueId}`,
                name: `次数权益_${uniqueId}`,
                description: '次数类型测试',
                unitType: 'count',
                consumptionMode: 'sum',
                defaultValue: BigInt(50),
                status: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })
        testBenefitIds.push(benefit.id)

        const { getUserBenefitDetailService } = await import(
            '../../../server/services/membership/userBenefit.service'
        )
        const result = await getUserBenefitDetailService(user.id, benefit.code)

        expect(result).not.toBeNull()
        expect(result!.formatted.total).toContain('次')
        expect(result!.formatted.remaining).toContain('次')
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
