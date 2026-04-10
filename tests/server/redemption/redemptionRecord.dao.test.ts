/**
 * 兑换记录 DAO 层测试
 *
 * 测试 redemptionRecord.dao.ts 的所有数据访问方法
 *
 * **Feature: redemption-record-dao**
 * **Validates: 创建记录、用户查询、重复检查、管理员查询**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import {
    getTestPrisma,
    createTestMembershipLevel,
    createTestRedemptionCode,
    createTestUser,
    createTestRedemptionRecord,
    cleanupTestData,
    createEmptyTestIds,
    disconnectTestDb,
    isTestDbAvailable,
    RedemptionCodeStatus,
    RedemptionCodeType,
    type TestIds,
} from './test-db-helper'

// 导入被测 DAO 函数
import {
    createRedemptionRecordDao,
    findRedemptionRecordsByUserIdDao,
    checkUserRedemptionRecordExistsDao,
    findRedemptionRecordsAdminDao,
} from '~~/server/services/redemption/redemptionRecord.dao'

let dbAvailable = false

describe('兑换记录 DAO 层测试', () => {
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

    describe('createRedemptionRecordDao - 创建兑换记录', () => {
        it('应成功创建兑换记录', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const code = await createTestRedemptionCode()
            testIds.redemptionCodeIds.push(code.id)

            const record = await createRedemptionRecordDao(user.id, code.id)
            testIds.redemptionRecordIds.push(record.id)

            expect(record.id).toBeGreaterThan(0)
            expect(record.userId).toBe(user.id)
            expect(record.codeId).toBe(code.id)
            expect(record.createdAt).toBeInstanceOf(Date)
            expect(record.updatedAt).toBeInstanceOf(Date)
        })

        it('不存在的用户 ID 应抛出错误', async () => {
            if (!dbAvailable) return

            const code = await createTestRedemptionCode()
            testIds.redemptionCodeIds.push(code.id)

            await expect(
                createRedemptionRecordDao(999999999, code.id)
            ).rejects.toThrow()
        })

        it('不存在的兑换码 ID 应抛出错误', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            await expect(
                createRedemptionRecordDao(user.id, 999999999)
            ).rejects.toThrow()
        })
    })

    describe('findRedemptionRecordsByUserIdDao - 查询用户兑换记录', () => {
        it('应返回分页结构（list 和 total）', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const code = await createTestRedemptionCode()
            testIds.redemptionCodeIds.push(code.id)

            const record = await createTestRedemptionRecord(user.id, code.id)
            testIds.redemptionRecordIds.push(record.id)

            const result = await findRedemptionRecordsByUserIdDao(user.id)

            expect(result).toHaveProperty('list')
            expect(result).toHaveProperty('total')
            expect(result.total).toBeGreaterThanOrEqual(1)
            expect(result.list.length).toBeGreaterThanOrEqual(1)
        })

        it('应包含关联的兑换码和会员级别信息', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const code = await createTestRedemptionCode({
                type: RedemptionCodeType.MEMBERSHIP_ONLY,
                levelId: level.id,
                duration: 30,
            })
            testIds.redemptionCodeIds.push(code.id)

            const record = await createTestRedemptionRecord(user.id, code.id)
            testIds.redemptionRecordIds.push(record.id)

            const result = await findRedemptionRecordsByUserIdDao(user.id)
            const item = result.list.find(r => r.id === record.id)

            expect(item).toBeDefined()
            expect(item!.code).toBeDefined()
            expect(item!.code.code).toBe(code.code)
            expect(item!.code.level).toBeDefined()
            expect(item!.code.level!.id).toBe(level.id)
        })

        it('应支持分页参数', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            // 创建 3 条记录
            for (let i = 0; i < 3; i++) {
                const code = await createTestRedemptionCode()
                testIds.redemptionCodeIds.push(code.id)
                const record = await createTestRedemptionRecord(user.id, code.id)
                testIds.redemptionRecordIds.push(record.id)
            }

            const page1 = await findRedemptionRecordsByUserIdDao(user.id, {
                page: 1,
                pageSize: 2,
            })
            expect(page1.list.length).toBeLessThanOrEqual(2)
            expect(page1.total).toBe(3)
        })

        it('没有记录的用户应返回空列表', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const result = await findRedemptionRecordsByUserIdDao(user.id)
            expect(result.list).toEqual([])
            expect(result.total).toBe(0)
        })

        it('结果应按创建时间降序排列', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            for (let i = 0; i < 3; i++) {
                const code = await createTestRedemptionCode()
                testIds.redemptionCodeIds.push(code.id)
                const record = await createTestRedemptionRecord(user.id, code.id)
                testIds.redemptionRecordIds.push(record.id)
            }

            const result = await findRedemptionRecordsByUserIdDao(user.id, { pageSize: 100 })

            for (let i = 1; i < result.list.length; i++) {
                expect(result.list[i - 1].createdAt.getTime())
                    .toBeGreaterThanOrEqual(result.list[i].createdAt.getTime())
            }
        })

        it('已软删除的记录不应返回', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const code = await createTestRedemptionCode()
            testIds.redemptionCodeIds.push(code.id)

            const record = await createTestRedemptionRecord(user.id, code.id)
            testIds.redemptionRecordIds.push(record.id)

            // 软删除
            await prisma.redemptionRecords.update({
                where: { id: record.id },
                data: { deletedAt: new Date() },
            })

            const result = await findRedemptionRecordsByUserIdDao(user.id)
            expect(result.list.find(r => r.id === record.id)).toBeUndefined()
        })
    })

    describe('checkUserRedemptionRecordExistsDao - 检查重复使用', () => {
        it('用户已使用过该兑换码应返回 true', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const code = await createTestRedemptionCode()
            testIds.redemptionCodeIds.push(code.id)

            const record = await createTestRedemptionRecord(user.id, code.id)
            testIds.redemptionRecordIds.push(record.id)

            const exists = await checkUserRedemptionRecordExistsDao(user.id, code.id)
            expect(exists).toBe(true)
        })

        it('用户未使用过该兑换码应返回 false', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const code = await createTestRedemptionCode()
            testIds.redemptionCodeIds.push(code.id)

            const exists = await checkUserRedemptionRecordExistsDao(user.id, code.id)
            expect(exists).toBe(false)
        })

        it('不同用户使用同一兑换码应互不影响', async () => {
            if (!dbAvailable) return

            const user1 = await createTestUser()
            testIds.userIds.push(user1.id)

            const user2 = await createTestUser()
            testIds.userIds.push(user2.id)

            const code = await createTestRedemptionCode()
            testIds.redemptionCodeIds.push(code.id)

            const record = await createTestRedemptionRecord(user1.id, code.id)
            testIds.redemptionRecordIds.push(record.id)

            expect(await checkUserRedemptionRecordExistsDao(user1.id, code.id)).toBe(true)
            expect(await checkUserRedemptionRecordExistsDao(user2.id, code.id)).toBe(false)
        })

        it('软删除的记录应视为不存在', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const code = await createTestRedemptionCode()
            testIds.redemptionCodeIds.push(code.id)

            const record = await createTestRedemptionRecord(user.id, code.id)
            testIds.redemptionRecordIds.push(record.id)

            // 软删除
            await prisma.redemptionRecords.update({
                where: { id: record.id },
                data: { deletedAt: new Date() },
            })

            const exists = await checkUserRedemptionRecordExistsDao(user.id, code.id)
            expect(exists).toBe(false)
        })
    })

    describe('findRedemptionRecordsAdminDao - 管理员查询兑换记录', () => {
        it('应返回分页结构且包含用户信息', async () => {
            if (!dbAvailable) return

            const user = await createTestUser({ name: '管理员视角用户' })
            testIds.userIds.push(user.id)

            const code = await createTestRedemptionCode()
            testIds.redemptionCodeIds.push(code.id)

            const record = await createTestRedemptionRecord(user.id, code.id)
            testIds.redemptionRecordIds.push(record.id)

            const result = await findRedemptionRecordsAdminDao({})

            expect(result).toHaveProperty('list')
            expect(result).toHaveProperty('total')

            const item = result.list.find(r => r.id === record.id)
            expect(item).toBeDefined()
            expect(item!.user).toBeDefined()
            expect(item!.user.id).toBe(user.id)
            expect(item!.user.name).toBe('管理员视角用户')
            expect(item!.user.phone).toBe(user.phone)
        })

        it('应支持按 userId 筛选', async () => {
            if (!dbAvailable) return

            const user1 = await createTestUser()
            testIds.userIds.push(user1.id)

            const user2 = await createTestUser()
            testIds.userIds.push(user2.id)

            const code1 = await createTestRedemptionCode()
            testIds.redemptionCodeIds.push(code1.id)

            const code2 = await createTestRedemptionCode()
            testIds.redemptionCodeIds.push(code2.id)

            const record1 = await createTestRedemptionRecord(user1.id, code1.id)
            testIds.redemptionRecordIds.push(record1.id)

            const record2 = await createTestRedemptionRecord(user2.id, code2.id)
            testIds.redemptionRecordIds.push(record2.id)

            const result = await findRedemptionRecordsAdminDao({ userId: user1.id })

            result.list.forEach(item => {
                expect(item.userId).toBe(user1.id)
            })
        })

        it('应支持按 code 模糊搜索', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const uniqueCode = `ADMIN-SEARCH-${Date.now()}`
            const code = await createTestRedemptionCode({ code: uniqueCode })
            testIds.redemptionCodeIds.push(code.id)

            const record = await createTestRedemptionRecord(user.id, code.id)
            testIds.redemptionRecordIds.push(record.id)

            const result = await findRedemptionRecordsAdminDao({ code: uniqueCode })
            expect(result.list.length).toBeGreaterThanOrEqual(1)
        })

        it('应支持按用户关键词搜索', async () => {
            if (!dbAvailable) return

            const uniqueName = `管理员搜索_${Date.now()}`
            const user = await createTestUser({ name: uniqueName })
            testIds.userIds.push(user.id)

            const code = await createTestRedemptionCode()
            testIds.redemptionCodeIds.push(code.id)

            const record = await createTestRedemptionRecord(user.id, code.id)
            testIds.redemptionRecordIds.push(record.id)

            const result = await findRedemptionRecordsAdminDao({
                userKeyword: uniqueName,
            })

            expect(result.list.length).toBeGreaterThanOrEqual(1)
            expect(result.list.some(r => r.user.name === uniqueName)).toBe(true)
        })

        it('默认分页应为 page=1, pageSize=20', async () => {
            if (!dbAvailable) return

            const result = await findRedemptionRecordsAdminDao({})
            expect(result.list.length).toBeLessThanOrEqual(20)
        })

        it('结果应按创建时间降序排列', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            for (let i = 0; i < 3; i++) {
                const code = await createTestRedemptionCode()
                testIds.redemptionCodeIds.push(code.id)
                const record = await createTestRedemptionRecord(user.id, code.id)
                testIds.redemptionRecordIds.push(record.id)
            }

            const result = await findRedemptionRecordsAdminDao({ pageSize: 100 })

            for (let i = 1; i < result.list.length; i++) {
                expect(result.list[i - 1].createdAt.getTime())
                    .toBeGreaterThanOrEqual(result.list[i].createdAt.getTime())
            }
        })
    })
})
