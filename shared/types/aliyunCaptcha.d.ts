import type { AliyunCaptchaRegion } from './captcha'

interface AliyunCaptchaInstance {
  show?: () => void
  hide?: () => void
  startTracelessVerification?: () => void
}

interface AliyunCaptchaInitErrorInfo {
  code?: string | number
  msg?: string
}

interface AliyunCaptchaInitOptions {
  SceneId: string
  mode: 'popup' | 'embed'
  element: string
  button: string
  success: (captchaVerifyParam: string) => void
  fail?: (result: unknown) => void
  getInstance: (instance: AliyunCaptchaInstance) => void
  slideStyle?: {
    width: number
    height: number
  }
  language?: string
  timeout?: number
  rem?: number
  onError?: (errorInfo: AliyunCaptchaInitErrorInfo) => void
  onClose?: () => void
  showErrorTip?: boolean
  delayBeforeSuccess?: boolean
  dualStack?: boolean
  zIndex?: number
  disableMaskClick?: boolean
}

interface AliyunCaptchaBrowserConfig {
  region: AliyunCaptchaRegion
  prefix: string
}

declare global {
  interface Window {
    AliyunCaptchaConfig?: AliyunCaptchaBrowserConfig
    initAliyunCaptcha?: (options: AliyunCaptchaInitOptions) => void
  }
}

export {}
