/**
 * 用户 DAO 覆盖测试
 *
 * 覆盖 users.dao.ts 中的错误路径和未测试分支
 *
 * **Feature: users-dao-coverage**
 * **Validates: Requirements 4.1, 4.2, 4.3**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import {
    testPrisma,
    createTestUser,
    connectTestDb,
    disconnectTestDb,
    resetDatabaseSequences,
} from '../membership/test-db-helper'
import { mockLogger } from '../membership/test-setup'

import {
    createUserDao,
    findUserByIdDao,
    findUserByPhoneDao,
    findUserByInviteCodeDao,
    findUserByUsernameDao,
    updateUserPasswordDao,
    updateUserProfileDao,
} from '../../../server/services/users/users.dao'

// 设置全局变量
if (typeof window === 'undefined' && process.env.NODE_ENV === 'test') {
    ;(globalThis as any).prisma = testPrisma
    ;(globalThis as any).logger = mockLogger
}

const createdUserIds: number[] = []

describe('用户 DAO 覆盖测试', () => {
    beforeAll(async () => {
        await connectTestDb()
        await resetDatabaseSequences()
    })

    afterAll(async () => {
        if (createdUserIds.length > 0) {
            await testPrisma.userRoles.deleteMany({ where: { userId: { in: createdUserIds } } })
            await testPrisma.users.deleteMany({ where: { id: { in: createdUserIds } } })
        }
        await disconnectTestDb()
    })

    afterEach(async () => {
        // 清理本轮测试数据
    })

    describe('createUserDao', () => {
        it('应成功创建用户并返回包含 userRoles 的结果', async () => {
            const ts = Date.now()
            const user = await createUserDao({
                phone: `199${String(ts).slice(-8)}`,
                name: `测试用户_DAO_${ts}`,
                password: 'hashed_password',
            })
            createdUserIds.push(user.id)

            expect(user.id).toBeGreaterThan(0)
            expect(user.userRoles).toBeDefined()
            expect(Array.isArray(user.userRoles)).toBe(true)
        })

        it('使用事务客户端应正常创建', async () => {
            const ts = Date.now()
            const user = await createUserDao(
                {
                    phone: `199${String(ts).slice(-8)}`,
                    name: `测试用户_TX_${ts}`,
                    password: 'hashed_password',
                },
                testPrisma as any
            )
            createdUserIds.push(user.id)

            expect(user.id).toBeGreaterThan(0)
        })
    })

    describe('findUserByIdDao', () => {
        it('应返回包含 userRoles 和 role 的完整用户', async () => {
            const user = await createTestUser()
            createdUserIds.push(user.id)

            const found = await findUserByIdDao(user.id)
            expect(found).not.toBeNull()
            expect(found!.id).toBe(user.id)
            expect(found!.userRoles).toBeDefined()
        })

        it('不存在的用户 ID 应返回 null', async () => {
            const found = await findUserByIdDao(999999)
            expect(found).toBeNull()
        })

        it('已删除的用户应返回 null', async () => {
            const user = await createTestUser()
            createdUserIds.push(user.id)

            await testPrisma.users.update({
                where: { id: user.id },
                data: { deletedAt: new Date() },
            })

            const found = await findUserByIdDao(user.id)
            expect(found).toBeNull()
        })

        it('使用事务客户端应正常查询', async () => {
            const user = await createTestUser()
            createdUserIds.push(user.id)

            const found = await findUserByIdDao(user.id, testPrisma)
            expect(found).not.toBeNull()
        })
    })

    describe('findUserByPhoneDao', () => {
        it('应通过手机号查询用户', async () => {
            const ts = Date.now()
            const phone = `199${String(ts).slice(-8)}`
            const user = await createTestUser({ phone })
            createdUserIds.push(user.id)

            const found = await findUserByPhoneDao(phone)
            expect(found).not.toBeNull()
            expect(found!.phone).toBe(phone)
        })

        it('不存在的手机号应返回 null', async () => {
            const found = await findUserByPhoneDao('19900000000')
            expect(found).toBeNull()
        })
    })

    describe('findUserByInviteCodeDao', () => {
        it('应通过邀请码查询用户', async () => {
            const ts = Date.now()
            const inviteCode = `IV${String(ts).slice(-8)}`
            const user = await createTestUser()
            createdUserIds.push(user.id)

            // 设置邀请码
            await testPrisma.users.update({
                where: { id: user.id },
                data: { inviteCode },
            })

            const found = await findUserByInviteCodeDao(inviteCode)
            expect(found).not.toBeNull()
            expect(found!.inviteCode).toBe(inviteCode)
        })

        it('不存在的邀请码应返回 null', async () => {
            const found = await findUserByInviteCodeDao('NONEXISTENT_CODE')
            expect(found).toBeNull()
        })
    })

    describe('findUserByUsernameDao', () => {
        it('应通过用户名查询用户', async () => {
            const ts = Date.now()
            const username = `testuser_${ts}`
            const user = await createTestUser()
            createdUserIds.push(user.id)

            await testPrisma.users.update({
                where: { id: user.id },
                data: { username },
            })

            const found = await findUserByUsernameDao(username)
            expect(found).not.toBeNull()
            expect(found!.username).toBe(username)
        })

        it('不存在的用户名应返回 null', async () => {
            const found = await findUserByUsernameDao('nonexistent_username_12345')
            expect(found).toBeNull()
        })
    })

    describe('updateUserPasswordDao', () => {
        it('应成功更新密码', async () => {
            const user = await createTestUser()
            createdUserIds.push(user.id)

            const updated = await updateUserPasswordDao(user.id, 'new_hashed_password')
            expect(updated.password).toBe('new_hashed_password')
        })
    })

    describe('updateUserProfileDao', () => {
        it('应成功更新用户资料', async () => {
            const user = await createTestUser()
            createdUserIds.push(user.id)

            const updated = await updateUserProfileDao(user.id, {
                name: '新名称',
            })
            expect(updated.name).toBe('新名称')
        })

        it('使用事务客户端应正常更新', async () => {
            const user = await createTestUser()
            createdUserIds.push(user.id)

            const updated = await updateUserProfileDao(
                user.id,
                { name: '事务更新' },
                testPrisma as any
            )
            expect(updated.name).toBe('事务更新')
        })
    })
})
