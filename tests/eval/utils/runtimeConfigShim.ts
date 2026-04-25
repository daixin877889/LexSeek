/**
 * Nuxt useRuntimeConfig polyfill for bun runtime.
 *
 * 项目业务代码（agentEventBridge / agentWorker / smsVerification 等）依赖 Nuxt 注入的
 * 全局 useRuntimeConfig()。eval 跑在裸 bun runtime（非 Nuxt server scope），需要 shim。
 *
 * 注：此 shim **必须在所有业务代码 import 之前先 import**（runEval.ts 顶部第一行）。
 */

const config = {
  public: {
    logLevel: process.env.NUXT_PUBLIC_LOG_LEVEL ?? 'INFO',
    baseUrl: process.env.NUXT_PUBLIC_BASE_URL ?? '',
    wechatAppId: process.env.NUXT_PUBLIC_WECHAT_APP_ID ?? '',
    wechatAuthCallbackUrl: process.env.NUXT_PUBLIC_WECHAT_AUTH_CALLBACK_URL ?? '',
  },
  wechat: { mpSecret: '', authRedirectWhitelist: '' },
  aliyun: {
    accessKeyId: process.env.NUXT_ALIYUN_ACCESS_KEY_ID ?? '',
    accessKeySecret: process.env.NUXT_ALIYUN_ACCESS_KEY_SECRET ?? '',
    captcha: {
      enable: false, region: 'cn', prefix: '', dualStack: false, scriptSrc: '',
      sceneIds: { loginSms: '', registerSms: '', resetPasswordSms: '', passwordLogin: '' },
      loginRisk: { enable: false, threshold: 3, windowSec: 900 },
    },
    sms: {
      enable: false, signName: '', templateCaptchaCode: '',
      rateLimitMs: 60, codeExpireMs: 300, maxFailures: 5, lockDurationMs: 900,
    },
    oss: { callbackUrl: '', main: { bucket: '', basePath: '' } },
  },
  jwt: { secret: process.env.NUXT_JWT_SECRET ?? 'lexseek_jwt_secret', expiresIn: '30d' },
  auth: { cookieName: 'auth_token', cookieMaxAge: 2592000 },
  wechatPay: { mchId: '', apiV3Key: '', serialNo: '', privateKey: '', platformCert: '', notifyUrl: '' },
  embedding: {
    apiKey: process.env.NUXT_EMBEDDING_API_KEY ?? '',
    baseUrl: process.env.NUXT_EMBEDDING_BASE_URL ?? '',
    model: process.env.NUXT_EMBEDDING_MODEL ?? 'text-embedding-v3',
    dimensions: parseInt(process.env.NUXT_EMBEDDING_DIMENSIONS ?? '1536', 10),
    batchSize: parseInt(process.env.NUXT_EMBEDDING_BATCH_SIZE ?? '5', 10),
  },
  agent: {
    maxConcurrent: 3, maxUserConcurrent: 2, timeoutMs: 3600000,
    heartbeatIntervalMs: 15000, crashThresholdMs: 60000,
    databaseUrl: process.env.NUXT_AGENT_DATABASE_URL ?? '',
    pendingQueueMax: 500000, pendingQueueTtlMs: 10 * 60 * 1000,
  },
  redis: { url: process.env.NUXT_REDIS_URL ?? '' },
  storage: { defaultType: 'aliyun_oss', callbackUrl: '' },
}

;(globalThis as any).useRuntimeConfig = function useRuntimeConfig() {
  return config
}

// 注入 logger（Nuxt 项目通过 imports 自动注入到全局，bun runtime 没这魔法）
import { logger } from '~~/shared/utils/logger'
;(globalThis as any).logger = logger

// 注入 prisma / resSuccess / resError 兜底（项目 server scope 自动导入，eval 在 tests/ 下需手工）
import { prisma } from '~~/server/utils/db'
;(globalThis as any).prisma = prisma
