/**
 * 审计日志属性测试
 *
 * 使用 fast-check 进行属性测试，验证审计日志完整性
 *
 * **Feature: rbac-enhancement**
 * **Property 12: 审计日志完整性**
 * **Validates: Requirements 12.1, 12.2, 12.3, 12.4**
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import * as fc from 'fast-check'
import {
    testPrisma,
    createTestUser,
    connectTestDb,
    disconnectTestDb,
    resetDatabaseSequences,
} from '../membership/test-db-helper'

// 导入审计日志 DAO 函数
import {
    createAuditLogDao,
    findAuditLogsDao,
    findAuditLogByIdDao,
    findAuditLogsByTargetDao,
} from '../../../server/services/rbac/auditLog.dao'

// 从共享类型导入 AuditLogAction 枚举
import { AuditLogAction } from '../../../shared/types/rbac'

// ==================== 测试数据追踪 ====================

const createdAuditLogIds: number[] = []
const createdUserIds: number[] = []

// ==================== 辅助函数 ====================

const generateUniqueId = () => {
    const timestamp = Date.now()
    const random = Math.floor(Math.random() * 1000000)
    const uuid = crypto.randomUUID().replace(/-/g, '').substring(0, 8)
    return `${timestamp}_${random}_${uuid}`
}

const cleanupTestData = async () => {
    if (createdAuditLogIds.length > 0) {
        await testPrisma.permissionAuditLogs.deleteMany({
            where: { id: { in: createdAuditLogIds } },
        })
        createdAuditLogIds.length = 0
    }

    if (createdUserIds.length > 0) {
        await testPrisma.users.deleteMany({
            where: { id: { in: createdUserIds } },
        })
        createdUserIds.length = 0
    }
}

// ==================== 测试套件 ====================

describe('审计日志属性测试', () => {
    beforeAll(async () => {
        await connectTestDb()
        await resetDatabaseSequences()
    })

    afterAll(async () => {
        await cleanupTestData()
        await disconnectTestDb()
    })

    beforeEach(() => {
        createdAuditLogIds.length = 0
        createdUserIds.length = 0
    })

    afterEach(async () => {
        await cleanupTestData()
    })

    describe('Property 12: 审计日志完整性', () => {
        it('创建审计日志应包含所有必要字段', async () => {
            // 创建操作者用户
            const operator = await createTestUser()
            createdUserIds.push(operator.id)

            const uniqueId = generateUniqueId()
            const targetId = Math.floor(Math.random() * 10000) + 1

            // 创建审计日志
            const log = await createAuditLogDao({
                action: AuditLogAction.ROLE_CREATE,
                targetType: 'role',
                targetId,
                operatorId: operator.id,
                newValue: { name: `测试角色_${uniqueId}`, code: `TEST_${uniqueId}` },
                ip: '127.0.0.1',
            })
            createdAuditLogIds.push(log.id)

            // 验证日志字段
            expect(log.action).toBe(AuditLogAction.ROLE_CREATE)
            expect(log.targetType).toBe('role')
            expect(log.targetId).toBe(targetId)
            expect(log.operatorId).toBe(operator.id)
            expect(log.ip).toBe('127.0.0.1')
            expect(log.createdAt).toBeInstanceOf(Date)
        })

        it('审计日志应正确记录新旧值', async () => {
            const operator = await createTestUser()
            createdUserIds.push(operator.id)

            const uniqueId = generateUniqueId()
            const targetId = Math.floor(Math.random() * 10000) + 1
            const oldValue = { name: `旧名称_${uniqueId}`, status: 1 }
            const newValue = { name: `新名称_${uniqueId}`, status: 0 }

            // 创建更新操作的审计日志
            const log = await createAuditLogDao({
                action: AuditLogAction.ROLE_UPDATE,
                targetType: 'role',
                targetId,
                operatorId: operator.id,
                oldValue,
                newValue,
            })
            createdAuditLogIds.push(log.id)

            // 查询并验证
            const found = await findAuditLogByIdDao(log.id)
            expect(found).not.toBeNull()
            expect(found!.oldValue).toEqual(oldValue)
            expect(found!.newValue).toEqual(newValue)
        })

        it('应能按操作类型筛选审计日志', async () => {
            const operator = await createTestUser()
            createdUserIds.push(operator.id)

            // 创建不同类型的审计日志
            const log1 = await createAuditLogDao({
                action: AuditLogAction.ROLE_CREATE,
                targetType: 'role',
                targetId: 1,
                operatorId: operator.id,
            })
            createdAuditLogIds.push(log1.id)

            const log2 = await createAuditLogDao({
                action: AuditLogAction.ROLE_DELETE,
                targetType: 'role',
                targetId: 2,
                operatorId: operator.id,
            })
            createdAuditLogIds.push(log2.id)

            const log3 = await createAuditLogDao({
                action: AuditLogAction.USER_ASSIGN_ROLE,
                targetType: 'user',
                targetId: 3,
                operatorId: operator.id,
            })
            createdAuditLogIds.push(log3.id)

            // 按操作类型筛选
            const result = await findAuditLogsDao({ action: AuditLogAction.ROLE_CREATE })
            const filteredIds = result.items.map(item => item.id)
            expect(filteredIds).toContain(log1.id)
            expect(filteredIds).not.toContain(log2.id)
            expect(filteredIds).not.toContain(log3.id)
        })

        it('应能按目标类型筛选审计日志', async () => {
            const operator = await createTestUser()
            createdUserIds.push(operator.id)

            // 创建不同目标类型的审计日志
            const log1 = await createAuditLogDao({
                action: AuditLogAction.ROLE_CREATE,
                targetType: 'role',
                targetId: 100,
                operatorId: operator.id,
            })
            createdAuditLogIds.push(log1.id)

            const log2 = await createAuditLogDao({
                action: AuditLogAction.USER_ASSIGN_ROLE,
                targetType: 'user',
                targetId: 200,
                operatorId: operator.id,
            })
            createdAuditLogIds.push(log2.id)

            // 按目标类型筛选
            const result = await findAuditLogsDao({ targetType: 'role' })
            const filteredIds = result.items.map(item => item.id)
            expect(filteredIds).toContain(log1.id)
            expect(filteredIds).not.toContain(log2.id)
        })

        it('应能查询指定目标的所有审计日志', async () => {
            const operator = await createTestUser()
            createdUserIds.push(operator.id)

            const targetId = Math.floor(Math.random() * 10000) + 1000

            // 为同一目标创建多条日志
            const log1 = await createAuditLogDao({
                action: AuditLogAction.ROLE_CREATE,
                targetType: 'role',
                targetId,
                operatorId: operator.id,
            })
            createdAuditLogIds.push(log1.id)

            const log2 = await createAuditLogDao({
                action: AuditLogAction.ROLE_UPDATE,
                targetType: 'role',
                targetId,
                operatorId: operator.id,
            })
            createdAuditLogIds.push(log2.id)

            // 为其他目标创建日志
            const log3 = await createAuditLogDao({
                action: AuditLogAction.ROLE_CREATE,
                targetType: 'role',
                targetId: targetId + 1,
                operatorId: operator.id,
            })
            createdAuditLogIds.push(log3.id)

            // 查询指定目标的日志
            const result = await findAuditLogsByTargetDao('role', targetId)
            const foundIds = result.items.map(item => item.id)
            expect(foundIds).toContain(log1.id)
            expect(foundIds).toContain(log2.id)
            expect(foundIds).not.toContain(log3.id)
        })

        it('审计日志应按时间倒序排列', async () => {
            const operator = await createTestUser()
            createdUserIds.push(operator.id)

            // 创建多条日志
            const logs: number[] = []
            for (let i = 0; i < 3; i++) {
                const log = await createAuditLogDao({
                    action: AuditLogAction.ROLE_CREATE,
                    targetType: 'role',
                    targetId: i + 1,
                    operatorId: operator.id,
                })
                createdAuditLogIds.push(log.id)
                logs.push(log.id)
                // 添加小延迟确保时间戳不同
                await new Promise(resolve => setTimeout(resolve, 10))
            }

            // 查询日志
            const result = await findAuditLogsDao({})

            // 验证排序（最新的在前）
            const resultIds = result.items.map(item => item.id)
            const testLogIds = resultIds.filter(id => logs.includes(id))

            // 最后创建的应该在最前面
            if (testLogIds.length >= 2) {
                const lastCreatedIndex = testLogIds.indexOf(logs[logs.length - 1])
                const firstCreatedIndex = testLogIds.indexOf(logs[0])
                expect(lastCreatedIndex).toBeLessThan(firstCreatedIndex)
            }
        })

        it('分页查询应正确返回总数和页数', async () => {
            const operator = await createTestUser()
            createdUserIds.push(operator.id)

            // 创建 5 条日志
            for (let i = 0; i < 5; i++) {
                const log = await createAuditLogDao({
                    action: AuditLogAction.ROLE_CREATE,
                    targetType: 'role',
                    targetId: i + 1,
                    operatorId: operator.id,
                })
                createdAuditLogIds.push(log.id)
            }

            // 分页查询（每页 2 条）
            const result = await findAuditLogsDao({}, { page: 1, pageSize: 2 })

            expect(result.items.length).toBeLessThanOrEqual(2)
            expect(result.page).toBe(1)
            expect(result.pageSize).toBe(2)
            expect(result.total).toBeGreaterThanOrEqual(5)
            expect(result.totalPages).toBeGreaterThanOrEqual(3)
        })
    })

    describe('审计日志操作类型覆盖', () => {
        it('应支持所有定义的操作类型', async () => {
            const operator = await createTestUser()
            createdUserIds.push(operator.id)

            const actions = [
                AuditLogAction.ROLE_CREATE,
                AuditLogAction.ROLE_UPDATE,
                AuditLogAction.ROLE_DELETE,
                AuditLogAction.ROLE_ASSIGN_API_PERMISSION,
                AuditLogAction.ROLE_REMOVE_API_PERMISSION,
                AuditLogAction.ROLE_ASSIGN_ROUTE_PERMISSION,
                AuditLogAction.USER_ASSIGN_ROLE,
                AuditLogAction.USER_REMOVE_ROLE,
                AuditLogAction.API_PERMISSION_CREATE,
                AuditLogAction.API_PERMISSION_UPDATE,
                AuditLogAction.API_PERMISSION_DELETE,
                AuditLogAction.API_PERMISSION_BATCH_PUBLIC,
            ]

            for (const action of actions) {
                const log = await createAuditLogDao({
                    action,
                    targetType: 'test',
                    targetId: 1,
                    operatorId: operator.id,
                })
                createdAuditLogIds.push(log.id)
                expect(log.action).toBe(action)
            }
        })
    })

    describe('属性测试 - 随机数据', () => {
        it('任意有效输入都应成功创建审计日志', async () => {
            const operator = await createTestUser()
            createdUserIds.push(operator.id)

            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 100000 }),
                    fc.constantFrom('role', 'user', 'api_permission'),
                    fc.constantFrom(
                        AuditLogAction.ROLE_CREATE,
                        AuditLogAction.ROLE_UPDATE,
                        AuditLogAction.USER_ASSIGN_ROLE
                    ),
                    async (targetId, targetType, action) => {
                        const log = await createAuditLogDao({
                            action,
                            targetType,
                            targetId,
                            operatorId: operator.id,
                        })
                        createdAuditLogIds.push(log.id)

                        expect(log.id).toBeGreaterThan(0)
                        expect(log.action).toBe(action)
                        expect(log.targetType).toBe(targetType)
                        expect(log.targetId).toBe(targetId)
                    }
                ),
                { numRuns: 20 }
            )
        })
    })
})
