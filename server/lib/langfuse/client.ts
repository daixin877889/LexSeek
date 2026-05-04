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
}

export function getLangfuseRuntimeConfig(): LangfuseRuntimeConfig {
  if (cachedConfig) return cachedConfig
  const raw = useRuntimeConfig().langfuse as Partial<LangfuseRuntimeConfig> | undefined
  cachedConfig = { ...DEFAULT_CONFIG, ...raw }
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
