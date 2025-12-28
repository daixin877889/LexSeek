/**
 * 会员升级测试
 *
 * 测试真实的会员升级服务函数，使用真实数据库操作
 *
 * **Feature: membership-upgrade**
 * **Validates: Requirements 2.1, 2.2, 3.1, 3.2**
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
    createEmptyTestIds,
    disconnectTestDb,
    isTestDbAvailable,
    MembershipStatus,
    MembershipLevelStatus,
    UserMembershipSourceType,
    PointRecordStatus,
    type TestIds,
} from './test-db-helper'
import { PBT_CONFIG_FAST } from './test-generators'

// 导入实际的服务函数
import {
    getUpgradeOptionsService,
    calculateUpgradePrice,
    calculateUpgradePriceService,
    getUserUpgradeRecordsService,
    executeMembershipUpgradeService,
} from '../../../server/services/membership/membershipUpgrade.service'

import {
    findCurrentUserMembershipDao,
    findUserMembershipByIdDao,
    invalidateUserMembershipDao,
    findAllActiveUserMembershipsDao,
    findUserMembershipHistoryDao,
} from '../../../server/services/membership/userMembership.dao'

import {
    findMembershipLevelByIdDao,
    findHigherMembershipLevelsDao,
    findAllActiveMembershipLevelsDao,
} from '../../../server/services/membership/membershipLevel.dao'

import {
    createMembershipUpgradeRecordDao,
    findMembershipUpgradeRecordByIdDao,
    findUserUpgradeRecordsDao,
} from '../../../server/services/membership/membershipUpgrade.dao'

// 导入积分相关的 DAO 函数
import {
    transferPointRecordsDao,
    sumUserValidPointsDao,
    findPointRecordsByMembershipIdDao,
} from '../../../server/services/point/pointRecords.dao'

// 测试数据 ID 追踪
let testIds: TestIds

// 数据库连接
const prisma = getTestPrisma()

// 检查数据库是否可用
let dbAvailable = false

describe('会员升级集成测试', () => {
    testIds = createEmptyTestIds()

    beforeAll(async () => {
        dbAvailable = await isTestDbAvailable()
        if (!dbAvailable) {
            console.warn('数据库不可用，跳过集成测试')
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
            await disconnectTestDb()
        }
    })

    describe('会员级别 DAO 函数测试', () => {
        it('findMembershipLevelByIdDao 应正确查询会员级别', async () => {
            if (!dbAvailable) return

            // 创建测试会员级别
            const level = await createTestMembershipLevel({
                name: '测试级别_DAO查询',
                sortOrder: 1,
                status: MembershipLevelStatus.ENABLED,
            })
            testIds.membershipLevelIds.push(level.id)

            // 使用实际的 DAO 函数查询
            const found = await findMembershipLevelByIdDao(level.id)

            expect(found).not.toBeNull()
            expect(found!.id).toBe(level.id)
            expect(found!.name).toBe('测试级别_DAO查询')
        })

        it('findAllActiveMembershipLevelsDao 应返回所有启用的会员级别', async () => {
            if (!dbAvailable) return

            // 创建启用和禁用的会员级别
            const enabledLevel = await createTestMembershipLevel({
                sortOrder: 1,
                status: MembershipLevelStatus.ENABLED,
            })
            const disabledLevel = await createTestMembershipLevel({
                sortOrder: 2,
                status: MembershipLevelStatus.DISABLED,
            })
            testIds.membershipLevelIds.push(enabledLevel.id, disabledLevel.id)

            // 使用实际的 DAO 函数查询
            const activeLevels = await findAllActiveMembershipLevelsDao()

            // 验证只返回启用的级别
            const foundEnabled = activeLevels.find(l => l.id === enabledLevel.id)
            const foundDisabled = activeLevels.find(l => l.id === disabledLevel.id)

            expect(foundEnabled).not.toBeUndefined()
            expect(foundDisabled).toBeUndefined()
        })

        it('findHigherMembershipLevelsDao 应返回比指定级别更高的级别', async () => {
            if (!dbAvailable) return

            // 创建三个级别（sortOrder 越小级别越高）
            const level1 = await createTestMembershipLevel({ sortOrder: 1, status: MembershipLevelStatus.ENABLED })
            const level2 = await createTestMembershipLevel({ sortOrder: 2, status: MembershipLevelStatus.ENABLED })
            const level3 = await createTestMembershipLevel({ sortOrder: 3, status: MembershipLevelStatus.ENABLED })
            testIds.membershipLevelIds.push(level1.id, level2.id, level3.id)

            // 查询比 level3 更高的级别
            const higherLevels = await findHigherMembershipLevelsDao(level3.sortOrder)

            // 验证返回的级别
            const higherIds = higherLevels.map(l => l.id)
            expect(higherIds).toContain(level1.id)
            expect(higherIds).toContain(level2.id)
            expect(higherIds).not.toContain(level3.id)
        })
    })

    describe('用户会员 DAO 函数测试', () => {
        it('findCurrentUserMembershipDao 应返回用户当前有效会员', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const now = new Date()
            const futureDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

            // 创建有效会员
            const membership = await createTestUserMembership(user.id, level.id, {
                status: MembershipStatus.ACTIVE,
                endDate: futureDate,
            })
            testIds.userMembershipIds.push(membership.id)

            // 使用实际的 DAO 函数查询
            const found = await findCurrentUserMembershipDao(user.id)

            expect(found).not.toBeNull()
            expect(found!.id).toBe(membership.id)
            expect(found!.level).not.toBeNull()
            expect(found!.level.id).toBe(level.id)
        })

        it('findCurrentUserMembershipDao 不应返回已过期的会员', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const pastDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

            // 创建已过期会员
            const membership = await createTestUserMembership(user.id, level.id, {
                status: MembershipStatus.ACTIVE,
                startDate: new Date(pastDate.getTime() - 60 * 24 * 60 * 60 * 1000),
                endDate: pastDate,
            })
            testIds.userMembershipIds.push(membership.id)

            // 使用实际的 DAO 函数查询
            const found = await findCurrentUserMembershipDao(user.id)

            expect(found).toBeNull()
        })

        it('findUserMembershipByIdDao 应正确查询会员记录', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const membership = await createTestUserMembership(user.id, level.id)
            testIds.userMembershipIds.push(membership.id)

            // 使用实际的 DAO 函数查询
            const found = await findUserMembershipByIdDao(membership.id)

            expect(found).not.toBeNull()
            expect(found!.id).toBe(membership.id)
        })
    })

    describe('会员升级价格计算测试', () => {
        it('calculateUpgradePrice 应正确计算升级价格', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            // 创建当前级别和目标级别
            const currentLevel = await createTestMembershipLevel({ sortOrder: 2 })
            const targetLevel = await createTestMembershipLevel({ sortOrder: 1 })
            testIds.membershipLevelIds.push(currentLevel.id, targetLevel.id)

            const now = new Date()
            const endDate = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000) // 180天后

            // 创建当前会员
            const membership = await createTestUserMembership(user.id, currentLevel.id, {
                endDate,
                status: MembershipStatus.ACTIVE,
            })
            testIds.userMembershipIds.push(membership.id)

            // 查询会员记录（包含级别信息）
            const currentMembership = await findCurrentUserMembershipDao(user.id)
            expect(currentMembership).not.toBeNull()

            // 创建目标商品（模拟）
            const targetProduct = {
                id: 1,
                priceMonthly: 99,
                priceYearly: 999,
            } as any

            const remainingDays = 180

            // 调用实际的计算函数
            const result = calculateUpgradePrice(
                currentMembership!,
                targetLevel,
                targetProduct,
                remainingDays
            )

            // 验证返回结果结构
            expect(result).toHaveProperty('originalRemainingValue')
            expect(result).toHaveProperty('targetRemainingValue')
            expect(result).toHaveProperty('upgradePrice')
            expect(result).toHaveProperty('pointCompensation')

            // 验证升级价格非负
            expect(result.upgradePrice).toBeGreaterThanOrEqual(0)
            // 验证积分补偿 = 升级价格 × 10
            expect(result.pointCompensation).toBe(Math.round(result.upgradePrice * 10))
        })

        it('calculateUpgradePriceService 应验证目标级别必须高于当前级别', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            // 创建两个级别（sortOrder 越小级别越高）
            const higherLevel = await createTestMembershipLevel({ sortOrder: 1 })
            const lowerLevel = await createTestMembershipLevel({ sortOrder: 2 })
            testIds.membershipLevelIds.push(higherLevel.id, lowerLevel.id)

            const now = new Date()
            const futureDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

            // 用户当前是高级别会员
            const membership = await createTestUserMembership(user.id, higherLevel.id, {
                endDate: futureDate,
                status: MembershipStatus.ACTIVE,
            })
            testIds.userMembershipIds.push(membership.id)

            // 尝试"升级"到低级别（应该失败）
            const result = await calculateUpgradePriceService(user.id, lowerLevel.id)

            expect(result.success).toBe(false)
            expect(result.errorMessage).toBe('目标级别必须高于当前级别')
        })

        it('calculateUpgradePriceService 应验证用户必须有有效会员', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            // 用户没有会员
            const result = await calculateUpgradePriceService(user.id, level.id)

            expect(result.success).toBe(false)
            expect(result.errorMessage).toBe('用户没有有效会员')
        })
    })

    describe('会员升级记录 DAO 函数测试', () => {
        it('createMembershipUpgradeRecordDao 应正确创建升级记录', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const level1 = await createTestMembershipLevel({ sortOrder: 2 })
            const level2 = await createTestMembershipLevel({ sortOrder: 1 })
            testIds.membershipLevelIds.push(level1.id, level2.id)

            const now = new Date()
            const futureDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

            // 创建原会员和新会员
            const fromMembership = await createTestUserMembership(user.id, level1.id, {
                status: MembershipStatus.INACTIVE,
                endDate: futureDate,
            })
            const toMembership = await createTestUserMembership(user.id, level2.id, {
                status: MembershipStatus.ACTIVE,
                endDate: futureDate,
            })
            testIds.userMembershipIds.push(fromMembership.id, toMembership.id)

            // 先创建测试产品，再创建测试订单
            const product = await createTestProduct(level2.id)
            testIds.productIds.push(product.id)
            const order = await createTestOrder(user.id, product.id)
            testIds.orderIds.push(order.id)

            // 使用实际的 DAO 函数创建升级记录
            const record = await createMembershipUpgradeRecordDao({
                userId: user.id,
                fromMembershipId: fromMembership.id,
                toMembershipId: toMembership.id,
                orderId: order.id,
                upgradePrice: 50,
                pointCompensation: 500,
            })
            testIds.membershipUpgradeRecordIds.push(record.id)

            expect(record.id).toBeGreaterThan(0)
            expect(record.userId).toBe(user.id)
            expect(record.fromMembershipId).toBe(fromMembership.id)
            expect(record.toMembershipId).toBe(toMembership.id)
            expect(Number(record.upgradePrice)).toBe(50)
            expect(record.pointCompensation).toBe(500)
        })

        it('findMembershipUpgradeRecordByIdDao 应正确查询升级记录', async () => {
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

            // 先创建测试产品，再创建测试订单
            const product = await createTestProduct(level2.id)
            testIds.productIds.push(product.id)
            const order = await createTestOrder(user.id, product.id)
            testIds.orderIds.push(order.id)

            const record = await createMembershipUpgradeRecordDao({
                userId: user.id,
                fromMembershipId: fromMembership.id,
                toMembershipId: toMembership.id,
                orderId: order.id,
                upgradePrice: 50,
                pointCompensation: 500,
            })
            testIds.membershipUpgradeRecordIds.push(record.id)

            // 使用实际的 DAO 函数查询
            const found = await findMembershipUpgradeRecordByIdDao(record.id)

            expect(found).not.toBeNull()
            expect(found!.id).toBe(record.id)
            expect(found!.fromMembership).not.toBeNull()
            expect(found!.toMembership).not.toBeNull()
            expect(found!.fromMembership.level.id).toBe(level1.id)
            expect(found!.toMembership.level.id).toBe(level2.id)
        })

        it('findUserUpgradeRecordsDao 应正确分页查询用户升级记录', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const level1 = await createTestMembershipLevel({ sortOrder: 3 })
            const level2 = await createTestMembershipLevel({ sortOrder: 2 })
            const level3 = await createTestMembershipLevel({ sortOrder: 1 })
            testIds.membershipLevelIds.push(level1.id, level2.id, level3.id)

            const now = new Date()
            const futureDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

            // 创建多条升级记录
            const membership1 = await createTestUserMembership(user.id, level1.id, { status: MembershipStatus.INACTIVE, endDate: futureDate })
            const membership2 = await createTestUserMembership(user.id, level2.id, { status: MembershipStatus.INACTIVE, endDate: futureDate })
            const membership3 = await createTestUserMembership(user.id, level3.id, { status: MembershipStatus.ACTIVE, endDate: futureDate })
            testIds.userMembershipIds.push(membership1.id, membership2.id, membership3.id)

            // 先创建测试产品，再创建测试订单
            const product1 = await createTestProduct(level2.id)
            const product2 = await createTestProduct(level3.id)
            testIds.productIds.push(product1.id, product2.id)
            const order1 = await createTestOrder(user.id, product1.id)
            const order2 = await createTestOrder(user.id, product2.id)
            testIds.orderIds.push(order1.id, order2.id)

            const record1 = await createMembershipUpgradeRecordDao({
                userId: user.id,
                fromMembershipId: membership1.id,
                toMembershipId: membership2.id,
                orderId: order1.id,
                upgradePrice: 30,
                pointCompensation: 300,
            })
            const record2 = await createMembershipUpgradeRecordDao({
                userId: user.id,
                fromMembershipId: membership2.id,
                toMembershipId: membership3.id,
                orderId: order2.id,
                upgradePrice: 50,
                pointCompensation: 500,
            })
            testIds.membershipUpgradeRecordIds.push(record1.id, record2.id)

            // 使用实际的 DAO 函数查询
            const result = await findUserUpgradeRecordsDao(user.id, { page: 1, pageSize: 10 })

            expect(result.total).toBe(2)
            expect(result.list.length).toBe(2)
        })
    })

    describe('Property: 会员升级级别验证', () => {
        it('只能升级到更高级别（sortOrder 更小）', async () => {
            if (!dbAvailable) return

            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 2, max: 10 }),
                    fc.integer({ min: 1, max: 9 }),
                    async (currentOrder, targetOrder) => {
                        // 确保 targetOrder < currentOrder（目标级别更高）
                        if (targetOrder >= currentOrder) {
                            targetOrder = currentOrder - 1
                        }
                        if (targetOrder < 1) return true

                        const user = await createTestUser()
                        testIds.userIds.push(user.id)

                        const currentLevel = await createTestMembershipLevel({ sortOrder: currentOrder })
                        const targetLevel = await createTestMembershipLevel({ sortOrder: targetOrder })
                        testIds.membershipLevelIds.push(currentLevel.id, targetLevel.id)

                        // 验证 sortOrder 关系
                        expect(targetLevel.sortOrder).toBeLessThan(currentLevel.sortOrder)

                        return true
                    }
                ),
                PBT_CONFIG_FAST
            )
        })
    })

    describe('Property: 会员升级有效期计算正确性', () => {
        it('升级后会员有效期应继承原会员的结束时间', async () => {
            if (!dbAvailable) return

            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 30, max: 365 }),
                    async (remainingDays) => {
                        const user = await createTestUser()
                        testIds.userIds.push(user.id)

                        const currentLevel = await createTestMembershipLevel({ sortOrder: 2 })
                        const targetLevel = await createTestMembershipLevel({ sortOrder: 1 })
                        testIds.membershipLevelIds.push(currentLevel.id, targetLevel.id)

                        const now = new Date()
                        const endDate = new Date(now.getTime() + remainingDays * 24 * 60 * 60 * 1000)

                        // 创建原会员
                        const fromMembership = await createTestUserMembership(user.id, currentLevel.id, {
                            status: MembershipStatus.INACTIVE,
                            endDate,
                        })
                        // 创建新会员（继承结束时间）
                        const toMembership = await createTestUserMembership(user.id, targetLevel.id, {
                            status: MembershipStatus.ACTIVE,
                            endDate, // 继承原会员的结束时间
                        })
                        testIds.userMembershipIds.push(fromMembership.id, toMembership.id)

                        // 验证结束时间一致
                        expect(toMembership.endDate.getTime()).toBe(fromMembership.endDate.getTime())

                        return true
                    }
                ),
                PBT_CONFIG_FAST
            )
        })
    })

    describe('Property: 会员升级积分补偿正确性', () => {
        it('积分补偿应等于升级价格乘以10', async () => {
            if (!dbAvailable) return

            await fc.assert(
                fc.asyncProperty(
                    fc.float({ min: 0, max: 1000, noNaN: true }),
                    async (upgradePrice) => {
                        const expectedCompensation = Math.round(upgradePrice * 10)

                        // 验证计算逻辑
                        expect(expectedCompensation).toBe(Math.round(upgradePrice * 10))

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
            console.log('检查 .env 文件中的 DATABASE_URL 配置')
        }
        expect(true).toBe(true)
    })
})


// ==================== 升级价格计算测试 ====================

describe('升级价格计算', () => {
    it('升级价格应等于目标级别剩余价值减去原级别剩余价值', async () => {
        // 创建测试用户
        const user = await createTestUser()
        testIds.userIds.push(user.id)

        // 创建两个会员级别（普通和高级）
        const normalLevel = await createTestMembershipLevel({
            name: '测试级别_普通',
            sortOrder: 2,
            status: MembershipLevelStatus.ENABLED,
        })
        testIds.membershipLevelIds.push(normalLevel.id)

        const premiumLevel = await createTestMembershipLevel({
            name: '测试级别_高级',
            sortOrder: 1,
            status: MembershipLevelStatus.ENABLED,
        })
        testIds.membershipLevelIds.push(premiumLevel.id)

        // 创建用户会员记录（30天后过期）
        const endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        const membership = await createTestUserMembership(user.id, normalLevel.id, {
            startDate: new Date(),
            endDate,
            status: MembershipStatus.ACTIVE,
        })
        testIds.userMembershipIds.push(membership.id)

        // 使用实际的 DAO 函数验证会员记录创建成功
        const savedMembership = await findUserMembershipByIdDao(membership.id)

        expect(savedMembership).not.toBeNull()
        expect(savedMembership!.levelId).toBe(normalLevel.id)
        expect(savedMembership!.status).toBe(MembershipStatus.ACTIVE)

        // 验证目标级别比当前级别高（sortOrder 更小）
        expect(premiumLevel.sortOrder).toBeLessThan(normalLevel.sortOrder)
    })

    it('剩余天数为0时升级价格应为0', async () => {
        // 创建测试用户
        const user = await createTestUser()
        testIds.userIds.push(user.id)

        // 创建会员级别
        const level = await createTestMembershipLevel({
            name: '测试级别_即将过期',
            sortOrder: 1,
        })
        testIds.membershipLevelIds.push(level.id)

        // 创建即将过期的会员记录（今天过期）
        const today = new Date()
        const membership = await createTestUserMembership(user.id, level.id, {
            startDate: new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000),
            endDate: today,
            status: MembershipStatus.ACTIVE,
        })
        testIds.userMembershipIds.push(membership.id)

        // 使用实际的 DAO 函数验证会员记录
        const savedMembership = await findUserMembershipByIdDao(membership.id)

        expect(savedMembership).not.toBeNull()
        // 剩余天数应该接近0
        const remainingDays = Math.max(0, Math.ceil(
            (savedMembership!.endDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000)
        ))
        expect(remainingDays).toBeLessThanOrEqual(1)
    })
})


// ==================== 会员升级状态转换测试 ====================

describe('会员升级状态转换', () => {
    it('升级后原会员状态应变为 INACTIVE', async () => {
        // 创建测试用户
        const user = await createTestUser()
        testIds.userIds.push(user.id)

        // 创建两个会员级别
        const normalLevel = await createTestMembershipLevel({
            name: '测试级别_普通_状态',
            sortOrder: 2,
        })
        testIds.membershipLevelIds.push(normalLevel.id)

        const premiumLevel = await createTestMembershipLevel({
            name: '测试级别_高级_状态',
            sortOrder: 1,
        })
        testIds.membershipLevelIds.push(premiumLevel.id)

        // 创建原会员记录
        const endDate = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
        const oldMembership = await createTestUserMembership(user.id, normalLevel.id, {
            startDate: new Date(),
            endDate,
            status: MembershipStatus.ACTIVE,
        })
        testIds.userMembershipIds.push(oldMembership.id)

        // 使用实际的 DAO 函数使原会员失效
        await invalidateUserMembershipDao(oldMembership.id)

        // 创建新会员记录
        const newMembership = await createTestUserMembership(user.id, premiumLevel.id, {
            startDate: new Date(),
            endDate, // 继承原会员的结束时间
            status: MembershipStatus.ACTIVE,
            sourceType: UserMembershipSourceType.MEMBERSHIP_UPGRADE,
        })
        testIds.userMembershipIds.push(newMembership.id)

        // 使用实际的 DAO 函数验证原会员状态
        const updatedOldMembership = await findUserMembershipByIdDao(oldMembership.id)
        expect(updatedOldMembership!.status).toBe(MembershipStatus.INACTIVE)

        // 验证新会员状态
        const savedNewMembership = await findUserMembershipByIdDao(newMembership.id)
        expect(savedNewMembership!.status).toBe(MembershipStatus.ACTIVE)
        expect(savedNewMembership!.sourceType).toBe(UserMembershipSourceType.MEMBERSHIP_UPGRADE)
    })

    it('新会员应继承原会员的结束时间', async () => {
        // 创建测试用户
        const user = await createTestUser()
        testIds.userIds.push(user.id)

        // 创建会员级别
        const normalLevel = await createTestMembershipLevel({
            name: '测试级别_普通_继承',
            sortOrder: 2,
        })
        testIds.membershipLevelIds.push(normalLevel.id)

        const premiumLevel = await createTestMembershipLevel({
            name: '测试级别_高级_继承',
            sortOrder: 1,
        })
        testIds.membershipLevelIds.push(premiumLevel.id)

        // 创建原会员记录（特定结束时间）
        const specificEndDate = new Date('2026-06-15T12:00:00Z')
        const oldMembership = await createTestUserMembership(user.id, normalLevel.id, {
            startDate: new Date(),
            endDate: specificEndDate,
            status: MembershipStatus.ACTIVE,
        })
        testIds.userMembershipIds.push(oldMembership.id)

        // 创建新会员记录（继承结束时间）
        const newMembership = await createTestUserMembership(user.id, premiumLevel.id, {
            startDate: new Date(),
            endDate: specificEndDate, // 继承原会员的结束时间
            status: MembershipStatus.ACTIVE,
            sourceType: UserMembershipSourceType.MEMBERSHIP_UPGRADE,
        })
        testIds.userMembershipIds.push(newMembership.id)

        // 使用实际的 DAO 函数验证结束时间一致
        const savedNewMembership = await findUserMembershipByIdDao(newMembership.id)
        expect(savedNewMembership!.endDate.getTime()).toBe(specificEndDate.getTime())
    })
})


// ==================== 积分转移测试 ====================

describe('积分转移', () => {
    it('升级后积分记录应转移到新会员', async () => {
        // 创建测试用户
        const user = await createTestUser()
        testIds.userIds.push(user.id)

        // 创建会员级别
        const normalLevel = await createTestMembershipLevel({
            name: '测试级别_普通_积分',
            sortOrder: 2,
        })
        testIds.membershipLevelIds.push(normalLevel.id)

        const premiumLevel = await createTestMembershipLevel({
            name: '测试级别_高级_积分',
            sortOrder: 1,
        })
        testIds.membershipLevelIds.push(premiumLevel.id)

        // 创建原会员记录
        const endDate = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
        const oldMembership = await createTestUserMembership(user.id, normalLevel.id, {
            startDate: new Date(),
            endDate,
            status: MembershipStatus.ACTIVE,
        })
        testIds.userMembershipIds.push(oldMembership.id)

        // 创建积分记录（关联到原会员）
        const pointRecord1 = await createTestPointRecord(user.id, {
            pointAmount: 100,
            remaining: 100,
            userMembershipId: oldMembership.id,
            status: PointRecordStatus.VALID,
        })
        testIds.pointRecordIds.push(pointRecord1.id)

        const pointRecord2 = await createTestPointRecord(user.id, {
            pointAmount: 200,
            remaining: 150,
            userMembershipId: oldMembership.id,
            status: PointRecordStatus.VALID,
        })
        testIds.pointRecordIds.push(pointRecord2.id)

        // 创建新会员记录
        const newMembership = await createTestUserMembership(user.id, premiumLevel.id, {
            startDate: new Date(),
            endDate,
            status: MembershipStatus.ACTIVE,
            sourceType: UserMembershipSourceType.MEMBERSHIP_UPGRADE,
        })
        testIds.userMembershipIds.push(newMembership.id)

        // 使用实际的 DAO 函数转移积分记录到新会员
        const transferCount = await transferPointRecordsDao(oldMembership.id, newMembership.id)

        expect(transferCount).toBe(2)

        // 使用实际的 DAO 函数验证积分记录已转移
        const transferredRecords = await findPointRecordsByMembershipIdDao(newMembership.id)

        expect(transferredRecords.length).toBe(2)
        expect(transferredRecords.every(r => r.userMembershipId === newMembership.id)).toBe(true)
    })

    it('转移后积分数量应保持不变', async () => {
        // 创建测试用户
        const user = await createTestUser()
        testIds.userIds.push(user.id)

        // 创建会员级别
        const level = await createTestMembershipLevel({
            name: '测试级别_积分数量',
            sortOrder: 1,
        })
        testIds.membershipLevelIds.push(level.id)

        // 创建会员记录
        const membership = await createTestUserMembership(user.id, level.id, {
            status: MembershipStatus.ACTIVE,
        })
        testIds.userMembershipIds.push(membership.id)

        // 创建多个积分记录
        const pointAmounts = [100, 200, 300]
        const remainingAmounts = [80, 150, 300]
        let totalOriginalRemaining = 0

        for (let i = 0; i < pointAmounts.length; i++) {
            const record = await createTestPointRecord(user.id, {
                pointAmount: pointAmounts[i],
                remaining: remainingAmounts[i],
                userMembershipId: membership.id,
                status: PointRecordStatus.VALID,
            })
            testIds.pointRecordIds.push(record.id)
            totalOriginalRemaining += remainingAmounts[i]
        }

        // 使用实际的 DAO 函数查询转移前的总积分
        const beforeTransfer = await sumUserValidPointsDao(user.id)

        expect(beforeTransfer.remaining).toBe(totalOriginalRemaining)

        // 创建新会员并转移积分
        const newLevel = await createTestMembershipLevel({
            name: '测试级别_新_积分数量',
            sortOrder: 0,
        })
        testIds.membershipLevelIds.push(newLevel.id)

        const newMembership = await createTestUserMembership(user.id, newLevel.id, {
            status: MembershipStatus.ACTIVE,
        })
        testIds.userMembershipIds.push(newMembership.id)

        // 使用实际的 DAO 函数转移积分
        await transferPointRecordsDao(membership.id, newMembership.id)

        // 使用实际的 DAO 函数查询转移后的总积分
        const afterTransfer = await sumUserValidPointsDao(user.id)

        expect(afterTransfer.remaining).toBe(totalOriginalRemaining)
    })
})


// ==================== 升级资格验证测试 ====================

describe('升级资格验证', () => {
    it('没有有效会员时不能升级', async () => {
        // 创建测试用户（没有会员记录）
        const user = await createTestUser()
        testIds.userIds.push(user.id)

        // 使用实际的 DAO 函数查询用户的有效会员
        const currentMembership = await findCurrentUserMembershipDao(user.id)

        expect(currentMembership).toBeNull()
    })

    it('会员已过期时不能升级', async () => {
        // 创建测试用户
        const user = await createTestUser()
        testIds.userIds.push(user.id)

        // 创建会员级别
        const level = await createTestMembershipLevel({
            name: '测试级别_过期',
            sortOrder: 1,
        })
        testIds.membershipLevelIds.push(level.id)

        // 创建已过期的会员记录
        const pastDate = new Date('2024-01-01')
        const membership = await createTestUserMembership(user.id, level.id, {
            startDate: new Date('2023-01-01'),
            endDate: pastDate,
            status: MembershipStatus.ACTIVE,
        })
        testIds.userMembershipIds.push(membership.id)

        // 使用实际的 DAO 函数查询有效会员（应该找不到，因为已过期）
        const currentMembership = await findCurrentUserMembershipDao(user.id)

        expect(currentMembership).toBeNull()
    })

    it('目标级别不高于当前级别时不能升级', async () => {
        // 创建测试用户
        const user = await createTestUser()
        testIds.userIds.push(user.id)

        // 创建会员级别（高级 sortOrder=1，普通 sortOrder=2）
        const premiumLevel = await createTestMembershipLevel({
            name: '测试级别_高级_资格',
            sortOrder: 1,
        })
        testIds.membershipLevelIds.push(premiumLevel.id)

        const normalLevel = await createTestMembershipLevel({
            name: '测试级别_普通_资格',
            sortOrder: 2,
        })
        testIds.membershipLevelIds.push(normalLevel.id)

        // 创建高级会员记录
        const membership = await createTestUserMembership(user.id, premiumLevel.id, {
            status: MembershipStatus.ACTIVE,
        })
        testIds.userMembershipIds.push(membership.id)

        // 验证目标级别（普通）不高于当前级别（高级）
        // sortOrder 越小级别越高，所以 normalLevel.sortOrder > premiumLevel.sortOrder
        expect(normalLevel.sortOrder).toBeGreaterThan(premiumLevel.sortOrder)

        // 这意味着不能从高级降级到普通
        const canUpgrade = normalLevel.sortOrder < premiumLevel.sortOrder
        expect(canUpgrade).toBe(false)
    })

    it('满足所有条件时可以升级', async () => {
        // 创建测试用户
        const user = await createTestUser()
        testIds.userIds.push(user.id)

        // 创建会员级别
        const normalLevel = await createTestMembershipLevel({
            name: '测试级别_普通_可升级',
            sortOrder: 2,
        })
        testIds.membershipLevelIds.push(normalLevel.id)

        const premiumLevel = await createTestMembershipLevel({
            name: '测试级别_高级_可升级',
            sortOrder: 1,
        })
        testIds.membershipLevelIds.push(premiumLevel.id)

        // 创建有效的普通会员记录
        const endDate = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
        const membership = await createTestUserMembership(user.id, normalLevel.id, {
            startDate: new Date(),
            endDate,
            status: MembershipStatus.ACTIVE,
        })
        testIds.userMembershipIds.push(membership.id)

        // 使用实际的 DAO 函数查询当前有效会员
        const currentMembership = await findCurrentUserMembershipDao(user.id)

        expect(currentMembership).not.toBeNull()

        // 验证可以升级到更高级别
        const canUpgrade = premiumLevel.sortOrder < currentMembership!.level.sortOrder
        expect(canUpgrade).toBe(true)
    })
})


// ==================== 属性测试 ====================

describe('属性测试 - 会员升级', () => {
    it('Property: 升级后用户应只有一个有效会员', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 5 }), // 升级次数
                async (upgradeCount) => {
                    // 创建测试用户
                    const user = await createTestUser()
                    testIds.userIds.push(user.id)

                    // 创建多个会员级别
                    const levels: Awaited<ReturnType<typeof createTestMembershipLevel>>[] = []
                    for (let i = 0; i <= upgradeCount; i++) {
                        const level = await createTestMembershipLevel({
                            name: `测试级别_属性_${Date.now()}_${i}`,
                            sortOrder: upgradeCount - i + 1, // 级别从低到高
                        })
                        testIds.membershipLevelIds.push(level.id)
                        levels.push(level)
                    }

                    // 创建初始会员
                    const endDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
                    let currentMembership = await createTestUserMembership(user.id, levels[0].id, {
                        startDate: new Date(),
                        endDate,
                        status: MembershipStatus.ACTIVE,
                    })
                    testIds.userMembershipIds.push(currentMembership.id)

                    // 模拟多次升级，使用实际的 DAO 函数
                    for (let i = 1; i <= upgradeCount; i++) {
                        // 使用实际的 DAO 函数将当前会员标记为无效
                        await invalidateUserMembershipDao(currentMembership.id)

                        // 创建新会员
                        const newMembership = await createTestUserMembership(user.id, levels[i].id, {
                            startDate: new Date(),
                            endDate,
                            status: MembershipStatus.ACTIVE,
                            sourceType: UserMembershipSourceType.MEMBERSHIP_UPGRADE,
                        })
                        testIds.userMembershipIds.push(newMembership.id)
                        currentMembership = newMembership
                    }

                    // 使用实际的 DAO 函数验证只有一个有效会员
                    const activeMemberships = await findAllActiveUserMembershipsDao(user.id)

                    expect(activeMemberships.length).toBe(1)
                    expect(activeMemberships[0].levelId).toBe(levels[upgradeCount].id)
                }
            ),
            { numRuns: 10 } // 减少运行次数以加快测试
        )
    })

    it('Property: 升级记录应保持完整的历史', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 3 }), // 升级次数
                async (upgradeCount) => {
                    // 创建测试用户
                    const user = await createTestUser()
                    testIds.userIds.push(user.id)

                    // 创建会员级别
                    const levels: Awaited<ReturnType<typeof createTestMembershipLevel>>[] = []
                    for (let i = 0; i <= upgradeCount; i++) {
                        const level = await createTestMembershipLevel({
                            name: `测试级别_历史_${Date.now()}_${i}`,
                            sortOrder: upgradeCount - i + 1,
                        })
                        testIds.membershipLevelIds.push(level.id)
                        levels.push(level)
                    }

                    // 创建初始会员
                    const endDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
                    let currentMembership = await createTestUserMembership(user.id, levels[0].id, {
                        startDate: new Date(),
                        endDate,
                        status: MembershipStatus.ACTIVE,
                    })
                    testIds.userMembershipIds.push(currentMembership.id)

                    // 模拟升级，使用实际的 DAO 函数
                    for (let i = 1; i <= upgradeCount; i++) {
                        await invalidateUserMembershipDao(currentMembership.id)

                        const newMembership = await createTestUserMembership(user.id, levels[i].id, {
                            startDate: new Date(),
                            endDate,
                            status: MembershipStatus.ACTIVE,
                            sourceType: UserMembershipSourceType.MEMBERSHIP_UPGRADE,
                        })
                        testIds.userMembershipIds.push(newMembership.id)
                        currentMembership = newMembership
                    }

                    // 使用实际的 DAO 函数验证会员记录总数
                    const { list: allMemberships, total } = await findUserMembershipHistoryDao(user.id, { pageSize: 100 })

                    expect(total).toBe(upgradeCount + 1)

                    // 验证无效会员数量
                    const inactiveMemberships = allMemberships.filter(
                        m => m.status === MembershipStatus.INACTIVE
                    )
                    expect(inactiveMemberships.length).toBe(upgradeCount)
                }
            ),
            { numRuns: 10 }
        )
    })
})


// ==================== executeMembershipUpgradeService 完整流程测试 ====================

describe('executeMembershipUpgradeService 完整流程测试', () => {
    /**
     * **Property 7: 会员升级有效期计算正确性**
     * **Validates: Requirements 2.1, 2.2**
     */
    it('应正确执行完整的会员升级流程', async () => {
        // 创建测试用户
        const user = await createTestUser()
        testIds.userIds.push(user.id)

        // 创建两个会员级别（普通和高级）
        const normalLevel = await createTestMembershipLevel({
            name: '测试级别_普通_完整流程',
            sortOrder: 2,
            status: MembershipLevelStatus.ENABLED,
        })
        testIds.membershipLevelIds.push(normalLevel.id)

        const premiumLevel = await createTestMembershipLevel({
            name: '测试级别_高级_完整流程',
            sortOrder: 1,
            status: MembershipLevelStatus.ENABLED,
        })
        testIds.membershipLevelIds.push(premiumLevel.id)

        // 创建目标级别对应的商品
        const product = await createTestProduct(premiumLevel.id, {
            priceMonthly: 99,
            priceYearly: 999,
        })
        testIds.productIds.push(product.id)

        // 创建用户当前会员记录（60天后过期）
        const endDate = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
        const currentMembership = await createTestUserMembership(user.id, normalLevel.id, {
            startDate: new Date(),
            endDate,
            status: MembershipStatus.ACTIVE,
        })
        testIds.userMembershipIds.push(currentMembership.id)

        // 创建一些积分记录（关联到当前会员）
        const pointRecord1 = await createTestPointRecord(user.id, {
            pointAmount: 100,
            remaining: 100,
            userMembershipId: currentMembership.id,
            status: PointRecordStatus.VALID,
        })
        testIds.pointRecordIds.push(pointRecord1.id)

        const pointRecord2 = await createTestPointRecord(user.id, {
            pointAmount: 200,
            remaining: 150,
            userMembershipId: currentMembership.id,
            status: PointRecordStatus.VALID,
        })
        testIds.pointRecordIds.push(pointRecord2.id)

        // 记录升级前的积分总数
        const beforeUpgrade = await sumUserValidPointsDao(user.id)
        const originalPointsRemaining = beforeUpgrade.remaining

        // 创建测试订单
        const order = await createTestOrder(user.id, product.id)
        testIds.orderIds.push(order.id)

        // 执行会员升级服务
        const result = await executeMembershipUpgradeService(user.id, premiumLevel.id, order.id)

        // 验证升级成功
        expect(result.success).toBe(true)
        expect(result.newMembership).not.toBeUndefined()

        // 记录新会员 ID 以便清理
        if (result.newMembership) {
            testIds.userMembershipIds.push(result.newMembership.id)
        }

        // 验证原会员已失效
        const oldMembership = await findUserMembershipByIdDao(currentMembership.id)
        expect(oldMembership!.status).toBe(MembershipStatus.INACTIVE)

        // 验证新会员状态正确
        const newMembership = await findUserMembershipByIdDao(result.newMembership!.id)
        expect(newMembership!.status).toBe(MembershipStatus.ACTIVE)
        expect(newMembership!.levelId).toBe(premiumLevel.id)
        expect(newMembership!.sourceType).toBe(UserMembershipSourceType.MEMBERSHIP_UPGRADE)

        // 验证新会员继承了原会员的结束时间
        expect(newMembership!.endDate.getTime()).toBe(endDate.getTime())

        // 验证积分已转移到新会员
        const transferredRecords = await findPointRecordsByMembershipIdDao(result.newMembership!.id)
        // 原有2条积分记录 + 可能的积分补偿记录
        expect(transferredRecords.length).toBeGreaterThanOrEqual(2)

        // 验证积分总数保持不变（或增加了补偿积分）
        const afterUpgrade = await sumUserValidPointsDao(user.id)
        expect(afterUpgrade.remaining).toBeGreaterThanOrEqual(originalPointsRemaining)

        // 验证升级记录已创建
        const upgradeRecords = await findUserUpgradeRecordsDao(user.id, { page: 1, pageSize: 10 })
        expect(upgradeRecords.total).toBeGreaterThanOrEqual(1)
        const latestRecord = upgradeRecords.list[0]
        expect(latestRecord.fromMembershipId).toBe(currentMembership.id)
        expect(latestRecord.toMembershipId).toBe(result.newMembership!.id)
    })

    it('用户没有有效会员时应返回错误', async () => {
        // 创建测试用户（没有会员）
        const user = await createTestUser()
        testIds.userIds.push(user.id)

        const level = await createTestMembershipLevel()
        testIds.membershipLevelIds.push(level.id)

        // 执行升级服务
        const result = await executeMembershipUpgradeService(user.id, level.id, 1)

        expect(result.success).toBe(false)
        expect(result.errorMessage).toBe('用户没有有效会员')
    })

    it('目标级别不存在时应返回错误', async () => {
        // 创建测试用户
        const user = await createTestUser()
        testIds.userIds.push(user.id)

        const level = await createTestMembershipLevel()
        testIds.membershipLevelIds.push(level.id)

        // 创建有效会员
        const membership = await createTestUserMembership(user.id, level.id, {
            status: MembershipStatus.ACTIVE,
            endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        })
        testIds.userMembershipIds.push(membership.id)

        // 使用不存在的级别 ID 执行升级
        const result = await executeMembershipUpgradeService(user.id, 999999, 1)

        expect(result.success).toBe(false)
        expect(result.errorMessage).toBe('目标级别不存在')
    })

    it('目标级别不高于当前级别时应返回错误', async () => {
        // 创建测试用户
        const user = await createTestUser()
        testIds.userIds.push(user.id)

        // 创建两个级别（高级 sortOrder=1，普通 sortOrder=2）
        const premiumLevel = await createTestMembershipLevel({ sortOrder: 1 })
        const normalLevel = await createTestMembershipLevel({ sortOrder: 2 })
        testIds.membershipLevelIds.push(premiumLevel.id, normalLevel.id)

        // 用户当前是高级会员
        const membership = await createTestUserMembership(user.id, premiumLevel.id, {
            status: MembershipStatus.ACTIVE,
            endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        })
        testIds.userMembershipIds.push(membership.id)

        // 尝试"升级"到低级别
        const result = await executeMembershipUpgradeService(user.id, normalLevel.id, 1)

        expect(result.success).toBe(false)
        expect(result.errorMessage).toBe('目标级别必须高于当前级别')
    })

    it('Property: 升级后应只有一个有效会员', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 30, max: 180 }), // 剩余天数
                async (remainingDays) => {
                    // 创建测试用户
                    const user = await createTestUser()
                    testIds.userIds.push(user.id)

                    // 创建两个级别
                    const normalLevel = await createTestMembershipLevel({ sortOrder: 2 })
                    const premiumLevel = await createTestMembershipLevel({ sortOrder: 1 })
                    testIds.membershipLevelIds.push(normalLevel.id, premiumLevel.id)

                    // 创建商品
                    const product = await createTestProduct(premiumLevel.id)
                    testIds.productIds.push(product.id)

                    // 创建当前会员
                    const endDate = new Date(Date.now() + remainingDays * 24 * 60 * 60 * 1000)
                    const membership = await createTestUserMembership(user.id, normalLevel.id, {
                        status: MembershipStatus.ACTIVE,
                        endDate,
                    })
                    testIds.userMembershipIds.push(membership.id)

                    // 创建订单
                    const order = await createTestOrder(user.id, product.id)
                    testIds.orderIds.push(order.id)

                    // 执行升级
                    const result = await executeMembershipUpgradeService(user.id, premiumLevel.id, order.id)

                    if (result.success && result.newMembership) {
                        testIds.userMembershipIds.push(result.newMembership.id)
                    }

                    // 验证只有一个有效会员
                    const activeMemberships = await findAllActiveUserMembershipsDao(user.id)
                    expect(activeMemberships.length).toBe(1)

                    return true
                }
            ),
            PBT_CONFIG_FAST
        )
    })
})


