import type { AliyunCaptchaSceneKey } from '#shared/types/captcha'

export const ALIYUN_CAPTCHA_BASE_WIDTH = 360

export function getAliyunCaptchaDomIds(scene: AliyunCaptchaSceneKey) {
  return {
    elementId: `lexseek-aliyun-captcha-${scene}-element`,
    buttonId: `lexseek-aliyun-captcha-${scene}-button`,
  }
}
