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
  element?: HTMLElement
  button?: HTMLElement
  pendingPromise?: Promise<string>
  resolvePending?: (captchaVerifyParam: string) => void
  rejectPending?: (error: Error) => void
  cachedVerifyParam?: string
  cachedVerifyAt?: number
}

const CAPTCHA_CONFIG_PATH = '/auth-captcha-config'
const CAPTCHA_VERIFY_PARAM_MAX_AGE_MS = 85 * 1000
const sceneStates = new Map<AliyunCaptchaSceneKey, SceneState>()
const CAPTCHA_PREVERIFY_CACHE_ENABLED_SCENES = new Set<AliyunCaptchaSceneKey>([
  'loginSms',
  'registerSms',
  'resetPasswordSms',
])

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

function getSceneDomNodes(scene: AliyunCaptchaSceneKey) {
  const domIds = getAliyunCaptchaDomIds(scene)
  return {
    element: document.getElementById(domIds.elementId),
    button: document.getElementById(domIds.buttonId) as HTMLButtonElement | null,
  }
}

function resetSceneState(scene: AliyunCaptchaSceneKey, error?: Error) {
  const state = getSceneState(scene)

  if (error && state.rejectPending) {
    state.rejectPending(error)
  }

  sceneStates.set(scene, {})
}

function isSceneBindingStale(scene: AliyunCaptchaSceneKey, state: SceneState): boolean {
  if (!state.element || !state.button) {
    return true
  }

  if (!document.contains(state.element) || !document.contains(state.button)) {
    return true
  }

  const { element, button } = getSceneDomNodes(scene)
  return state.element !== element || state.button !== button
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
        captchaConfigPromise = null
        throw error instanceof Error
          ? error
          : new Error('验证码配置加载失败，请稍后再试')
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

function cacheVerificationResult(scene: AliyunCaptchaSceneKey, captchaVerifyParam: string) {
  if (!CAPTCHA_PREVERIFY_CACHE_ENABLED_SCENES.has(scene)) {
    return
  }

  const state = getSceneState(scene)
  state.cachedVerifyParam = captchaVerifyParam
  state.cachedVerifyAt = Date.now()
}

function resolvePendingVerification(scene: AliyunCaptchaSceneKey, captchaVerifyParam: string) {
  const state = getSceneState(scene)
  if (!state.resolvePending) {
    cacheVerificationResult(scene, captchaVerifyParam)
    return
  }

  state.resolvePending(captchaVerifyParam)
  state.pendingPromise = undefined
  state.resolvePending = undefined
  state.rejectPending = undefined
}

function consumeCachedVerification(scene: AliyunCaptchaSceneKey): string | null {
  const state = getSceneState(scene)
  if (!state.cachedVerifyParam || !state.cachedVerifyAt) {
    return null
  }

  const isExpired = Date.now() - state.cachedVerifyAt > CAPTCHA_VERIFY_PARAM_MAX_AGE_MS
  const captchaVerifyParam = isExpired ? null : state.cachedVerifyParam

  state.cachedVerifyParam = undefined
  state.cachedVerifyAt = undefined

  return captchaVerifyParam
}

async function ensureCaptchaReady(scene: AliyunCaptchaSceneKey): Promise<boolean> {
  if (!import.meta.client) {
    return false
  }

  const config = await getCaptchaConfig()
  const sceneId = config.sceneIds[scene]
  if (!config.enabled) {
    return false
  }

  if (!config.prefix || !sceneId) {
    throw new Error(`验证码场景配置不完整：${scene}`)
  }

  let state = getSceneState(scene)
  if (state.initPromise && !isSceneBindingStale(scene, state)) {
    return state.initPromise
  }

  if (state.initPromise) {
    resetSceneState(scene, new Error('验证码宿主已变更，请重试'))
    state = getSceneState(scene)
  }

  state.initPromise = (async () => {
    await nextTick()
    await loadCaptchaScript(config.scriptSrc)

    if (!window.initAliyunCaptcha) {
      throw new Error('验证码脚本未正确加载')
    }

    const domIds = getAliyunCaptchaDomIds(scene)
    const { element, button } = getSceneDomNodes(scene)

    if (!element || !button) {
      throw new Error(`验证码宿主未就绪：${scene}`)
    }

    state.element = element
    state.button = button

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
    const cachedVerifyParam = consumeCachedVerification(scene)
    if (cachedVerifyParam) {
      logger.info('复用预先完成的验证码结果', { scene })
      return cachedVerifyParam
    }

    if (state.pendingPromise) {
      return state.pendingPromise
    }

    const pendingPromise = new Promise<string>((resolve, reject) => {
      state.resolvePending = resolve
      state.rejectPending = reject
    })
    state.pendingPromise = pendingPromise

    const domIds = getAliyunCaptchaDomIds(scene)
    const button = document.getElementById(domIds.buttonId) as HTMLButtonElement | null

    if (button) {
      button.click()
    } else if (typeof state.instance?.startTracelessVerification === 'function') {
      state.instance.startTracelessVerification()
    } else if (typeof state.instance?.show === 'function') {
      state.instance.show()
    } else {
      rejectPendingVerification(scene, new Error('验证码触发失败'))
    }

    return pendingPromise
  }

  return {
    preload,
    verify,
  }
}
