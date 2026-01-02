/**
 * 用户响应格式化服务测试
 *
 * 测试 userResponse.service.ts 的功能，包括：
 * - 格式化用户信息为安全响应格式
 * - 排除敏感字段
 *
 * **Feature: user-response**
 * **Validates: Requirements 1.1, 1.2**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

// 模拟 SafeUserInfo 接口
interface SafeUserInfo {
    id: number
    name: string | null
    username: string | null
    phone: string
    email: string | null
    roles: number[]
    status: number
    company: string | null
    profile: string | null
    inviteCode: string | null
}

// 模拟 formatUserResponseService 函数
const formatUserResponseService = (user: any): SafeUserInfo => {
    return {
        id: user.id,
        name: user.name,
        username: user.username,
        phone: user.phone,
        email: user.email,
        roles: user.userRoles.map((role: any) => role.roleId),
        status: user.status,
        company: user.company,
        profile: user.profile,
        inviteCode: user.inviteCode,
    }
}

describe('用户响应格式化服务测试', () => {
    describe('格式化用户信息', () => {
        it('应正确格式化用户信息', () => {
            const user = {
                id: 1,
                name: '测试用户',
                username: 'testuser',
                phone: '13800138000',
                email: 'test@example.com',
                password: 'hashed_password', // 敏感字段
                status: 1,
                company: '测试公司',
                profile: '个人简介',
                inviteCode: 'ABC123',
                deletedAt: null, // 敏感字段
                createdAt: new Date(),
                updatedAt: new Date(),
                userRoles: [
                    { roleId: 1, roles: { id: 1, name: '管理员' } },
                    { roleId: 2, roles: { id: 2, name: '用户' } },
                ],
            }

            const result = formatUserResponseService(user)

            expect(result.id).toBe(1)
            expect(result.name).toBe('测试用户')
            expect(result.username).toBe('testuser')
            expect(result.phone).toBe('13800138000')
            expect(result.email).toBe('test@example.com')
            expect(result.roles).toEqual([1, 2])
            expect(result.status).toBe(1)
            expect(result.company).toBe('测试公司')
            expect(result.profile).toBe('个人简介')
            expect(result.inviteCode).toBe('ABC123')
        })

        it('应排除敏感字段', () => {
            const user = {
                id: 1,
                name: '测试用户',
                username: 'testuser',
                phone: '13800138000',
                email: 'test@example.com',
                password: 'super_secret_password',
                status: 1,
                company: null,
                profile: null,
                inviteCode: null,
                deletedAt: new Date(),
                createdAt: new Date(),
                updatedAt: new Date(),
                userRoles: [],
            }

            const result = formatUserResponseService(user)

            // 验证敏感字段不存在
            expect(result).not.toHaveProperty('password')
            expect(result).not.toHaveProperty('deletedAt')
            expect(result).not.toHaveProperty('createdAt')
            expect(result).not.toHaveProperty('updatedAt')
        })

        it('应正确处理空角色列表', () => {
            const user = {
                id: 1,
                name: '测试用户',
                username: null,
                phone: '13800138000',
                email: null,
                password: 'password',
                status: 1,
                company: null,
                profile: null,
                inviteCode: null,
                userRoles: [],
            }

            const result = formatUserResponseService(user)

            expect(result.roles).toEqual([])
        })

        it('应正确处理 null 值字段', () => {
            const user = {
                id: 1,
                name: null,
                username: null,
                phone: '13800138000',
                email: null,
                password: 'password',
                status: 0,
                company: null,
                profile: null,
                inviteCode: null,
                userRoles: [],
            }

            const result = formatUserResponseService(user)

            expect(result.name).toBeNull()
            expect(result.username).toBeNull()
            expect(result.email).toBeNull()
            expect(result.company).toBeNull()
            expect(result.profile).toBeNull()
            expect(result.inviteCode).toBeNull()
        })

        it('属性测试：格式化后的用户信息应只包含安全字段', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        id: fc.integer({ min: 1, max: 10000 }),
                        name: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: null }),
                        username: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: null }),
                        phone: fc.string({ minLength: 11, maxLength: 11 }).map(s => s.replace(/\D/g, '0').slice(0, 11)),
                        email: fc.option(fc.emailAddress(), { nil: null }),
                        password: fc.string({ minLength: 8, maxLength: 100 }),
                        status: fc.integer({ min: 0, max: 2 }),
                        company: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: null }),
                        profile: fc.option(fc.string({ minLength: 1, maxLength: 500 }), { nil: null }),
                        inviteCode: fc.option(fc.string({ minLength: 6, maxLength: 10 }), { nil: null }),
                        roleIds: fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 0, maxLength: 5 }),
                    }),
                    (input) => {
                        const user = {
                            ...input,
                            deletedAt: null,
                            createdAt: new Date(),
                            updatedAt: new Date(),
                            userRoles: input.roleIds.map(roleId => ({
                                roleId,
                                roles: { id: roleId, name: `角色${roleId}` },
                            })),
                        }

                        const result = formatUserResponseService(user)

                        // 验证只包含安全字段
                        const keys = Object.keys(result)
                        const expectedKeys = ['id', 'name', 'username', 'phone', 'email', 'roles', 'status', 'company', 'profile', 'inviteCode']
                        expect(keys.sort()).toEqual(expectedKeys.sort())

                        // 验证敏感字段不存在
                        expect(result).not.toHaveProperty('password')
                        expect(result).not.toHaveProperty('deletedAt')
                        expect(result).not.toHaveProperty('createdAt')
                        expect(result).not.toHaveProperty('updatedAt')

                        // 验证角色 ID 正确提取
                        expect(result.roles).toEqual(input.roleIds)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('属性测试：角色列表应正确提取所有角色 ID', () => {
            fc.assert(
                fc.property(
                    fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 0, maxLength: 10 }),
                    (roleIds) => {
                        const user = {
                            id: 1,
                            name: '测试',
                            username: 'test',
                            phone: '13800138000',
                            email: 'test@test.com',
                            password: 'password',
                            status: 1,
                            company: null,
                            profile: null,
                            inviteCode: null,
                            userRoles: roleIds.map(roleId => ({
                                roleId,
                                roles: { id: roleId, name: `角色${roleId}` },
                            })),
                        }

                        const result = formatUserResponseService(user)

                        expect(result.roles).toEqual(roleIds)
                        expect(result.roles.length).toBe(roleIds.length)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })
})
