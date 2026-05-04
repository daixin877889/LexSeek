/**
 * Langfuse 客户端 - 单例 + 兜底
 *
 * - getLangfuseHandler(): 返回 LangChain CallbackHandler 单例；初始化失败 → NoopCallbackHandler 空类
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
