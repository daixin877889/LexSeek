/**
 * 会员升级结算测试
 *
 * 使用 fast-check 进行属性测试，验证会员升级结算逻辑的正确性
 *
 * **Feature: membership-upgrade-settlement**
 * **Validates: Requirements 1-8, Properties 1-7**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import * as fc from 'fast-check'
import {
    getTestPrisma,
    createTestUser,
    createTestMembershipLevel,
    createTestUserMembership,
    createTestPointRecord,
    createTestProduct,
    createTestOrder,
    cleanupTestData,
    cleanupAllTestData,
    createEmptyTestIds,
    disconnectTestDb,
    isTestDbAvailable,
    resetDatabaseSequences,
    MembershipStatus,
    MembershipLevelStatus,
    UserMembershipSourceType,
    PointRecordStatus,
    type TestIds,
} from './test-db-helper'
import { PBT_CONFIG_FAST } from './test-generators'

// 导入实际的服务函数
import { executeMembershipUpgradeService } from '../../../server/services/membership/membershipUpgrade.service'
import { findUserMembershipByIdDao } from '../../../server/services/membership/userMembership.dao'
import { findPointRecordByIdDao, findPointRecordsByMembershipIdDao } from '../../../server/services/point/pointRecords.dao'
import { findMembershipUpgradeRecordByIdDao } from '../../../server/services/membership/membershipUpgrade.dao'

// 导入类型
import { PointRecordSourceType } from '../../../shared/types/point.types'
import type { UpgradeDetails } from '../../../shared/types/membership'

// 测试数据 ID 追踪
let testIds: TestIds

// 数据库连接
const prisma = getTestPrisma()

// 检查数据库是否可用
let dbAvailable = false


describe('会员升级结算属性测试', () => {
    testIds = createEmptyTestIds()

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
            await cleanupTestData(testIds)
            // 重置所有 ID 数组
            Object.keys(testIds).forEach(key => {
                (testIds as any)[key] = []
            })
        }
    })

    afterAll(async () => {
        if (dbAvailable) {
            // 最终清理：使用前缀匹配清理所有测试数据
            await cleanupAllTestData()
            await disconnectTestDb()
        }
    })

    // ==================== Property 1: 会员记录结算正确性 ====================
    describe('Property 1: 会员记录结算正确性', () => {
        it('正常升级场景：旧会员 endDate 应等于结算日期前一天，status 应为 2（已结算）', async () => {
            if (!dbAvailable) return

            // 创建测试数据
            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const currentLevel = await createTestMembershipLevel({ sortOrder: 1 })
            const targetLevel = await createTestMembershipLevel({ sortOrder: 2 })
            testIds.membershipLevelIds.push(currentLevel.id, targetLevel.id)

            const now = new Date()
            const originalEndDate = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000)

            const oldMembership = await createTestUserMembership(user.id, currentLevel.id, {
                startDate: now,
                endDate: originalEndDate,
                status: MembershipStatus.ACTIVE,
                sourceType: UserMembershipSourceType.DIRECT_PURCHASE,
            })
            testIds.userMembershipIds.push(oldMembership.id)

            // 创建产品和订单
            const product = await createTestProduct(targetLevel.id, { priceYearly: 999 })
            testIds.productIds.push(product.id)
            const order = await createTestOrder(user.id, product.id, { amount: 500 })
            testIds.orderIds.push(order.id)

            // 执行升级
            const beforeUpgrade = new Date()
            const result = await executeMembershipUpgradeService(user.id, targetLevel.id, order.id, order.orderNo)

            expect(result.success).toBe(true)
            expect(result.newMembership).toBeDefined()
            testIds.userMembershipIds.push(result.newMembership!.id)

            // 验证旧会员记录
            const updatedOldMembership = await findUserMembershipByIdDao(oldMembership.id)
            expect(updatedOldMembership).not.toBeNull()
            expect(updatedOldMembership!.status).toBe(2) // SETTLED
            // 正常升级场景：endDate 应该等于结算日期前一天
            // 由于结算日期是当前时间，endDate 应该是昨天
            const expectedEndDate = new Date(beforeUpgrade)
            expectedEndDate.setDate(expectedEndDate.getDate() - 1)
            // 只比较日期部分（忽略时间）
            const actualEndDateStr = updatedOldMembership!.endDate.toISOString().split('T')[0]
            const expectedEndDateStr = expectedEndDate.toISOString().split('T')[0]
            expect(actualEndDateStr).toBe(expectedEndDateStr)
            // 验证 settlementAt 已记录
            expect(updatedOldMembership!.settlementAt).not.toBeNull()
        })


        it('新会员 startDate 应等于结算日期，endDate 应等于旧会员原 endDate', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const currentLevel = await createTestMembershipLevel({ sortOrder: 1 })
            const targetLevel = await createTestMembershipLevel({ sortOrder: 2 })
            testIds.membershipLevelIds.push(currentLevel.id, targetLevel.id)

            const now = new Date()
            const originalEndDate = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000)

            const oldMembership = await createTestUserMembership(user.id, currentLevel.id, {
                startDate: now,
                endDate: originalEndDate,
                status: MembershipStatus.ACTIVE,
            })
            testIds.userMembershipIds.push(oldMembership.id)

            const product = await createTestProduct(targetLevel.id)
            testIds.productIds.push(product.id)
            const order = await createTestOrder(user.id, product.id)
            testIds.orderIds.push(order.id)

            const beforeUpgrade = new Date()
            const result = await executeMembershipUpgradeService(user.id, targetLevel.id, order.id, order.orderNo)

            expect(result.success).toBe(true)
            testIds.userMembershipIds.push(result.newMembership!.id)

            // 验证新会员记录
            const newMembership = await findUserMembershipByIdDao(result.newMembership!.id)
            expect(newMembership).not.toBeNull()
            expect(newMembership!.status).toBe(MembershipStatus.ACTIVE)
            // startDate 应该在升级前后之间
            expect(newMembership!.startDate.getTime()).toBeGreaterThanOrEqual(beforeUpgrade.getTime() - 1000)
            // endDate 应该等于旧会员原 endDate
            expect(newMembership!.endDate.getTime()).toBe(originalEndDate.getTime())
        })
    })


    // ==================== Property 2: 积分记录结算正确性 ====================
    describe('Property 2: 积分记录结算正确性', () => {
        it('旧积分记录 status 应为 2，remaining 应为 0，transferOut 应等于结算前的 remaining', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const currentLevel = await createTestMembershipLevel({ sortOrder: 1 })
            const targetLevel = await createTestMembershipLevel({ sortOrder: 2 })
            testIds.membershipLevelIds.push(currentLevel.id, targetLevel.id)

            const now = new Date()
            const endDate = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000)

            const oldMembership = await createTestUserMembership(user.id, currentLevel.id, {
                startDate: now,
                endDate,
                status: MembershipStatus.ACTIVE,
            })
            testIds.userMembershipIds.push(oldMembership.id)

            // 创建积分记录
            const pointRecord1 = await createTestPointRecord(user.id, {
                pointAmount: 100,
                remaining: 80,
                userMembershipId: oldMembership.id,
                status: PointRecordStatus.VALID,
                expiredAt: endDate,
            })
            const pointRecord2 = await createTestPointRecord(user.id, {
                pointAmount: 200,
                remaining: 150,
                userMembershipId: oldMembership.id,
                status: PointRecordStatus.VALID,
                expiredAt: endDate,
            })
            testIds.pointRecordIds.push(pointRecord1.id, pointRecord2.id)

            const product = await createTestProduct(targetLevel.id)
            testIds.productIds.push(product.id)
            const order = await createTestOrder(user.id, product.id)
            testIds.orderIds.push(order.id)

            const result = await executeMembershipUpgradeService(user.id, targetLevel.id, order.id, order.orderNo)
            expect(result.success).toBe(true)
            testIds.userMembershipIds.push(result.newMembership!.id)

            // 验证旧积分记录
            const updatedRecord1 = await findPointRecordByIdDao(pointRecord1.id)
            const updatedRecord2 = await findPointRecordByIdDao(pointRecord2.id)

            expect(updatedRecord1!.status).toBe(PointRecordStatus.MEMBERSHIP_UPGRADE_SETTLEMENT)
            expect(updatedRecord1!.remaining).toBe(0)
            expect(updatedRecord1!.transferOut).toBe(80)

            expect(updatedRecord2!.status).toBe(PointRecordStatus.MEMBERSHIP_UPGRADE_SETTLEMENT)
            expect(updatedRecord2!.remaining).toBe(0)
            expect(updatedRecord2!.transferOut).toBe(150)
        })
    })


    // ==================== Property 3: 转入积分记录正确性 ====================
    describe('Property 3: 转入积分记录正确性', () => {
        it('转入积分记录 pointAmount 应等于旧积分 remaining 之和', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const currentLevel = await createTestMembershipLevel({ sortOrder: 1 })
            const targetLevel = await createTestMembershipLevel({ sortOrder: 2 })
            testIds.membershipLevelIds.push(currentLevel.id, targetLevel.id)

            const now = new Date()
            const endDate = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000)

            const oldMembership = await createTestUserMembership(user.id, currentLevel.id, {
                startDate: now,
                endDate,
                status: MembershipStatus.ACTIVE,
            })
            testIds.userMembershipIds.push(oldMembership.id)

            // 创建积分记录
            const remaining1 = 80
            const remaining2 = 150
            const totalRemaining = remaining1 + remaining2

            const pointRecord1 = await createTestPointRecord(user.id, {
                pointAmount: 100,
                remaining: remaining1,
                userMembershipId: oldMembership.id,
                status: PointRecordStatus.VALID,
                expiredAt: endDate,
            })
            const pointRecord2 = await createTestPointRecord(user.id, {
                pointAmount: 200,
                remaining: remaining2,
                userMembershipId: oldMembership.id,
                status: PointRecordStatus.VALID,
                expiredAt: endDate,
            })
            testIds.pointRecordIds.push(pointRecord1.id, pointRecord2.id)

            const product = await createTestProduct(targetLevel.id)
            testIds.productIds.push(product.id)
            const order = await createTestOrder(user.id, product.id)
            testIds.orderIds.push(order.id)

            const result = await executeMembershipUpgradeService(user.id, targetLevel.id, order.id, order.orderNo)
            expect(result.success).toBe(true)
            testIds.userMembershipIds.push(result.newMembership!.id)

            // 查询新会员关联的积分记录
            const newPointRecords = await findPointRecordsByMembershipIdDao(result.newMembership!.id)

            // 找到转入积分记录（sourceType = 10）
            const transferRecord = newPointRecords.find(
                r => r.sourceType === PointRecordSourceType.MEMBERSHIP_UPGRADE_TRANSFER
            )

            expect(transferRecord).toBeDefined()
            expect(transferRecord!.pointAmount).toBe(totalRemaining)
            expect(transferRecord!.remaining).toBe(totalRemaining)
            expect(transferRecord!.status).toBe(PointRecordStatus.VALID)

            // 记录新创建的积分记录 ID
            newPointRecords.forEach(r => testIds.pointRecordIds.push(r.id))
        })
    })


    // ==================== Property 4: 补偿积分记录正确性 ====================
    describe('Property 4: 补偿积分记录正确性', () => {
        it('补偿积分记录 remark 应包含订单号', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const currentLevel = await createTestMembershipLevel({ sortOrder: 1 })
            const targetLevel = await createTestMembershipLevel({ sortOrder: 2 })
            testIds.membershipLevelIds.push(currentLevel.id, targetLevel.id)

            const now = new Date()
            const endDate = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000)

            // 创建有实付金额的会员（通过订单关联）
            const currentProduct = await createTestProduct(currentLevel.id, { priceYearly: 365 })
            testIds.productIds.push(currentProduct.id)
            const currentOrder = await createTestOrder(user.id, currentProduct.id, { amount: 365, status: 1 })
            testIds.orderIds.push(currentOrder.id)

            const oldMembership = await createTestUserMembership(user.id, currentLevel.id, {
                startDate: now,
                endDate,
                status: MembershipStatus.ACTIVE,
                sourceType: UserMembershipSourceType.DIRECT_PURCHASE,
                sourceId: currentOrder.id,
            })
            testIds.userMembershipIds.push(oldMembership.id)

            const targetProduct = await createTestProduct(targetLevel.id, { priceYearly: 999 })
            testIds.productIds.push(targetProduct.id)
            const upgradeOrder = await createTestOrder(user.id, targetProduct.id, { amount: 500 })
            testIds.orderIds.push(upgradeOrder.id)

            const result = await executeMembershipUpgradeService(user.id, targetLevel.id, upgradeOrder.id, upgradeOrder.orderNo)
            expect(result.success).toBe(true)
            testIds.userMembershipIds.push(result.newMembership!.id)

            // 查询新会员关联的积分记录
            const newPointRecords = await findPointRecordsByMembershipIdDao(result.newMembership!.id)

            // 找到补偿积分记录（sourceType = 9）
            const compensationRecord = newPointRecords.find(
                r => r.sourceType === PointRecordSourceType.MEMBERSHIP_UPGRADE_COMPENSATION
            )

            // 如果有补偿积分，验证 remark 包含订单号
            if (compensationRecord) {
                expect(compensationRecord.remark).toContain(upgradeOrder.orderNo)
                testIds.pointRecordIds.push(compensationRecord.id)
            }

            // 记录其他新创建的积分记录 ID
            newPointRecords.forEach(r => {
                if (!testIds.pointRecordIds.includes(r.id)) {
                    testIds.pointRecordIds.push(r.id)
                }
            })
        })
    })


    // ==================== Property 5: 升级记录正确性 ====================
    describe('Property 5: 升级记录正确性', () => {
        it('升级记录应包含正确的 transferPoints 和 details JSON', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const currentLevel = await createTestMembershipLevel({ sortOrder: 1, name: '测试级别_基础' })
            const targetLevel = await createTestMembershipLevel({ sortOrder: 2, name: '测试级别_高级' })
            testIds.membershipLevelIds.push(currentLevel.id, targetLevel.id)

            const now = new Date()
            const endDate = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000)

            const oldMembership = await createTestUserMembership(user.id, currentLevel.id, {
                startDate: now,
                endDate,
                status: MembershipStatus.ACTIVE,
            })
            testIds.userMembershipIds.push(oldMembership.id)

            // 创建积分记录
            const remaining1 = 80
            const remaining2 = 150
            const totalRemaining = remaining1 + remaining2

            const pointRecord1 = await createTestPointRecord(user.id, {
                pointAmount: 100,
                remaining: remaining1,
                userMembershipId: oldMembership.id,
                status: PointRecordStatus.VALID,
                expiredAt: endDate,
            })
            const pointRecord2 = await createTestPointRecord(user.id, {
                pointAmount: 200,
                remaining: remaining2,
                userMembershipId: oldMembership.id,
                status: PointRecordStatus.VALID,
                expiredAt: endDate,
            })
            testIds.pointRecordIds.push(pointRecord1.id, pointRecord2.id)

            const product = await createTestProduct(targetLevel.id)
            testIds.productIds.push(product.id)
            const order = await createTestOrder(user.id, product.id)
            testIds.orderIds.push(order.id)

            const result = await executeMembershipUpgradeService(user.id, targetLevel.id, order.id, order.orderNo)
            expect(result.success).toBe(true)
            testIds.userMembershipIds.push(result.newMembership!.id)

            // 查询升级记录
            const upgradeRecords = await prisma.membershipUpgradeRecords.findMany({
                where: {
                    userId: user.id,
                    fromMembershipId: oldMembership.id,
                    toMembershipId: result.newMembership!.id,
                },
            })

            expect(upgradeRecords.length).toBe(1)
            const upgradeRecord = upgradeRecords[0]
            testIds.membershipUpgradeRecordIds.push(upgradeRecord.id)

            // 验证 transferPoints
            expect(upgradeRecord.transferPoints).toBe(totalRemaining)

            // 验证 details JSON
            expect(upgradeRecord.details).not.toBeNull()
            const details = upgradeRecord.details as UpgradeDetails

            expect(details.oldMembership.id).toBe(oldMembership.id)
            expect(details.oldMembership.levelId).toBe(currentLevel.id)
            expect(details.newMembership.id).toBe(result.newMembership!.id)
            expect(details.newMembership.levelId).toBe(targetLevel.id)
            expect(details.oldPointRecords.length).toBe(2)
            expect(details.newPointRecords.transferRecordId).not.toBeNull()

            // 清理新创建的积分记录
            const newPointRecords = await findPointRecordsByMembershipIdDao(result.newMembership!.id)
            newPointRecords.forEach(r => testIds.pointRecordIds.push(r.id))
        })
    })


    // ==================== Property 6: 积分总量守恒 ====================
    describe('Property 6: 积分总量守恒', () => {
        it('旧积分记录的 transferOut 之和应等于转入积分记录的 pointAmount', async () => {
            if (!dbAvailable) return

            await fc.assert(
                fc.asyncProperty(
                    fc.array(fc.integer({ min: 1, max: 500 }), { minLength: 1, maxLength: 5 }),
                    async (remainingAmounts) => {
                        const user = await createTestUser()
                        testIds.userIds.push(user.id)

                        const currentLevel = await createTestMembershipLevel({ sortOrder: 1 })
                        const targetLevel = await createTestMembershipLevel({ sortOrder: 2 })
                        testIds.membershipLevelIds.push(currentLevel.id, targetLevel.id)

                        const now = new Date()
                        const endDate = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000)

                        const oldMembership = await createTestUserMembership(user.id, currentLevel.id, {
                            startDate: now,
                            endDate,
                            status: MembershipStatus.ACTIVE,
                        })
                        testIds.userMembershipIds.push(oldMembership.id)

                        // 创建多个积分记录
                        const totalRemaining = remainingAmounts.reduce((sum, r) => sum + r, 0)
                        for (const remaining of remainingAmounts) {
                            const record = await createTestPointRecord(user.id, {
                                pointAmount: remaining + 50,
                                remaining,
                                userMembershipId: oldMembership.id,
                                status: PointRecordStatus.VALID,
                                expiredAt: endDate,
                            })
                            testIds.pointRecordIds.push(record.id)
                        }

                        const product = await createTestProduct(targetLevel.id)
                        testIds.productIds.push(product.id)
                        const order = await createTestOrder(user.id, product.id)
                        testIds.orderIds.push(order.id)

                        const result = await executeMembershipUpgradeService(user.id, targetLevel.id, order.id, order.orderNo)
                        expect(result.success).toBe(true)
                        testIds.userMembershipIds.push(result.newMembership!.id)

                        // 查询转入积分记录
                        const newPointRecords = await findPointRecordsByMembershipIdDao(result.newMembership!.id)
                        const transferRecord = newPointRecords.find(
                            r => r.sourceType === PointRecordSourceType.MEMBERSHIP_UPGRADE_TRANSFER
                        )

                        // 验证积分总量守恒
                        expect(transferRecord).toBeDefined()
                        expect(transferRecord!.pointAmount).toBe(totalRemaining)

                        // 清理
                        newPointRecords.forEach(r => testIds.pointRecordIds.push(r.id))
                        const upgradeRecords = await prisma.membershipUpgradeRecords.findMany({
                            where: { userId: user.id },
                        })
                        upgradeRecords.forEach(r => testIds.membershipUpgradeRecordIds.push(r.id))

                        return true
                    }
                ),
                { numRuns: 10 } // 减少运行次数，避免测试时间过长
            )
        })
    })


    // ==================== Property 7: 状态过滤正确性 ====================
    describe('Property 7: 状态过滤正确性', () => {
        it('查询有效积分时应只返回 status = 1 的记录', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const currentLevel = await createTestMembershipLevel({ sortOrder: 1 })
            const targetLevel = await createTestMembershipLevel({ sortOrder: 2 })
            testIds.membershipLevelIds.push(currentLevel.id, targetLevel.id)

            const now = new Date()
            const endDate = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000)

            const oldMembership = await createTestUserMembership(user.id, currentLevel.id, {
                startDate: now,
                endDate,
                status: MembershipStatus.ACTIVE,
            })
            testIds.userMembershipIds.push(oldMembership.id)

            // 创建积分记录
            const pointRecord = await createTestPointRecord(user.id, {
                pointAmount: 100,
                remaining: 100,
                userMembershipId: oldMembership.id,
                status: PointRecordStatus.VALID,
                expiredAt: endDate,
            })
            testIds.pointRecordIds.push(pointRecord.id)

            const product = await createTestProduct(targetLevel.id)
            testIds.productIds.push(product.id)
            const order = await createTestOrder(user.id, product.id)
            testIds.orderIds.push(order.id)

            // 执行升级
            const result = await executeMembershipUpgradeService(user.id, targetLevel.id, order.id, order.orderNo)
            expect(result.success).toBe(true)
            testIds.userMembershipIds.push(result.newMembership!.id)

            // 查询旧会员的有效积分记录（应该为空，因为都已结算）
            const validOldRecords = await findPointRecordsByMembershipIdDao(
                oldMembership.id,
                { status: PointRecordStatus.VALID }
            )
            expect(validOldRecords.length).toBe(0)

            // 查询旧会员的所有积分记录（应该有已结算的记录）
            const allOldRecords = await findPointRecordsByMembershipIdDao(oldMembership.id)
            expect(allOldRecords.length).toBe(1)
            expect(allOldRecords[0].status).toBe(PointRecordStatus.MEMBERSHIP_UPGRADE_SETTLEMENT)

            // 查询新会员的有效积分记录
            const validNewRecords = await findPointRecordsByMembershipIdDao(
                result.newMembership!.id,
                { status: PointRecordStatus.VALID }
            )
            expect(validNewRecords.length).toBeGreaterThan(0)
            expect(validNewRecords.every(r => r.status === PointRecordStatus.VALID)).toBe(true)

            // 清理
            const newPointRecords = await findPointRecordsByMembershipIdDao(result.newMembership!.id)
            newPointRecords.forEach(r => testIds.pointRecordIds.push(r.id))
            const upgradeRecords = await prisma.membershipUpgradeRecords.findMany({
                where: { userId: user.id },
            })
            upgradeRecords.forEach(r => testIds.membershipUpgradeRecordIds.push(r.id))
        })
    })


    // ==================== 边界情况测试 ====================
    describe('边界情况测试', () => {
        it('旧会员没有积分记录时应正常升级', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const currentLevel = await createTestMembershipLevel({ sortOrder: 1 })
            const targetLevel = await createTestMembershipLevel({ sortOrder: 2 })
            testIds.membershipLevelIds.push(currentLevel.id, targetLevel.id)

            const now = new Date()
            const endDate = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000)

            const oldMembership = await createTestUserMembership(user.id, currentLevel.id, {
                startDate: now,
                endDate,
                status: MembershipStatus.ACTIVE,
            })
            testIds.userMembershipIds.push(oldMembership.id)

            // 不创建积分记录

            const product = await createTestProduct(targetLevel.id)
            testIds.productIds.push(product.id)
            const order = await createTestOrder(user.id, product.id)
            testIds.orderIds.push(order.id)

            const result = await executeMembershipUpgradeService(user.id, targetLevel.id, order.id, order.orderNo)
            expect(result.success).toBe(true)
            testIds.userMembershipIds.push(result.newMembership!.id)

            // 验证没有转入积分记录
            const newPointRecords = await findPointRecordsByMembershipIdDao(result.newMembership!.id)
            const transferRecord = newPointRecords.find(
                r => r.sourceType === PointRecordSourceType.MEMBERSHIP_UPGRADE_TRANSFER
            )
            expect(transferRecord).toBeUndefined()

            // 清理
            newPointRecords.forEach(r => testIds.pointRecordIds.push(r.id))
            const upgradeRecords = await prisma.membershipUpgradeRecords.findMany({
                where: { userId: user.id },
            })
            upgradeRecords.forEach(r => testIds.membershipUpgradeRecordIds.push(r.id))
        })

        it('积分 remaining 为 0 的记录不应被转移', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const currentLevel = await createTestMembershipLevel({ sortOrder: 1 })
            const targetLevel = await createTestMembershipLevel({ sortOrder: 2 })
            testIds.membershipLevelIds.push(currentLevel.id, targetLevel.id)

            const now = new Date()
            const endDate = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000)

            const oldMembership = await createTestUserMembership(user.id, currentLevel.id, {
                startDate: now,
                endDate,
                status: MembershipStatus.ACTIVE,
            })
            testIds.userMembershipIds.push(oldMembership.id)

            // 创建一个已用完的积分记录（remaining = 0）
            const usedRecord = await createTestPointRecord(user.id, {
                pointAmount: 100,
                used: 100,
                remaining: 0,
                userMembershipId: oldMembership.id,
                status: PointRecordStatus.VALID,
                expiredAt: endDate,
            })
            // 创建一个有剩余的积分记录
            const validRecord = await createTestPointRecord(user.id, {
                pointAmount: 200,
                remaining: 150,
                userMembershipId: oldMembership.id,
                status: PointRecordStatus.VALID,
                expiredAt: endDate,
            })
            testIds.pointRecordIds.push(usedRecord.id, validRecord.id)

            const product = await createTestProduct(targetLevel.id)
            testIds.productIds.push(product.id)
            const order = await createTestOrder(user.id, product.id)
            testIds.orderIds.push(order.id)

            const result = await executeMembershipUpgradeService(user.id, targetLevel.id, order.id, order.orderNo)
            expect(result.success).toBe(true)
            testIds.userMembershipIds.push(result.newMembership!.id)

            // 验证转入积分只包含有剩余的记录
            const newPointRecords = await findPointRecordsByMembershipIdDao(result.newMembership!.id)
            const transferRecord = newPointRecords.find(
                r => r.sourceType === PointRecordSourceType.MEMBERSHIP_UPGRADE_TRANSFER
            )
            expect(transferRecord).toBeDefined()
            expect(transferRecord!.pointAmount).toBe(150) // 只有 validRecord 的 remaining

            // 清理
            newPointRecords.forEach(r => testIds.pointRecordIds.push(r.id))
            const upgradeRecords = await prisma.membershipUpgradeRecords.findMany({
                where: { userId: user.id },
            })
            upgradeRecords.forEach(r => testIds.membershipUpgradeRecordIds.push(r.id))
        })
    })
})
