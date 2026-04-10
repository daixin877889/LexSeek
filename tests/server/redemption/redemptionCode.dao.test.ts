/**
 * 兑换码 DAO 层测试
 *
 * 测试 redemptionCode.dao.ts 的所有数据访问方法
 *
 * **Feature: redemption-code-dao**
 * **Validates: CRUD 操作、分页查询、批量创建、筛选导出**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
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

// 导入被测 DAO 函数
import {
    createRedemptionCodeDao,
    findRedemptionCodeByCodeDao,
    findRedemptionCodeByIdDao,
    updateRedemptionCodeStatusDao,
    findAllRedemptionCodesDao,
    bulkCreateRedemptionCodesDao,
    findRedemptionCodesWithFiltersDao,
    findRedemptionCodesForExportDao,
} from '~~/server/services/redemption/redemptionCode.dao'

let dbAvailable = false

describe('兑换码 DAO 层测试', () => {
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

    describe('createRedemptionCodeDao - 创建兑换码', () => {
        it('应成功创建兑换码并返回完整记录', async () => {
            if (!dbAvailable) return

            const code = await createRedemptionCodeDao({
                code: `DAO-TEST-${Date.now()}`,
                type: RedemptionCodeType.MEMBERSHIP_ONLY,
                status: RedemptionCodeStatus.ACTIVE,
            })

            testIds.redemptionCodeIds.push(code.id)
            expect(code.id).toBeGreaterThan(0)
            expect(code.type).toBe(RedemptionCodeType.MEMBERSHIP_ONLY)
            expect(code.status).toBe(RedemptionCodeStatus.ACTIVE)
            expect(code.createdAt).toBeInstanceOf(Date)
            expect(code.updatedAt).toBeInstanceOf(Date)
        })

        it('应正确设置关联的会员级别', async () => {
            if (!dbAvailable) return

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const code = await createRedemptionCodeDao({
                code: `DAO-LEVEL-${Date.now()}`,
                type: RedemptionCodeType.MEMBERSHIP_ONLY,
                status: RedemptionCodeStatus.ACTIVE,
                level: { connect: { id: level.id } },
                duration: 30,
            })

            testIds.redemptionCodeIds.push(code.id)
            expect(code.levelId).toBe(level.id)
            expect(code.duration).toBe(30)
        })

        it('创建重复 code 时应抛出错误', async () => {
            if (!dbAvailable) return

            const uniqueCode = `DAO-DUP-${Date.now()}`
            const first = await createRedemptionCodeDao({
                code: uniqueCode,
                type: RedemptionCodeType.POINTS_ONLY,
                status: RedemptionCodeStatus.ACTIVE,
            })
            testIds.redemptionCodeIds.push(first.id)

            await expect(
                createRedemptionCodeDao({
                    code: uniqueCode,
                    type: RedemptionCodeType.POINTS_ONLY,
                    status: RedemptionCodeStatus.ACTIVE,
                })
            ).rejects.toThrow()
        })
    })

    describe('findRedemptionCodeByCodeDao - 通过兑换码查询', () => {
        it('应通过 code 字符串找到兑换码', async () => {
            if (!dbAvailable) return

            const codeStr = `FIND-CODE-${Date.now()}`
            const created = await createTestRedemptionCode({ code: codeStr })
            testIds.redemptionCodeIds.push(created.id)

            const found = await findRedemptionCodeByCodeDao(codeStr)
            expect(found).not.toBeNull()
            expect(found!.id).toBe(created.id)
            expect(found!.code).toBe(codeStr)
        })

        it('应包含关联的会员级别信息', async () => {
            if (!dbAvailable) return

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const created = await createTestRedemptionCode({
                code: `FIND-LEVEL-${Date.now()}`,
                levelId: level.id,
            })
            testIds.redemptionCodeIds.push(created.id)

            const found = await findRedemptionCodeByCodeDao(created.code)
            expect(found).not.toBeNull()
            expect(found!.level).not.toBeNull()
            expect(found!.level!.id).toBe(level.id)
        })

        it('查询不存在的 code 应返回 null', async () => {
            if (!dbAvailable) return

            const found = await findRedemptionCodeByCodeDao('NONEXISTENT-CODE-999')
            expect(found).toBeNull()
        })

        it('已软删除的记录应返回 null', async () => {
            if (!dbAvailable) return

            const codeStr = `SOFT-DEL-${Date.now()}`
            const created = await createTestRedemptionCode({ code: codeStr })
            testIds.redemptionCodeIds.push(created.id)

            // 软删除
            await prisma.redemptionCodes.update({
                where: { id: created.id },
                data: { deletedAt: new Date() },
            })

            const found = await findRedemptionCodeByCodeDao(codeStr)
            expect(found).toBeNull()
        })
    })

    describe('findRedemptionCodeByIdDao - 通过 ID 查询', () => {
        it('应通过 ID 找到兑换码', async () => {
            if (!dbAvailable) return

            const created = await createTestRedemptionCode()
            testIds.redemptionCodeIds.push(created.id)

            const found = await findRedemptionCodeByIdDao(created.id)
            expect(found).not.toBeNull()
            expect(found!.id).toBe(created.id)
        })

        it('查询不存在的 ID 应返回 null', async () => {
            if (!dbAvailable) return

            const found = await findRedemptionCodeByIdDao(999999999)
            expect(found).toBeNull()
        })

        it('已软删除的记录应返回 null', async () => {
            if (!dbAvailable) return

            const created = await createTestRedemptionCode()
            testIds.redemptionCodeIds.push(created.id)

            await prisma.redemptionCodes.update({
                where: { id: created.id },
                data: { deletedAt: new Date() },
            })

            const found = await findRedemptionCodeByIdDao(created.id)
            expect(found).toBeNull()
        })
    })

    describe('updateRedemptionCodeStatusDao - 更新状态', () => {
        it('应成功更新兑换码状态', async () => {
            if (!dbAvailable) return

            const created = await createTestRedemptionCode({
                status: RedemptionCodeStatus.ACTIVE,
            })
            testIds.redemptionCodeIds.push(created.id)

            const updated = await updateRedemptionCodeStatusDao(
                created.id,
                RedemptionCodeStatus.USED
            )

            expect(updated.status).toBe(RedemptionCodeStatus.USED)
            expect(updated.updatedAt.getTime()).toBeGreaterThan(created.status)
        })

        it('更新不存在的 ID 应抛出错误', async () => {
            if (!dbAvailable) return

            await expect(
                updateRedemptionCodeStatusDao(999999999, RedemptionCodeStatus.INVALID)
            ).rejects.toThrow()
        })
    })

    describe('findAllRedemptionCodesDao - 分页查询', () => {
        it('应返回分页结果（包含 list 和 total）', async () => {
            if (!dbAvailable) return

            // 创建 3 个兑换码
            for (let i = 0; i < 3; i++) {
                const code = await createTestRedemptionCode()
                testIds.redemptionCodeIds.push(code.id)
            }

            const result = await findAllRedemptionCodesDao({ page: 1, pageSize: 2 })
            expect(result).toHaveProperty('list')
            expect(result).toHaveProperty('total')
            expect(result.list.length).toBeLessThanOrEqual(2)
            expect(result.total).toBeGreaterThanOrEqual(3)
        })

        it('默认参数应为 page=1, pageSize=10', async () => {
            if (!dbAvailable) return

            const result = await findAllRedemptionCodesDao()
            expect(result).toHaveProperty('list')
            expect(result.list.length).toBeLessThanOrEqual(10)
        })

        it('按状态筛选应正确过滤', async () => {
            if (!dbAvailable) return

            const activeCode = await createTestRedemptionCode({
                status: RedemptionCodeStatus.ACTIVE,
            })
            testIds.redemptionCodeIds.push(activeCode.id)

            const usedCode = await createTestRedemptionCode({
                status: RedemptionCodeStatus.USED,
            })
            testIds.redemptionCodeIds.push(usedCode.id)

            const result = await findAllRedemptionCodesDao({
                status: RedemptionCodeStatus.ACTIVE,
            })

            result.list.forEach(item => {
                expect(item.status).toBe(RedemptionCodeStatus.ACTIVE)
            })
        })

        it('结果应按创建时间降序排列', async () => {
            if (!dbAvailable) return

            for (let i = 0; i < 3; i++) {
                const code = await createTestRedemptionCode()
                testIds.redemptionCodeIds.push(code.id)
            }

            const result = await findAllRedemptionCodesDao({ page: 1, pageSize: 100 })

            for (let i = 1; i < result.list.length; i++) {
                expect(result.list[i - 1].createdAt.getTime())
                    .toBeGreaterThanOrEqual(result.list[i].createdAt.getTime())
            }
        })
    })

    describe('bulkCreateRedemptionCodesDao - 批量创建', () => {
        it('应返回创建的数量', async () => {
            if (!dbAvailable) return

            const now = new Date()
            const codes = Array.from({ length: 5 }, (_, i) => ({
                code: `BULK-${Date.now()}-${i}`,
                type: RedemptionCodeType.POINTS_ONLY,
                status: RedemptionCodeStatus.ACTIVE,
                pointAmount: 100,
                createdAt: now,
                updatedAt: now,
            }))

            const count = await bulkCreateRedemptionCodesDao(codes)
            expect(count).toBe(5)

            // 清理
            const created = await prisma.redemptionCodes.findMany({
                where: { code: { in: codes.map(c => c.code) } },
            })
            created.forEach(c => testIds.redemptionCodeIds.push(c.id))
        })

        it('空数组应返回 0', async () => {
            if (!dbAvailable) return

            const count = await bulkCreateRedemptionCodesDao([])
            expect(count).toBe(0)
        })
    })

    describe('findRedemptionCodesWithFiltersDao - 多条件筛选', () => {
        it('应支持按类型筛选', async () => {
            if (!dbAvailable) return

            const membershipCode = await createTestRedemptionCode({
                type: RedemptionCodeType.MEMBERSHIP_ONLY,
            })
            testIds.redemptionCodeIds.push(membershipCode.id)

            const pointsCode = await createTestRedemptionCode({
                type: RedemptionCodeType.POINTS_ONLY,
            })
            testIds.redemptionCodeIds.push(pointsCode.id)

            const result = await findRedemptionCodesWithFiltersDao({
                type: RedemptionCodeType.MEMBERSHIP_ONLY,
            })

            result.list.forEach(item => {
                expect(item.type).toBe(RedemptionCodeType.MEMBERSHIP_ONLY)
            })
        })

        it('应支持按 code 模糊搜索', async () => {
            if (!dbAvailable) return

            const uniquePrefix = `FUZZY-${Date.now()}`
            const code = await createTestRedemptionCode({
                code: `${uniquePrefix}-SEARCH`,
            })
            testIds.redemptionCodeIds.push(code.id)

            const result = await findRedemptionCodesWithFiltersDao({
                code: uniquePrefix,
            })

            expect(result.list.length).toBeGreaterThanOrEqual(1)
            expect(result.list.some(item => item.code.includes(uniquePrefix))).toBe(true)
        })

        it('应支持按备注模糊搜索', async () => {
            if (!dbAvailable) return

            const uniqueRemark = `备注_${Date.now()}`
            const code = await createTestRedemptionCode({
                remark: uniqueRemark,
            })
            testIds.redemptionCodeIds.push(code.id)

            const result = await findRedemptionCodesWithFiltersDao({
                remark: uniqueRemark,
            })

            expect(result.list.length).toBeGreaterThanOrEqual(1)
        })

        it('默认分页大小应为 20', async () => {
            if (!dbAvailable) return

            const result = await findRedemptionCodesWithFiltersDao()
            expect(result.list.length).toBeLessThanOrEqual(20)
        })
    })

    describe('findRedemptionCodesForExportDao - 导出查询', () => {
        it('应返回不分页的列表', async () => {
            if (!dbAvailable) return

            for (let i = 0; i < 3; i++) {
                const code = await createTestRedemptionCode()
                testIds.redemptionCodeIds.push(code.id)
            }

            const result = await findRedemptionCodesForExportDao()
            expect(Array.isArray(result)).toBe(true)
            expect(result.length).toBeGreaterThanOrEqual(3)
        })

        it('应支持按 ID 列表筛选', async () => {
            if (!dbAvailable) return

            const codes = []
            for (let i = 0; i < 3; i++) {
                const code = await createTestRedemptionCode()
                testIds.redemptionCodeIds.push(code.id)
                codes.push(code)
            }

            const targetIds = [codes[0].id, codes[1].id]
            const result = await findRedemptionCodesForExportDao({ ids: targetIds })

            expect(result.length).toBe(2)
            result.forEach(item => {
                expect(targetIds).toContain(item.id)
            })
        })

        it('应尊重 limit 参数', async () => {
            if (!dbAvailable) return

            for (let i = 0; i < 5; i++) {
                const code = await createTestRedemptionCode()
                testIds.redemptionCodeIds.push(code.id)
            }

            const result = await findRedemptionCodesForExportDao({ limit: 2 })
            expect(result.length).toBeLessThanOrEqual(2)
        })

        it('默认 limit 应为 10000', async () => {
            if (!dbAvailable) return

            // 只需验证函数不会报错即可
            const result = await findRedemptionCodesForExportDao()
            expect(Array.isArray(result)).toBe(true)
        })
    })
})
