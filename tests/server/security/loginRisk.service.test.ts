// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockRedisClient = {
  get: vi.fn(),
  incr: vi.fn(),
  expire: vi.fn(),
  del: vi.fn(),
}

const mockGetRequestIP = vi.fn()
const mockCanUseAliyunCaptchaSceneService = vi.fn(() => true)
const mockGetAliyunCaptchaRuntimeConfigService = vi.fn(() => ({
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
}))

vi.mock('h3', () => ({
  getRequestIP: mockGetRequestIP,
}))

vi.mock('~~/server/lib/redis', () => ({
  getRedisClient: () => mockRedisClient,
}))

vi.mock('~~/server/services/security/aliyunCaptcha.service', () => ({
  canUseAliyunCaptchaSceneService: mockCanUseAliyunCaptchaSceneService,
  getAliyunCaptchaRuntimeConfigService: mockGetAliyunCaptchaRuntimeConfigService,
}))

describe('loginRisk.service', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mockGetRequestIP.mockReturnValue('10.1.2.3')
    mockRedisClient.get.mockResolvedValue('0')
    mockRedisClient.incr.mockResolvedValue(1)
    mockRedisClient.expire.mockResolvedValue(1)
    mockRedisClient.del.mockResolvedValue(1)
    mockCanUseAliyunCaptchaSceneService.mockReturnValue(true)
    mockGetAliyunCaptchaRuntimeConfigService.mockReturnValue({
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
    })

    vi.stubGlobal('createLogger', () => ({
      warn: vi.fn(),
    }))
  })

  it('应根据手机号和 IP 生成带 hash 的风控 key', async () => {
    const service = await import('../../../server/services/security/loginRisk.service')
    const key = service.getPasswordLoginRiskKeyService({} as any, '13800138000')

    expect(key).toMatch(/^auth:pwd-login:fail:13800138000:[a-f0-9]{16}$/)
    expect(key).not.toContain('10.1.2.3')
  })

  it('达到阈值时应要求密码登录验证码', async () => {
    const service = await import('../../../server/services/security/loginRisk.service')
    mockRedisClient.get.mockResolvedValue('3')

    const result = await service.shouldRequirePasswordLoginCaptchaService({} as any, '13800138000')
    expect(result).toBe(true)
  })

  it('未达到阈值时不应要求验证码', async () => {
    const service = await import('../../../server/services/security/loginRisk.service')
    mockRedisClient.get.mockResolvedValue('2')

    const result = await service.shouldRequirePasswordLoginCaptchaService({} as any, '13800138000')
    expect(result).toBe(false)
  })

  it('记录密码登录失败时应写入 Redis 并刷新 TTL', async () => {
    const service = await import('../../../server/services/security/loginRisk.service')
    await service.recordPasswordLoginFailureService({} as any, '13800138000')

    expect(mockRedisClient.incr).toHaveBeenCalledTimes(1)
    expect(mockRedisClient.expire).toHaveBeenCalledWith(expect.stringMatching(/^auth:pwd-login:fail:/), 900)
  })

  it('登录成功后应清理 Redis 计数', async () => {
    const service = await import('../../../server/services/security/loginRisk.service')
    await service.clearPasswordLoginFailureService({} as any, '13800138000')

    expect(mockRedisClient.del).toHaveBeenCalledTimes(1)
    expect(mockRedisClient.del.mock.calls[0]?.[0]).toMatch(/^auth:pwd-login:fail:/)
  })

  it('登录风控关闭时应跳过 Redis 操作', async () => {
    const service = await import('../../../server/services/security/loginRisk.service')
    mockCanUseAliyunCaptchaSceneService.mockReturnValue(false)

    const shouldRequire = await service.shouldRequirePasswordLoginCaptchaService({} as any, '13800138000')
    await service.recordPasswordLoginFailureService({} as any, '13800138000')

    expect(shouldRequire).toBe(false)
    expect(mockRedisClient.get).not.toHaveBeenCalled()
    expect(mockRedisClient.incr).not.toHaveBeenCalled()
  })
})
