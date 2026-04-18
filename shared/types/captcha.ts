export const ALIYUN_CAPTCHA_SCENE_KEYS = [
  'loginSms',
  'registerSms',
  'resetPasswordSms',
  'passwordLogin',
] as const

export type AliyunCaptchaSceneKey = (typeof ALIYUN_CAPTCHA_SCENE_KEYS)[number]

export type AliyunCaptchaRegion = 'cn' | 'sgp'

export interface AliyunCaptchaSceneIds {
  loginSms: string
  registerSms: string
  resetPasswordSms: string
  passwordLogin: string
}

export interface AliyunCaptchaClientConfig {
  enabled: boolean
  region: AliyunCaptchaRegion
  prefix: string
  scriptSrc: string
  sceneIds: AliyunCaptchaSceneIds
}
