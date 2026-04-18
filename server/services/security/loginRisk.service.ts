import { createHash } from 'node:crypto'
import { getRequestIP, type H3Event } from 'h3'
import { getRedisClient } from '~~/server/lib/redis'
import { canUseAliyunCaptchaSceneService, getAliyunCaptchaRuntimeConfigService } from '~~/server/services/security/aliyunCaptcha.service'

const PASSWORD_LOGIN_RISK_KEY_PREFIX = 'auth:pwd-login:fail'

export interface PasswordLoginCaptchaRequirement {
  requireCaptcha: boolean
  degraded: boolean
}

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
): Promise<PasswordLoginCaptchaRequirement> {
  const logger = createLogger('AuthLoginRisk')
  const config = getPasswordLoginRiskConfig()

  if (!config.enabled) {
    return {
      requireCaptcha: false,
      degraded: false,
    }
  }

  try {
    const redis = getRedisClient()
    const key = getPasswordLoginRiskKeyService(event, phone)
    const count = Number(await redis.get(key) || 0)

    return {
      requireCaptcha: count >= config.threshold,
      degraded: false,
    }
  } catch (error: any) {
    logger.warn('读取密码登录风控计数失败，已降级为强制验证码', { error })
    return {
      requireCaptcha: true,
      degraded: true,
    }
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
    const results = await redis.multi()
      .incr(key)
      .expire(key, config.windowSec)
      .exec()

    if (!results || results.some(([commandError]) => commandError)) {
      throw results?.find(([commandError]) => commandError)?.[0]
        || new Error('密码登录失败计数写入失败')
    }
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
