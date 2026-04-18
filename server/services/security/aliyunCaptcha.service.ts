import CaptchaClient, { VerifyIntelligentCaptchaRequest } from '@alicloud/captcha20230305'
import { $OpenApiUtil } from '@alicloud/openapi-core'
import type { AliyunCaptchaClientConfig, AliyunCaptchaRegion, AliyunCaptchaSceneIds, AliyunCaptchaSceneKey } from '#shared/types/captcha'

const CAPTCHA_SCRIPT_SRC = 'https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js'
const CAPTCHA_SUCCESS_CODES = new Set(['T001', 'T005'])

const CAPTCHA_ENDPOINTS: Record<AliyunCaptchaRegion, { ipv4: string; dualStack: string }> = {
  cn: {
    ipv4: 'captcha.cn-shanghai.aliyuncs.com',
    dualStack: 'captcha-dualstack.cn-shanghai.aliyuncs.com',
  },
  sgp: {
    ipv4: 'captcha.ap-southeast-1.aliyuncs.com',
    dualStack: 'captcha-dualstack.ap-southeast-1.aliyuncs.com',
  },
}

interface AliyunCaptchaRuntimeConfig {
  enable: boolean
  region: AliyunCaptchaRegion
  prefix: string
  dualStack: boolean
  scriptSrc: string
  sceneIds: AliyunCaptchaSceneIds
  loginRisk: {
    enable: boolean
    threshold: number
    windowSec: number
  }
}

export interface VerifyAliyunCaptchaResult {
  success: boolean
  providerCode: string | null
  providerMessage: string
  verifyCode: string | null
  requestId: string | null
  certifyId: string | null
}

let captchaClient: CaptchaClient | null = null
let captchaClientSignature: string | null = null

export function resolveAliyunCaptchaEndpoint(
  region: AliyunCaptchaRegion,
  dualStack: boolean
): string {
  const endpoints = CAPTCHA_ENDPOINTS[region]
  return dualStack ? endpoints.dualStack : endpoints.ipv4
}

export function getAliyunCaptchaRuntimeConfigService(): AliyunCaptchaRuntimeConfig {
  const config = useRuntimeConfig()
  const captcha = config.aliyun.captcha

  return {
    enable: Boolean(captcha.enable),
    region: captcha.region === 'sgp' ? 'sgp' : 'cn',
    prefix: captcha.prefix?.trim() || '',
    dualStack: Boolean(captcha.dualStack),
    scriptSrc: captcha.scriptSrc?.trim() || CAPTCHA_SCRIPT_SRC,
    sceneIds: {
      loginSms: captcha.sceneIds.loginSms?.trim() || '',
      registerSms: captcha.sceneIds.registerSms?.trim() || '',
      resetPasswordSms: captcha.sceneIds.resetPasswordSms?.trim() || '',
      passwordLogin: captcha.sceneIds.passwordLogin?.trim() || '',
    },
    loginRisk: {
      enable: Boolean(captcha.loginRisk.enable),
      threshold: Math.max(Number(captcha.loginRisk.threshold) || 0, 0),
      windowSec: Math.max(Number(captcha.loginRisk.windowSec) || 0, 0),
    },
  }
}

export function getAliyunCaptchaSceneIdService(sceneKey: AliyunCaptchaSceneKey): string {
  return getAliyunCaptchaRuntimeConfigService().sceneIds[sceneKey] || ''
}

export function canUseAliyunCaptchaSceneService(sceneKey: AliyunCaptchaSceneKey): boolean {
  const config = useRuntimeConfig()
  const captchaConfig = getAliyunCaptchaRuntimeConfigService()

  return Boolean(
    captchaConfig.enable &&
      captchaConfig.prefix &&
      getAliyunCaptchaSceneIdService(sceneKey) &&
      config.aliyun.accessKeyId &&
      config.aliyun.accessKeySecret
  )
}

export function getAliyunCaptchaClientConfigService(): AliyunCaptchaClientConfig {
  const config = getAliyunCaptchaRuntimeConfigService()
  const runtimeConfig = useRuntimeConfig()

  return {
    enabled: Boolean(
      config.enable &&
        config.prefix &&
        runtimeConfig.aliyun.accessKeyId &&
        runtimeConfig.aliyun.accessKeySecret
    ),
    region: config.region,
    prefix: config.prefix,
    scriptSrc: config.scriptSrc,
    sceneIds: config.sceneIds,
  }
}

function getCaptchaClient(): CaptchaClient {
  const logger = createLogger('AliyunCaptcha')
  const config = useRuntimeConfig()
  const captchaConfig = getAliyunCaptchaRuntimeConfigService()
  const endpoint = resolveAliyunCaptchaEndpoint(captchaConfig.region, captchaConfig.dualStack)
  const signature = `${config.aliyun.accessKeyId}:${endpoint}`

  if (!captchaClient || captchaClientSignature !== signature) {
    if (!config.aliyun.accessKeyId || !config.aliyun.accessKeySecret) {
      throw new Error('阿里云验证码 AccessKey 未配置')
    }

    const openApiConfig = new $OpenApiUtil.Config({
      accessKeyId: config.aliyun.accessKeyId,
      accessKeySecret: config.aliyun.accessKeySecret,
      endpoint,
      protocol: 'https',
    })

    captchaClient = new CaptchaClient(openApiConfig)
    captchaClientSignature = signature
    logger.info('阿里云验证码客户端已初始化', {
      endpoint,
      region: captchaConfig.region,
      dualStack: captchaConfig.dualStack,
    })
  }

  return captchaClient
}

export async function verifyAliyunCaptchaService({
  captchaVerifyParam,
  sceneKey,
}: {
  captchaVerifyParam: string
  sceneKey: AliyunCaptchaSceneKey
}): Promise<VerifyAliyunCaptchaResult> {
  const logger = createLogger('AliyunCaptcha')
  const sceneId = getAliyunCaptchaSceneIdService(sceneKey)

  if (!canUseAliyunCaptchaSceneService(sceneKey) || !sceneId || !captchaVerifyParam?.trim()) {
    return {
      success: false,
      providerCode: null,
      providerMessage: '验证码配置不完整或缺少验证参数',
      verifyCode: null,
      requestId: null,
      certifyId: null,
    }
  }

  try {
    const client = getCaptchaClient()
    const request = new VerifyIntelligentCaptchaRequest({
      captchaVerifyParam,
      sceneId,
    })
    const response = await client.verifyIntelligentCaptcha(request)
    const body = response.body
    const verifyCode = body?.result?.verifyCode || null
    const verifyResult = body?.result?.verifyResult === true
    const success = body?.success === true && verifyResult && Boolean(verifyCode && CAPTCHA_SUCCESS_CODES.has(verifyCode))

    if (!success) {
      logger.warn('阿里云验证码校验未通过', {
        sceneKey,
        requestId: body?.requestId,
        verifyCode,
        providerCode: body?.code,
        providerMessage: body?.message,
      })
    }

    return {
      success,
      providerCode: body?.code || null,
      providerMessage: body?.message || '验证码校验失败',
      verifyCode,
      requestId: body?.requestId || null,
      certifyId: body?.result?.certifyId || null,
    }
  } catch (error: any) {
    logger.error('阿里云验证码校验异常', {
      sceneKey,
      error,
    })

    return {
      success: false,
      providerCode: null,
      providerMessage: error?.message || '验证码校验失败',
      verifyCode: null,
      requestId: null,
      certifyId: null,
    }
  }
}
