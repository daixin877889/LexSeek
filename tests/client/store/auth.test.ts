// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const mockFetch = vi.fn()
const mockSetUserInfo = vi.fn()
const mockClearUserInfo = vi.fn()

vi.stubGlobal('$fetch', mockFetch)
vi.stubGlobal('useUserStore', () => ({
  setUserInfo: mockSetUserInfo,
  clearUserInfo: mockClearUserInfo,
}))
vi.stubGlobal('useLegalEditorCache', () => ({
  clearAllDraftCaches: vi.fn(),
}))
vi.stubGlobal('useCookie', () => ({
  value: '',
}))

describe('auth store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  it('登录成功时应返回 success 并写入用户信息', async () => {
    const { useAuthStore } = await import('../../../app/store/auth')
    const store = useAuthStore()

    mockFetch.mockResolvedValue({
      success: true,
      code: 0,
      message: 'ok',
      timestamp: Date.now(),
      requestId: 'req-1',
      data: {
        token: 'token-123',
        user: {
          id: 1,
          phone: '13800138000',
          name: '测试用户',
          roles: [1],
          status: 1,
        },
      },
    })

    const result = await store.login({
      phone: '13800138000',
      password: 'Password123',
    })

    expect(result).toEqual({
      success: true,
      requiresCaptcha: false,
    })
    expect(store.isAuthenticated).toBe(true)
  })

  it('登录返回 429 时应标记 requiresCaptcha', async () => {
    const { useAuthStore } = await import('../../../app/store/auth')
    const store = useAuthStore()

    mockFetch.mockResolvedValue({
      success: false,
      code: 429,
      message: '请完成安全验证后重试',
      timestamp: Date.now(),
      requestId: 'req-2',
      data: null,
    })

    const result = await store.login({
      phone: '13800138000',
      password: 'Password123',
    })

    expect(result).toEqual({
      success: false,
      requiresCaptcha: true,
    })
    expect(store.error).toBe('请完成安全验证后重试')
  })

  it('发送短信验证码时应透传 captchaVerifyParam', async () => {
    const { useAuthStore } = await import('../../../app/store/auth')
    const store = useAuthStore()

    mockFetch.mockResolvedValue({
      success: true,
      code: 0,
      message: 'ok',
      timestamp: Date.now(),
      requestId: 'req-3',
      data: {
        expiredAt: new Date().toISOString(),
        retryAfterSec: 60,
      },
    })

    const result = await store.sendSmsCode({
      phone: '13800138000',
      type: 'register',
      captchaVerifyParam: 'opaque-captcha-param',
    })

    expect(result).toEqual({
      success: true,
      message: null,
      retryAfterSec: 60,
      expiredAt: expect.any(String),
    })
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/sms/send', expect.objectContaining({
      body: expect.objectContaining({
        captchaVerifyParam: 'opaque-captcha-param',
      }),
    }))
  })

  it('发送短信验证码失败时应保留业务错误和 retryAfterSec', async () => {
    const { useAuthStore } = await import('../../../app/store/auth')
    const store = useAuthStore()

    mockFetch.mockResolvedValue({
      success: false,
      code: 400,
      message: '验证码获取频率过高，请稍后再试',
      timestamp: Date.now(),
      requestId: 'req-4',
      data: {
        retryAfterSec: 42,
      },
    })

    const result = await store.sendSmsCode({
      phone: '13800138000',
      type: 'register',
      captchaVerifyParam: 'opaque-captcha-param',
    })

    expect(result).toEqual({
      success: false,
      message: '验证码获取频率过高，请稍后再试',
      retryAfterSec: 42,
      expiredAt: null,
    })
    expect(store.error).toBe('验证码获取频率过高，请稍后再试')
  })
})
