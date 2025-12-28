/**
 * RBAC 权限模块测试
 *
 * 测试角色和用户角色 DAO 功能
 *
 * **Feature: rbac-module**
 * **Validates: Requirements 5.1, 5.2, 5.3**
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import * as fc from 'fast-check'
import {
    testPrisma,
    createTestUser,
    createEmptyTestIds,
    cleanupTestData,
    connectTestDb,
    disconnectTestDb,
    type TestIds,
} from '../membership/test-db-helper'

// 导入实际的业务函数
import {
    findRoleByIdsDao,
} from '../../../server/services/rbac/roles.dao'

import {
    createUserRoleDao,
    findUserRolesByUserIdDao,
    findUserRolesRouterByUserIdDao,
} from '../../../server/services/rbac/userRoles.dao'

// 测试数据追踪
let testIds: TestIds

// 角色 ID 追踪
const createdRoleIds: number[] = []
const createdUserRoleIds: number[] = []

describe('RBAC 权限模块测试', () => {
    beforeAll(async () => {
        await connectTestDb()
    })

    afterAll(async () => {
        await disconnectTestDb()
    })

    beforeEach(() => {
        testIds = createEmptyTestIds()
        createdRoleIds.length = 0
        createdUserRoleIds.length = 0
    })

    afterEach(async () => {
        // 清理用户角色关联
        if (createdUserRoleIds.length > 0) {
            await testPrisma.userRoles.deleteMany({
                where: { id: { in: createdUserRoleIds } },
            })
        }

        // 清理测试角色
        if (createdRoleIds.length > 0) {
            await testPrisma.roles.deleteMany({
                where: { id: { in: createdRoleIds } },
            })
        }

        await cleanupTestData(testIds)
    })

    describe('角色 DAO 测试', () => {
        describe('findRoleByIdsDao - 通过 ID 列表查询角色', () => {
            it('应能通过 ID 列表查询到角色', async () => {
                const timestamp = Date.now()

                // 创建测试角色
                const role1 = await testPrisma.roles.create({
                    data: {
                        name: `测试角色1_${timestamp}`,
                        code: `TEST_ROLE_1_${timestamp}`,
                        description: '测试角色1描述',
                        status: 1,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    },
                })
                createdRoleIds.push(role1.id)

                const role2 = await testPrisma.roles.create({
                    data: {
                        name: `测试角色2_${timestamp}`,
                        code: `TEST_ROLE_2_${timestamp}`,
                        description: '测试角色2描述',
                        status: 1,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    },
                })
                createdRoleIds.push(role2.id)

                // 查询
                const roles = await findRoleByIdsDao([role1.id, role2.id])

                expect(roles.length).toBe(2)
                expect(roles.some(r => r.id === role1.id)).toBe(true)
                expect(roles.some(r => r.id === role2.id)).toBe(true)
            })

            it('查询不存在的角色 ID 应返回空数组', async () => {
                const roles = await findRoleByIdsDao([999999998, 999999999])
                expect(roles.length).toBe(0)
            })

            it('不应返回禁用状态的角色', async () => {
                const timestamp = Date.now()

                // 创建禁用状态的角色
                const disabledRole = await testPrisma.roles.create({
                    data: {
                        name: `禁用角色_${timestamp}`,
                        code: `DISABLED_ROLE_${timestamp}`,
                        description: '禁用角色描述',
                        status: 0, // 禁用
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    },
                })
                createdRoleIds.push(disabledRole.id)

                // 查询
                const roles = await findRoleByIdsDao([disabledRole.id])

                expect(roles.length).toBe(0)
            })

            it('部分 ID 存在时应只返回存在的角色', async () => {
                const timestamp = Date.now()

                const role = await testPrisma.roles.create({
                    data: {
                        name: `部分测试角色_${timestamp}`,
                        code: `PARTIAL_ROLE_${timestamp}`,
                        description: '部分测试角色描述',
                        status: 1,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    },
                })
                createdRoleIds.push(role.id)

                // 查询包含存在和不存在的 ID
                const roles = await findRoleByIdsDao([role.id, 999999999])

                expect(roles.length).toBe(1)
                expect(roles[0].id).toBe(role.id)
            })
        })
    })

    describe('用户角色 DAO 测试', () => {
        describe('createUserRoleDao - 创建用户角色关联', () => {
            it('应能创建用户角色关联', async () => {
                const user = await createTestUser()
                testIds.userIds.push(user.id)

                const timestamp = Date.now()
                const role = await testPrisma.roles.create({
                    data: {
                        name: `关联测试角色_${timestamp}`,
                        code: `LINK_ROLE_${timestamp}`,
                        description: '关联测试角色描述',
                        status: 1,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    },
                })
                createdRoleIds.push(role.id)

                // 创建关联
                const userRole = await createUserRoleDao(user.id, role.id)
                createdUserRoleIds.push(userRole.id)

                expect(userRole).toBeDefined()
                expect(userRole.userId).toBe(user.id)
                expect(userRole.roleId).toBe(role.id)
            })
        })

        describe('findUserRolesByUserIdDao - 查询用户角色', () => {
            it('应能查询用户的所有角色', async () => {
                const user = await createTestUser()
                testIds.userIds.push(user.id)

                const timestamp = Date.now()

                // 创建两个角色
                const role1 = await testPrisma.roles.create({
                    data: {
                        name: `用户角色1_${timestamp}`,
                        code: `USER_ROLE_1_${timestamp}`,
                        status: 1,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    },
                })
                createdRoleIds.push(role1.id)

                const role2 = await testPrisma.roles.create({
                    data: {
                        name: `用户角色2_${timestamp}`,
                        code: `USER_ROLE_2_${timestamp}`,
                        status: 1,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    },
                })
                createdRoleIds.push(role2.id)

                // 创建关联
                const userRole1 = await createUserRoleDao(user.id, role1.id)
                createdUserRoleIds.push(userRole1.id)

                const userRole2 = await createUserRoleDao(user.id, role2.id)
                createdUserRoleIds.push(userRole2.id)

                // 查询
                const userRoles = await findUserRolesByUserIdDao(user.id)

                expect(userRoles.length).toBe(2)
                expect(userRoles.some(ur => ur.roleId === role1.id)).toBe(true)
                expect(userRoles.some(ur => ur.roleId === role2.id)).toBe(true)
            })

            it('查询结果应包含角色详情', async () => {
                const user = await createTestUser()
                testIds.userIds.push(user.id)

                const timestamp = Date.now()
                const role = await testPrisma.roles.create({
                    data: {
                        name: `详情测试角色_${timestamp}`,
                        code: `DETAIL_ROLE_${timestamp}`,
                        description: '详情测试描述',
                        status: 1,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    },
                })
                createdRoleIds.push(role.id)

                const userRole = await createUserRoleDao(user.id, role.id)
                createdUserRoleIds.push(userRole.id)

                // 查询
                const userRoles = await findUserRolesByUserIdDao(user.id)

                expect(userRoles.length).toBe(1)
                expect(userRoles[0].role).toBeDefined()
                expect(userRoles[0].role.name).toBe(`详情测试角色_${timestamp}`)
            })

            it('没有角色的用户应返回空数组', async () => {
                const user = await createTestUser()
                testIds.userIds.push(user.id)

                const userRoles = await findUserRolesByUserIdDao(user.id)

                expect(userRoles.length).toBe(0)
            })
        })

        describe('findUserRolesRouterByUserIdDao - 查询用户角色路由权限', () => {
            it('应能查询用户的角色路由权限', async () => {
                const user = await createTestUser()
                testIds.userIds.push(user.id)

                const timestamp = Date.now()
                const role = await testPrisma.roles.create({
                    data: {
                        name: `路由测试角色_${timestamp}`,
                        code: `ROUTER_ROLE_${timestamp}`,
                        status: 1,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    },
                })
                createdRoleIds.push(role.id)

                const userRole = await createUserRoleDao(user.id, role.id)
                createdUserRoleIds.push(userRole.id)

                // 查询
                const userRolesWithRouters = await findUserRolesRouterByUserIdDao(user.id)

                expect(userRolesWithRouters.length).toBe(1)
                expect(userRolesWithRouters[0].role).toBeDefined()
                expect(userRolesWithRouters[0].role.roleRouters).toBeDefined()
            })

            it('应支持按角色 ID 筛选', async () => {
                const user = await createTestUser()
                testIds.userIds.push(user.id)

                const timestamp = Date.now()

                const role1 = await testPrisma.roles.create({
                    data: {
                        name: `筛选角色1_${timestamp}`,
                        code: `FILTER_ROLE_1_${timestamp}`,
                        status: 1,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    },
                })
                createdRoleIds.push(role1.id)

                const role2 = await testPrisma.roles.create({
                    data: {
                        name: `筛选角色2_${timestamp}`,
                        code: `FILTER_ROLE_2_${timestamp}`,
                        status: 1,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    },
                })
                createdRoleIds.push(role2.id)

                const userRole1 = await createUserRoleDao(user.id, role1.id)
                createdUserRoleIds.push(userRole1.id)

                const userRole2 = await createUserRoleDao(user.id, role2.id)
                createdUserRoleIds.push(userRole2.id)

                // 按单个角色 ID 筛选
                const filtered = await findUserRolesRouterByUserIdDao(user.id, { roleId: role1.id })

                expect(filtered.length).toBe(1)
                expect(filtered[0].roleId).toBe(role1.id)
            })
        })
    })

    describe('Property: 用户角色关联一致性', () => {
        it('创建的用户角色关联应能被正确查询到', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 3 }), // 角色数量
                    async (roleCount) => {
                        const user = await createTestUser()
                        testIds.userIds.push(user.id)

                        const timestamp = Date.now()
                        const random = Math.floor(Math.random() * 10000)
                        const roleIds: number[] = []

                        // 创建角色
                        for (let i = 0; i < roleCount; i++) {
                            const role = await testPrisma.roles.create({
                                data: {
                                    name: `属性测试角色_${timestamp}_${random}_${i}`,
                                    code: `PROP_ROLE_${timestamp}_${random}_${i}`,
                                    status: 1,
                                    createdAt: new Date(),
                                    updatedAt: new Date(),
                                },
                            })
                            createdRoleIds.push(role.id)
                            roleIds.push(role.id)

                            // 创建关联
                            const userRole = await createUserRoleDao(user.id, role.id)
                            createdUserRoleIds.push(userRole.id)
                        }

                        // 查询验证
                        const userRoles = await findUserRolesByUserIdDao(user.id)

                        expect(userRoles.length).toBe(roleCount)
                        for (const roleId of roleIds) {
                            expect(userRoles.some(ur => ur.roleId === roleId)).toBe(true)
                        }
                    }
                ),
                { numRuns: 5 }
            )
        })
    })
})
