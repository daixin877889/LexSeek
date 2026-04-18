import { getAliyunCaptchaClientConfigService } from '~~/server/services/security/aliyunCaptcha.service'

export default defineEventHandler(() => {
  return getAliyunCaptchaClientConfigService()
})
