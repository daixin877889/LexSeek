/**
 * 认证工具函数测试
 *
 * 测试 token 存储、获取、删除和登录状态判断
 *
 * **Feature: auth-utils**
 * **Validates: Requirements 1.1, 1.2**
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as fc from 'fast-check'
import {
    getToken,
    setToken,
    removeToken,
    isLoggedIn,
    getRememberedAccount,
    rememberMeHandler,
} from '../../../app/utils/auth'

// 模拟 localStorage
const localStorageMock = (() => {
    let store: Record<string, string> = {}
    return {
        getItem: vi.fn((key: string) => store[key] || null),
        setItem: vi.fn((key: string, value: string) => {
            store[key] = value
        }),
        removeItem: vi.fn((key: string) => {
            delete store[key]
        }),
        clear: vi.fn(() => {
            store = {}
        }),
    }
})()

// 在全局作用域注入模拟的 localStorage
vi.stubGlobal('localStorage', localStorageMock)

describe('getToken 获取 token', () => {
    beforeEach(() => {
        localStorageMock.clear()
        vi.clearAllMocks()
    })

    it('存在 token 时应返回 token', () => {
        localStorageMock.setItem('token', 'test-token-123')
        const token = getToken()
        expect(token).toBe('test-token-123')
    })

    it('不存在 token 时应返回 null', () => {
        const token = getToken()
        expect(token).toBeNull()
    })
})

describe('setToken 设置 token', () => {
    beforeEach(() => {
        localStorageMock.clear()
        vi.clearAllMocks()
    })

    it('应正确保存 token', () => {
        setToken('new-token-456')
        expect(localStorageMock.setItem).toHaveBeenCalledWith('token', 'new-token-456')
    })

    it('记住我为 true 时应保存 rememberMe 标记', () => {
        setToken('token-123', true, '13800138000')
        expect(localStorageMock.setItem).toHaveBeenCalledWith('rememberMe', 'true')
        expect(localStorageMock.setItem).toHaveBeenCalledWith('rememberedAccount', '13800138000')
    })

    it('记住我为 false 时应删除记住的账号', () => {
        setToken('token-123', false)
        expect(localStorageMock.removeItem).toHaveBeenCalledWith('rememberedAccount')
    })

    it('Property: 任意 token 都应能正确保存', () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 10, maxLength: 500 }),
                (token) => {
                    localStorageMock.clear()
                    setToken(token)
                    expect(localStorageMock.setItem).toHaveBeenCalledWith('token', token)
                }
            ),
            { numRuns: 50 }
        )
    })
})

describe('removeToken 移除 token', () => {
    beforeEach(() => {
        localStorageMock.clear()
        vi.clearAllMocks()
    })

    it('应移除 token', () => {
        localStorageMock.setItem('token', 'test-token')
        removeToken()
        expect(localStorageMock.removeItem).toHaveBeenCalledWith('token')
    })

    it('应移除 rememberMe 标记', () => {
        localStorageMock.setItem('rememberMe', 'true')
        removeToken()
        expect(localStorageMock.removeItem).toHaveBeenCalledWith('rememberMe')
    })
})

describe('isLoggedIn 登录状态判断', () => {
    beforeEach(() => {
        localStorageMock.clear()
        vi.clearAllMocks()
    })

    it('存在 token 时应返回 true', () => {
        localStorageMock.setItem('token', 'valid-token')
        // 重新设置 mock 返回值
        localStorageMock.getItem.mockReturnValueOnce('valid-token')
        expect(isLoggedIn()).toBe(true)
    })

    it('不存在 token 时应返回 false', () => {
        localStorageMock.getItem.mockReturnValueOnce(null)
        expect(isLoggedIn()).toBe(false)
    })

    it('token 为空字符串时应返回 false', () => {
        localStorageMock.getItem.mockReturnValueOnce('')
        expect(isLoggedIn()).toBe(false)
    })
})

describe('getRememberedAccount 获取记住的账号', () => {
    beforeEach(() => {
        localStorageMock.clear()
        vi.clearAllMocks()
    })

    it('存在记住的账号时应返回账号', () => {
        localStorageMock.setItem('rememberedAccount', '13800138000')
        localStorageMock.getItem.mockReturnValueOnce('13800138000')
        expect(getRememberedAccount()).toBe('13800138000')
    })

    it('不存在记住的账号时应返回 null', () => {
        localStorageMock.getItem.mockReturnValueOnce(null)
        expect(getRememberedAccount()).toBeNull()
    })
})

describe('rememberMeHandler 记住我处理', () => {
    beforeEach(() => {
        localStorageMock.clear()
        vi.clearAllMocks()
    })

    it('记住我为 true 时应保存标记和账号', () => {
        rememberMeHandler(true, '13900139000')
        expect(localStorageMock.setItem).toHaveBeenCalledWith('rememberMe', 'true')
        expect(localStorageMock.setItem).toHaveBeenCalledWith('rememberedAccount', '13900139000')
    })

    it('记住我为 false 时应删除标记和账号', () => {
        rememberMeHandler(false)
        expect(localStorageMock.removeItem).toHaveBeenCalledWith('rememberMe')
        expect(localStorageMock.removeItem).toHaveBeenCalledWith('rememberedAccount')
    })

    it('记住我为 true 但没有账号时不应保存账号', () => {
        rememberMeHandler(true, '')
        expect(localStorageMock.setItem).toHaveBeenCalledWith('rememberMe', 'true')
        expect(localStorageMock.setItem).not.toHaveBeenCalledWith('rememberedAccount', '')
    })

    it('Property: 任意手机号都应能正确保存', () => {
        fc.assert(
            fc.property(
                fc.stringMatching(/^1[3-9]\d{9}$/),
                (phone) => {
                    vi.clearAllMocks()
                    rememberMeHandler(true, phone)
                    expect(localStorageMock.setItem).toHaveBeenCalledWith('rememberedAccount', phone)
                }
            ),
            { numRuns: 50 }
        )
    })
})
