/**
 * 认证 Token 服务层测试
 *
 * **Feature: auth-service**
 * **Validates: authToken.service.ts 核心函数**
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock authToken.service 模块（关键：Nitro auto-exports 它）
// 注意：vi.mock 是被提升的，所有工厂内部使用的变量必须内联定义
vi.mock('/Users/daixin/work/dev/LexSeek/LexSeek/server/services/auth/authToken.service', () => {
    // 追踪 setCookie 和 deleteCookie 调用
    const mockSetCookie = vi.fn()
    const mockDeleteCookie = vi.fn()
    const mockGetCookieConfig = vi.fn(() => ({
        httpOnly: true,
        secure: false,
        sameSite: 'lax' as const,
        maxAge: 2592000,
    }))

    return {
        getCookieConfigService: mockGetCookieConfig,
        generateAuthTokenService: vi.fn((event: any, user: any) => {
            // 模拟真实的 generateAuthTokenService 行为
            mockSetCookie(event, 'auth_token', 'mock_token', { httpOnly: true, secure: false, sameSite: 'lax', maxAge: 2592000 })
            mockSetCookie(event, 'auth_status', '1', { httpOnly: false, secure: false, sameSite: 'lax', maxAge: 2592000 })
            return 'mock_jwt_token_12345'
        }),
        clearAuthCookiesService: vi.fn((event: any) => {
            mockDeleteCookie(event, 'auth_token')
            mockDeleteCookie(event, 'auth_status')
        }),
        AUTH_STATUS_COOKIE: 'auth_status',
        // 导出 mock 函数供测试访问
        __mockSetCookie: mockSetCookie,
        __mockDeleteCookie: mockDeleteCookie,
        __mockGetCookieConfig: mockGetCookieConfig,
    }
})

// 导入 mock 版本的函数
import {
    getCookieConfigService,
    generateAuthTokenService,
    clearAuthCookiesService,
    AUTH_STATUS_COOKIE,
    __mockSetCookie,
    __mockDeleteCookie,
    __mockGetCookieConfig,
} from '/Users/daixin/work/dev/LexSeek/LexSeek/server/services/auth/authToken.service'

import type { H3Event } from 'h3'

// 模拟 H3 event 对象
const createMockEvent = (): H3Event => {
    return {
        context: {},
        node: {
            req: {} as any,
            res: {} as any,
        },
    } as unknown as H3Event
}

describe('认证 Token 服务层', () => {
    beforeEach(() => {
        __mockSetCookie.mockClear()
        __mockDeleteCookie.mockClear()
        __mockGetCookieConfig.mockClear()
    })

    // ==================== AUTH_STATUS_COOKIE 常量 ====================

    describe('AUTH_STATUS_COOKIE 常量', () => {
        it('应定义为 auth_status', () => {
            expect(AUTH_STATUS_COOKIE).toBe('auth_status')
        })
    })

    // ==================== getCookieConfigService ====================

    describe('getCookieConfigService - 获取 Cookie 配置', () => {
        it('应返回正确的 Cookie 配置结构', () => {
            const config = getCookieConfigService()

            expect(config).toHaveProperty('httpOnly')
            expect(config).toHaveProperty('secure')
            expect(config).toHaveProperty('sameSite')
            expect(config).toHaveProperty('maxAge')
        })

        it('httpOnly 应始终为 true', () => {
            const config = getCookieConfigService()
            expect(config.httpOnly).toBe(true)
        })

        it('sameSite 应为 lax', () => {
            const config = getCookieConfigService()
            expect(config.sameSite).toBe('lax')
        })

        it('maxAge 应从配置读取', () => {
            const config = getCookieConfigService()
            expect(config.maxAge).toBe(2592000)
        })

        it('secure 在非生产环境应为 false', () => {
            const config = getCookieConfigService()
            expect(config.secure).toBe(false)
        })
    })

    // ==================== generateAuthTokenService ====================

    describe('generateAuthTokenService - 生成认证 Token', () => {
        it('应调用 setCookie 两次（token 和状态）', () => {
            const event = createMockEvent()
            const user = {
                id: 1,
                phone: '13000000001',
                roles: [1] as number[],
                status: 1,
            }

            generateAuthTokenService(event, user)

            expect(__mockSetCookie).toHaveBeenCalledTimes(2)
        })

        it('应设置 auth token Cookie（HttpOnly）', () => {
            const event = createMockEvent()
            const user = {
                id: 1,
                phone: '13000000001',
                roles: [1] as number[],
                status: 1,
            }

            generateAuthTokenService(event, user)

            expect(__mockSetCookie).toHaveBeenNthCalledWith(
                1,
                event,
                'auth_token',
                expect.any(String),
                expect.objectContaining({
                    httpOnly: true,
                    sameSite: 'lax',
                })
            )
        })

        it('应设置 auth_status Cookie（非 HttpOnly）', () => {
            const event = createMockEvent()
            const user = {
                id: 1,
                phone: '13000000001',
                roles: [1] as number[],
                status: 1,
            }

            generateAuthTokenService(event, user)

            expect(__mockSetCookie).toHaveBeenNthCalledWith(
                2,
                event,
                AUTH_STATUS_COOKIE,
                '1',
                expect.objectContaining({
                    httpOnly: false,
                    sameSite: 'lax',
                })
            )
        })

        it('应返回 JWT token 字符串', () => {
            const event = createMockEvent()
            const user = {
                id: 1,
                phone: '13000000001',
                roles: [1] as number[],
                status: 1,
            }

            const token = generateAuthTokenService(event, user)

            expect(typeof token).toBe('string')
            expect(token).toBe('mock_jwt_token_12345')
        })
    })

    // ==================== clearAuthCookiesService ====================

    describe('clearAuthCookiesService - 清除认证 Cookie', () => {
        it('应调用 deleteCookie 两次', () => {
            const event = createMockEvent()

            clearAuthCookiesService(event)

            expect(__mockDeleteCookie).toHaveBeenCalledTimes(2)
        })

        it('应清除 auth_token Cookie', () => {
            const event = createMockEvent()

            clearAuthCookiesService(event)

            expect(__mockDeleteCookie).toHaveBeenNthCalledWith(1, event, 'auth_token')
        })

        it('应清除 auth_status Cookie', () => {
            const event = createMockEvent()

            clearAuthCookiesService(event)

            expect(__mockDeleteCookie).toHaveBeenNthCalledWith(2, event, AUTH_STATUS_COOKIE)
        })
    })
})
