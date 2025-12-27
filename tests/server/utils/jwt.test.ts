/**
 * JWT 工具函数测试
 *
 * 测试 JWT 令牌的生成和验证
 *
 * **Feature: auth-system**
 * **Validates: Requirements 1.3, 1.4**
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import * as fc from 'fast-check'
import jwt from 'jsonwebtoken'

// 模拟配置
const mockConfig = {
    jwt: {
        secret: 'test-secret-key-for-jwt-testing-12345',
        expiresIn: '1h',
    },
}

// 在模块加载前设置全局模拟
vi.stubGlobal('useRuntimeConfig', () => mockConfig)
vi.stubGlobal('logger', {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
})

// 动态导入被测试的模块
let JwtUtil: typeof import('../../../server/utils/jwt').JwtUtil
type JwtPayload = import('../../../server/utils/jwt').JwtPayload

beforeAll(async () => {
    // 重置模块缓存并重新导入
    vi.resetModules()
    const module = await import('../../../server/utils/jwt')
    JwtUtil = module.JwtUtil
})

describe('JwtUtil.generateToken 令牌生成', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('应成功生成 JWT 令牌', () => {
        const payload: JwtPayload = {
            id: 1,
            phone: '13800138000',
            roles: [1, 2],
        }

        const token = JwtUtil.generateToken(payload)

        expect(token).toBeDefined()
        expect(typeof token).toBe('string')
        expect(token.split('.').length).toBe(3) // JWT 格式：header.payload.signature
    })

    it('禁用状态的用户应无法生成令牌', () => {
        const payload: JwtPayload = {
            id: 1,
            phone: '13800138000',
            roles: [1],
            status: 0, // 禁用状态
        }

        expect(() => JwtUtil.generateToken(payload)).toThrow('账号已禁用，无法生成令牌')
    })

    it('正常状态的用户应能生成令牌', () => {
        const payload: JwtPayload = {
            id: 1,
            phone: '13800138000',
            roles: [1],
            status: 1, // 正常状态
        }

        const token = JwtUtil.generateToken(payload)
        expect(token).toBeDefined()
    })

    it('生成的令牌不应包含 status 字段', () => {
        const payload: JwtPayload = {
            id: 1,
            phone: '13800138000',
            roles: [1],
            status: 1,
        }

        const token = JwtUtil.generateToken(payload)
        const decoded = jwt.decode(token) as Record<string, unknown>

        expect(decoded.id).toBe(1)
        expect(decoded.phone).toBe('13800138000')
        expect(decoded.status).toBeUndefined()
    })

    it('Property: 任意有效 payload 都应能生成令牌', () => {
        fc.assert(
            fc.property(
                fc.record({
                    id: fc.integer({ min: 1, max: 1000000 }),
                    phone: fc.stringMatching(/^1[3-9]\d{9}$/),
                    roles: fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 1, maxLength: 5 }),
                    status: fc.constantFrom(1, 2, undefined), // 非禁用状态
                }),
                (payload) => {
                    const token = JwtUtil.generateToken(payload as JwtPayload)
                    expect(token).toBeDefined()
                    expect(token.split('.').length).toBe(3)
                }
            ),
            { numRuns: 50 }
        )
    })
})

describe('JwtUtil.verifyToken 令牌验证', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('应成功验证有效令牌', () => {
        const payload: JwtPayload = {
            id: 1,
            phone: '13800138000',
            roles: [1, 2],
        }

        const token = JwtUtil.generateToken(payload)
        const decoded = JwtUtil.verifyToken(token)

        expect(decoded.id).toBe(payload.id)
        expect(decoded.phone).toBe(payload.phone)
        expect(decoded.roles).toEqual(payload.roles)
    })

    it('无效令牌应抛出错误', () => {
        const invalidToken = 'invalid.token.here'

        expect(() => JwtUtil.verifyToken(invalidToken)).toThrow('无效的认证令牌')
    })

    it('过期令牌应抛出错误', () => {
        // 创建一个已过期的令牌
        const payload = { id: 1, phone: '13800138000', roles: [1] }
        const expiredToken = jwt.sign(payload, mockConfig.jwt.secret, { expiresIn: '-1s' })

        expect(() => JwtUtil.verifyToken(expiredToken)).toThrow('认证令牌已过期')
    })

    it('使用错误密钥签名的令牌应抛出错误', () => {
        // 使用不同的密钥签名
        const payload = { id: 1, phone: '13800138000', roles: [1] }
        const wrongKeyToken = jwt.sign(payload, 'wrong-secret-key', { expiresIn: '1h' })

        expect(() => JwtUtil.verifyToken(wrongKeyToken)).toThrow('无效的认证令牌')
    })

    it('格式错误的令牌应抛出错误', () => {
        // 完全无效的格式
        expect(() => JwtUtil.verifyToken('')).toThrow('无效的认证令牌')
        expect(() => JwtUtil.verifyToken('not-a-jwt')).toThrow('无效的认证令牌')
    })

    it('Property: 生成后立即验证应成功', () => {
        fc.assert(
            fc.property(
                fc.record({
                    id: fc.integer({ min: 1, max: 1000000 }),
                    phone: fc.stringMatching(/^1[3-9]\d{9}$/),
                    roles: fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 1, maxLength: 5 }),
                }),
                (payload) => {
                    const token = JwtUtil.generateToken(payload as JwtPayload)
                    const decoded = JwtUtil.verifyToken(token)

                    expect(decoded.id).toBe(payload.id)
                    expect(decoded.phone).toBe(payload.phone)
                    expect(decoded.roles).toEqual(payload.roles)
                }
            ),
            { numRuns: 50 }
        )
    })
})

describe('Property: JWT 往返一致性', () => {
    it('生成并验证的令牌应保留原始数据', () => {
        fc.assert(
            fc.property(
                fc.record({
                    id: fc.integer({ min: 1, max: 1000000 }),
                    phone: fc.stringMatching(/^1[3-9]\d{9}$/),
                    roles: fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 1, maxLength: 5 }),
                }),
                (payload) => {
                    const token = JwtUtil.generateToken(payload as JwtPayload)
                    const decoded = JwtUtil.verifyToken(token)

                    // 验证核心字段一致
                    expect(decoded.id).toBe(payload.id)
                    expect(decoded.phone).toBe(payload.phone)
                    expect(decoded.roles).toEqual(payload.roles)
                }
            ),
            { numRuns: 100 }
        )
    })
})