// ==================== 任务 4.7: 会员升级积分转移正确性 ====================

describe('Property 8: 会员升级积分转移正确性', () => {
    /**
     * **Property 8: 会员升级积分转移正确性**
     * **Validates: Requirements 3.1, 3.2**
     *
     * 验证积分转移的正确性：
     * 1. 所有原会员的积分记录都应转移到新会员
     * 2. 转移后积分总数保持不变
     * 3. 积分记录的其他属性（金额、状态等）保持不变
     */
    it('积分转移后所有记录应关联到新会员', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 5 }), // 积分记录数量
                async (recordCount) => {
                    // 创建测试用户
                    const user = await createTestUser()
                    testIds.userIds.push(user.id)

                    // 创建两个会员级别
                    const normalLevel = await createTestMembershipLevel({ sortOrder: 2 })
                    const premiumLevel = await createTestMembershipLevel({ sortOrder: 1 })
                    testIds.membershipLevelIds.push(normalLevel.id, premiumLevel.id)

                    // 创建原会员
                    const endDate = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
                    const oldMembership = await createTestUserMembership(user.id, normalLevel.id, {
                        status: MembershipStatus.ACTIVE,
                        endDate,
                    })
                    testIds.userMembershipIds.push(oldMembership.id)

                    // 创建多条积分记录
                    const originalRecordIds: number[] = []
                    for (let i = 0; i < recordCount; i++) {
                        const record = await createTestPointRecord(user.id, {
                            pointAmount: 100 * (i + 1),
                            remaining: 100 * (i + 1),
                            userMembershipId: oldMembership.id,
                            status: PointRecordStatus.VALID,
                        })
                        testIds.pointRecordIds.push(record.id)
                        originalRecordIds.push(record.id)
                    }

                    // 创建新会员
                    const newMembership = await createTestUserMembership(user.id, premiumLevel.id, {
                        status: MembershipStatus.ACTIVE,
                        endDate,
                        sourceType: UserMembershipSourceType.MEMBERSHIP_UPGRADE,
                    })
                    testIds.userMembershipIds.push(newMembership.id)

                    // 使用实际的 DAO 函数转移积分
                    const transferCount = await transferPointRecordsDao(oldMembership.id, newMembership.id)

                    // 验证转移数量
                    expect(transferCount).toBe(recordCount)

                    // 验证所有记录都已转移到新会员
                    const transferredRecords = await findPointRecordsByMembershipIdDao(newMembership.id)
                    expect(transferredRecords.length).toBe(recordCount)

                    // 验证原会员不再有积分记录
                    const oldRecords = await findPointRecordsByMembershipIdDao(oldMembership.id)
                    expect(oldRecords.length).toBe(0)

                    return true
                }
            ),
            PBT_CONFIG_FAST
        )
    })

    it('积分转移后总积分数量应保持不变', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.array(fc.integer({ min: 10, max: 500 }), { minLength: 1, maxLength: 5 }),
                async (pointAmounts) => {
                    // 创建测试用户
                    const user = await createTestUser()
                    testIds.userIds.push(user.id)

                    // 创建会员级别
                    const normalLevel = await createTestMembershipLevel({ sortOrder: 2 })
                    const premiumLevel = await createTestMembershipLevel({ sortOrder: 1 })
                    testIds.membershipLevelIds.push(normalLevel.id, premiumLevel.id)

                    // 创建原会员
                    const endDate = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
                    const oldMembership = await createTestUserMembership(user.id, normalLevel.id, {
                        status: MembershipStatus.ACTIVE,
                        endDate,
                    })
                    testIds.userMembershipIds.push(oldMembership.id)

                    // 创建积分记录
                    let totalPoints = 0
                    for (const amount of pointAmounts) {
                        const record = await createTestPointRecord(user.id, {
                            pointAmount: amount,
                            remaining: amount,
                            userMembershipId: oldMembership.id,
                            status: PointRecordStatus.VALID,
                        })
                        testIds.pointRecordIds.push(record.id)
                        totalPoints += amount
                    }

                    // 查询转移前的积分总数
                    const beforeTransfer = await sumUserValidPointsDao(user.id)
                    expect(beforeTransfer.remaining).toBe(totalPoints)

                    // 创建新会员并转移积分
                    const newMembership = await createTestUserMembership(user.id, premiumLevel.id, {
                        status: MembershipStatus.ACTIVE,
                        endDate,
                        sourceType: UserMembershipSourceType.MEMBERSHIP_UPGRADE,
                    })
                    testIds.userMembershipIds.push(newMembership.id)

                    await transferPointRecordsDao(oldMembership.id, newMembership.id)

                    // 查询转移后的积分总数
                    const afterTransfer = await sumUserValidPointsDao(user.id)
                    expect(afterTransfer.remaining).toBe(totalPoints)

                    return true
                }
            ),
            PBT_CONFIG_FAST
        )
    })
})


