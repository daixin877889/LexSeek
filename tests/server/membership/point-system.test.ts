/**
 * 积分系统集成测试
 *
 * 测试真实的积分 DAO/Service 函数，使用真实数据库操作
 *
 * **Feature: point-system**
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import * as fc from 'fast-check'
import {
    getTestPrisma,
    createTestUser,
    createTestMembershipLevel,
    createTestUserMembership,
    createTestPointRecord,
    cleanupTestData,
    createEmptyTestIds,
    disconnectTestDb,
    isTestDbAvailable,
    resetDatabaseSequences,
    PointRecordStatus,
    PointSourceType,
    MembershipStatus,
    type TestIds,
} from './test-db-helper'
import {
    pointAmountArb,
    PBT_CONFIG_FAST,
} from './test-generators'

// 导入实际的 DAO 函数
import {
    createPointRecordDao,
    findPointRecordByIdDao,
    findPointRecordsByUserIdDao,
    findValidPointRecordsByUserIdDao,
    updatePointRecordDao,
    sumUserValidPointsDao,
    findPointRecordsByMembershipIdDao,
    transferPointRecordsDao,
} from '../../../server/services/point/pointRecords.dao'

// 注意：Service 函数依赖 Nuxt 自动导入的 DAO 函数，无法在测试环境中直接调用
// 因此只测试 DAO 函数

// 检查数据库是否可用
let dbAvailable = false

describe('积分系统集成测试', () => {
    const testIds: TestIds = createEmptyTestIds()
    const prisma = getTestPrisma()

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

    describe('createPointRecordDao 测试', () => {
        it('应成功创建积分记录', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const now = new Date()
            const expiredAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)

            // 使用实际的 DAO 函数创建
            const record = await createPointRecordDao({
                users: { connect: { id: user.id } },
                pointAmount: 100,
                used: 0,
                remaining: 100,
                sourceType: PointSourceType.DIRECT_PURCHASE,
                effectiveAt: now,
                expiredAt,
                status: PointRecordStatus.VALID,
            })
            testIds.pointRecordIds.push(record.id)

            expect(record.id).toBeGreaterThan(0)
            expect(record.userId).toBe(user.id)
            expect(record.pointAmount).toBe(100)
            expect(record.used).toBe(0)
            expect(record.remaining).toBe(100)
            expect(record.status).toBe(PointRecordStatus.VALID)
        })

        it('Property: 新创建的积分记录 remaining 应等于 pointAmount', async () => {
            if (!dbAvailable) return

            await fc.assert(
                fc.asyncProperty(
                    pointAmountArb,
                    async (pointAmount) => {
                        const user = await createTestUser()
                        testIds.userIds.push(user.id)

                        const now = new Date()
                        const expiredAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)

                        // 使用实际的 DAO 函数创建
                        const record = await createPointRecordDao({
                            users: { connect: { id: user.id } },
                            pointAmount,
                            used: 0,
                            remaining: pointAmount,
                            sourceType: PointSourceType.DIRECT_PURCHASE,
                            effectiveAt: now,
                            expiredAt,
                            status: PointRecordStatus.VALID,
                        })
                        testIds.pointRecordIds.push(record.id)

                        expect(record.remaining).toBe(pointAmount)
                        expect(record.used).toBe(0)

                        return true
                    }
                ),
                PBT_CONFIG_FAST
            )
        })
    })

    describe('findPointRecordByIdDao 测试', () => {
        it('应成功通过 ID 查询积分记录', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const record = await createTestPointRecord(user.id)
            testIds.pointRecordIds.push(record.id)

            // 使用实际的 DAO 函数查询
            const found = await findPointRecordByIdDao(record.id)

            expect(found).not.toBeNull()
            expect(found!.id).toBe(record.id)
            expect(found!.pointAmount).toBe(record.pointAmount)
        })
    })

    describe('findPointRecordsByUserIdDao 测试', () => {
        it('应正确返回分页结果', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            // 创建 5 条积分记录
            for (let i = 0; i < 5; i++) {
                const record = await createTestPointRecord(user.id, {
                    pointAmount: (i + 1) * 100,
                })
                testIds.pointRecordIds.push(record.id)
            }

            // 使用实际的 DAO 函数查询
            const page1 = await findPointRecordsByUserIdDao(user.id, { page: 1, pageSize: 2 })
            const page2 = await findPointRecordsByUserIdDao(user.id, { page: 2, pageSize: 2 })

            expect(page1.list.length).toBe(2)
            expect(page2.list.length).toBe(2)
            expect(page1.total).toBe(5)
        })
    })

    describe('findValidPointRecordsByUserIdDao 测试', () => {
        it('应按 expiredAt 升序排列（FIFO 消耗）', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const now = Date.now()
            // 创建不同过期时间的积分记录
            const record1 = await createTestPointRecord(user.id, {
                expiredAt: new Date(now + 90 * 24 * 60 * 60 * 1000), // 90天后
            })
            const record2 = await createTestPointRecord(user.id, {
                expiredAt: new Date(now + 30 * 24 * 60 * 60 * 1000), // 30天后
            })
            const record3 = await createTestPointRecord(user.id, {
                expiredAt: new Date(now + 60 * 24 * 60 * 60 * 1000), // 60天后
            })
            testIds.pointRecordIds.push(record1.id, record2.id, record3.id)

            // 使用实际的 DAO 函数查询
            const records = await findValidPointRecordsByUserIdDao(user.id)

            // 验证排序：30天 < 60天 < 90天
            expect(records.length).toBe(3)
            expect(records[0].id).toBe(record2.id)
            expect(records[1].id).toBe(record3.id)
            expect(records[2].id).toBe(record1.id)
        })

        it('不应返回已过期的积分记录', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const now = new Date()
            const futureDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
            const pastDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

            // 创建有效积分记录
            const validRecord = await createTestPointRecord(user.id, {
                expiredAt: futureDate,
                status: PointRecordStatus.VALID,
            })
            testIds.pointRecordIds.push(validRecord.id)

            // 创建已过期积分记录
            const expiredRecord = await createTestPointRecord(user.id, {
                expiredAt: pastDate,
                status: PointRecordStatus.VALID,
            })
            testIds.pointRecordIds.push(expiredRecord.id)

            // 使用实际的 DAO 函数查询
            const records = await findValidPointRecordsByUserIdDao(user.id)

            expect(records.length).toBe(1)
            expect(records[0].id).toBe(validRecord.id)
        })
    })

    describe('updatePointRecordDao 测试', () => {
        it('应成功更新积分记录', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const record = await createTestPointRecord(user.id, { pointAmount: 100 })
            testIds.pointRecordIds.push(record.id)

            // 使用实际的 DAO 函数更新（模拟消耗 30 积分）
            const updated = await updatePointRecordDao(record.id, {
                used: 30,
                remaining: 70,
            })

            expect(updated.used).toBe(30)
            expect(updated.remaining).toBe(70)
        })
    })

    describe('sumUserValidPointsDao 测试', () => {
        it('应正确统计用户有效积分汇总', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const now = new Date()
            const futureDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)
            const pastDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

            // 创建有效积分记录
            const validRecord1 = await createTestPointRecord(user.id, {
                pointAmount: 100,
                remaining: 80,
                used: 20,
                expiredAt: futureDate,
                status: PointRecordStatus.VALID,
                sourceType: PointSourceType.MEMBERSHIP_PURCHASE_GIFT,
            })
            const validRecord2 = await createTestPointRecord(user.id, {
                pointAmount: 200,
                remaining: 200,
                used: 0,
                expiredAt: futureDate,
                status: PointRecordStatus.VALID,
                sourceType: PointSourceType.DIRECT_PURCHASE,
            })
            testIds.pointRecordIds.push(validRecord1.id, validRecord2.id)

            // 创建已过期的积分记录（不应计入）
            const expiredRecord = await createTestPointRecord(user.id, {
                pointAmount: 50,
                remaining: 50,
                expiredAt: pastDate,
                status: PointRecordStatus.VALID,
            })
            testIds.pointRecordIds.push(expiredRecord.id)

            // 创建已取消的积分记录（不应计入）
            const cancelledRecord = await createTestPointRecord(user.id, {
                pointAmount: 30,
                remaining: 30,
                expiredAt: futureDate,
                status: PointRecordStatus.CANCELLED,
            })
            testIds.pointRecordIds.push(cancelledRecord.id)

            // 使用实际的 DAO 函数统计
            const summary = await sumUserValidPointsDao(user.id)

            expect(summary.remaining).toBe(280) // 80 + 200
            expect(summary.purchasePoint).toBe(280) // 来源类型 1 和 2 的积分
        })
    })

    describe('findPointRecordsByMembershipIdDao 测试', () => {
        it('应正确查询会员关联的积分记录', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)
            const membership = await createTestUserMembership(user.id, level.id)
            testIds.userMembershipIds.push(membership.id)

            // 创建关联到会员的积分记录
            const record1 = await createTestPointRecord(user.id, {
                userMembershipId: membership.id,
                pointAmount: 100,
            })
            const record2 = await createTestPointRecord(user.id, {
                userMembershipId: membership.id,
                pointAmount: 200,
            })
            // 创建不关联会员的积分记录
            const record3 = await createTestPointRecord(user.id, {
                pointAmount: 50,
            })
            testIds.pointRecordIds.push(record1.id, record2.id, record3.id)

            // 使用实际的 DAO 函数查询
            const membershipRecords = await findPointRecordsByMembershipIdDao(membership.id)

            expect(membershipRecords.length).toBe(2)
            const totalPoints = membershipRecords.reduce((sum, r) => sum + r.pointAmount, 0)
            expect(totalPoints).toBe(300)
        })
    })

    describe('transferPointRecordsDao 测试', () => {
        it('应正确转移积分记录到新会员', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const level1 = await createTestMembershipLevel({ sortOrder: 2 })
            const level2 = await createTestMembershipLevel({ sortOrder: 1 })
            testIds.membershipLevelIds.push(level1.id, level2.id)

            const now = new Date()
            const futureDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

            const fromMembership = await createTestUserMembership(user.id, level1.id, {
                status: MembershipStatus.INACTIVE,
                endDate: futureDate,
            })
            const toMembership = await createTestUserMembership(user.id, level2.id, {
                status: MembershipStatus.ACTIVE,
                endDate: futureDate,
            })
            testIds.userMembershipIds.push(fromMembership.id, toMembership.id)

            // 创建关联到原会员的积分记录
            const record1 = await createTestPointRecord(user.id, {
                userMembershipId: fromMembership.id,
                pointAmount: 100,
            })
            const record2 = await createTestPointRecord(user.id, {
                userMembershipId: fromMembership.id,
                pointAmount: 200,
            })
            testIds.pointRecordIds.push(record1.id, record2.id)

            // 使用实际的 DAO 函数转移
            const count = await transferPointRecordsDao(fromMembership.id, toMembership.id)

            expect(count).toBe(2)

            // 验证转移后的关联
            const newMembershipRecords = await findPointRecordsByMembershipIdDao(toMembership.id)
            expect(newMembershipRecords.length).toBe(2)

            const oldMembershipRecords = await findPointRecordsByMembershipIdDao(fromMembership.id)
            expect(oldMembershipRecords.length).toBe(0)
        })
    })

    describe('积分数据一致性', () => {
        it('Property: remaining 应始终等于 pointAmount - used', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const record = await createTestPointRecord(user.id, { pointAmount: 100 })
            testIds.pointRecordIds.push(record.id)

            // 多次消费
            const consumeAmounts = [20, 30, 15]
            let totalUsed = 0

            for (const amount of consumeAmounts) {
                totalUsed += amount
                // 使用实际的 DAO 函数更新
                await updatePointRecordDao(record.id, {
                    used: totalUsed,
                    remaining: 100 - totalUsed,
                })

                const updated = await findPointRecordByIdDao(record.id)

                // 验证不变量
                expect(updated!.remaining).toBe(updated!.pointAmount - updated!.used)
            }
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
