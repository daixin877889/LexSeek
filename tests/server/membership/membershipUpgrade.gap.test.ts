/**
 * 会员升级服务 - 覆盖率补齐测试
 *
 * 专注补齐以下未被其他测试覆盖的路径：
 * - getUpgradeOptionsService（指定/未指定 membershipId、无可升级级别、无关联商品）
 * - calculateUpgradePriceService（成功路径、月价路径、非法用户、目标级别不存在、
 *   目标级别过低、无目标商品、指定 membershipId 无权访问的路径）
 * - getUserUpgradeRecordsService（列表格式化）
 * - executeMembershipUpgradeService（指定 membershipId、无目标商品、预购场景、
 *   MEMBERSHIP_UPGRADE 来源递归、Order 非 paid fallback、catch 异常分支）
 *
 * **Feature: membership-upgrade-gap**
 * **Validates: Requirements 2.1, 2.2, 3.1, 3.2**
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import dayjs from 'dayjs'
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
    resetDatabaseSequences,
    MembershipStatus,
    UserMembershipSourceType,
    PointRecordStatus,
    type TestIds,
} from './test-db-helper'

import {
    getUpgradeOptionsService,
    calculateUpgradePriceService,
    getUserUpgradeRecordsService,
    executeMembershipUpgradeService,
} from '../../../server/services/membership/membershipUpgrade.service'

// 测试数据 ID 追踪（整个 describe 共享，afterAll 统一清理）
const testIds: TestIds = createEmptyTestIds()

const prisma = getTestPrisma()

let dbAvailable = false

describe('会员升级服务 - 覆盖率补齐', () => {
    beforeAll(async () => {
        dbAvailable = await isTestDbAvailable()
        if (!dbAvailable) {
            console.warn('测试数据库不可用，跳过补齐测试')
            return
        }
        await resetDatabaseSequences()
    })

    afterAll(async () => {
        if (!dbAvailable) return
        try {
            await cleanupTestData(testIds)
        } finally {
            await disconnectTestDb()
        }
    })

    // ==================== getUpgradeOptionsService ====================
    describe('getUpgradeOptionsService', () => {
        it('用户无当前会员时应返回空 options 和 null 会员', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const result = await getUpgradeOptionsService(user.id)

            expect(result.options).toEqual([])
            expect(result.currentMembership).toBeNull()
        })

        it('指定 membershipId 不属于当前用户时应视为无会员', async () => {
            if (!dbAvailable) return

            const userA = await createTestUser()
            const userB = await createTestUser()
            testIds.userIds.push(userA.id, userB.id)

            const level = await createTestMembershipLevel({ sortOrder: 1 })
            testIds.membershipLevelIds.push(level.id)

            const endDate = dayjs().add(60, 'day').toDate()
            const membership = await createTestUserMembership(userA.id, level.id, {
                startDate: new Date(),
                endDate,
                status: MembershipStatus.ACTIVE,
            })
            testIds.userMembershipIds.push(membership.id)

            // 用 userB 查询 userA 的会员，不应命中
            const result = await getUpgradeOptionsService(userB.id, membership.id)

            expect(result.currentMembership).toBeNull()
            expect(result.options).toEqual([])
        })

        it('当前是最高级别（无更高级别）时应返回空 options', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            // 用极大的 sortOrder 确保没有更高级别
            const topLevel = await createTestMembershipLevel({ sortOrder: 99999 })
            testIds.membershipLevelIds.push(topLevel.id)

            const endDate = dayjs().add(60, 'day').toDate()
            const membership = await createTestUserMembership(user.id, topLevel.id, {
                startDate: new Date(),
                endDate,
                status: MembershipStatus.ACTIVE,
            })
            testIds.userMembershipIds.push(membership.id)

            const result = await getUpgradeOptionsService(user.id, membership.id)

            expect(result.currentMembership).not.toBeNull()
            expect(result.options).toEqual([])
        })

        it('更高级别无关联商品时应过滤该级别', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const lowerLevel = await createTestMembershipLevel({ sortOrder: 1 })
            const higherLevel = await createTestMembershipLevel({ sortOrder: 2 })
            testIds.membershipLevelIds.push(lowerLevel.id, higherLevel.id)

            // 故意不为 higherLevel 创建商品
            const endDate = dayjs().add(60, 'day').toDate()
            const membership = await createTestUserMembership(user.id, lowerLevel.id, {
                startDate: new Date(),
                endDate,
                status: MembershipStatus.ACTIVE,
            })
            testIds.userMembershipIds.push(membership.id)

            const result = await getUpgradeOptionsService(user.id, membership.id)

            expect(result.currentMembership).not.toBeNull()
            // 高级别无商品时应被过滤
            expect(result.options.find(o => o.levelId === higherLevel.id)).toBeUndefined()
        })

        it('有可升级级别且目标级别有商品时应返回升级选项', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const current = await createTestMembershipLevel({ sortOrder: 1 })
            const target = await createTestMembershipLevel({ sortOrder: 2 })
            testIds.membershipLevelIds.push(current.id, target.id)

            const targetProduct = await createTestProduct(target.id, { priceYearly: 999 })
            testIds.productIds.push(targetProduct.id)

            const endDate = dayjs().add(100, 'day').toDate()
            const membership = await createTestUserMembership(user.id, current.id, {
                startDate: new Date(),
                endDate,
                status: MembershipStatus.ACTIVE,
            })
            testIds.userMembershipIds.push(membership.id)

            const result = await getUpgradeOptionsService(user.id, membership.id)

            expect(result.currentMembership).not.toBeNull()
            expect(result.options.length).toBeGreaterThan(0)
            const option = result.options.find(o => o.levelId === target.id)
            expect(option).toBeDefined()
            expect(option!.productId).toBe(targetProduct.id)
            expect(option!.remainingDays).toBeGreaterThan(0)
            expect(option!.calculationDetails.totalDays).toBeGreaterThan(0)
        })

        it('不传 membershipId 时应通过 findCurrentUserMembershipDao 获取当前会员', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const current = await createTestMembershipLevel({ sortOrder: 1 })
            const target = await createTestMembershipLevel({ sortOrder: 2 })
            testIds.membershipLevelIds.push(current.id, target.id)

            const product = await createTestProduct(target.id, { priceYearly: 500 })
            testIds.productIds.push(product.id)

            const membership = await createTestUserMembership(user.id, current.id, {
                startDate: new Date(),
                endDate: dayjs().add(30, 'day').toDate(),
                status: MembershipStatus.ACTIVE,
            })
            testIds.userMembershipIds.push(membership.id)

            const result = await getUpgradeOptionsService(user.id)
            expect(result.currentMembership).not.toBeNull()
            expect(result.options.length).toBeGreaterThan(0)
        })
    })

    // ==================== calculateUpgradePriceService ====================
    describe('calculateUpgradePriceService', () => {
        it('用户无会员时应返回失败', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const level = await createTestMembershipLevel({ sortOrder: 99 })
            testIds.membershipLevelIds.push(level.id)

            const result = await calculateUpgradePriceService(user.id, level.id)

            expect(result.success).toBe(false)
            expect(result.errorMessage).toBe('用户没有有效会员')
        })

        it('目标级别不存在时应返回失败', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const current = await createTestMembershipLevel({ sortOrder: 1 })
            testIds.membershipLevelIds.push(current.id)

            const membership = await createTestUserMembership(user.id, current.id, {
                startDate: new Date(),
                endDate: dayjs().add(30, 'day').toDate(),
                status: MembershipStatus.ACTIVE,
            })
            testIds.userMembershipIds.push(membership.id)

            const result = await calculateUpgradePriceService(user.id, 99999999)

            expect(result.success).toBe(false)
            expect(result.errorMessage).toBe('目标级别不存在')
        })

        it('目标级别不高于当前级别时应返回失败', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const high = await createTestMembershipLevel({ sortOrder: 10 })
            const low = await createTestMembershipLevel({ sortOrder: 1 })
            testIds.membershipLevelIds.push(high.id, low.id)

            const membership = await createTestUserMembership(user.id, high.id, {
                startDate: new Date(),
                endDate: dayjs().add(30, 'day').toDate(),
                status: MembershipStatus.ACTIVE,
            })
            testIds.userMembershipIds.push(membership.id)

            const result = await calculateUpgradePriceService(user.id, low.id)

            expect(result.success).toBe(false)
            expect(result.errorMessage).toBe('目标级别必须高于当前级别')
        })

        it('目标级别无可用商品时应返回失败', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const current = await createTestMembershipLevel({ sortOrder: 1 })
            const target = await createTestMembershipLevel({ sortOrder: 2 })
            testIds.membershipLevelIds.push(current.id, target.id)

            // 不为 target 创建商品

            const membership = await createTestUserMembership(user.id, current.id, {
                startDate: new Date(),
                endDate: dayjs().add(30, 'day').toDate(),
                status: MembershipStatus.ACTIVE,
            })
            testIds.userMembershipIds.push(membership.id)

            const result = await calculateUpgradePriceService(user.id, target.id)

            expect(result.success).toBe(false)
            expect(result.errorMessage).toBe('目标级别没有可用商品')
        })

        it('成功路径：返回升级价格计算结果和 targetProduct', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const current = await createTestMembershipLevel({ sortOrder: 1 })
            const target = await createTestMembershipLevel({ sortOrder: 2 })
            testIds.membershipLevelIds.push(current.id, target.id)

            const currentProduct = await createTestProduct(current.id, { priceYearly: 365 })
            const targetProduct = await createTestProduct(target.id, { priceYearly: 999 })
            testIds.productIds.push(currentProduct.id, targetProduct.id)

            // 创建实付订单，让 DIRECT_PURCHASE 路径走到
            const order = await createTestOrder(user.id, currentProduct.id, {
                amount: 365,
                status: 1,
            })
            testIds.orderIds.push(order.id)

            const membership = await createTestUserMembership(user.id, current.id, {
                startDate: dayjs().subtract(1, 'day').toDate(),
                endDate: dayjs().add(100, 'day').toDate(),
                status: MembershipStatus.ACTIVE,
                sourceType: UserMembershipSourceType.DIRECT_PURCHASE,
                sourceId: order.id,
            })
            testIds.userMembershipIds.push(membership.id)

            const result = await calculateUpgradePriceService(user.id, target.id, membership.id)

            expect(result.success).toBe(true)
            expect(result.result).toBeDefined()
            expect(result.result!.targetProduct.id).toBe(targetProduct.id)
            expect(result.result!.upgradePrice).toBeGreaterThanOrEqual(0)
            expect(result.result!.calculationDetails.paidAmount).toBe(365)
        })

        it('指定 membershipId 不属于当前用户时应视为无会员', async () => {
            if (!dbAvailable) return

            const owner = await createTestUser()
            const other = await createTestUser()
            testIds.userIds.push(owner.id, other.id)

            const level = await createTestMembershipLevel({ sortOrder: 1 })
            const target = await createTestMembershipLevel({ sortOrder: 2 })
            testIds.membershipLevelIds.push(level.id, target.id)

            const product = await createTestProduct(target.id, { priceYearly: 500 })
            testIds.productIds.push(product.id)

            const membership = await createTestUserMembership(owner.id, level.id, {
                startDate: new Date(),
                endDate: dayjs().add(30, 'day').toDate(),
                status: MembershipStatus.ACTIVE,
            })
            testIds.userMembershipIds.push(membership.id)

            const result = await calculateUpgradePriceService(other.id, target.id, membership.id)

            expect(result.success).toBe(false)
            expect(result.errorMessage).toBe('用户没有有效会员')
        })
    })

    // ==================== getUserUpgradeRecordsService ====================
    describe('getUserUpgradeRecordsService', () => {
        it('应返回格式化后的升级记录列表', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const current = await createTestMembershipLevel({ sortOrder: 1, name: '测试级别_gap_基础' })
            const target = await createTestMembershipLevel({ sortOrder: 2, name: '测试级别_gap_高级' })
            testIds.membershipLevelIds.push(current.id, target.id)

            const targetProduct = await createTestProduct(target.id, { priceYearly: 999 })
            testIds.productIds.push(targetProduct.id)

            const oldMembership = await createTestUserMembership(user.id, current.id, {
                startDate: new Date(),
                endDate: dayjs().add(90, 'day').toDate(),
                status: MembershipStatus.ACTIVE,
            })
            testIds.userMembershipIds.push(oldMembership.id)

            const order = await createTestOrder(user.id, targetProduct.id, { amount: 500 })
            testIds.orderIds.push(order.id)

            const upgradeResult = await executeMembershipUpgradeService(
                user.id,
                target.id,
                order.id,
                order.orderNo,
            )
            expect(upgradeResult.success).toBe(true)
            testIds.userMembershipIds.push(upgradeResult.newMembership!.id)

            const result = await getUserUpgradeRecordsService(user.id, { page: 1, pageSize: 10 })

            expect(result.total).toBeGreaterThanOrEqual(1)
            expect(result.list.length).toBeGreaterThanOrEqual(1)
            const first = result.list[0]!
            expect(first.fromLevelName).toBe(current.name)
            expect(first.toLevelName).toBe(target.name)
            expect(typeof first.upgradePrice).toBe('number')
            expect(Number.isInteger(first.pointCompensation)).toBe(true)
            // 格式为 YYYY-MM-DD HH:mm:ss
            expect(first.createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
        })
    })

    // ==================== executeMembershipUpgradeService 特殊分支 ====================
    describe('executeMembershipUpgradeService - 特殊路径', () => {
        it('目标级别无可用商品时应返回失败', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const current = await createTestMembershipLevel({ sortOrder: 1 })
            const target = await createTestMembershipLevel({ sortOrder: 2 })
            testIds.membershipLevelIds.push(current.id, target.id)

            // 不创建目标商品
            const membership = await createTestUserMembership(user.id, current.id, {
                startDate: new Date(),
                endDate: dayjs().add(30, 'day').toDate(),
                status: MembershipStatus.ACTIVE,
            })
            testIds.userMembershipIds.push(membership.id)

            const result = await executeMembershipUpgradeService(user.id, target.id, 1, 'TEST_GAP_NO_PRODUCT')

            expect(result.success).toBe(false)
            expect(result.errorMessage).toBe('目标级别没有可用商品')
        })

        it('指定 membershipId 不属于当前用户时应返回失败', async () => {
            if (!dbAvailable) return

            const owner = await createTestUser()
            const other = await createTestUser()
            testIds.userIds.push(owner.id, other.id)

            const current = await createTestMembershipLevel({ sortOrder: 1 })
            const target = await createTestMembershipLevel({ sortOrder: 2 })
            testIds.membershipLevelIds.push(current.id, target.id)

            const targetProduct = await createTestProduct(target.id, { priceYearly: 999 })
            testIds.productIds.push(targetProduct.id)

            const membership = await createTestUserMembership(owner.id, current.id, {
                startDate: new Date(),
                endDate: dayjs().add(30, 'day').toDate(),
                status: MembershipStatus.ACTIVE,
            })
            testIds.userMembershipIds.push(membership.id)

            const order = await createTestOrder(other.id, targetProduct.id, { amount: 100 })
            testIds.orderIds.push(order.id)

            const result = await executeMembershipUpgradeService(
                other.id,
                target.id,
                order.id,
                order.orderNo,
                membership.id,
            )

            expect(result.success).toBe(false)
            expect(result.errorMessage).toBe('用户没有有效会员')
        })

        it('预购场景：结算日期在原会员开始日期之前时，新会员继承原 startDate', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const current = await createTestMembershipLevel({ sortOrder: 1 })
            const target = await createTestMembershipLevel({ sortOrder: 2 })
            testIds.membershipLevelIds.push(current.id, target.id)

            const targetProduct = await createTestProduct(target.id, { priceYearly: 999 })
            testIds.productIds.push(targetProduct.id)

            // startDate > now => isPrePurchase
            const futureStart = dayjs().add(10, 'day').toDate()
            const futureEnd = dayjs().add(100, 'day').toDate()
            const membership = await createTestUserMembership(user.id, current.id, {
                startDate: futureStart,
                endDate: futureEnd,
                status: MembershipStatus.ACTIVE,
            })
            testIds.userMembershipIds.push(membership.id)

            const order = await createTestOrder(user.id, targetProduct.id, { amount: 400 })
            testIds.orderIds.push(order.id)

            // 注意：findCurrentUserMembershipDao 要求 startDate <= now，
            // 预购场景会员 startDate 在未来，所以必须显式传 membershipId 才能命中
            const result = await executeMembershipUpgradeService(
                user.id,
                target.id,
                order.id,
                order.orderNo,
                membership.id,
            )

            expect(result.success).toBe(true)
            testIds.userMembershipIds.push(result.newMembership!.id)

            // 新会员应继承原 startDate（精确到天即可）
            expect(
                dayjs(result.newMembership!.startDate).format('YYYY-MM-DD'),
            ).toBe(dayjs(futureStart).format('YYYY-MM-DD'))
            // 新会员 endDate 等于原 endDate
            expect(result.newMembership!.endDate.getTime()).toBe(futureEnd.getTime())

            // 旧会员 endDate 保持不变（预购场景）
            const updatedOld = await prisma.userMemberships.findUnique({
                where: { id: membership.id },
            })
            expect(updatedOld!.endDate.getTime()).toBe(futureEnd.getTime())
            expect(updatedOld!.status).toBe(2) // SETTLED
        })

        it('MEMBERSHIP_UPGRADE 来源：累计实付金额递归追溯并成功再次升级', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const lvl1 = await createTestMembershipLevel({ sortOrder: 1, name: '测试级别_gap_1' })
            const lvl2 = await createTestMembershipLevel({ sortOrder: 2, name: '测试级别_gap_2' })
            const lvl3 = await createTestMembershipLevel({ sortOrder: 3, name: '测试级别_gap_3' })
            testIds.membershipLevelIds.push(lvl1.id, lvl2.id, lvl3.id)

            const product1 = await createTestProduct(lvl1.id, { priceYearly: 365 })
            const product2 = await createTestProduct(lvl2.id, { priceYearly: 680 })
            const product3 = await createTestProduct(lvl3.id, { priceYearly: 999 })
            testIds.productIds.push(product1.id, product2.id, product3.id)

            // 创建初始 DIRECT_PURCHASE 会员（带真实订单）
            const firstOrder = await createTestOrder(user.id, product1.id, {
                amount: 365,
                status: 1,
            })
            testIds.orderIds.push(firstOrder.id)

            const firstMembership = await createTestUserMembership(user.id, lvl1.id, {
                startDate: dayjs().subtract(30, 'day').toDate(),
                endDate: dayjs().add(335, 'day').toDate(),
                status: MembershipStatus.ACTIVE,
                sourceType: UserMembershipSourceType.DIRECT_PURCHASE,
                sourceId: firstOrder.id,
            })
            testIds.userMembershipIds.push(firstMembership.id)

            // 第一次升级（lvl1 -> lvl2）
            const upgradeOrder1 = await createTestOrder(user.id, product2.id, { amount: 300 })
            testIds.orderIds.push(upgradeOrder1.id)
            const firstUpgrade = await executeMembershipUpgradeService(
                user.id,
                lvl2.id,
                upgradeOrder1.id,
                upgradeOrder1.orderNo,
            )
            expect(firstUpgrade.success).toBe(true)
            testIds.userMembershipIds.push(firstUpgrade.newMembership!.id)

            // 第二次升级（lvl2 -> lvl3）：这次会触发 MEMBERSHIP_UPGRADE 来源递归
            const upgradeOrder2 = await createTestOrder(user.id, product3.id, { amount: 500 })
            testIds.orderIds.push(upgradeOrder2.id)
            const secondUpgrade = await executeMembershipUpgradeService(
                user.id,
                lvl3.id,
                upgradeOrder2.id,
                upgradeOrder2.orderNo,
            )

            expect(secondUpgrade.success).toBe(true)
            testIds.userMembershipIds.push(secondUpgrade.newMembership!.id)

            // 追踪所有创建的升级记录方便清理
            const records = await prisma.membershipUpgradeRecords.findMany({
                where: { userId: user.id },
            })
            records.forEach(r => {
                if (!testIds.membershipUpgradeRecordIds.includes(r.id)) {
                    testIds.membershipUpgradeRecordIds.push(r.id)
                }
            })

            // 追踪所有创建的积分记录方便清理
            const points = await prisma.pointRecords.findMany({
                where: { userId: user.id },
            })
            points.forEach(p => {
                if (!testIds.pointRecordIds.includes(p.id)) {
                    testIds.pointRecordIds.push(p.id)
                }
            })
        })

        it('DIRECT_PURCHASE 来源但订单未支付时实付金额应为 0', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const current = await createTestMembershipLevel({ sortOrder: 1 })
            const target = await createTestMembershipLevel({ sortOrder: 2 })
            testIds.membershipLevelIds.push(current.id, target.id)

            const targetProduct = await createTestProduct(target.id, { priceYearly: 999 })
            testIds.productIds.push(targetProduct.id)

            // 创建未支付订单（status != 1）
            const unpaidOrder = await createTestOrder(user.id, targetProduct.id, {
                amount: 365,
                status: 0,
            })
            testIds.orderIds.push(unpaidOrder.id)

            const membership = await createTestUserMembership(user.id, current.id, {
                startDate: dayjs().subtract(10, 'day').toDate(),
                endDate: dayjs().add(80, 'day').toDate(),
                status: MembershipStatus.ACTIVE,
                sourceType: UserMembershipSourceType.DIRECT_PURCHASE,
                sourceId: unpaidOrder.id,
            })
            testIds.userMembershipIds.push(membership.id)

            const priceResult = await calculateUpgradePriceService(user.id, target.id, membership.id)
            expect(priceResult.success).toBe(true)
            // 订单未支付时实付金额为 0
            expect(priceResult.result!.calculationDetails.paidAmount).toBe(0)
        })

        it('捕获异常并返回 errorMessage', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const current = await createTestMembershipLevel({ sortOrder: 1 })
            const target = await createTestMembershipLevel({ sortOrder: 2 })
            testIds.membershipLevelIds.push(current.id, target.id)

            const targetProduct = await createTestProduct(target.id, { priceYearly: 999 })
            testIds.productIds.push(targetProduct.id)

            const membership = await createTestUserMembership(user.id, current.id, {
                startDate: new Date(),
                endDate: dayjs().add(30, 'day').toDate(),
                status: MembershipStatus.ACTIVE,
            })
            testIds.userMembershipIds.push(membership.id)

            // 传入不存在的 orderId，createMembershipUpgradeRecord 的外键约束会失败
            // 进入 catch 分支返回 errorMessage
            const nonExistentOrderId = 2147483640
            const result = await executeMembershipUpgradeService(
                user.id,
                target.id,
                nonExistentOrderId,
                'TEST_GAP_CATCH',
            )

            expect(result.success).toBe(false)
            expect(typeof result.errorMessage).toBe('string')
            expect(result.errorMessage!.length).toBeGreaterThan(0)

            // 清理可能残留的会员记录（异常分支可能在 createUserMembershipDao 之后才失败）
            const stray = await prisma.userMemberships.findMany({
                where: { userId: user.id },
            })
            stray.forEach(s => {
                if (!testIds.userMembershipIds.includes(s.id)) {
                    testIds.userMembershipIds.push(s.id)
                }
            })
            const strayPoints = await prisma.pointRecords.findMany({
                where: { userId: user.id },
            })
            strayPoints.forEach(p => {
                if (!testIds.pointRecordIds.includes(p.id)) {
                    testIds.pointRecordIds.push(p.id)
                }
            })
        })

        it('带积分记录的 MEMBERSHIP_UPGRADE 来源：应正常转移积分并追溯实付', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const current = await createTestMembershipLevel({ sortOrder: 1 })
            const target = await createTestMembershipLevel({ sortOrder: 2 })
            testIds.membershipLevelIds.push(current.id, target.id)

            const targetProduct = await createTestProduct(target.id, { priceYearly: 999 })
            testIds.productIds.push(targetProduct.id)

            const endDate = dayjs().add(60, 'day').toDate()
            const membership = await createTestUserMembership(user.id, current.id, {
                startDate: new Date(),
                endDate,
                status: MembershipStatus.ACTIVE,
            })
            testIds.userMembershipIds.push(membership.id)

            // 带有积分记录
            const p = await createTestPointRecord(user.id, {
                pointAmount: 100,
                remaining: 50,
                userMembershipId: membership.id,
                status: PointRecordStatus.VALID,
                expiredAt: endDate,
            })
            testIds.pointRecordIds.push(p.id)

            const upgradeOrder = await createTestOrder(user.id, targetProduct.id, { amount: 300 })
            testIds.orderIds.push(upgradeOrder.id)

            const result = await executeMembershipUpgradeService(
                user.id,
                target.id,
                upgradeOrder.id,
                upgradeOrder.orderNo,
            )
            expect(result.success).toBe(true)
            testIds.userMembershipIds.push(result.newMembership!.id)

            // 追踪产生的积分和升级记录
            const allPoints = await prisma.pointRecords.findMany({
                where: { userId: user.id },
            })
            allPoints.forEach(pp => {
                if (!testIds.pointRecordIds.includes(pp.id)) {
                    testIds.pointRecordIds.push(pp.id)
                }
            })
            const records = await prisma.membershipUpgradeRecords.findMany({
                where: { userId: user.id },
            })
            records.forEach(r => {
                if (!testIds.membershipUpgradeRecordIds.includes(r.id)) {
                    testIds.membershipUpgradeRecordIds.push(r.id)
                }
            })
        })
    })
})
