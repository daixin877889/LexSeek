/**
 * 兑换码管理员服务测试（补充覆盖）
 *
 * 补充 redemptionCode.admin.service.ts 中尚未覆盖的方法：
 * - getRedemptionCodesAdminService
 * - getRedemptionRecordsAdminService
 * - exportRedemptionCodesService
 *
 * **Feature: redemption-admin-service**
 * **Validates: 列表查询、记录查询、CSV 导出**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import dayjs from 'dayjs'
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

// 导入被测服务函数
import {
    getRedemptionCodesAdminService,
    getRedemptionRecordsAdminService,
    exportRedemptionCodesService,
    generateUniqueCode,
} from '~~/server/services/redemption/redemptionCode.admin.service'

let dbAvailable = false

describe('兑换码管理员服务测试（补充覆盖）', () => {
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
            testIds.redemptionRecordIds = []
            testIds.userIds = []
        }
    })

    afterAll(async () => {
        if (dbAvailable) {
            await disconnectTestDb()
        }
    })

    describe('getRedemptionCodesAdminService - 管理员查询兑换码列表', () => {
        it('应返回分页结构（items、total、page、pageSize、totalPages）', async () => {
            if (!dbAvailable) return

            const code = await createTestRedemptionCode()
            testIds.redemptionCodeIds.push(code.id)

            const result = await getRedemptionCodesAdminService({})

            expect(result).toHaveProperty('items')
            expect(result).toHaveProperty('total')
            expect(result).toHaveProperty('page')
            expect(result).toHaveProperty('pageSize')
            expect(result).toHaveProperty('totalPages')
            expect(result.page).toBe(1)
            expect(result.pageSize).toBe(20)
        })

        it('items 中的每一项应包含格式化的字段（typeName、statusName、时间格式）', async () => {
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

            const result = await getRedemptionCodesAdminService({})
            const item = result.items.find(i => i.id === code.id)

            expect(item).toBeDefined()
            expect(item!.typeName).toBe('仅会员')
            expect(item!.statusName).toBe('有效')
            expect(item!.levelName).toBe(level.name)
            expect(item!.duration).toBe(30)
            // 时间格式验证
            expect(item!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
            expect(item!.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
        })

        it('应支持按状态筛选', async () => {
            if (!dbAvailable) return

            const active = await createTestRedemptionCode({ status: RedemptionCodeStatus.ACTIVE })
            testIds.redemptionCodeIds.push(active.id)

            const used = await createTestRedemptionCode({ status: RedemptionCodeStatus.USED })
            testIds.redemptionCodeIds.push(used.id)

            const result = await getRedemptionCodesAdminService({
                status: RedemptionCodeStatus.ACTIVE,
            })

            result.items.forEach(item => {
                expect(item.status).toBe(RedemptionCodeStatus.ACTIVE)
            })
        })

        it('应支持按类型筛选', async () => {
            if (!dbAvailable) return

            const membership = await createTestRedemptionCode({
                type: RedemptionCodeType.MEMBERSHIP_ONLY,
            })
            testIds.redemptionCodeIds.push(membership.id)

            const points = await createTestRedemptionCode({
                type: RedemptionCodeType.POINTS_ONLY,
                pointAmount: 100,
            })
            testIds.redemptionCodeIds.push(points.id)

            const result = await getRedemptionCodesAdminService({
                type: RedemptionCodeType.POINTS_ONLY,
            })

            result.items.forEach(item => {
                expect(item.type).toBe(RedemptionCodeType.POINTS_ONLY)
            })
        })

        it('totalPages 应正确计算', async () => {
            if (!dbAvailable) return

            for (let i = 0; i < 5; i++) {
                const code = await createTestRedemptionCode()
                testIds.redemptionCodeIds.push(code.id)
            }

            const result = await getRedemptionCodesAdminService({ pageSize: 2 })
            expect(result.totalPages).toBe(Math.ceil(result.total / 2))
        })

        it('没有关联级别时 levelName 应为 null', async () => {
            if (!dbAvailable) return

            const code = await createTestRedemptionCode({
                type: RedemptionCodeType.POINTS_ONLY,
                pointAmount: 50,
            })
            testIds.redemptionCodeIds.push(code.id)

            const result = await getRedemptionCodesAdminService({})
            const item = result.items.find(i => i.id === code.id)

            expect(item).toBeDefined()
            expect(item!.levelName).toBeNull()
        })

        it('有过期时间时 expiredAt 应格式化', async () => {
            if (!dbAvailable) return

            const expiredAt = new Date('2025-12-31T23:59:59Z')
            const code = await createTestRedemptionCode({ expiredAt })
            testIds.redemptionCodeIds.push(code.id)

            const result = await getRedemptionCodesAdminService({})
            const item = result.items.find(i => i.id === code.id)

            expect(item).toBeDefined()
            expect(item!.expiredAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
        })
    })

    describe('getRedemptionRecordsAdminService - 管理员查询兑换记录', () => {
        it('应返回分页结构', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const code = await createTestRedemptionCode({
                status: RedemptionCodeStatus.USED,
            })
            testIds.redemptionCodeIds.push(code.id)

            const record = await createTestRedemptionRecord(user.id, code.id)
            testIds.redemptionRecordIds.push(record.id)

            const result = await getRedemptionRecordsAdminService({})

            expect(result).toHaveProperty('items')
            expect(result).toHaveProperty('total')
            expect(result).toHaveProperty('page')
            expect(result).toHaveProperty('pageSize')
            expect(result).toHaveProperty('totalPages')
        })

        it('items 中应包含用户信息和兑换码信息', async () => {
            if (!dbAvailable) return

            const user = await createTestUser({ name: '测试用户_记录' })
            testIds.userIds.push(user.id)

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const code = await createTestRedemptionCode({
                type: RedemptionCodeType.MEMBERSHIP_ONLY,
                levelId: level.id,
                duration: 30,
                status: RedemptionCodeStatus.USED,
            })
            testIds.redemptionCodeIds.push(code.id)

            const record = await createTestRedemptionRecord(user.id, code.id)
            testIds.redemptionRecordIds.push(record.id)

            const result = await getRedemptionRecordsAdminService({})
            const item = result.items.find(i => i.id === record.id)

            expect(item).toBeDefined()
            expect(item!.userId).toBe(user.id)
            expect(item!.userName).toBe('测试用户_记录')
            expect(item!.userPhone).toBe(user.phone)
            expect(item!.code).toBe(code.code)
            expect(item!.typeName).toBe('仅会员')
            expect(item!.levelName).toBe(level.name)
            expect(item!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
        })

        it('应支持按用户关键词搜索', async () => {
            if (!dbAvailable) return

            const uniqueName = `搜索用户_${Date.now()}`
            const user = await createTestUser({ name: uniqueName })
            testIds.userIds.push(user.id)

            const code = await createTestRedemptionCode({ status: RedemptionCodeStatus.USED })
            testIds.redemptionCodeIds.push(code.id)

            const record = await createTestRedemptionRecord(user.id, code.id)
            testIds.redemptionRecordIds.push(record.id)

            const result = await getRedemptionRecordsAdminService({
                userKeyword: uniqueName,
            })

            expect(result.items.length).toBeGreaterThanOrEqual(1)
            expect(result.items.some(i => i.userName === uniqueName)).toBe(true)
        })

        it('应支持按 code 搜索', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const codeStr = `SEARCH-REC-${Date.now()}`
            const code = await createTestRedemptionCode({
                code: codeStr,
                status: RedemptionCodeStatus.USED,
            })
            testIds.redemptionCodeIds.push(code.id)

            const record = await createTestRedemptionRecord(user.id, code.id)
            testIds.redemptionRecordIds.push(record.id)

            const result = await getRedemptionRecordsAdminService({ code: codeStr })
            expect(result.items.length).toBeGreaterThanOrEqual(1)
        })
    })

    describe('exportRedemptionCodesService - 导出兑换码', () => {
        it('应返回包含 BOM 和表头的 CSV 字符串', async () => {
            if (!dbAvailable) return

            const code = await createTestRedemptionCode()
            testIds.redemptionCodeIds.push(code.id)

            const csv = await exportRedemptionCodesService({})

            // 检查 BOM
            expect(csv.charCodeAt(0)).toBe(0xFEFF)
            // 检查表头
            expect(csv).toContain('兑换码')
            expect(csv).toContain('类型')
            expect(csv).toContain('会员级别')
            expect(csv).toContain('时长(天)')
            expect(csv).toContain('积分数量')
            expect(csv).toContain('状态')
            expect(csv).toContain('过期时间')
            expect(csv).toContain('备注')
            expect(csv).toContain('创建时间')
        })

        it('CSV 数据行应正确包含兑换码信息', async () => {
            if (!dbAvailable) return

            const level = await createTestMembershipLevel({ name: '导出测试级别' })
            testIds.membershipLevelIds.push(level.id)

            const code = await createTestRedemptionCode({
                type: RedemptionCodeType.MEMBERSHIP_ONLY,
                levelId: level.id,
                duration: 60,
                status: RedemptionCodeStatus.ACTIVE,
                remark: '导出测试备注',
            })
            testIds.redemptionCodeIds.push(code.id)

            const csv = await exportRedemptionCodesService({
                ids: [code.id],
            })

            expect(csv).toContain(code.code)
            expect(csv).toContain('仅会员')
            expect(csv).toContain('导出测试级别')
            expect(csv).toContain('60')
            expect(csv).toContain('有效')
            expect(csv).toContain('导出测试备注')
        })

        it('应支持按状态筛选导出', async () => {
            if (!dbAvailable) return

            const active = await createTestRedemptionCode({ status: RedemptionCodeStatus.ACTIVE })
            testIds.redemptionCodeIds.push(active.id)

            const used = await createTestRedemptionCode({ status: RedemptionCodeStatus.USED })
            testIds.redemptionCodeIds.push(used.id)

            const csv = await exportRedemptionCodesService({
                status: RedemptionCodeStatus.ACTIVE,
            })

            // 应包含有效的，不应包含已使用的
            expect(csv).toContain(active.code)
            expect(csv).not.toContain(used.code)
        })

        it('空结果应只返回表头', async () => {
            if (!dbAvailable) return

            const csv = await exportRedemptionCodesService({
                ids: [999999999],
            })

            // BOM + 表头
            const lines = csv.split('\n')
            expect(lines.length).toBe(1) // 只有表头行
        })

        it('应尊重 limit 参数', async () => {
            if (!dbAvailable) return

            for (let i = 0; i < 5; i++) {
                const code = await createTestRedemptionCode()
                testIds.redemptionCodeIds.push(code.id)
            }

            const csv = await exportRedemptionCodesService({ limit: 2 })
            const lines = csv.split('\n')
            // 表头 + 最多 2 行数据
            expect(lines.length).toBeLessThanOrEqual(3)
        })

        it('CSV 单元格应使用双引号包裹', async () => {
            if (!dbAvailable) return

            const code = await createTestRedemptionCode({
                remark: '测试备注',
            })
            testIds.redemptionCodeIds.push(code.id)

            const csv = await exportRedemptionCodesService({ ids: [code.id] })
            const dataLine = csv.split('\n')[1]

            // 每个单元格应被双引号包裹
            expect(dataLine).toContain('"')
        })
    })

    describe('generateUniqueCode - 边界行为', () => {
        it('生成 1000 个码不应有重复', () => {
            const codes = new Set<string>()
            for (let i = 0; i < 1000; i++) {
                codes.add(generateUniqueCode())
            }
            expect(codes.size).toBe(1000)
        })

        it('每个码长度应为 17（8 + 1 + 8）', () => {
            for (let i = 0; i < 50; i++) {
                const code = generateUniqueCode()
                expect(code.length).toBe(17)
            }
        })
    })
})
