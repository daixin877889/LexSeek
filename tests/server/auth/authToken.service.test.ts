import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { H3Event } from 'h3'
import { getCookieConfigService, generateAuthTokenService, clearAuthCookiesService, AUTH_STATUS_COOKIE } from '../../../server/services/auth/authToken.service'
import type { TokenUserInfo } from '../../../server/services/auth/authToken.service'

describe('authToken.service · 认证令牌服务', () => {
  let mockEvent: H3Event

  beforeEach(() => {
    mockEvent = {
      req: { headers: {} },
      res: {},
      context: {},
    } as unknown as H3Event

    global.setCookie = vi.fn()
    global.deleteCookie = vi.fn()
    
    // Mock JwtUtil
    global.JwtUtil = {
      generateToken: vi.fn((data: any) => {
        // 生成模拟的 JWT token（格式：header.payload.signature）
        return `${Buffer.from(JSON.stringify({alg: 'HS256'})).toString('base64')}.${Buffer.from(JSON.stringify(data)).toString('base64')}.signature`
      }),
    } as any
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('getCookieConfigService · 获取 Cookie 配置', () => {
    it('应该返回正确的 Cookie 配置对象', () => {
      const config = getCookieConfigService()

      expect(config).toHaveProperty('httpOnly')
      expect(config).toHaveProperty('secure')
      expect(config).toHaveProperty('sameSite')
      expect(config).toHaveProperty('maxAge')
    })

    it('httpOnly 应该始终为 true（防止 XSS）', () => {
      const config = getCookieConfigService()
      expect(config.httpOnly).toBe(true)
    })

    it('sameSite 应该为 lax', () => {
      const config = getCookieConfigService()
      expect(config.sameSite).toBe('lax')
    })

    it('maxAge 应该是正数', () => {
      const config = getCookieConfigService()
      expect(config.maxAge).toBeGreaterThan(0)
    })

    it('开发环境下 secure 应该为 false', () => {
      process.env.NODE_ENV = 'development'
      const config = getCookieConfigService()
      expect(config.secure).toBe(false)
    })

    it('生产环境下 secure 应该为 true', () => {
      process.env.NODE_ENV = 'production'
      const config = getCookieConfigService()
      expect(config.secure).toBe(true)
    })
  })

  describe('generateAuthTokenService · 生成认证令牌', () => {
    it('应该返回一个非空的 token 字符串', () => {
      const user: TokenUserInfo = {
        id: 1,
        phone: '13800138000',
        roles: [1, 2],
        status: 1,
      }

      const token = generateAuthTokenService(mockEvent, user)

      expect(typeof token).toBe('string')
      expect(token.length).toBeGreaterThan(0)
    })

    it('应该为不同的用户生成不同的 token', () => {
      const user1: TokenUserInfo = {
        id: 1,
        phone: '13800138000',
        roles: [1],
        status: 1,
      }

      const user2: TokenUserInfo = {
        id: 2,
        phone: '13800138001',
        roles: [1],
        status: 1,
      }

      const token1 = generateAuthTokenService(mockEvent, user1)
      const token2 = generateAuthTokenService(mockEvent, user2)

      expect(token1).not.toBe(token2)
    })

    it('应该设置 HttpOnly Cookie', () => {
      const user: TokenUserInfo = {
        id: 1,
        phone: '13800138000',
        roles: [1],
        status: 1,
      }

      generateAuthTokenService(mockEvent, user)

      expect(global.setCookie).toHaveBeenCalled()
    })

    it('应该设置状态 Cookie（非 httpOnly）', () => {
      const user: TokenUserInfo = {
        id: 1,
        phone: '13800138000',
        roles: [1],
        status: 1,
      }

      generateAuthTokenService(mockEvent, user)

      const setCookieCalls = (global.setCookie as any).mock.calls
      const statusCookieCall = setCookieCalls.find(
        (call: any) => call[1] === AUTH_STATUS_COOKIE
      )

      expect(statusCookieCall).toBeDefined()
      expect(statusCookieCall[3].httpOnly).toBe(false)
    })

    it('token 应该是 JWT 格式', () => {
      const user: TokenUserInfo = {
        id: 123,
        phone: '13800138000',
        roles: [1, 2, 3],
        status: 1,
      }

      const token = generateAuthTokenService(mockEvent, user)

      expect(token.split('.').length).toBe(3)
    })

    it('应该处理不同数量的 roles', () => {
      const user1: TokenUserInfo = {
        id: 1,
        phone: '13800138000',
        roles: [],
        status: 1,
      }

      const user2: TokenUserInfo = {
        id: 1,
        phone: '13800138000',
        roles: [1, 2, 3, 4, 5],
        status: 1,
      }

      const token1 = generateAuthTokenService(mockEvent, user1)
      const token2 = generateAuthTokenService(mockEvent, user2)

      expect(token1).toBeDefined()
      expect(token2).toBeDefined()
      expect(token1).not.toBe(token2)
    })

    it('应该调用 JwtUtil.generateToken', () => {
      const user: TokenUserInfo = {
        id: 1,
        phone: '13800138000',
        roles: [1],
        status: 1,
      }

      generateAuthTokenService(mockEvent, user)

      expect(global.JwtUtil.generateToken).toHaveBeenCalledWith({
        id: user.id,
        phone: user.phone,
        roles: user.roles,
        status: user.status,
      })
    })
  })

  describe('clearAuthCookiesService · 清除认证 Cookie', () => {
    it('应该调用 deleteCookie', () => {
      clearAuthCookiesService(mockEvent)

      expect(global.deleteCookie).toHaveBeenCalled()
    })

    it('应该清除至少两个 Cookie', () => {
      clearAuthCookiesService(mockEvent)

      const deleteCookieCalls = (global.deleteCookie as any).mock.calls
      expect(deleteCookieCalls.length).toBeGreaterThanOrEqual(2)
    })

    it('应该清除状态 Cookie', () => {
      clearAuthCookiesService(mockEvent)

      const deleteCookieCalls = (global.deleteCookie as any).mock.calls
      const statusCookieCall = deleteCookieCalls.find(
        (call: any) => call[1] === AUTH_STATUS_COOKIE
      )

      expect(statusCookieCall).toBeDefined()
    })

    it('应该能多次清除而不报错', () => {
      expect(() => {
        clearAuthCookiesService(mockEvent)
        clearAuthCookiesService(mockEvent)
        clearAuthCookiesService(mockEvent)
      }).not.toThrow()
    })
  })

  describe('整体工作流', () => {
    it('应该能完整执行：生成 token → 清除 cookie', () => {
      const user: TokenUserInfo = {
        id: 1,
        phone: '13800138000',
        roles: [1],
        status: 1,
      }

      const token = generateAuthTokenService(mockEvent, user)
      expect(token).toBeDefined()

      clearAuthCookiesService(mockEvent)
      expect(global.deleteCookie).toHaveBeenCalled()
    })
  })
})
