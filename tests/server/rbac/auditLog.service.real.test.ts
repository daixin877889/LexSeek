/**
 * 权限审计日志服务层真实 DB 集成测试
 *
 * 针对 server/services/rbac/auditLog.service.ts 的全部导出函数进行覆盖，
 * 使用真实 Postgres 测试库，通过 DAO 回读并断言数据完整性。
 *
 * **Feature: rbac-audit-log-service-coverage**
 * **Target: server/services/rbac/auditLog.service.ts (>=90%)**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import type { H3Event } from 'h3'
import type { IncomingHttpHeaders } from 'node:http'

import {
    testPrisma,
    createTestUser,
    connectTestDb,
    disconnectTestDb,
    resetDatabaseSequences,
} from '../membership/test-db-helper'

// 注入 Nuxt 自动导入依赖的全局符号，必须在 service 模块加载前完成
import { createAuditLogDao, findAuditLogByIdDao } from '../../../server/services/rbac/auditLog.dao'
import { AuditLogAction } from '../../../shared/types/rbac'
import { getHeader } from 'h3'

;(globalThis as any).createAuditLogDao = createAuditLogDao
;(globalThis as any).AuditLogAction = AuditLogAction
;(globalThis as any).getHeader = getHeader

import {
    logRoleCreate,
    logRoleUpdate,
    logRoleDelete,
    logRoleAssignApiPermission,
    logRoleRemoveApiPermission,
    logRoleAssignRoutePermission,
    logUserAssignRole,
    logUserRemoveRole,
    logApiPermissionCreate,
    logApiPermissionUpdate,
    logApiPermissionDelete,
    logApiPermissionBatchPublic,
    logApiPermissionBatchDelete,
} from '../../../server/services/rbac/auditLog.service'

// ==================== 测试数据追踪 ====================

const createdAuditLogIds: number[] = []
const createdUserIds: number[] = []

const trackLog = <T extends { id: number }>(log: T): T => {
    createdAuditLogIds.push(log.id)
    return log
}

// ==================== H3Event Mock 构造器 ====================

/**
 * 构造一个足以满足 getHeader 以及 node.req.socket 读取的 H3Event mock。
 *
 * h3 的 getHeader 实现为：event.node.req.headers[name.toLowerCase()]
 * 因此只需要提供一个 headers 字典即可驱动 getClientIp 的三条分支。
 */
interface MockEventOptions {
    headers?: IncomingHttpHeaders
    remoteAddress?: string | null
    /** 当为 true 时 node.req.socket 为 undefined，用于覆盖 null 兜底分支 */
    withoutSocket?: boolean
}

const createMockEvent = (options: MockEventOptions = {}): H3Event => {
    const headers = options.headers ?? {}
    const socket = options.withoutSocket
        ? undefined
        : {
              remoteAddress: options.remoteAddress ?? null,
          }

    return {
        context: {},
        node: {
            req: {
                headers,
                socket,
            },
            res: {},
        },
    } as unknown as H3Event
}

// ==================== 清理 ====================

const cleanupTestData = async () => {
    if (createdAuditLogIds.length > 0) {
        await testPrisma.permissionAuditLogs.deleteMany({
            where: { id: { in: createdAuditLogIds } },
        })
        createdAuditLogIds.length = 0
    }

    if (createdUserIds.length > 0) {
        // 清理用户相关的所有审计日志（防止系统自动产生的残留）
        await testPrisma.permissionAuditLogs.deleteMany({
            where: { operatorId: { in: createdUserIds } },
        })
        await testPrisma.users.deleteMany({
            where: { id: { in: createdUserIds } },
        })
        createdUserIds.length = 0
    }
}

// ==================== 测试套件 ====================

