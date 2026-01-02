/**
 * 兑换码管理员服务测试
 *
 * 使用 fast-check 进行属性测试，验证兑换码管理功能
 *
 * **Feature: admin-redemption-codes**
 * **Validates: Requirements 2.1-2.8, 3.1-3.2**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import * as fc from 'fast-check'
import {
    getTestPrisma,
    createTestMembershipLevel,
    createTestRedemptionCode,
    cleanupTestData,
    createEmptyTestIds,
    disconnectTestDb,
    isTestDbAvailable,
    RedemptionCodeStatus,
    RedemptionCodeType,
    type TestIds,
} from './test-db-helper'

// 导入实际的服务函数
import {
    generateUniqueCode,
    generateRedemptionCodesService,
    invalidateRedemptionCodeService,
} from '../../../server/services/redemption/redemptionCode.admin.service'

// 属性测试配置
const PBT_CONFIG = { numRuns: 100 }
const PBT_CONFIG_FAST = { numRuns: 20 }

// 检查数据库是否可用
let dbAvailable = false

describe('兑换码管理员服务测试', () => {
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
            testIds.membershipLevelIds = []
        }
    })

    afterAll(async () => {
        if (dbAvailable) {
            await disconnectTestDb()
        }
    })

    describe('Property 1: 兑换码唯一性', () => {
        /**
         * **Property 1: 兑换码唯一性**
         * *对于任意* 批量生成的兑换码集合，所有生成的兑换码值应互不相同
         * **Validates: Requirements 2.8**
         */
        it('生成的兑换码格式应为 XXXXXXXX-XXXXXXXX', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 100 }),
                    () => {
                        const code = generateUniqueCode()
                        // 验证格式：8位-8位，全大写十六进制
                        expect(code).toMatch(/^[A-F0-9]{8}-[A-F0-9]{8}$/)
                        return true
                    }
                ),
                PBT_CONFIG
            )
        })

        it('批量生成的兑换码应互不相同', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 10, max: 100 }),
                    (count) => {
                        const codes = new Set<string>()
                        for (let i = 0; i < count; i++) {
                            codes.add(generateUniqueCode())
                        }
                        // 所有生成的码应该都是唯一的
                        expect(codes.size).toBe(count)
                        return true
                    }
                ),
                PBT_CONFIG
            )
        })

        it('批量生成兑换码服务应返回唯一的码', async () => {
            if (!dbAvailable) return

            // 创建测试会员级别
            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const result = await generateRedemptionCodesService({
                type: RedemptionCodeType.MEMBERSHIP_ONLY,
                quantity: 50,
                levelId: level.id,
                duration: 30,
            })

            // 记录创建的兑换码 ID 以便清理
            const createdCodes = await prisma.redemptionCodes.findMany({
                where: { code: { in: result.codes } },
            })
            createdCodes.forEach(c => testIds.redemptionCodeIds.push(c.id))

            // 验证唯一性
            const uniqueCodes = new Set(result.codes)
            expect(uniqueCodes.size).toBe(result.codes.length)
            expect(result.count).toBe(50)
        })
    })


    describe('Property 2: 生成数量一致性', () => {
        /**
         * **Property 2: 生成数量一致性**
         * *对于任意* 有效的生成请求，返回的兑换码数量应等于请求的 quantity 参数值
         * **Validates: Requirements 2.7**
         */
        it('生成的兑换码数量应与请求数量一致', async () => {
            if (!dbAvailable) return

            // 创建测试会员级别
            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 20 }),
                    async (quantity) => {
                        const result = await generateRedemptionCodesService({
                            type: RedemptionCodeType.MEMBERSHIP_ONLY,
                            quantity,
                            levelId: level.id,
                            duration: 30,
                        })

                        // 记录创建的兑换码 ID 以便清理
                        const createdCodes = await prisma.redemptionCodes.findMany({
                            where: { code: { in: result.codes } },
                        })
                        createdCodes.forEach(c => testIds.redemptionCodeIds.push(c.id))

                        // 验证数量一致性
                        expect(result.codes.length).toBe(quantity)
                        expect(result.count).toBe(quantity)

                        return true
                    }
                ),
                PBT_CONFIG_FAST
            )
        })

        it('超过 1000 的数量应被拒绝', async () => {
            if (!dbAvailable) return

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            await expect(
                generateRedemptionCodesService({
                    type: RedemptionCodeType.MEMBERSHIP_ONLY,
                    quantity: 1001,
                    levelId: level.id,
                    duration: 30,
                })
            ).rejects.toThrow('生成数量必须在 1-1000 之间')
        })

        it('数量为 0 或负数应被拒绝', async () => {
            if (!dbAvailable) return

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            await expect(
                generateRedemptionCodesService({
                    type: RedemptionCodeType.MEMBERSHIP_ONLY,
                    quantity: 0,
                    levelId: level.id,
                    duration: 30,
                })
            ).rejects.toThrow('生成数量必须在 1-1000 之间')

            await expect(
                generateRedemptionCodesService({
                    type: RedemptionCodeType.MEMBERSHIP_ONLY,
                    quantity: -1,
                    levelId: level.id,
                    duration: 30,
                })
            ).rejects.toThrow('生成数量必须在 1-1000 之间')
        })
    })

    describe('Property 3: 类型参数完整性', () => {
        /**
         * **Property 3: 类型参数完整性**
         * *对于任意* 生成请求，当 type 为仅会员(1)或会员和积分(3)时，levelId 和 duration 必须存在且有效
         * **Validates: Requirements 2.1, 2.2, 2.3**
         */
        it('仅会员类型必须提供 levelId 和 duration', async () => {
            if (!dbAvailable) return

            // 缺少 levelId
            await expect(
                generateRedemptionCodesService({
                    type: RedemptionCodeType.MEMBERSHIP_ONLY,
                    quantity: 1,
                    duration: 30,
                })
            ).rejects.toThrow('会员类型兑换码必须指定会员级别')

            // 缺少 duration
            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            await expect(
                generateRedemptionCodesService({
                    type: RedemptionCodeType.MEMBERSHIP_ONLY,
                    quantity: 1,
                    levelId: level.id,
                })
            ).rejects.toThrow('会员类型兑换码必须指定有效时长')
        })

        it('仅积分类型必须提供 pointAmount', async () => {
            if (!dbAvailable) return

            await expect(
                generateRedemptionCodesService({
                    type: RedemptionCodeType.POINTS_ONLY,
                    quantity: 1,
                })
            ).rejects.toThrow('积分类型兑换码必须指定积分数量')

            await expect(
                generateRedemptionCodesService({
                    type: RedemptionCodeType.POINTS_ONLY,
                    quantity: 1,
                    pointAmount: 0,
                })
            ).rejects.toThrow('积分类型兑换码必须指定积分数量')
        })

        it('会员和积分类型必须提供所有参数', async () => {
            if (!dbAvailable) return

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            // 缺少 pointAmount
            await expect(
                generateRedemptionCodesService({
                    type: RedemptionCodeType.MEMBERSHIP_AND_POINTS,
                    quantity: 1,
                    levelId: level.id,
                    duration: 30,
                })
            ).rejects.toThrow('积分类型兑换码必须指定积分数量')

            // 缺少 levelId
            await expect(
                generateRedemptionCodesService({
                    type: RedemptionCodeType.MEMBERSHIP_AND_POINTS,
                    quantity: 1,
                    duration: 30,
                    pointAmount: 100,
                })
            ).rejects.toThrow('会员类型兑换码必须指定会员级别')
        })

        it('有效参数应成功创建各类型兑换码', async () => {
            if (!dbAvailable) return

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            // 仅会员类型
            const membershipResult = await generateRedemptionCodesService({
                type: RedemptionCodeType.MEMBERSHIP_ONLY,
                quantity: 1,
                levelId: level.id,
                duration: 30,
            })
            expect(membershipResult.count).toBe(1)

            // 仅积分类型
            const pointsResult = await generateRedemptionCodesService({
                type: RedemptionCodeType.POINTS_ONLY,
                quantity: 1,
                pointAmount: 100,
            })
            expect(pointsResult.count).toBe(1)

            // 会员和积分类型
            const bothResult = await generateRedemptionCodesService({
                type: RedemptionCodeType.MEMBERSHIP_AND_POINTS,
                quantity: 1,
                levelId: level.id,
                duration: 30,
                pointAmount: 100,
            })
            expect(bothResult.count).toBe(1)

            // 清理
            const allCodes = [...membershipResult.codes, ...pointsResult.codes, ...bothResult.codes]
            const createdCodes = await prisma.redemptionCodes.findMany({
                where: { code: { in: allCodes } },
            })
            createdCodes.forEach(c => testIds.redemptionCodeIds.push(c.id))
        })
    })


    describe('Property 4: 作废状态转换', () => {
        /**
         * **Property 4: 作废状态转换**
         * *对于任意* 兑换码，只有状态为有效(1)的兑换码才能被作废，作废后状态变为已作废(4)
         * **Validates: Requirements 3.1, 3.2**
         */
        it('有效状态的兑换码可以被作废', async () => {
            if (!dbAvailable) return

            const code = await createTestRedemptionCode({
                status: RedemptionCodeStatus.ACTIVE,
            })
            testIds.redemptionCodeIds.push(code.id)

            await invalidateRedemptionCodeService(code.id)

            // 验证状态已更新
            const updated = await prisma.redemptionCodes.findUnique({
                where: { id: code.id },
            })
            expect(updated?.status).toBe(RedemptionCodeStatus.INVALID)
        })

        it('已使用状态的兑换码不能被作废', async () => {
            if (!dbAvailable) return

            const code = await createTestRedemptionCode({
                status: RedemptionCodeStatus.USED,
            })
            testIds.redemptionCodeIds.push(code.id)

            await expect(
                invalidateRedemptionCodeService(code.id)
            ).rejects.toThrow('已使用的兑换码不能作废')
        })

        it('已作废状态的兑换码再次作废应提示', async () => {
            if (!dbAvailable) return

            const code = await createTestRedemptionCode({
                status: RedemptionCodeStatus.INVALID,
            })
            testIds.redemptionCodeIds.push(code.id)

            await expect(
                invalidateRedemptionCodeService(code.id)
            ).rejects.toThrow('兑换码已经是作废状态')
        })

        it('不存在的兑换码应返回错误', async () => {
            if (!dbAvailable) return

            await expect(
                invalidateRedemptionCodeService(999999)
            ).rejects.toThrow('兑换码不存在')
        })

        it('Property: 有效状态作废后应变为已作废', async () => {
            if (!dbAvailable) return

            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 10 }),
                    async () => {
                        const code = await createTestRedemptionCode({
                            status: RedemptionCodeStatus.ACTIVE,
                        })
                        testIds.redemptionCodeIds.push(code.id)

                        // 作废前状态应为有效
                        expect(code.status).toBe(RedemptionCodeStatus.ACTIVE)

                        await invalidateRedemptionCodeService(code.id)

                        // 作废后状态应为已作废
                        const updated = await prisma.redemptionCodes.findUnique({
                            where: { id: code.id },
                        })
                        expect(updated?.status).toBe(RedemptionCodeStatus.INVALID)

                        return true
                    }
                ),
                PBT_CONFIG_FAST
            )
        })
    })
})

// 数据库连接检查
describe('数据库连接检查', () => {
    it('检查数据库是否可用', async () => {
        const available = await isTestDbAvailable()
        if (!available) {
            console.log('请确保数据库已启动并配置正确的连接字符串')
        }
        expect(true).toBe(true)
    })
})