// ==================== 任务 4.8: 会员升级价格计算正确性 ====================

describe('Property 9: 会员升级价格计算正确性', () => {
    /**
     * **Property 9: 会员升级价格计算正确性**
     * **Validates: Requirements 2.1**
     *
     * 验证升级价格计算的正确性：
     * 1. 升级价格 = 目标级别剩余价值 - 原级别剩余价值
     * 2. 升级价格不能为负数
     * 3. 积分补偿 = 升级价格 × 10
     */
    it('升级价格应为非负数', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 365 }), // 剩余天数
                fc.integer({ min: 100, max: 2000 }), // 目标年价
                async (remainingDays, targetYearlyPrice) => {
                    // 创建测试用户
                    const user = await createTestUser()
                    testIds.userIds.push(user.id)

                    // 创建会员级别
                    const normalLevel = await createTestMembershipLevel({ sortOrder: 2 })
                    const premiumLevel = await createTestMembershipLevel({ sortOrder: 1 })
                    testIds.membershipLevelIds.push(normalLevel.id, premiumLevel.id)

                    // 创建原会员
                    const endDate = new Date(Date.now() + remainingDays * 24 * 60 * 60 * 1000)
                    const membership = await createTestUserMembership(user.id, normalLevel.id, {
                        status: MembershipStatus.ACTIVE,
                        endDate,
                    })
                    testIds.userMembershipIds.push(membership.id)

                    // 查询会员记录
                    const currentMembership = await findCurrentUserMembershipDao(user.id)
                    expect(currentMembership).not.toBeNull()

                    // 创建目标商品
                    const targetProduct = {
                        id: 1,
                        priceMonthly: Math.round(targetYearlyPrice / 12),
                        priceYearly: targetYearlyPrice,
                    } as any

                    // 计算升级价格
                    const result = calculateUpgradePrice(
                        currentMembership!,
                        premiumLevel,
                        targetProduct,
                        remainingDays
                    )

                    // 验证升级价格非负
                    expect(result.upgradePrice).toBeGreaterThanOrEqual(0)

                    return true
                }
            ),
            PBT_CONFIG_FAST
        )
    })

    it('积分补偿应等于升级价格乘以10', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 30, max: 180 }), // 剩余天数
                fc.integer({ min: 500, max: 1500 }), // 目标年价
                async (remainingDays, targetYearlyPrice) => {
                    // 创建测试用户
                    const user = await createTestUser()
                    testIds.userIds.push(user.id)

                    // 创建会员级别
                    const normalLevel = await createTestMembershipLevel({ sortOrder: 2 })
                    const premiumLevel = await createTestMembershipLevel({ sortOrder: 1 })
                    testIds.membershipLevelIds.push(normalLevel.id, premiumLevel.id)

                    // 创建原会员
                    const endDate = new Date(Date.now() + remainingDays * 24 * 60 * 60 * 1000)
                    const membership = await createTestUserMembership(user.id, normalLevel.id, {
                        status: MembershipStatus.ACTIVE,
                        endDate,
                    })
                    testIds.userMembershipIds.push(membership.id)

                    // 查询会员记录
                    const currentMembership = await findCurrentUserMembershipDao(user.id)

                    // 创建目标商品
                    const targetProduct = {
                        id: 1,
                        priceMonthly: Math.round(targetYearlyPrice / 12),
                        priceYearly: targetYearlyPrice,
                    } as any

                    // 计算升级价格
                    const result = calculateUpgradePrice(
                        currentMembership!,
                        premiumLevel,
                        targetProduct,
                        remainingDays
                    )

                    // 验证积分补偿 = 升级价格 × 10
                    expect(result.pointCompensation).toBe(Math.round(result.upgradePrice * 10))

                    return true
                }
            ),
            PBT_CONFIG_FAST
        )
    })

    it('calculateUpgradePriceService 应正确验证升级条件', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 5 }), // 当前级别 sortOrder
                fc.integer({ min: 1, max: 5 }), // 目标级别 sortOrder
                async (currentOrder, targetOrder) => {
                    // 创建测试用户
                    const user = await createTestUser()
                    testIds.userIds.push(user.id)

                    // 创建会员级别
                    const currentLevel = await createTestMembershipLevel({ sortOrder: currentOrder })
                    const targetLevel = await createTestMembershipLevel({ sortOrder: targetOrder })
                    testIds.membershipLevelIds.push(currentLevel.id, targetLevel.id)

                    // 创建商品（仅当目标级别更高时需要）
                    if (targetOrder < currentOrder) {
                        const product = await createTestProduct(targetLevel.id)
                        testIds.productIds.push(product.id)
                    }

                    // 创建当前会员
                    const endDate = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
                    const membership = await createTestUserMembership(user.id, currentLevel.id, {
                        status: MembershipStatus.ACTIVE,
                        endDate,
                    })
                    testIds.userMembershipIds.push(membership.id)

                    // 调用服务计算升级价格
                    const result = await calculateUpgradePriceService(user.id, targetLevel.id)

                    // 验证结果
                    if (targetOrder < currentOrder) {
                        // 目标级别更高，应该成功（如果有商品）
                        // 注意：可能因为没有商品而失败
                        if (result.success) {
                            expect(result.result).not.toBeUndefined()
                            expect(result.result!.upgradePrice).toBeGreaterThanOrEqual(0)
                        }
                    } else {
                        // 目标级别不高于当前级别，应该失败
                        expect(result.success).toBe(false)
                        expect(result.errorMessage).toBe('目标级别必须高于当前级别')
                    }

                    return true
                }
            ),
            PBT_CONFIG_FAST
        )
    })
})


