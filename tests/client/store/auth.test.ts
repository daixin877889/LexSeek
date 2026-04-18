// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const mockUseApiFetch = vi.fn()
const mockSetUserInfo = vi.fn()
const mockClearUserInfo = vi.fn()

vi.stubGlobal('useApiFetch', mockUseApiFetch)
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

    mockUseApiFetch.mockResolvedValue({
      token: 'token-123',
      user: {
        id: 1,
        phone: '13800138000',
        name: '测试用户',
        roles: [1],
        status: 1,
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
    expect(mockSetUserInfo).toHaveBeenCalledWith(expect.objectContaining({
      phone: '13800138000',
    }))
    expect(store.isAuthenticated).toBe(true)
  })

  it('登录返回 429 时应标记 requiresCaptcha', async () => {
    const { useAuthStore } = await import('../../../app/store/auth')
    const store = useAuthStore()

    mockUseApiFetch.mockImplementation(async (_url: string, options: Record<string, any>) => {
      options.onBusinessError?.({
        success: false,
        code: 429,
        message: '请完成安全验证后重试',
        data: null,
      })
      return null
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

    mockUseApiFetch.mockResolvedValue({
      expiredAt: new Date().toISOString(),
    })

    const result = await store.sendSmsCode({
      phone: '13800138000',
      type: 'register',
      captchaVerifyParam: 'opaque-captcha-param',
    })

    expect(result).toBe(true)
    expect(mockUseApiFetch).toHaveBeenCalledWith('/api/v1/sms/send', expect.objectContaining({
      body: expect.objectContaining({
        captchaVerifyParam: 'opaque-captcha-param',
      }),
    }))
  })
})
