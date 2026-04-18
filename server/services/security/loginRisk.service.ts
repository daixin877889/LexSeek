import { createHash } from 'node:crypto'
import { getRequestIP, type H3Event } from 'h3'
import { getRedisClient } from '~~/server/lib/redis'
import { canUseAliyunCaptchaSceneService, getAliyunCaptchaRuntimeConfigService } from '~~/server/services/security/aliyunCaptcha.service'

const PASSWORD_LOGIN_RISK_KEY_PREFIX = 'auth:pwd-login:fail'

function getPasswordLoginRiskConfig() {
  const config = getAliyunCaptchaRuntimeConfigService()
  return {
    enabled:
      config.loginRisk.enable &&
      config.loginRisk.threshold > 0 &&
      config.loginRisk.windowSec > 0 &&
      canUseAliyunCaptchaSceneService('passwordLogin'),
    threshold: config.loginRisk.threshold,
    windowSec: config.loginRisk.windowSec,
  }
}

export function getPasswordLoginRiskIpHashService(event: H3Event): string {
  const ip = getRequestIP(event, { xForwardedFor: true }) || 'unknown'
  if (ip === 'unknown') {
    return ip
  }

  return createHash('sha256').update(ip).digest('hex').slice(0, 16)
}

export function getPasswordLoginRiskKeyService(event: H3Event, phone: string): string {
  return `${PASSWORD_LOGIN_RISK_KEY_PREFIX}:${phone}:${getPasswordLoginRiskIpHashService(event)}`
}

export async function shouldRequirePasswordLoginCaptchaService(
  event: H3Event,
  phone: string
): Promise<boolean> {
  const logger = createLogger('AuthLoginRisk')
  const config = getPasswordLoginRiskConfig()

  if (!config.enabled) {
    return false
  }

  try {
    const redis = getRedisClient()
    const key = getPasswordLoginRiskKeyService(event, phone)
    const count = Number(await redis.get(key) || 0)

    return count >= config.threshold
  } catch (error: any) {
    logger.warn('读取密码登录风控计数失败，跳过本次验证码要求', { error })
    return false
  }
}

export async function recordPasswordLoginFailureService(
  event: H3Event,
  phone: string
): Promise<void> {
  const logger = createLogger('AuthLoginRisk')
  const config = getPasswordLoginRiskConfig()

  if (!config.enabled) {
    return
  }

  try {
    const redis = getRedisClient()
    const key = getPasswordLoginRiskKeyService(event, phone)
    await redis.incr(key)
    await redis.expire(key, config.windowSec)
  } catch (error: any) {
    logger.warn('记录密码登录失败计数失败，已跳过', { error })
  }
}

export async function clearPasswordLoginFailureService(
  event: H3Event,
  phone: string
): Promise<void> {
  const logger = createLogger('AuthLoginRisk')
  const config = getPasswordLoginRiskConfig()

  if (!config.enabled) {
    return
  }

  try {
    const redis = getRedisClient()
    await redis.del(getPasswordLoginRiskKeyService(event, phone))
  } catch (error: any) {
    logger.warn('清理密码登录失败计数失败，已跳过', { error })
  }
}