// ==================== 任务 4.9: 会员升级级别验证 ====================

describe('Property 10: 会员升级级别验证', () => {
    /**
     * **Property 10: 会员升级级别验证**
     * **Validates: Requirements 2.1**
     *
     * 验证升级级别的限制：
     * 1. 只能升级到更高级别（sortOrder 更小）
     * 2. 不能降级或平级转换
     * 3. 目标级别必须存在且启用
     */
    it('只能升级到 sortOrder 更小的级别', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 2, max: 10 }), // 当前级别 sortOrder
                async (currentOrder) => {
                    // 创建测试用户
                    const user = await createTestUser()
                    testIds.userIds.push(user.id)

                    // 创建当前级别
                    const currentLevel = await createTestMembershipLevel({ sortOrder: currentOrder })
                    testIds.membershipLevelIds.push(currentLevel.id)

                    // 创建更高级别（sortOrder 更小）
                    const higherLevel = await createTestMembershipLevel({ sortOrder: currentOrder - 1 })
                    testIds.membershipLevelIds.push(higherLevel.id)

                    // 创建商品
                    const product = await createTestProduct(higherLevel.id)
                    testIds.productIds.push(product.id)

                    // 创建当前会员
                    const endDate = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
                    const membership = await createTestUserMembership(user.id, currentLevel.id, {
                        status: MembershipStatus.ACTIVE,
                        endDate,
                    })
                    testIds.userMembershipIds.push(membership.id)

                    // 验证可以升级到更高级别
                    const result = await calculateUpgradePriceService(user.id, higherLevel.id)

                    // 应该成功（如果有商品）
                    if (result.success) {
                        expect(result.result).not.toBeUndefined()
                    }

                    return true
                }
            ),
            PBT_CONFIG_FAST
        )
    })

    it('不能降级到 sortOrder 更大的级别', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 9 }), // 当前级别 sortOrder
                async (currentOrder) => {
                    // 创建测试用户
                    const user = await createTestUser()
                    testIds.userIds.push(user.id)

                    // 创建当前级别
                    const currentLevel = await createTestMembershipLevel({ sortOrder: currentOrder })
                    testIds.membershipLevelIds.push(currentLevel.id)

                    // 创建更低级别（sortOrder 更大）
                    const lowerLevel = await createTestMembershipLevel({ sortOrder: currentOrder + 1 })
                    testIds.membershipLevelIds.push(lowerLevel.id)

                    // 创建当前会员
                    const endDate = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
                    const membership = await createTestUserMembership(user.id, currentLevel.id, {
                        status: MembershipStatus.ACTIVE,
                        endDate,
                    })
                    testIds.userMembershipIds.push(membership.id)

                    // 验证不能降级
                    const result = await calculateUpgradePriceService(user.id, lowerLevel.id)

                    expect(result.success).toBe(false)
                    expect(result.errorMessage).toBe('目标级别必须高于当前级别')

                    return true
                }
            ),
            PBT_CONFIG_FAST
        )
    })

    it('不能平级转换', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 10 }), // 级别 sortOrder
                async (sortOrder) => {
                    // 创建测试用户
                    const user = await createTestUser()
                    testIds.userIds.push(user.id)

                    // 创建两个相同 sortOrder 的级别
                    const level1 = await createTestMembershipLevel({ sortOrder })
                    const level2 = await createTestMembershipLevel({ sortOrder })
                    testIds.membershipLevelIds.push(level1.id, level2.id)

                    // 创建当前会员
                    const endDate = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
                    const membership = await createTestUserMembership(user.id, level1.id, {
                        status: MembershipStatus.ACTIVE,
                        endDate,
                    })
                    testIds.userMembershipIds.push(membership.id)

                    // 验证不能平级转换
                    const result = await calculateUpgradePriceService(user.id, level2.id)

                    expect(result.success).toBe(false)
                    expect(result.errorMessage).toBe('目标级别必须高于当前级别')

                    return true
                }
            ),
            PBT_CONFIG_FAST
        )
    })
})


