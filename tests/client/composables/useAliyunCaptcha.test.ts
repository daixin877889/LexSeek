import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockFetch = vi.fn()
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
}

vi.stubGlobal('fetch', mockFetch)
vi.stubGlobal('logger', mockLogger)

describe('useAliyunCaptcha', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    document.body.innerHTML = ''
    document.head.innerHTML = ''

    const domIds = {
      elementId: 'lexseek-aliyun-captcha-registerSms-element',
      buttonId: 'lexseek-aliyun-captcha-registerSms-button',
    }

    const element = document.createElement('div')
    element.id = domIds.elementId
    document.body.appendChild(element)

    const button = document.createElement('button')
    button.id = domIds.buttonId
    document.body.appendChild(button)

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        enabled: true,
        region: 'cn',
        prefix: 'prefix_123',
        scriptSrc: 'https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js',
        sceneIds: {
          loginSms: '',
          registerSms: 'scene-register',
          resetPasswordSms: '',
          passwordLogin: '',
        },
      }),
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
})
