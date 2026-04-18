// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockVerifyIntelligentCaptcha = vi.fn()
const mockCaptchaClient = vi.fn(() => ({
  verifyIntelligentCaptcha: mockVerifyIntelligentCaptcha,
}))

vi.mock('@alicloud/captcha20230305', () => ({
  default: mockCaptchaClient,
  VerifyIntelligentCaptchaRequest: class VerifyIntelligentCaptchaRequest {
    captchaVerifyParam?: string
    sceneId?: string

    constructor(map?: Record<string, unknown>) {
      Object.assign(this, map)
    }
  },
}))

vi.mock('@alicloud/openapi-core', () => ({
  $OpenApiUtil: {
    Config: class Config {
      constructor(map?: Record<string, unknown>) {
        Object.assign(this, map)
      }
    },
  },
}))

describe('aliyunCaptcha.service', () => {
  let runtimeConfig: any

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    runtimeConfig = {
      aliyun: {
        accessKeyId: 'test-ak',
        accessKeySecret: 'test-sk',
        captcha: {
          enable: true,
          region: 'cn',
          prefix: 'prefix_123',
          dualStack: false,
          scriptSrc: 'https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js',
          sceneIds: {
            loginSms: 'scene-login-sms',
            registerSms: 'scene-register-sms',
            resetPasswordSms: 'scene-reset-password-sms',
            passwordLogin: 'scene-password-login',
          },
          loginRisk: {
            enable: true,
            threshold: 3,
            windowSec: 900,
          },
        },
      },
    }

    vi.stubGlobal('useRuntimeConfig', () => runtimeConfig)
    vi.stubGlobal('createLogger', () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }))
  })

  it('应根据 region 和 dualStack 推导 endpoint', async () => {
    const service = await import('../../../server/services/security/aliyunCaptcha.service')

    expect(service.resolveAliyunCaptchaEndpoint('cn', false)).toBe('captcha.cn-shanghai.aliyuncs.com')
    expect(service.resolveAliyunCaptchaEndpoint('cn', true)).toBe('captcha-dualstack.cn-shanghai.aliyuncs.com')
    expect(service.resolveAliyunCaptchaEndpoint('sgp', false)).toBe('captcha.ap-southeast-1.aliyuncs.com')
    expect(service.resolveAliyunCaptchaEndpoint('sgp', true)).toBe('captcha-dualstack.ap-southeast-1.aliyuncs.com')
  })

  it('应将 T001 视为验证码通过', async () => {
    const service = await import('../../../server/services/security/aliyunCaptcha.service')

    mockVerifyIntelligentCaptcha.mockResolvedValue({
      body: {
        success: true,
        code: 'Success',
        message: 'success',
        requestId: 'req-1',
        result: {
          verifyResult: true,
          verifyCode: 'T001',
          certifyId: 'cert-1',
        },
      },
    })

    const result = await service.verifyAliyunCaptchaService({
      captchaVerifyParam: 'opaque-param',
      sceneKey: 'passwordLogin',
    })

    expect(result.success).toBe(true)
    expect(result.verifyCode).toBe('T001')
    expect(mockVerifyIntelligentCaptcha).toHaveBeenCalledTimes(1)
    expect(mockVerifyIntelligentCaptcha.mock.calls[0]?.[0]).toMatchObject({
      captchaVerifyParam: 'opaque-param',
      sceneId: 'scene-password-login',
    })
  })

  it('应将 T005 视为验证码通过', async () => {
    const service = await import('../../../server/services/security/aliyunCaptcha.service')

    mockVerifyIntelligentCaptcha.mockResolvedValue({
      body: {
        success: true,
        code: 'Success',
        message: 'test mode',
        requestId: 'req-2',
        result: {
          verifyResult: true,
          verifyCode: 'T005',
          certifyId: 'cert-2',
        },
      },
    })

    const result = await service.verifyAliyunCaptchaService({
      captchaVerifyParam: 'opaque-param',
      sceneKey: 'registerSms',
    })

    expect(result.success).toBe(true)
    expect(result.verifyCode).toBe('T005')
  })

  it('应将 F001 视为验证码失败', async () => {
    const service = await import('../../../server/services/security/aliyunCaptcha.service')

    mockVerifyIntelligentCaptcha.mockResolvedValue({
      body: {
        success: true,
        code: 'Success',
        message: 'blocked',
        requestId: 'req-3',
        result: {
          verifyResult: false,
          verifyCode: 'F001',
          certifyId: 'cert-3',
        },
      },
    })

    const result = await service.verifyAliyunCaptchaService({
      captchaVerifyParam: 'opaque-param',
      sceneKey: 'loginSms',
    })

    expect(result.success).toBe(false)
    expect(result.verifyCode).toBe('F001')
  })

  it('缺少 captchaVerifyParam 时不应调用 SDK', async () => {
    const service = await import('../../../server/services/security/aliyunCaptcha.service')

    const result = await service.verifyAliyunCaptchaService({
      captchaVerifyParam: '',
      sceneKey: 'loginSms',
    })

    expect(result.success).toBe(false)
    expect(mockVerifyIntelligentCaptcha).not.toHaveBeenCalled()
  })
})
