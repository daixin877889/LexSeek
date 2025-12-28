/**
 * 用户模块测试
 *
 * 测试用户 DAO 和 Service 层功能
 *
 * **Feature: users-module**
 * **Validates: Requirements 2.1, 2.2, 2.3, 2.4**
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
    TEST_USER_PHONE_PREFIX,
    type TestIds,
} from '../membership/test-db-helper'

// 导入实际的业务函数
import {
    createUserDao,
    findUserByIdDao,
    findUserByPhoneDao,
    findUserByInviteCodeDao,
    findUserByUsernameDao,
    updateUserPasswordDao,
    updateUserProfileDao,
} from '../../../server/services/users/users.dao'

import { createUserService } from '../../../server/services/users/users.service'

// 测试数据追踪
let testIds: TestIds

describe('用户模块测试', () => {
    beforeAll(async () => {
        await connectTestDb()
    })

    afterAll(async () => {
        await disconnectTestDb()
    })

    beforeEach(() => {
        testIds = createEmptyTestIds()
    })

    afterEach(async () => {
        await cleanupTestData(testIds)
    })

    describe('用户 DAO 测试', () => {
        describe('createUserDao - 创建用户', () => {
            it('应能创建新用户', async () => {
                const timestamp = Date.now()
                const phone = `${TEST_USER_PHONE_PREFIX}${String(timestamp).slice(-8)}`

                const user = await createUserDao({
                    name: `测试用户_${timestamp}`,
                    phone,
                    password: 'hashed_password',
                    status: 1,
                })

                testIds.userIds.push(user.id)

                expect(user).toBeDefined()
                expect(user.id).toBeGreaterThan(0)
                expect(user.phone).toBe(phone)
                expect(user.status).toBe(1)
            })

            it('创建用户应包含 userRoles 关联', async () => {
                const timestamp = Date.now()
                const phone = `${TEST_USER_PHONE_PREFIX}${String(timestamp).slice(-8)}`

                const user = await createUserDao({
                    name: `测试用户_${timestamp}`,
                    phone,
                    password: 'hashed_password',
                    status: 1,
                })

                testIds.userIds.push(user.id)

                expect(user.userRoles).toBeDefined()
                expect(Array.isArray(user.userRoles)).toBe(true)
            })
        })

        describe('findUserByIdDao - 通过 ID 查询用户', () => {
            it('应能通过 ID 查询到用户', async () => {
                const user = await createTestUser()
                testIds.userIds.push(user.id)

                const found = await findUserByIdDao(user.id)

                expect(found).not.toBeNull()
                expect(found?.id).toBe(user.id)
                expect(found?.phone).toBe(user.phone)
            })

            it('查询不存在的用户应返回 null', async () => {
                const found = await findUserByIdDao(999999999)
                expect(found).toBeNull()
            })

            it('查询结果应包含 userRoles 关联', async () => {
                const user = await createTestUser()
                testIds.userIds.push(user.id)

                const found = await findUserByIdDao(user.id)

                expect(found?.userRoles).toBeDefined()
                expect(Array.isArray(found?.userRoles)).toBe(true)
            })
        })

        describe('findUserByPhoneDao - 通过手机号查询用户', () => {
            it('应能通过手机号查询到用户', async () => {
                const user = await createTestUser()
                testIds.userIds.push(user.id)

                const found = await findUserByPhoneDao(user.phone)

                expect(found).not.toBeNull()
                expect(found?.id).toBe(user.id)
                expect(found?.phone).toBe(user.phone)
            })

            it('查询不存在的手机号应返回 null', async () => {
                const found = await findUserByPhoneDao('19900000000')
                expect(found).toBeNull()
            })
        })

        describe('findUserByInviteCodeDao - 通过邀请码查询用户', () => {
            it('应能通过邀请码查询到用户', async () => {
                const timestamp = Date.now()
                // 邀请码最大长度为 10 个字符
                const inviteCode = `INV${String(timestamp).slice(-7)}`
                const phone = `${TEST_USER_PHONE_PREFIX}${String(timestamp).slice(-8)}`

                // 创建带邀请码的用户
                const user = await testPrisma.users.create({
                    data: {
                        name: `测试用户_${timestamp}`,
                        phone,
                        password: 'hashed_password',
                        inviteCode,
                        status: 1,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    },
                })
                testIds.userIds.push(user.id)

                const found = await findUserByInviteCodeDao(inviteCode)

                expect(found).not.toBeNull()
                expect(found?.id).toBe(user.id)
                expect(found?.inviteCode).toBe(inviteCode)
            })

            it('查询不存在的邀请码应返回 null', async () => {
                const found = await findUserByInviteCodeDao('NON_EXISTENT_CODE')
                expect(found).toBeNull()
            })
        })

        describe('findUserByUsernameDao - 通过用户名查询用户', () => {
            it('应能通过用户名查询到用户', async () => {
                const timestamp = Date.now()
                const username = `testuser_${timestamp}`
                const phone = `${TEST_USER_PHONE_PREFIX}${String(timestamp).slice(-8)}`

                // 创建带用户名的用户
                const user = await testPrisma.users.create({
                    data: {
                        name: `测试用户_${timestamp}`,
                        phone,
                        username,
                        password: 'hashed_password',
                        status: 1,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    },
                })
                testIds.userIds.push(user.id)

                const found = await findUserByUsernameDao(username)

                expect(found).not.toBeNull()
                expect(found?.id).toBe(user.id)
                expect(found?.username).toBe(username)
            })

            it('查询不存在的用户名应返回 null', async () => {
                const found = await findUserByUsernameDao('non_existent_username')
                expect(found).toBeNull()
            })
        })

        describe('updateUserPasswordDao - 更新用户密码', () => {
            it('应能更新用户密码', async () => {
                const user = await createTestUser()
                testIds.userIds.push(user.id)

                const newPassword = 'new_hashed_password'
                const updated = await updateUserPasswordDao(user.id, newPassword)

                expect(updated).toBeDefined()
                expect(updated.password).toBe(newPassword)
            })
        })

        describe('updateUserProfileDao - 更新用户资料', () => {
            it('应能更新用户资料', async () => {
                const user = await createTestUser()
                testIds.userIds.push(user.id)

                const newName = '更新后的名称'
                const updated = await updateUserProfileDao(user.id, { name: newName })

                expect(updated).toBeDefined()
                expect(updated.name).toBe(newName)
            })

            it('应能更新多个字段', async () => {
                const user = await createTestUser()
                testIds.userIds.push(user.id)

                const updated = await updateUserProfileDao(user.id, {
                    name: '新名称',
                    company: '测试公司',
                })

                expect(updated.name).toBe('新名称')
                expect(updated.company).toBe('测试公司')
            })
        })
    })

    describe('Property: 用户 CRUD 往返一致性', () => {
        it('创建的用户应能被正确查询到', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0),
                    async (name) => {
                        const timestamp = Date.now()
                        const random = Math.floor(Math.random() * 10000)
                        const phone = `${TEST_USER_PHONE_PREFIX}${String(timestamp).slice(-4)}${String(random).padStart(4, '0')}`

                        // 创建
                        const user = await createUserDao({
                            name: `测试_${name}`,
                            phone,
                            password: 'test_password',
                            status: 1,
                        })
                        testIds.userIds.push(user.id)

                        // 通过 ID 查询
                        const foundById = await findUserByIdDao(user.id)
                        expect(foundById).not.toBeNull()
                        expect(foundById?.id).toBe(user.id)

                        // 通过手机号查询
                        const foundByPhone = await findUserByPhoneDao(phone)
                        expect(foundByPhone).not.toBeNull()
                        expect(foundByPhone?.id).toBe(user.id)
                    }
                ),
                { numRuns: 10 }
            )
        })
    })

    describe('Property: 用户更新一致性', () => {
        it('更新后的用户资料应能被正确查询到', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
                    async (newName) => {
                        const user = await createTestUser()
                        testIds.userIds.push(user.id)

                        // 更新
                        await updateUserProfileDao(user.id, { name: newName })

                        // 查询验证
                        const found = await findUserByIdDao(user.id)
                        expect(found?.name).toBe(newName)
                    }
                ),
                { numRuns: 10 }
            )
        })
    })
})
