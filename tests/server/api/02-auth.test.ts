/**
 * 认证流程 API 测试
 *
 * 测试注册、登录、登出、重置密码等认证相关 API
 * 所有用户创建和验证码发送都通过 API 完成
 *
 * **Feature: api-integration-tests**
 * **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import * as fc from 'fast-check'
import {
    createTestHelper,
    connectTestDb,
    disconnectTestDb,
    testPrisma,
    SmsType,
} from './test-api-helpers'

describe('认证流程 API 测试', () => {
    const helper = createTestHelper()
    const client = helper.getClient()

    beforeAll(async () => {
        await connectTestDb()
    })

    afterAll(async () => {
        await disconnectTestDb()
    })

    afterEach(async () => {
        await helper.cleanup()
    })

    describe('注册测试', () => {
        it('应能使用有效信息注册新用户', async () => {
            const phone = helper.generatePhone()
            const password = helper.generatePassword()
            const name = `测试用户_${Date.now()}`

            // 通过 API 发送验证码并获取
            const code = await helper.sendAndGetSmsCode(phone, SmsType.REGISTER)

            // 发送注册请求
            const response = await client.post('/api/v1/auth/register', {
                phone,
                code,
                name,
                password,
            })

            // 清理验证码
            await helper.deleteSmsCode(phone, SmsType.REGISTER)

            expect(response.success).toBe(true)
            expect(response.message).toBe('注册成功')
            expect(response.data).toBeDefined()
            expect(response.data.token).toBeDefined()
            expect(response.data.user).toBeDefined()
            expect(response.data.user.phone).toBe(phone)

            // 记录用户 ID 以便清理
            if (response.data?.user?.id) {
                helper.getTestIds().userIds.push(response.data.user.id)
            }
        })

        it('应拒绝已存在手机号的注册', async () => {
            // 先通过 API 注册一个用户
            const existingUser = await helper.createAndLoginUser()
            client.clearAuthToken()

            // 通过 API 发送验证码
            const code = await helper.sendAndGetSmsCode(existingUser.phone, SmsType.REGISTER)

            // 尝试用相同手机号注册
            const response = await client.post('/api/v1/auth/register', {
                phone: existingUser.phone,
                code,
                name: '新用户',
                password: helper.generatePassword(),
            })

            // 清理验证码
            await helper.deleteSmsCode(existingUser.phone, SmsType.REGISTER)

            expect(response.success).toBe(false)
            expect(response.message).toContain('已注册')
        })

        it('应正确记录邀请人信息', async () => {
            // 通过 API 注册邀请人
            const inviter = await helper.registerAndLogin()

            // 通过 API 获取邀请人的邀请码
            const meResponse = await client.get('/api/v1/users/me')
            const inviteCode = meResponse.data?.inviteCode

            if (!inviteCode) {
                // 如果没有邀请码，跳过测试
                console.log('邀请人没有邀请码，跳过测试')
                return
            }

            // 清除当前 token
            client.clearAuthToken()

            // 被邀请人注册
            const inviteePhone = helper.generatePhone()
            const code = await helper.sendAndGetSmsCode(inviteePhone, SmsType.REGISTER)

            const response = await client.post('/api/v1/auth/register', {
                phone: inviteePhone,
                code,
                name: '被邀请用户',
                password: helper.generatePassword(),
                invitedBy: inviteCode,
            })

            await helper.deleteSmsCode(inviteePhone, SmsType.REGISTER)

            expect(response.success).toBe(true)

            if (response.data?.user?.id) {
                helper.getTestIds().userIds.push(response.data.user.id)

                // 验证邀请人记录（数据验证可以查数据库）
                const invitee = await testPrisma.users.findUnique({
                    where: { id: response.data.user.id },
                    select: { invitedBy: true },
                })

                expect(invitee?.invitedBy).toBe(inviter.id)
            }
        })
    })

    describe('密码登录测试', () => {
        it('应能使用正确密码登录', async () => {
            // 通过 API 注册用户
            const user = await helper.createAndLoginUser()
            client.clearAuthToken()

            const response = await client.post('/api/v1/auth/login/password', {
                phone: user.phone,
                password: user.password,
            })

            expect(response.success).toBe(true)
            expect(response.message).toBe('登录成功')
            expect(response.data.token).toBeDefined()
            expect(response.data.user.phone).toBe(user.phone)
        })

        it('应拒绝错误密码登录', async () => {
            // 通过 API 注册用户
            const user = await helper.createAndLoginUser()
            client.clearAuthToken()

            const response = await client.post('/api/v1/auth/login/password', {
                phone: user.phone,
                password: 'WrongPassword123!',
            })

            expect(response.success).toBe(false)
            expect(response.message).toContain('密码错误')
        })

        it('应拒绝不存在用户登录', async () => {
            const response = await client.post('/api/v1/auth/login/password', {
                phone: '19900000000',
                password: 'SomePassword123!',
            })

            expect(response.success).toBe(false)
            expect(response.message).toContain('用户不存在')
        })
    })

    describe('短信登录测试', () => {
        it('应能使用有效验证码登录', async () => {
            // 通过 API 注册用户
            const user = await helper.createAndLoginUser()
            client.clearAuthToken()

            // 通过 API 发送登录验证码
            const code = await helper.sendAndGetSmsCode(user.phone, SmsType.LOGIN)

            const response = await client.post('/api/v1/auth/login/sms', {
                phone: user.phone,
                code,
            })

            await helper.deleteSmsCode(user.phone, SmsType.LOGIN)

            expect(response.success).toBe(true)
            expect(response.message).toBe('登录成功')
            expect(response.data.token).toBeDefined()
        })

        it('应拒绝无效验证码登录', async () => {
            // 通过 API 注册用户
            const user = await helper.createAndLoginUser()
            client.clearAuthToken()

            const response = await client.post('/api/v1/auth/login/sms', {
                phone: user.phone,
                code: '000000',
            })

            expect(response.success).toBe(false)
        })
    })

    describe('登出测试', () => {
        it('应能成功登出并使 token 失效', async () => {
            const user = await helper.createAndLoginUser()

            // 验证登录状态
            const meResponse = await client.get('/api/v1/users/me')
            expect(meResponse.success).toBe(true)

            // 登出
            const logoutResponse = await client.post('/api/v1/auth/logout')
            expect(logoutResponse.success).toBe(true)

            // 使用旧 token 访问应该失败
            client.setAuthToken(user.token!)
            const afterLogoutResponse = await client.get('/api/v1/users/me')
            expect(afterLogoutResponse.success).toBe(false)
        })
    })

    describe('重置密码测试', () => {
        it('应能成功重置密码', async () => {
            // 通过 API 注册用户
            const user = await helper.createAndLoginUser()
            client.clearAuthToken()
            const newPassword = helper.generatePassword()

            // 通过 API 发送重置密码验证码
            const code = await helper.sendAndGetSmsCode(user.phone, SmsType.RESET_PASSWORD)

            const response = await client.post('/api/v1/auth/reset-password', {
                phone: user.phone,
                code,
                newPassword,
            })

            await helper.deleteSmsCode(user.phone, SmsType.RESET_PASSWORD)

            expect(response.success).toBe(true)
            expect(response.message).toBe('重置密码成功')
        })

        it('重置密码后应能使用新密码登录', async () => {
            // 通过 API 注册用户
            const user = await helper.createAndLoginUser()
            client.clearAuthToken()
            const newPassword = helper.generatePassword()

            // 通过 API 发送重置密码验证码
            const code = await helper.sendAndGetSmsCode(user.phone, SmsType.RESET_PASSWORD)
            await client.post('/api/v1/auth/reset-password', {
                phone: user.phone,
                code,
                newPassword,
            })
            await helper.deleteSmsCode(user.phone, SmsType.RESET_PASSWORD)

            // 使用新密码登录
            const loginResponse = await client.post('/api/v1/auth/login/password', {
                phone: user.phone,
                password: newPassword,
            })

            expect(loginResponse.success).toBe(true)
            expect(loginResponse.data.token).toBeDefined()
        })

        it('重置密码后旧密码应失效', async () => {
            // 通过 API 注册用户
            const user = await helper.createAndLoginUser()
            client.clearAuthToken()
            const oldPassword = user.password
            const newPassword = helper.generatePassword()

            // 通过 API 发送重置密码验证码
            const code = await helper.sendAndGetSmsCode(user.phone, SmsType.RESET_PASSWORD)
            await client.post('/api/v1/auth/reset-password', {
                phone: user.phone,
                code,
                newPassword,
            })
            await helper.deleteSmsCode(user.phone, SmsType.RESET_PASSWORD)

            // 使用旧密码登录应失败
            const loginResponse = await client.post('/api/v1/auth/login/password', {
                phone: user.phone,
                password: oldPassword,
            })

            expect(loginResponse.success).toBe(false)
        })
    })

    describe('Property: 认证令牌有效性', () => {
        it('有效凭证登录后的 token 应能访问受保护资源', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.constant(null), // 占位符
                    async () => {
                        const user = await helper.createAndLoginUser()

                        // 使用 token 访问受保护资源
                        const response = await client.get('/api/v1/users/me')

                        expect(response.success).toBe(true)
                        expect(response.data.phone).toBe(user.phone)

                        // 清理
                        await helper.cleanup()
                    }
                ),
                { numRuns: 5 }
            )
        })
    })

    describe('Property: 密码重置后登录一致性', () => {
        it('重置密码后新密码可用旧密码失效', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.constant(null),
                    async () => {
                        // 通过 API 注册用户
                        const user = await helper.createAndLoginUser()
                        client.clearAuthToken()
                        const oldPassword = user.password
                        const newPassword = helper.generatePassword()

                        // 通过 API 发送重置密码验证码
                        const code = await helper.sendAndGetSmsCode(user.phone, SmsType.RESET_PASSWORD)
                        const resetResponse = await client.post('/api/v1/auth/reset-password', {
                            phone: user.phone,
                            code,
                            newPassword,
                        })
                        await helper.deleteSmsCode(user.phone, SmsType.RESET_PASSWORD)

                        expect(resetResponse.success).toBe(true)

                        // 新密码可用
                        const newLoginResponse = await client.post('/api/v1/auth/login/password', {
                            phone: user.phone,
                            password: newPassword,
                        })
                        expect(newLoginResponse.success).toBe(true)

                        // 旧密码失效
                        const oldLoginResponse = await client.post('/api/v1/auth/login/password', {
                            phone: user.phone,
                            password: oldPassword,
                        })
                        expect(oldLoginResponse.success).toBe(false)

                        // 清理
                        await helper.cleanup()
                    }
                ),
                { numRuns: 3 }
            )
        })
    })
})
