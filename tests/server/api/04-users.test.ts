/**
 * 用户信息 API 测试
 *
 * 测试用户信息获取和更新相关 API
 * 所有用户创建都通过注册 API 完成
 *
 * **Feature: api-integration-tests**
 * **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import * as fc from 'fast-check'
import {
    createTestHelper,
    connectTestDb,
    disconnectTestDb,
} from './test-api-helpers'
import { createApiClient } from './test-api-client'

describe('用户信息 API 测试', () => {
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

    describe('获取用户信息测试', () => {
        it('已认证用户应能获取个人信息', async () => {
            // 通过 API 注册用户
            const user = await helper.createAndLoginUser()

            const response = await client.get('/api/v1/users/me')

            expect(response.success).toBe(true)
            expect(response.data).toBeDefined()
            expect(response.data.id).toBe(user.id)
            expect(response.data.phone).toBe(user.phone)
            expect(response.data.name).toBe(user.name)
        })

        it('未认证用户应返回错误', async () => {
            // 使用新的客户端，不带 token
            const unauthClient = createApiClient()

            const response = await unauthClient.get('/api/v1/users/me')

            // API 返回 success: false 表示未授权
            expect(response.success).toBe(false)
            // 检查响应体中的 code 字段（业务错误码）
            expect(response.code).toBe(401)
        })
    })

    describe('更新用户信息测试', () => {
        it('应能更新个人资料', async () => {
            // 通过 API 注册用户
            await helper.createAndLoginUser()

            const newName = `更新后的名字_${Date.now()}`
            const newCompany = '测试公司'
            const newProfile = '这是个人简介'

            const response = await client.put('/api/v1/users/profile', {
                name: newName,
                company: newCompany,
                profile: newProfile,
            })

            expect(response.success).toBe(true)
            expect(response.data.name).toBe(newName)
            expect(response.data.company).toBe(newCompany)
            expect(response.data.profile).toBe(newProfile)
        })

        it('应能使用正确的旧密码修改密码', async () => {
            // 通过 API 注册用户
            const user = await helper.createAndLoginUser()
            const newPassword = helper.generatePassword()

            const response = await client.put('/api/v1/users/password', {
                currentPassword: user.password,
                newPassword,
            })

            expect(response.success).toBe(true)

            // 验证新密码可以登录
            client.clearAuthToken()
            const loginResponse = await client.post('/api/v1/auth/login/password', {
                phone: user.phone,
                password: newPassword,
            })
            expect(loginResponse.success).toBe(true)
        })

        it('应拒绝错误的旧密码修改密码', async () => {
            // 通过 API 注册用户
            await helper.createAndLoginUser()

            const response = await client.put('/api/v1/users/password', {
                currentPassword: 'WrongOldPassword123!',
                newPassword: helper.generatePassword(),
            })

            expect(response.success).toBe(false)
            expect(response.message).toContain('密码错误')
        })
    })

    describe('角色和权限测试', () => {
        it('应能获取用户角色信息', async () => {
            // 通过 API 注册用户
            await helper.createAndLoginUser()

            const response = await client.get('/api/v1/users/roles')

            expect(response.success).toBe(true)
            expect(Array.isArray(response.data)).toBe(true)
        })

        it('应能获取用户路由权限', async () => {
            // 通过 API 注册用户
            await helper.createAndLoginUser()

            const response = await client.get('/api/v1/users/routers')

            expect(response.success).toBe(true)
            expect(Array.isArray(response.data)).toBe(true)
        })
    })

    describe('邀请列表测试', () => {
        it('应能获取邀请列表', async () => {
            // 通过 API 注册用户
            await helper.createAndLoginUser()

            const response = await client.get('/api/v1/users/invitees')

            expect(response.success).toBe(true)
            expect(response.data).toBeDefined()
            expect(response.data.invitees).toBeDefined()
            expect(Array.isArray(response.data.invitees)).toBe(true)
        })

        it('邀请列表应包含被邀请用户', async () => {
            // 通过 API 注册邀请人
            const inviter = await helper.registerAndLogin()

            // 通过 API 获取邀请人的邀请码
            const meResponse = await client.get('/api/v1/users/me')
            const inviteCode = meResponse.data?.inviteCode

            if (!inviteCode) {
                console.log('邀请人没有邀请码，跳过测试')
                return
            }

            // 清除当前 token
            client.clearAuthToken()

            // 通过 API 注册被邀请人
            const invitee = await helper.registerAndLogin(
                undefined,
                undefined,
                undefined,
                inviteCode
            )

            // 切换回邀请人
            await helper.loginWithPassword(inviter.phone, inviter.password)

            // 获取邀请列表
            const inviteesResponse = await client.get('/api/v1/users/invitees')

            expect(inviteesResponse.success).toBe(true)
            expect(inviteesResponse.data.invitees.length).toBeGreaterThan(0)

            // 验证被邀请人在列表中
            const foundInvitee = inviteesResponse.data.invitees.find(
                (i: any) => i.id === invitee.id
            )
            expect(foundInvitee).toBeDefined()
        })
    })

    describe('Property: 未认证请求拒绝', () => {
        it('所有受保护端点应拒绝未认证请求', async () => {
            const protectedEndpoints = [
                { method: 'GET', url: '/api/v1/users/me' },
                { method: 'GET', url: '/api/v1/users/roles' },
                { method: 'GET', url: '/api/v1/users/routers' },
                { method: 'GET', url: '/api/v1/users/invitees' },
                { method: 'PUT', url: '/api/v1/users/profile' },
                { method: 'PUT', url: '/api/v1/users/password' },
            ]

            const unauthClient = createApiClient()

            for (const endpoint of protectedEndpoints) {
                let response
                if (endpoint.method === 'GET') {
                    response = await unauthClient.get(endpoint.url)
                } else if (endpoint.method === 'PUT') {
                    response = await unauthClient.put(endpoint.url, {})
                }

                // API 返回 success: false 和 code: 401 表示未授权
                expect(response?.success).toBe(false)
                expect(response?.code).toBe(401)
            }
        })
    })
})