describe('auditLog.service 真实 DB 集成测试', () => {
    beforeAll(async () => {
        await connectTestDb()
        await resetDatabaseSequences()
    })

    afterAll(async () => {
        await cleanupTestData()
        await disconnectTestDb()
    })

    afterEach(async () => {
        await cleanupTestData()
    })

    describe('getClientIp 分支（通过 ip 字段断言）', () => {
        it('应优先从 x-forwarded-for 取第一个 IP 并去除空白', async () => {
            const operator = await createTestUser()
            createdUserIds.push(operator.id)

            const event = createMockEvent({
                headers: {
                    'x-forwarded-for': '  10.0.0.1 , 10.0.0.2',
                    'x-real-ip': '192.168.1.1',
                },
                remoteAddress: '127.0.0.1',
            })

            const log = trackLog(await logRoleCreate(event, operator.id, 1001, { name: 'r1' }))

            expect(log.ip).toBe('10.0.0.1')
            expect(log.action).toBe(AuditLogAction.ROLE_CREATE)
        })

        it('缺少 x-forwarded-for 时应从 x-real-ip 读取', async () => {
            const operator = await createTestUser()
            createdUserIds.push(operator.id)

            const event = createMockEvent({
                headers: { 'x-real-ip': '192.168.1.100' },
                remoteAddress: '127.0.0.1',
            })

            const log = trackLog(await logRoleCreate(event, operator.id, 1002, { name: 'r2' }))
            expect(log.ip).toBe('192.168.1.100')
        })

        it('两个代理头都缺失时应回退到 socket.remoteAddress', async () => {
            const operator = await createTestUser()
            createdUserIds.push(operator.id)

            const event = createMockEvent({
                headers: {},
                remoteAddress: '203.0.113.7',
            })

            const log = trackLog(await logRoleCreate(event, operator.id, 1003, { name: 'r3' }))
            expect(log.ip).toBe('203.0.113.7')
        })

        it('socket 缺失或 remoteAddress 为空时应写入 null', async () => {
            const operator = await createTestUser()
            createdUserIds.push(operator.id)

            const event = createMockEvent({ headers: {}, withoutSocket: true })

            const log = trackLog(await logRoleCreate(event, operator.id, 1004, { name: 'r4' }))
            expect(log.ip).toBeNull()
        })
    })

    describe('角色相关日志', () => {
        it('logRoleCreate 应记录 newValue 和 role targetType', async () => {
            const operator = await createTestUser()
            createdUserIds.push(operator.id)

            const event = createMockEvent({ headers: { 'x-real-ip': '10.0.0.11' } })
            const roleData = { name: '测试角色', code: 'TEST_ROLE' }

            const log = trackLog(await logRoleCreate(event, operator.id, 2001, roleData))

            expect(log.action).toBe(AuditLogAction.ROLE_CREATE)
            expect(log.targetType).toBe('role')
            expect(log.targetId).toBe(2001)
            expect(log.operatorId).toBe(operator.id)
            expect(log.ip).toBe('10.0.0.11')

            const found = await findAuditLogByIdDao(log.id)
            expect(found?.newValue).toEqual(roleData)
            expect(found?.oldValue).toBeNull()
        })

        it('logRoleUpdate 应同时记录 oldValue 和 newValue', async () => {
            const operator = await createTestUser()
            createdUserIds.push(operator.id)

            const event = createMockEvent()
            const oldData = { name: '旧名称', status: 1 }
            const newData = { name: '新名称', status: 0 }

            const log = trackLog(
                await logRoleUpdate(event, operator.id, 2002, oldData, newData)
            )

            expect(log.action).toBe(AuditLogAction.ROLE_UPDATE)
            const found = await findAuditLogByIdDao(log.id)
            expect(found?.oldValue).toEqual(oldData)
            expect(found?.newValue).toEqual(newData)
        })

        it('logRoleDelete 应只记录 oldValue', async () => {
            const operator = await createTestUser()
            createdUserIds.push(operator.id)

            const event = createMockEvent()
            const roleData = { name: '待删除角色', code: 'TO_DELETE' }

            const log = trackLog(await logRoleDelete(event, operator.id, 2003, roleData))

            expect(log.action).toBe(AuditLogAction.ROLE_DELETE)
            const found = await findAuditLogByIdDao(log.id)
            expect(found?.oldValue).toEqual(roleData)
            expect(found?.newValue).toBeNull()
        })
    })

    describe('角色权限相关日志', () => {
        it('logRoleAssignApiPermission 应记录 permissionIds 到 newValue', async () => {
            const operator = await createTestUser()
            createdUserIds.push(operator.id)

            const log = trackLog(
                await logRoleAssignApiPermission(createMockEvent(), operator.id, 3001, [1, 2, 3])
            )

            expect(log.action).toBe(AuditLogAction.ROLE_ASSIGN_API_PERMISSION)
            expect(log.targetType).toBe('role')
            const found = await findAuditLogByIdDao(log.id)
            expect(found?.newValue).toEqual({ permissionIds: [1, 2, 3] })
        })

        it('logRoleRemoveApiPermission 应记录 permissionIds 到 oldValue', async () => {
            const operator = await createTestUser()
            createdUserIds.push(operator.id)

            const log = trackLog(
                await logRoleRemoveApiPermission(createMockEvent(), operator.id, 3002, [9, 10])
            )

            expect(log.action).toBe(AuditLogAction.ROLE_REMOVE_API_PERMISSION)
            const found = await findAuditLogByIdDao(log.id)
            expect(found?.oldValue).toEqual({ permissionIds: [9, 10] })
            expect(found?.newValue).toBeNull()
        })

        it('logRoleAssignRoutePermission 应记录 routes 数组', async () => {
            const operator = await createTestUser()
            createdUserIds.push(operator.id)

            const routes = ['/admin/dashboard', '/admin/users']
            const log = trackLog(
                await logRoleAssignRoutePermission(createMockEvent(), operator.id, 3003, routes)
            )

            expect(log.action).toBe(AuditLogAction.ROLE_ASSIGN_ROUTE_PERMISSION)
            const found = await findAuditLogByIdDao(log.id)
            expect(found?.newValue).toEqual({ routes })
        })
    })

    describe('用户角色相关日志', () => {
        it('logUserAssignRole 应以 user 作为 targetType 并记录 roleIds', async () => {
            const operator = await createTestUser()
            const target = await createTestUser()
            createdUserIds.push(operator.id, target.id)

            const log = trackLog(
                await logUserAssignRole(createMockEvent(), operator.id, target.id, [11, 22])
            )

            expect(log.action).toBe(AuditLogAction.USER_ASSIGN_ROLE)
            expect(log.targetType).toBe('user')
            expect(log.targetId).toBe(target.id)
            const found = await findAuditLogByIdDao(log.id)
            expect(found?.newValue).toEqual({ roleIds: [11, 22] })
        })

        it('logUserRemoveRole 应记录 roleIds 到 oldValue', async () => {
            const operator = await createTestUser()
            const target = await createTestUser()
            createdUserIds.push(operator.id, target.id)

            const log = trackLog(
                await logUserRemoveRole(createMockEvent(), operator.id, target.id, [33])
            )

            expect(log.action).toBe(AuditLogAction.USER_REMOVE_ROLE)
            expect(log.targetType).toBe('user')
            const found = await findAuditLogByIdDao(log.id)
            expect(found?.oldValue).toEqual({ roleIds: [33] })
            expect(found?.newValue).toBeNull()
        })
    })

    describe('API 权限相关日志', () => {
        it('logApiPermissionCreate 应记录 api_permission targetType 和 newValue', async () => {
            const operator = await createTestUser()
            createdUserIds.push(operator.id)

            const permissionData = { path: '/api/v1/demo', method: 'GET' }
            const log = trackLog(
                await logApiPermissionCreate(createMockEvent(), operator.id, 4001, permissionData)
            )

            expect(log.action).toBe(AuditLogAction.API_PERMISSION_CREATE)
            expect(log.targetType).toBe('api_permission')
            expect(log.targetId).toBe(4001)
            const found = await findAuditLogByIdDao(log.id)
            expect(found?.newValue).toEqual(permissionData)
        })

        it('logApiPermissionUpdate 应同时记录 oldValue 和 newValue', async () => {
            const operator = await createTestUser()
            createdUserIds.push(operator.id)

            const oldData = { isPublic: false }
            const newData = { isPublic: true }

            const log = trackLog(
                await logApiPermissionUpdate(
                    createMockEvent(),
                    operator.id,
                    4002,
                    oldData,
                    newData
                )
            )

            expect(log.action).toBe(AuditLogAction.API_PERMISSION_UPDATE)
            const found = await findAuditLogByIdDao(log.id)
            expect(found?.oldValue).toEqual(oldData)
            expect(found?.newValue).toEqual(newData)
        })

        it('logApiPermissionDelete 应只记录 oldValue', async () => {
            const operator = await createTestUser()
            createdUserIds.push(operator.id)

            const permissionData = { path: '/api/v1/removed', method: 'POST' }

            const log = trackLog(
                await logApiPermissionDelete(createMockEvent(), operator.id, 4003, permissionData)
            )

            expect(log.action).toBe(AuditLogAction.API_PERMISSION_DELETE)
            const found = await findAuditLogByIdDao(log.id)
            expect(found?.oldValue).toEqual(permissionData)
            expect(found?.newValue).toBeNull()
        })

        describe('logApiPermissionBatchPublic', () => {
            it('非空 permissionIds 应以第一个 id 作为 targetId', async () => {
                const operator = await createTestUser()
                createdUserIds.push(operator.id)

                const permissionIds = [5001, 5002, 5003]
                const log = trackLog(
                    await logApiPermissionBatchPublic(
                        createMockEvent(),
                        operator.id,
                        permissionIds,
                        true
                    )
                )

                expect(log.action).toBe(AuditLogAction.API_PERMISSION_BATCH_PUBLIC)
                expect(log.targetType).toBe('api_permission')
                expect(log.targetId).toBe(5001)
                const found = await findAuditLogByIdDao(log.id)
                expect(found?.newValue).toEqual({ permissionIds, isPublic: true })
            })

            it('空 permissionIds 数组应回退 targetId 为 0', async () => {
                const operator = await createTestUser()
                createdUserIds.push(operator.id)

                const log = trackLog(
                    await logApiPermissionBatchPublic(createMockEvent(), operator.id, [], false)
                )

                expect(log.targetId).toBe(0)
                const found = await findAuditLogByIdDao(log.id)
                expect(found?.newValue).toEqual({ permissionIds: [], isPublic: false })
            })
        })

        describe('logApiPermissionBatchDelete', () => {
            it('非空 permissionIds 应以第一个 id 作为 targetId', async () => {
                const operator = await createTestUser()
                createdUserIds.push(operator.id)

                const permissionIds = [6001, 6002]
                const log = trackLog(
                    await logApiPermissionBatchDelete(
                        createMockEvent(),
                        operator.id,
                        permissionIds
                    )
                )

                expect(log.action).toBe(AuditLogAction.API_PERMISSION_BATCH_DELETE)
                expect(log.targetId).toBe(6001)
                const found = await findAuditLogByIdDao(log.id)
                expect(found?.oldValue).toEqual({ permissionIds })
                expect(found?.newValue).toBeNull()
            })

            it('空 permissionIds 数组应回退 targetId 为 0', async () => {
                const operator = await createTestUser()
                createdUserIds.push(operator.id)

                const log = trackLog(
                    await logApiPermissionBatchDelete(createMockEvent(), operator.id, [])
                )

                expect(log.targetId).toBe(0)
                const found = await findAuditLogByIdDao(log.id)
                expect(found?.oldValue).toEqual({ permissionIds: [] })
            })
        })
    })

    describe('事务客户端支持', () => {
        it('传入 tx 时应使用事务客户端写入，并对外部事务可见', async () => {
            const operator = await createTestUser()
            createdUserIds.push(operator.id)

            const event = createMockEvent({ headers: { 'x-real-ip': '172.16.0.1' } })

            const createdId = await testPrisma.$transaction(async tx => {
                const log = await logRoleCreate(
                    event,
                    operator.id,
                    7001,
                    { name: 'tx-role' },
                    tx
                )
                createdAuditLogIds.push(log.id)

                // 事务内部应能通过 tx 读到刚写入的日志
                const inTx = await tx.permissionAuditLogs.findUnique({ where: { id: log.id } })
                expect(inTx).not.toBeNull()
                expect(inTx?.ip).toBe('172.16.0.1')

                return log.id
            })

            const found = await findAuditLogByIdDao(createdId)
            expect(found).not.toBeNull()
            expect(found?.targetId).toBe(7001)
            expect(found?.action).toBe(AuditLogAction.ROLE_CREATE)
        })
    })
})
