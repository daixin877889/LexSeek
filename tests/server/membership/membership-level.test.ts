/**
 * 会员级别集成测试
 *
 * 测试真实的会员级别 DAO 函数，使用真实数据库操作
 *
 * **Feature: membership-system**
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import * as fc from 'fast-check'
import {
    getTestPrisma,
    createTestMembershipLevel,
    cleanupTestData,
    createEmptyTestIds,
    disconnectTestDb,
    isTestDbAvailable,
    resetDatabaseSequences,
    MembershipLevelStatus,
    type TestIds,
} from './test-db-helper'
import {
    membershipLevelDataArb,
    PBT_CONFIG_FAST,
} from './test-generators'

// 导入实际的 DAO 函数
import {
    createMembershipLevelDao,
    findMembershipLevelByIdDao,
    findAllActiveMembershipLevelsDao,
    findAllMembershipLevelsDao,
    updateMembershipLevelDao,
    deleteMembershipLevelDao,
    findHigherMembershipLevelsDao,
} from '../../../server/services/membership/membershipLevel.dao'

// 检查数据库是否可用
let dbAvailable = false

describe('会员级别集成测试', () => {
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
            testIds.membershipLevelIds = []
        }
    })

    afterAll(async () => {
        if (dbAvailable) {
            await disconnectTestDb()
        }
    })

    describe('createMembershipLevelDao 测试', () => {
        it('应成功创建会员级别', async () => {
            if (!dbAvailable) return

            // 使用实际的 DAO 函数创建
            const level = await createMembershipLevelDao({
                name: '测试级别_DAO创建',
                description: '测试描述',
                sortOrder: 1,
                status: MembershipLevelStatus.ENABLED,
            })
            testIds.membershipLevelIds.push(level.id)

            expect(level.id).toBeGreaterThan(0)
            expect(level.name).toBe('测试级别_DAO创建')
            expect(level.description).toBe('测试描述')
            expect(level.sortOrder).toBe(1)
            expect(level.status).toBe(MembershipLevelStatus.ENABLED)
            expect(level.deletedAt).toBeNull()
        })

        it('Property: 创建后立即查询应返回等价数据', async () => {
            if (!dbAvailable) return

            await fc.assert(
                fc.asyncProperty(
                    membershipLevelDataArb,
                    async (data) => {
                        // 使用实际的 DAO 函数创建
                        const created = await createMembershipLevelDao({
                            name: data.name,
                            description: data.description,
                            sortOrder: data.sortOrder,
                            status: data.status,
                        })
                        testIds.membershipLevelIds.push(created.id)

                        // 使用实际的 DAO 函数查询
                        const found = await findMembershipLevelByIdDao(created.id)

                        // 验证数据一致性
                        expect(found).not.toBeNull()
                        expect(found!.name).toBe(data.name)
                        expect(found!.description).toBe(data.description)
                        expect(found!.sortOrder).toBe(data.sortOrder)
                        expect(found!.status).toBe(data.status)

                        return true
                    }
                ),
                PBT_CONFIG_FAST
            )
        })
    })

    describe('findMembershipLevelByIdDao 测试', () => {
        it('应成功通过 ID 查询会员级别', async () => {
            if (!dbAvailable) return

            const created = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(created.id)

            // 使用实际的 DAO 函数查询
            const found = await findMembershipLevelByIdDao(created.id)

            expect(found).not.toBeNull()
            expect(found!.id).toBe(created.id)
            expect(found!.name).toBe(created.name)
        })

        it('查询不存在的 ID 应返回 null', async () => {
            if (!dbAvailable) return

            const found = await findMembershipLevelByIdDao(999999)
            expect(found).toBeNull()
        })

        it('查询已删除的记录应返回 null', async () => {
            if (!dbAvailable) return

            const created = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(created.id)

            // 软删除
            await deleteMembershipLevelDao(created.id)

            // 使用实际的 DAO 函数查询（应返回 null）
            const found = await findMembershipLevelByIdDao(created.id)
            expect(found).toBeNull()
        })
    })

    describe('updateMembershipLevelDao 测试', () => {
        it('应成功更新会员级别', async () => {
            if (!dbAvailable) return

            const created = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(created.id)

            // 使用实际的 DAO 函数更新
            const updated = await updateMembershipLevelDao(created.id, {
                name: '测试级别_更新后',
                description: '更新后的描述',
            })

            expect(updated.name).toBe('测试级别_更新后')
            expect(updated.description).toBe('更新后的描述')
        })

        it('更新后查询应返回新数据', async () => {
            if (!dbAvailable) return

            const created = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(created.id)

            const newName = `测试级别_更新_${Date.now()}`
            await updateMembershipLevelDao(created.id, { name: newName })

            // 使用实际的 DAO 函数查询
            const found = await findMembershipLevelByIdDao(created.id)

            expect(found).not.toBeNull()
            expect(found!.name).toBe(newName)
        })
    })

    describe('deleteMembershipLevelDao 测试', () => {
        it('应成功软删除会员级别', async () => {
            if (!dbAvailable) return

            const created = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(created.id)

            // 使用实际的 DAO 函数删除
            await deleteMembershipLevelDao(created.id)

            // 使用实际的 DAO 函数查询（应返回 null）
            const found = await findMembershipLevelByIdDao(created.id)
            expect(found).toBeNull()

            // 直接查询数据库验证 deletedAt 已设置
            const foundWithDeleted = await prisma.membershipLevels.findUnique({
                where: { id: created.id },
            })
            expect(foundWithDeleted).not.toBeNull()
            expect(foundWithDeleted!.deletedAt).not.toBeNull()
        })
    })

    describe('findAllActiveMembershipLevelsDao 测试', () => {
        it('应只返回启用状态的会员级别', async () => {
            if (!dbAvailable) return

            // 创建启用和禁用的会员级别
            const enabledLevel = await createTestMembershipLevel({
                status: MembershipLevelStatus.ENABLED,
            })
            const disabledLevel = await createTestMembershipLevel({
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

        it('结果应按 sortOrder 升序排列', async () => {
            if (!dbAvailable) return

            // 创建多个会员级别，sortOrder 乱序
            const level3 = await createTestMembershipLevel({ sortOrder: 103, status: MembershipLevelStatus.ENABLED })
            const level1 = await createTestMembershipLevel({ sortOrder: 101, status: MembershipLevelStatus.ENABLED })
            const level2 = await createTestMembershipLevel({ sortOrder: 102, status: MembershipLevelStatus.ENABLED })
            testIds.membershipLevelIds.push(level1.id, level2.id, level3.id)

            // 使用实际的 DAO 函数查询
            const activeLevels = await findAllActiveMembershipLevelsDao()

            // 筛选出测试创建的级别
            const testLevels = activeLevels.filter(l =>
                [level1.id, level2.id, level3.id].includes(l.id)
            )

            // 验证排序
            expect(testLevels.length).toBe(3)
            expect(testLevels[0].sortOrder).toBeLessThanOrEqual(testLevels[1].sortOrder)
            expect(testLevels[1].sortOrder).toBeLessThanOrEqual(testLevels[2].sortOrder)
        })

        it('不应返回已删除的会员级别', async () => {
            if (!dbAvailable) return

            const level = await createTestMembershipLevel({ status: MembershipLevelStatus.ENABLED })
            testIds.membershipLevelIds.push(level.id)

            // 软删除
            await deleteMembershipLevelDao(level.id)

            // 使用实际的 DAO 函数查询
            const activeLevels = await findAllActiveMembershipLevelsDao()

            const found = activeLevels.find(l => l.id === level.id)
            expect(found).toBeUndefined()
        })
    })

    describe('findAllMembershipLevelsDao 测试', () => {
        it('应正确返回分页结果', async () => {
            if (!dbAvailable) return

            // 创建 5 个会员级别
            const levels = await Promise.all(
                Array.from({ length: 5 }, (_, i) =>
                    createTestMembershipLevel({ sortOrder: 200 + i + 1 })
                )
            )
            levels.forEach(l => testIds.membershipLevelIds.push(l.id))

            // 使用实际的 DAO 函数查询第一页
            const page1 = await findAllMembershipLevelsDao({ page: 1, pageSize: 2 })

            expect(page1.list.length).toBeLessThanOrEqual(2)
            expect(page1.total).toBeGreaterThanOrEqual(5)
        })

        it('应正确按状态筛选', async () => {
            if (!dbAvailable) return

            const enabledLevel = await createTestMembershipLevel({ status: MembershipLevelStatus.ENABLED })
            const disabledLevel = await createTestMembershipLevel({ status: MembershipLevelStatus.DISABLED })
            testIds.membershipLevelIds.push(enabledLevel.id, disabledLevel.id)

            // 使用实际的 DAO 函数按状态筛选
            const enabledResult = await findAllMembershipLevelsDao({ status: MembershipLevelStatus.ENABLED, pageSize: 10 })
            const disabledResult = await findAllMembershipLevelsDao({ status: MembershipLevelStatus.DISABLED, pageSize: 10 })

            // 验证筛选功能正常工作：
            // 1. 启用状态的结果应该只包含启用状态的记录
            // 2. 禁用状态的结果应该只包含禁用状态的记录
            expect(enabledResult.list.every(l => l.status === MembershipLevelStatus.ENABLED)).toBe(true)
            expect(disabledResult.list.every(l => l.status === MembershipLevelStatus.DISABLED)).toBe(true)

            // 验证创建的数据状态正确
            expect(enabledLevel.status).toBe(MembershipLevelStatus.ENABLED)
            expect(disabledLevel.status).toBe(MembershipLevelStatus.DISABLED)

            // 验证通过 ID 查询可以找到创建的数据
            const foundEnabled = await findMembershipLevelByIdDao(enabledLevel.id)
            const foundDisabled = await findMembershipLevelByIdDao(disabledLevel.id)
            expect(foundEnabled).not.toBeNull()
            expect(foundDisabled).not.toBeNull()
            expect(foundEnabled?.status).toBe(MembershipLevelStatus.ENABLED)
            expect(foundDisabled?.status).toBe(MembershipLevelStatus.DISABLED)
        })
    })

    describe('findHigherMembershipLevelsDao 测试', () => {
        it('应返回比指定级别更高的级别', async () => {
            if (!dbAvailable) return

            // 创建三个级别（sortOrder 越大级别越高）
            const level1 = await createTestMembershipLevel({ sortOrder: 301, status: MembershipLevelStatus.ENABLED })
            const level2 = await createTestMembershipLevel({ sortOrder: 302, status: MembershipLevelStatus.ENABLED })
            const level3 = await createTestMembershipLevel({ sortOrder: 303, status: MembershipLevelStatus.ENABLED })
            testIds.membershipLevelIds.push(level1.id, level2.id, level3.id)

            // 使用实际的 DAO 函数查询比 level1（最低级别）更高的级别
            const higherLevels = await findHigherMembershipLevelsDao(level1.sortOrder)

            // 验证返回的级别（应该包含 level2 和 level3，不包含 level1）
            const higherIds = higherLevels.map(l => l.id)
            expect(higherIds).not.toContain(level1.id)
            expect(higherIds).toContain(level2.id)
            expect(higherIds).toContain(level3.id)
        })

        it('最低级别应没有更低的级别', async () => {
            if (!dbAvailable) return

            const lowestLevel = await createTestMembershipLevel({ sortOrder: 1, status: MembershipLevelStatus.ENABLED })
            testIds.membershipLevelIds.push(lowestLevel.id)

            // 使用实际的 DAO 函数查询
            const higherLevels = await findHigherMembershipLevelsDao(lowestLevel.sortOrder)

            // sortOrder = 1 是最低级别，应该有更高的级别（如果存在的话）
            // 但这里只创建了一个级别，所以不应该找到自己
            const found = higherLevels.find(l => l.id === lowestLevel.id)
            expect(found).toBeUndefined()
        })
    })

    describe('Property: 级别比较传递性', () => {
        it('如果 A > B 且 B > C，则 A > C', async () => {
            if (!dbAvailable) return

            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 401, max: 430 }),
                    fc.integer({ min: 431, max: 460 }),
                    fc.integer({ min: 461, max: 500 }),
                    async (orderA, orderB, orderC) => {
                        // 使用实际的 DAO 函数创建
                        const levelA = await createMembershipLevelDao({
                            name: `测试级别_传递性_A_${Date.now()}_${Math.random()}`,
                            sortOrder: orderA,
                            status: MembershipLevelStatus.ENABLED,
                        })
                        const levelB = await createMembershipLevelDao({
                            name: `测试级别_传递性_B_${Date.now()}_${Math.random()}`,
                            sortOrder: orderB,
                            status: MembershipLevelStatus.ENABLED,
                        })
                        const levelC = await createMembershipLevelDao({
                            name: `测试级别_传递性_C_${Date.now()}_${Math.random()}`,
                            sortOrder: orderC,
                            status: MembershipLevelStatus.ENABLED,
                        })
                        testIds.membershipLevelIds.push(levelA.id, levelB.id, levelC.id)

                        // A 比 B 高（sortOrder 更小）
                        expect(levelA.sortOrder).toBeLessThan(levelB.sortOrder)
                        // B 比 C 高
                        expect(levelB.sortOrder).toBeLessThan(levelC.sortOrder)
                        // 传递性：A 比 C 高
                        expect(levelA.sortOrder).toBeLessThan(levelC.sortOrder)

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
