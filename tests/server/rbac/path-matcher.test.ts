/**
 * 路径匹配工具属性测试
 *
 * 使用 fast-check 进行属性测试，验证通配符路径匹配正确性
 *
 * **Feature: rbac-enhancement**
 * **Property 4: 通配符路径匹配正确性**
 * **Validates: Requirements 3.6**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

// 导入路径匹配函数
import {
    matchPath,
    matchMethod,
    matchPermission,
    findMatchingPermission,
    pathStartsWith,
} from '../../../server/services/rbac/pathMatcher'

// ==================== 测试套件 ====================

describe('路径匹配工具属性测试', () => {
    describe('Property 4: 通配符路径匹配正确性', () => {
        describe('matchPath - 路径匹配', () => {
            it('完全相等的路径应匹配', () => {
                fc.assert(
                    fc.property(
                        fc.stringMatching(/^\/[a-z]+(?:\/[a-z0-9]+)*$/),
                        (path) => {
                            expect(matchPath(path, path)).toBe(true)
                        }
                    ),
                    { numRuns: 50 }
                )
            })

            it('不同的路径不应匹配（无通配符）', () => {
                const testCases = [
                    { pattern: '/api/v1/users', path: '/api/v1/roles' },
                    { pattern: '/api/v1/users', path: '/api/v1/users/123' },
                    { pattern: '/api/v1/users/123', path: '/api/v1/users' },
                ]

                for (const { pattern, path } of testCases) {
                    expect(matchPath(pattern, path)).toBe(false)
                }
            })

            it('单星号通配符应匹配单个路径段', () => {
                // 应该匹配的情况
                expect(matchPath('/api/v1/users/*', '/api/v1/users/123')).toBe(true)
                expect(matchPath('/api/v1/users/*', '/api/v1/users/abc')).toBe(true)
                expect(matchPath('/api/v1/*/roles', '/api/v1/admin/roles')).toBe(true)

                // 不应该匹配的情况
                expect(matchPath('/api/v1/users/*', '/api/v1/users')).toBe(false)
                expect(matchPath('/api/v1/users/*', '/api/v1/users/123/profile')).toBe(false)
                expect(matchPath('/api/v1/users/*', '/api/v1/roles/123')).toBe(false)
            })

            it('双星号通配符应匹配任意路径段', () => {
                // 应该匹配的情况
                expect(matchPath('/api/v1/admin/**', '/api/v1/admin/roles')).toBe(true)
                expect(matchPath('/api/v1/admin/**', '/api/v1/admin/roles/1')).toBe(true)
                expect(matchPath('/api/v1/admin/**', '/api/v1/admin/roles/1/permissions')).toBe(true)
                expect(matchPath('/api/**', '/api/v1/users/123')).toBe(true)

                // 不应该匹配的情况
                expect(matchPath('/api/v1/admin/**', '/api/v1/users')).toBe(false)
                expect(matchPath('/api/v1/admin/**', '/api/v2/admin/roles')).toBe(false)
            })

            it('混合通配符应正确匹配', () => {
                // /api/v1/*/roles/* 应匹配 /api/v1/admin/roles/123
                expect(matchPath('/api/v1/*/roles/*', '/api/v1/admin/roles/123')).toBe(true)
                expect(matchPath('/api/v1/*/roles/*', '/api/v1/user/roles/456')).toBe(true)

                // 不应该匹配
                expect(matchPath('/api/v1/*/roles/*', '/api/v1/admin/users/123')).toBe(false)
            })
        })

        describe('matchMethod - 方法匹配', () => {
            it('星号应匹配所有方法', () => {
                const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']
                for (const method of methods) {
                    expect(matchMethod('*', method)).toBe(true)
                }
            })

            it('相同方法应匹配（不区分大小写）', () => {
                expect(matchMethod('GET', 'GET')).toBe(true)
                expect(matchMethod('GET', 'get')).toBe(true)
                expect(matchMethod('get', 'GET')).toBe(true)
                expect(matchMethod('Post', 'POST')).toBe(true)
            })

            it('不同方法不应匹配', () => {
                expect(matchMethod('GET', 'POST')).toBe(false)
                expect(matchMethod('PUT', 'DELETE')).toBe(false)
            })
        })

        describe('matchPermission - 权限匹配', () => {
            it('路径和方法都匹配时应返回 true', () => {
                const permission = { path: '/api/v1/users/*', method: 'GET' }
                expect(matchPermission(permission, '/api/v1/users/123', 'GET')).toBe(true)
            })

            it('路径匹配但方法不匹配时应返回 false', () => {
                const permission = { path: '/api/v1/users/*', method: 'GET' }
                expect(matchPermission(permission, '/api/v1/users/123', 'POST')).toBe(false)
            })

            it('方法匹配但路径不匹配时应返回 false', () => {
                const permission = { path: '/api/v1/users/*', method: 'GET' }
                expect(matchPermission(permission, '/api/v1/roles/123', 'GET')).toBe(false)
            })

            it('方法为星号时只需路径匹配', () => {
                const permission = { path: '/api/v1/users/*', method: '*' }
                expect(matchPermission(permission, '/api/v1/users/123', 'GET')).toBe(true)
                expect(matchPermission(permission, '/api/v1/users/123', 'POST')).toBe(true)
                expect(matchPermission(permission, '/api/v1/users/123', 'DELETE')).toBe(true)
            })
        })

        describe('findMatchingPermission - 查找匹配权限', () => {
            it('应返回第一个匹配的权限', () => {
                const permissions = [
                    { id: 1, path: '/api/v1/users', method: 'GET' },
                    { id: 2, path: '/api/v1/users/*', method: 'GET' },
                    { id: 3, path: '/api/v1/roles', method: 'GET' },
                ]

                const result = findMatchingPermission(permissions, '/api/v1/users/123', 'GET')
                expect(result).not.toBeNull()
                expect(result!.id).toBe(2)
            })

            it('没有匹配时应返回 null', () => {
                const permissions = [
                    { id: 1, path: '/api/v1/users', method: 'GET' },
                    { id: 2, path: '/api/v1/roles', method: 'GET' },
                ]

                const result = findMatchingPermission(permissions, '/api/v1/products', 'GET')
                expect(result).toBeNull()
            })

            it('空权限列表应返回 null', () => {
                const result = findMatchingPermission([], '/api/v1/users', 'GET')
                expect(result).toBeNull()
            })
        })

        describe('pathStartsWith - 路径前缀匹配', () => {
            it('完全相等应返回 true', () => {
                expect(pathStartsWith('/api/v1/users', '/api/v1/users')).toBe(true)
            })

            it('以前缀开头应返回 true', () => {
                expect(pathStartsWith('/api/v1/users/123', '/api/v1/users')).toBe(true)
                expect(pathStartsWith('/api/v1/users/123/profile', '/api/v1/users')).toBe(true)
            })

            it('不以前缀开头应返回 false', () => {
                expect(pathStartsWith('/api/v1/roles', '/api/v1/users')).toBe(false)
                expect(pathStartsWith('/api/v1/usersx', '/api/v1/users')).toBe(false)
            })
        })
    })

    describe('边界情况', () => {
        it('空路径应正确处理', () => {
            expect(matchPath('', '')).toBe(true)
            expect(matchPath('/', '')).toBe(false)
            expect(matchPath('', '/')).toBe(false)
        })

        it('只有通配符的模式应正确匹配', () => {
            expect(matchPath('*', 'anything')).toBe(true)
            expect(matchPath('**', 'any/thing/here')).toBe(true)
        })

        it('特殊字符应被正确转义', () => {
            // 点号应被转义，不作为正则的任意字符
            expect(matchPath('/api/v1/users.json', '/api/v1/users.json')).toBe(true)
            expect(matchPath('/api/v1/users.json', '/api/v1/usersXjson')).toBe(false)
        })
    })
})
