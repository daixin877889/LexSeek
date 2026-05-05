/**
 * Langfuse 客户端 - 单例 + 兜底
 *
 * - getLangfuseHandler(): 返回 LangChain CallbackHandler 单例
 *     - tracingEnabled=false 或 publicKey/secretKey 缺失 → NoopCallbackHandler（避免无谓的 OTel span 创建开销）
 *     - 初始化抛错 → 也回退到 NoopCallbackHandler
 * - getLangfuseRuntimeConfig(): 返回 runtimeConfig.langfuse 缓存视图
 * - _resetLangfuseClientCache(): 仅供测试清空缓存
 */

import { BaseCallbackHandler } from '@langchain/core/callbacks/base'
import { CallbackHandler } from '@langfuse/langchain'
import type { LangfuseRuntimeConfig } from './types'

let cachedConfig: LangfuseRuntimeConfig | undefined
let cachedHandler: BaseCallbackHandler | undefined

const DEFAULT_CONFIG: LangfuseRuntimeConfig = {
  publicKey: '',
  secretKey: '',
  baseUrl: '',
  tracingEnabled: false,
  maskPII: true,
  environment: 'development',
  gitSha: '',
  exportMode: 'batched',
}

export function getLangfuseRuntimeConfig(): LangfuseRuntimeConfig {
  if (cachedConfig) return cachedConfig
  const raw = (useRuntimeConfig().langfuse as Partial<LangfuseRuntimeConfig> | undefined) ?? {}

  // 兜底从 process.env 直读（Nuxt runtimeConfig 默认值是构建时烤死的；
  // 部署到 FC3 / Lambda / Cloudflare Workers 等场景，控制台只配 LANGFUSE_*（无 NUXT_ 前缀）
  // 时 useRuntimeConfig 取不到——这里直接补一次 process.env 让两种命名都能命中）
  cachedConfig = {
    publicKey: raw.publicKey || process.env.LANGFUSE_PUBLIC_KEY || DEFAULT_CONFIG.publicKey,
    secretKey: raw.secretKey || process.env.LANGFUSE_SECRET_KEY || DEFAULT_CONFIG.secretKey,
    baseUrl: raw.baseUrl || process.env.LANGFUSE_BASE_URL || DEFAULT_CONFIG.baseUrl,
    tracingEnabled: raw.tracingEnabled !== undefined
      ? raw.tracingEnabled
      : process.env.LANGFUSE_TRACING_ENABLED !== undefined
        ? process.env.LANGFUSE_TRACING_ENABLED !== 'false'
        : DEFAULT_CONFIG.tracingEnabled,
    maskPII: raw.maskPII !== undefined
      ? raw.maskPII
      : process.env.LANGFUSE_MASK_PII !== undefined
        ? process.env.LANGFUSE_MASK_PII !== 'false'
        : DEFAULT_CONFIG.maskPII,
    environment: raw.environment
      || (process.env.LANGFUSE_ENVIRONMENT as LangfuseRuntimeConfig['environment'])
      || (process.env.NODE_ENV as LangfuseRuntimeConfig['environment'])
      || DEFAULT_CONFIG.environment,
    gitSha: raw.gitSha || process.env.GIT_SHA || DEFAULT_CONFIG.gitSha,
    exportMode: raw.exportMode
      || (process.env.LANGFUSE_EXPORT_MODE === 'immediate' ? 'immediate' : DEFAULT_CONFIG.exportMode),
  }
  return cachedConfig
}

export function getLangfuseHandler(): BaseCallbackHandler {
  if (cachedHandler) return cachedHandler

  // tracingEnabled=false 或缺凭据 → 直接返回 noop。
  // 真 CallbackHandler 即便 OTel SDK 没启动，handleChainStart 等也会去 startActiveObservation
  // 创建 OTel span（无人 export，纯 CPU/内存浪费）。本地开发关闭监控时本兜底显著省资源。
  const cfg = getLangfuseRuntimeConfig()
  if (!cfg.tracingEnabled || !cfg.publicKey || !cfg.secretKey) {
    cachedHandler = new NoopCallbackHandler()
    return cachedHandler
  }

  try {
    cachedHandler = new CallbackHandler()
  }
  catch (err) {
    logger.warn('[langfuse] CallbackHandler 初始化失败，回退到 noop:', err)
    cachedHandler = new NoopCallbackHandler()
  }
  return cachedHandler
}

class NoopCallbackHandler extends BaseCallbackHandler {
  name = 'NoopLangfuseCallbackHandler'
  // 不 override 任何 handle* 方法；BaseCallbackHandler 的默认实现都是 no-op
}

export function _resetLangfuseClientCache(): void {
  cachedConfig = undefined
  cachedHandler = undefined
}
