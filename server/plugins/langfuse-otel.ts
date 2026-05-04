/**
 * Langfuse OpenTelemetry NodeSDK 启动 + 关闭
 *
 * - tracingEnabled=false → 直接 skip 不启 SDK（测试 / 显式禁用）
 * - publicKey/secretKey/baseUrl 缺失 → 也 skip（避免本地缺配置时启动报错）
 * - LangfuseSpanProcessor 配 mask 钩子（v5: data 是 stringified JSON，整段 redactPII）
 *   + shouldExportSpan 钩子（nostream 豁免）
 * - prod 环境强制 maskPII=true（即使 env 写 false 也忽略）
 * - Nitro close hook 内 await nodeSdk.shutdown() 刷新未上送 span
 */

import { LangfuseSpanProcessor } from '@langfuse/otel'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { getLangfuseRuntimeConfig } from '~~/server/lib/langfuse/client'
import { redactPII } from '~~/server/lib/langfuse/redactPII'

let nodeSdk: NodeSDK | undefined

export default defineNitroPlugin((nitroApp) => {
  const cfg = getLangfuseRuntimeConfig()

  if (!cfg.tracingEnabled) {
    logger.info('[langfuse] tracing 已禁用（LANGFUSE_TRACING_ENABLED=false）')
    return
  }

  if (!cfg.publicKey || !cfg.secretKey || !cfg.baseUrl) {
    logger.warn('[langfuse] 配置不完整（publicKey / secretKey / baseUrl），跳过 tracing 初始化')
    return
  }

  // prod 强制开启 maskPII；其它环境按 env 决定
  const enableMask = cfg.environment === 'production' ? true : cfg.maskPII

  const spanProcessor = new LangfuseSpanProcessor({
    publicKey: cfg.publicKey,
    secretKey: cfg.secretKey,
    baseUrl: cfg.baseUrl,
    environment: cfg.environment,
    // v5 SDK：data 是 stringified JSON 字符串，整段调 redactPII 即可
    mask: enableMask
      ? ({ data }: { data: string }) => redactPII(data)
      : undefined,
    shouldExportSpan: ({ otelSpan }) => {
      const tags = otelSpan.attributes['langfuse.trace.tags'] as string[] | undefined
      return !tags?.includes('langfuse:nostream')
    },
  })

  nodeSdk = new NodeSDK({ spanProcessors: [spanProcessor] })

  try {
    nodeSdk.start()
    logger.info('[langfuse] OTel NodeSDK 已启动', {
      baseUrl: cfg.baseUrl,
      environment: cfg.environment,
      maskPII: enableMask,
    })
  }
  catch (err) {
    logger.warn('[langfuse] OTel NodeSDK 启动失败:', err)
    nodeSdk = undefined
    return
  }

  nitroApp.hooks.hook('close', async () => {
    if (!nodeSdk) return
    try {
      await nodeSdk.shutdown()
      logger.info('[langfuse] OTel NodeSDK 关闭完成')
    }
    catch (err) {
      logger.warn('[langfuse] OTel NodeSDK 关闭异常:', err)
    }
  })
})
