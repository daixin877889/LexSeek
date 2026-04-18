import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockFetch = vi.fn()
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
}

vi.stubGlobal('fetch', mockFetch)
vi.stubGlobal('logger', mockLogger)

function appendSceneDom(scene: 'registerSms' | 'passwordLogin') {
  const element = document.createElement('div')
  element.id = `lexseek-aliyun-captcha-${scene}-element`
  document.body.appendChild(element)

  const button = document.createElement('button')
  button.id = `lexseek-aliyun-captcha-${scene}-button`
  document.body.appendChild(button)

  return button
}

function createCaptchaConfig() {
  return {
    enabled: true,
    region: 'cn',
    prefix: 'prefix_123',
    scriptSrc: 'https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js',
    sceneIds: {
      loginSms: '',
      registerSms: 'scene-register',
      resetPasswordSms: '',
      passwordLogin: 'scene-password-login',
    },
  }
}

describe('useAliyunCaptcha', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    document.body.innerHTML = ''
    document.head.innerHTML = ''

    appendSceneDom('registerSms')
    appendSceneDom('passwordLogin')

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => createCaptchaConfig(),
    })
  })

  it('预加载阶段提前 success 时，verify 应消费缓存结果', async () => {
    ;(window as any).initAliyunCaptcha = vi.fn((options: any) => {
      options.getInstance({
        show: vi.fn(),
      })
      options.success('prefetched-captcha-param')
    })

    const { useAliyunCaptcha } = await import('../../../app/composables/useAliyunCaptcha')
    const captcha = useAliyunCaptcha('registerSms')

    const preloadResult = await captcha.preload()
    const verifyResult = await captcha.verify()

    expect(preloadResult).toBe(true)
    expect(verifyResult).toBe('prefetched-captcha-param')
  })

  it('passwordLogin 不应复用预加载阶段提前 success 的结果', async () => {
    let latestOptions: any

    ;(window as any).initAliyunCaptcha = vi.fn((options: any) => {
      latestOptions = options
      options.getInstance({
        show: vi.fn(),
      })
      options.success('prefetched-password-login-param')
    })

    const passwordLoginButton = document.getElementById(
      'lexseek-aliyun-captcha-passwordLogin-button'
    ) as HTMLButtonElement

    passwordLoginButton.addEventListener('click', () => {
      latestOptions.success('fresh-password-login-param')
    })

    const { useAliyunCaptcha } = await import('../../../app/composables/useAliyunCaptcha')
    const captcha = useAliyunCaptcha('passwordLogin')

    const preloadResult = await captcha.preload()
    const verifyResult = await captcha.verify()

    expect(preloadResult).toBe(true)
    expect(verifyResult).toBe('fresh-password-login-param')
  })

  it('配置加载失败后下一次 preload 应允许重试', async () => {
    mockFetch.mockReset()
    mockFetch
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => createCaptchaConfig(),
      })

    ;(window as any).initAliyunCaptcha = vi.fn((options: any) => {
      options.getInstance({
        show: vi.fn(),
      })
    })

    const { useAliyunCaptcha } = await import('../../../app/composables/useAliyunCaptcha')
    const captcha = useAliyunCaptcha('registerSms')

    const firstPreloadResult = await captcha.preload()
    const secondPreloadResult = await captcha.preload()

    expect(firstPreloadResult).toBe(false)
    expect(secondPreloadResult).toBe(true)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('宿主 DOM 重新挂载后应重新初始化验证码实例', async () => {
    let latestOptions: any

    ;(window as any).initAliyunCaptcha = vi.fn((options: any) => {
      latestOptions = options
      options.getInstance({
        show: vi.fn(),
      })
    })

    const { useAliyunCaptcha } = await import('../../../app/composables/useAliyunCaptcha')
    const captcha = useAliyunCaptcha('registerSms')

    const firstPreloadResult = await captcha.preload()

    document.getElementById('lexseek-aliyun-captcha-registerSms-element')?.remove()
    document.getElementById('lexseek-aliyun-captcha-registerSms-button')?.remove()

    const remountedButton = appendSceneDom('registerSms')
    remountedButton.addEventListener('click', () => {
      latestOptions.success('remounted-captcha-param')
    })

    const verifyResult = await captcha.verify()

    expect(firstPreloadResult).toBe(true)
    expect(verifyResult).toBe('remounted-captcha-param')
    expect((window as any).initAliyunCaptcha).toHaveBeenCalledTimes(2)
  })
})