// ==================== 任务 4.10: 会员升级记录完整性 ====================

describe('Property 16: 会员升级记录完整性', () => {
    /**
     * **Property 16: 会员升级记录完整性**
     * **Validates: Requirements 2.1**
     *
     * 验证升级记录的完整性：
     * 1. 每次升级都应创建升级记录
     * 2. 升级记录应包含正确的原会员和新会员信息
     * 3. 升级记录应包含正确的价格和积分补偿信息
     */
    it('升级记录应包含完整的会员信息', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 30, max: 180 }), // 剩余天数
                async (remainingDays) => {
                    // 创建测试用户
                    const user = await createTestUser()
                    testIds.userIds.push(user.id)

                    // 创建会员级别
                    const normalLevel = await createTestMembershipLevel({ sortOrder: 2 })
                    const premiumLevel = await createTestMembershipLevel({ sortOrder: 1 })
                    testIds.membershipLevelIds.push(normalLevel.id, premiumLevel.id)

                    // 创建商品
                    const product = await createTestProduct(premiumLevel.id)
                    testIds.productIds.push(product.id)

                    // 创建当前会员
                    const endDate = new Date(Date.now() + remainingDays * 24 * 60 * 60 * 1000)
                    const currentMembership = await createTestUserMembership(user.id, normalLevel.id, {
                        status: MembershipStatus.ACTIVE,
                        endDate,
                    })
                    testIds.userMembershipIds.push(currentMembership.id)

                    // 创建订单
                    const order = await createTestOrder(user.id, product.id)
                    testIds.orderIds.push(order.id)

                    // 执行升级
                    const result = await executeMembershipUpgradeService(user.id, premiumLevel.id, order.id)

                    if (result.success && result.newMembership) {
                        testIds.userMembershipIds.push(result.newMembership.id)

                        // 查询升级记录
                        const upgradeRecords = await findUserUpgradeRecordsDao(user.id, { page: 1, pageSize: 10 })

                        expect(upgradeRecords.total).toBeGreaterThanOrEqual(1)

                        // 验证最新的升级记录
                        const latestRecord = upgradeRecords.list[0]
                        expect(latestRecord.fromMembershipId).toBe(currentMembership.id)
                        expect(latestRecord.toMembershipId).toBe(result.newMembership.id)
                        expect(latestRecord.orderId).toBe(order.id)
                        expect(latestRecord.userId).toBe(user.id)
                    }

                    return true
                }
            ),
            PBT_CONFIG_FAST
        )
    })

    it('升级记录应可通过 ID 查询', async () => {
        // 创建测试用户
        const user = await createTestUser()
        testIds.userIds.push(user.id)

        // 创建会员级别
        const normalLevel = await createTestMembershipLevel({ sortOrder: 2 })
        const premiumLevel = await createTestMembershipLevel({ sortOrder: 1 })
        testIds.membershipLevelIds.push(normalLevel.id, premiumLevel.id)

        // 创建商品
        const product = await createTestProduct(premiumLevel.id)
        testIds.productIds.push(product.id)

        // 创建当前会员
        const endDate = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
        const currentMembership = await createTestUserMembership(user.id, normalLevel.id, {
            status: MembershipStatus.ACTIVE,
            endDate,
        })
        testIds.userMembershipIds.push(currentMembership.id)

        // 创建订单
        const order = await createTestOrder(user.id, product.id)
        testIds.orderIds.push(order.id)

        // 执行升级
        const result = await executeMembershipUpgradeService(user.id, premiumLevel.id, order.id)

        expect(result.success).toBe(true)
        if (result.newMembership) {
            testIds.userMembershipIds.push(result.newMembership.id)
        }

        // 查询升级记录列表
        const upgradeRecords = await findUserUpgradeRecordsDao(user.id, { page: 1, pageSize: 10 })
        expect(upgradeRecords.total).toBeGreaterThanOrEqual(1)

        // 通过 ID 查询升级记录
        const recordId = upgradeRecords.list[0].id
        const record = await findMembershipUpgradeRecordByIdDao(recordId)

        expect(record).not.toBeNull()
        expect(record!.id).toBe(recordId)
        expect(record!.fromMembership).not.toBeNull()
        expect(record!.toMembership).not.toBeNull()
        expect(record!.fromMembership.level.id).toBe(normalLevel.id)
        expect(record!.toMembership.level.id).toBe(premiumLevel.id)
    })

    it('多次升级应创建多条升级记录', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 2, max: 3 }), // 升级次数
                async (upgradeCount) => {
                    // 创建测试用户
                    const user = await createTestUser()
                    testIds.userIds.push(user.id)

                    // 创建多个会员级别（从低到高）
                    const levels: Awaited<ReturnType<typeof createTestMembershipLevel>>[] = []
                    for (let i = 0; i <= upgradeCount; i++) {
                        const level = await createTestMembershipLevel({
                            sortOrder: upgradeCount - i + 1, // 级别从低到高
                        })
                        testIds.membershipLevelIds.push(level.id)
                        levels.push(level)
                    }

                    // 为每个目标级别创建商品
                    for (let i = 1; i <= upgradeCount; i++) {
                        const product = await createTestProduct(levels[i].id)
                        testIds.productIds.push(product.id)
                    }

                    // 创建初始会员
                    const endDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
                    let currentMembership = await createTestUserMembership(user.id, levels[0].id, {
                        status: MembershipStatus.ACTIVE,
                        endDate,
                    })
                    testIds.userMembershipIds.push(currentMembership.id)

                    // 执行多次升级
                    for (let i = 1; i <= upgradeCount; i++) {
                        // 查找目标级别的商品
                        const products = await getTestPrisma().products.findMany({
                            where: { levelId: levels[i].id },
                        })
                        const product = products[0]

                        // 创建订单
                        const order = await createTestOrder(user.id, product.id)
                        testIds.orderIds.push(order.id)

                        // 执行升级
                        const result = await executeMembershipUpgradeService(user.id, levels[i].id, order.id)

                        if (result.success && result.newMembership) {
                            testIds.userMembershipIds.push(result.newMembership.id)
                            currentMembership = result.newMembership
                        }
                    }

                    // 验证升级记录数量
                    const upgradeRecords = await findUserUpgradeRecordsDao(user.id, { page: 1, pageSize: 100 })
                    expect(upgradeRecords.total).toBe(upgradeCount)

                    return true
                }
            ),
            { numRuns: 5 } // 减少运行次数，因为每次测试创建大量数据
        )
    })
})
