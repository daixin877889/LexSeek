import type { AliyunCaptchaClientConfig, AliyunCaptchaSceneKey } from '#shared/types/captcha'
import { nextTick } from 'vue'
import { ALIYUN_CAPTCHA_BASE_WIDTH, getAliyunCaptchaDomIds } from '~/utils/aliyunCaptcha'

interface CaptchaInstance {
  show?: () => void
  hide?: () => void
  startTracelessVerification?: () => void
}

interface SceneState {
  initPromise?: Promise<boolean>
  instance?: CaptchaInstance
  pendingPromise?: Promise<string>
  resolvePending?: (captchaVerifyParam: string) => void
  rejectPending?: (error: Error) => void
}

const CAPTCHA_CONFIG_PATH = '/auth-captcha-config'
const sceneStates = new Map<AliyunCaptchaSceneKey, SceneState>()

let captchaConfigPromise: Promise<AliyunCaptchaClientConfig> | null = null
let captchaScriptPromise: Promise<void> | null = null

function createDisabledCaptchaConfig(): AliyunCaptchaClientConfig {
  return {
    enabled: false,
    region: 'cn',
    prefix: '',
    scriptSrc: '',
    sceneIds: {
      loginSms: '',
      registerSms: '',
      resetPasswordSms: '',
      passwordLogin: '',
    },
  }
}

function getSceneState(scene: AliyunCaptchaSceneKey): SceneState {
  let state = sceneStates.get(scene)
  if (!state) {
    state = {}
    sceneStates.set(scene, state)
  }
  return state
}

async function getCaptchaConfig(): Promise<AliyunCaptchaClientConfig> {
  if (!import.meta.client) {
    return createDisabledCaptchaConfig()
  }

  if (!captchaConfigPromise) {
    captchaConfigPromise = (async () => {
      try {
        const response = await fetch(CAPTCHA_CONFIG_PATH, {
          credentials: 'include',
        })
        if (!response.ok) {
          throw new Error('验证码配置加载失败')
        }

        return await response.json() as AliyunCaptchaClientConfig
      } catch (error) {
        logger.warn('获取阿里云验证码配置失败', error)
        return createDisabledCaptchaConfig()
      }
    })()
  }

  return captchaConfigPromise
}

async function loadCaptchaScript(src: string): Promise<void> {
  if (!import.meta.client || !src || window.initAliyunCaptcha) {
    return
  }

  if (captchaScriptPromise) {
    return captchaScriptPromise
  }

  captchaScriptPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>('script[data-aliyun-captcha="true"]')

    if (existingScript) {
      const handleLoad = () => resolve()
      const handleError = () => reject(new Error('验证码脚本加载失败'))

      if (window.initAliyunCaptcha) {
        resolve()
        return
      }

      existingScript.addEventListener('load', handleLoad, { once: true })
      existingScript.addEventListener('error', handleError, { once: true })
      return
    }

    const script = document.createElement('script')
    script.type = 'text/javascript'
    script.src = src
    script.async = true
    script.dataset.aliyunCaptcha = 'true'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('验证码脚本加载失败'))
    document.head.appendChild(script)
  })

  return captchaScriptPromise.catch((error) => {
    captchaScriptPromise = null
    throw error
  })
}

function getCaptchaRem(): number {
  if (!import.meta.client) {
    return 1
  }

  if (window.innerWidth >= ALIYUN_CAPTCHA_BASE_WIDTH) {
    return 1
  }

  return Math.max(
    Math.floor((window.innerWidth / ALIYUN_CAPTCHA_BASE_WIDTH) * 100) / 100,
    0.5
  )
}

function rejectPendingVerification(scene: AliyunCaptchaSceneKey, error: Error) {
  const state = getSceneState(scene)
  if (!state.rejectPending) {
    return
  }

  state.rejectPending(error)
  state.pendingPromise = undefined
  state.resolvePending = undefined
  state.rejectPending = undefined
}

function resolvePendingVerification(scene: AliyunCaptchaSceneKey, captchaVerifyParam: string) {
  const state = getSceneState(scene)
  if (!state.resolvePending) {
    return
  }

  state.resolvePending(captchaVerifyParam)
  state.pendingPromise = undefined
  state.resolvePending = undefined
  state.rejectPending = undefined
}

async function ensureCaptchaReady(scene: AliyunCaptchaSceneKey): Promise<boolean> {
  if (!import.meta.client) {
    return false
  }

  const config = await getCaptchaConfig()
  const sceneId = config.sceneIds[scene]
  if (!config.enabled || !config.prefix || !sceneId) {
    return false
  }

  const state = getSceneState(scene)
  if (state.initPromise) {
    return state.initPromise
  }

  state.initPromise = (async () => {
    await nextTick()
    await loadCaptchaScript(config.scriptSrc)

    if (!window.initAliyunCaptcha) {
      throw new Error('验证码脚本未正确加载')
    }

    const domIds = getAliyunCaptchaDomIds(scene)
    const element = document.getElementById(domIds.elementId)
    const button = document.getElementById(domIds.buttonId)

    if (!element || !button) {
      throw new Error(`验证码宿主未就绪：${scene}`)
    }

    window.AliyunCaptchaConfig = {
      region: config.region,
      prefix: config.prefix,
    }

    await new Promise<void>((resolve, reject) => {
      let resolved = false

      window.initAliyunCaptcha?.({
        SceneId: sceneId,
        mode: 'popup',
        element: `#${domIds.elementId}`,
        button: `#${domIds.buttonId}`,
        language: 'cn',
        rem: getCaptchaRem(),
        showErrorTip: true,
        slideStyle: {
          width: ALIYUN_CAPTCHA_BASE_WIDTH,
          height: 40,
        },
        success(captchaVerifyParam) {
          resolvePendingVerification(scene, captchaVerifyParam)
        },
        fail(result) {
          logger.warn('验证码校验交互未通过，等待用户重试', result)
        },
        getInstance(instance) {
          state.instance = instance
          if (!resolved) {
            resolved = true
            resolve()
          }
        },
        onClose() {
          rejectPendingVerification(scene, new Error('已取消安全验证'))
        },
        onError(errorInfo) {
          const error = new Error(errorInfo?.msg || '验证码初始化失败')
          if (!resolved) {
            resolved = true
            reject(error)
            return
          }

          rejectPendingVerification(scene, error)
        },
      })
    })

    return true
  })().catch((error) => {
    state.initPromise = undefined
    throw error
  })

  return state.initPromise
}

export function useAliyunCaptcha(scene: AliyunCaptchaSceneKey) {
  const preload = async () => {
    try {
      return await ensureCaptchaReady(scene)
    } catch (error) {
      logger.warn('预加载验证码失败', { scene, error })
      return false
    }
  }

  const verify = async (): Promise<string | null> => {
    const ready = await ensureCaptchaReady(scene)
    if (!ready) {
      return null
    }

    const state = getSceneState(scene)
    if (state.pendingPromise) {
      return state.pendingPromise
    }

    state.pendingPromise = new Promise<string>((resolve, reject) => {
      state.resolvePending = resolve
      state.rejectPending = reject
    })

    if (typeof state.instance?.show === 'function') {
      state.instance.show()
    } else {
      const domIds = getAliyunCaptchaDomIds(scene)
      document.getElementById(domIds.buttonId)?.click()
    }

    return state.pendingPromise
  }

  return {
    preload,
    verify,
  }
}
