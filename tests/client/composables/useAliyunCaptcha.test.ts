import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockFetch = vi.fn()
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
}

vi.stubGlobal('fetch', mockFetch)
vi.stubGlobal('logger', mockLogger)

async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

async function waitForCaptchaScript(): Promise<HTMLScriptElement> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const script = document.querySelector('script[data-aliyun-captcha="true"]') as HTMLScriptElement | null
    if (script) {
      return script
    }

    await flushMicrotasks()
  }

  throw new Error('未找到验证码脚本')
}

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
    delete (window as any).initAliyunCaptcha
    delete (window as any).AliyunCaptchaConfig

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

  it('脚本首次加载失败后，下一次 preload 应重建 script', async () => {
    const { useAliyunCaptcha } = await import('../../../app/composables/useAliyunCaptcha')
    const captcha = useAliyunCaptcha('registerSms')

    const firstPreloadPromise = captcha.preload()
    const failedScript = await waitForCaptchaScript()
    failedScript.dispatchEvent(new Event('error'))

    const firstPreloadResult = await firstPreloadPromise
    expect(firstPreloadResult).toBe(false)

    const secondPreloadPromise = captcha.preload()
    let reloadedScript: HTMLScriptElement | null = null
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await flushMicrotasks()
      const currentScript = document.querySelector('script[data-aliyun-captcha="true"]') as HTMLScriptElement | null
      if (currentScript && currentScript !== failedScript) {
        reloadedScript = currentScript
        break
      }
    }

    expect(reloadedScript).toBeTruthy()
    expect(reloadedScript).not.toBe(failedScript)
    reloadedScript.dispatchEvent(new Event('error'))

    const secondPreloadResult = await secondPreloadPromise
    expect(secondPreloadResult).toBe(false)
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

  it('一次验证成功后，下一次 verify 应重新初始化实例', async () => {
    let initCount = 0

    ;(window as any).initAliyunCaptcha = vi.fn((options: any) => {
      initCount += 1
      const currentCount = initCount
      const button = document.querySelector(options.button) as HTMLButtonElement

      button.onclick = () => {
        options.success(`captcha-${currentCount}`)
      }

      options.getInstance({
        show: vi.fn(),
      })
    })

    const { useAliyunCaptcha } = await import('../../../app/composables/useAliyunCaptcha')
    const captcha = useAliyunCaptcha('passwordLogin')

    const firstVerifyResult = await captcha.verify()
    const secondVerifyResult = await captcha.verify()

    expect(firstVerifyResult).toBe('captcha-1')
    expect(secondVerifyResult).toBe('captcha-2')
    expect((window as any).initAliyunCaptcha).toHaveBeenCalledTimes(2)
  })

  it('SDK 静默不回调时，verify 应在超时后失败', async () => {
    vi.useFakeTimers()

    try {
      const hide = vi.fn()
      ;(window as any).initAliyunCaptcha = vi.fn((options: any) => {
        options.getInstance({
          show: vi.fn(),
          hide,
        })
      })

      const { useAliyunCaptcha } = await import('../../../app/composables/useAliyunCaptcha')
      const captcha = useAliyunCaptcha('passwordLogin')

      const verifyPromise = captcha.verify()
      await flushMicrotasks()
      const timeoutAssertion = expect(verifyPromise).rejects.toThrow('安全验证超时，请重试')
      await vi.advanceTimersByTimeAsync(120 * 1000)

      await timeoutAssertion
      expect(hide).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
