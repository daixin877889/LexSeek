/**
 * chatModelFactory ES Proxy 包装
 *
 * - 拦截 invoke / stream / batch / streamEvents 四个方法
 * - 仅注入 RunnableConfig 的 metadata / tags / runName 三件套，**不**注入 callbacks
 *
 * ## 为什么不注入 callbacks
 *
 * LangChain Runnable 内部把 chain 顶层 callbacks 转成 CallbackManager 通过 ALS 自动
 * 传到 child runnable（含 model）。当 model.invoke(input, { callbacks: [...] }) 显式
 * 给了 callbacks，LangChain ensureConfig 视为覆盖 ALS implicit config，把 LangGraph 在
 * streamMode='messages' 下注入到 ALS 的 StreamMessagesHandler 一起挤掉，前端 messages
 * 流随之失效（每个节点结束才一次性拿到 values 快照）。
 *
 * 因此 langfuseHandler 的注入由 chain 顶层 buildLangfuseTopLevelConfig() 统一负责，
 * 通过 ALS 自动传播到 model。本 proxy 只补 metadata + tags + runName。
 *
 * ## 关于 "fallback" 命名的字段（不是 langfuseUserId / langfuseSessionId）
 *
 * langfuse v5 CallbackHandler 的设计：trace 顶层 user_id / session_id 仅在
 * **handleChainStart**（顶层 chain 启动）时通过 propagateAttributes 写入 OTel context。
 * **handleGenerationStart**（model 启动）不调 propagateAttributes，且会通过
 * stripLangfuseKeysFromMetadata 把 metadata.langfuseUserId / langfuseSessionId 主动剔除。
 *
 * 这意味着：**裸 model.invoke（不经过 chain）的 trace 顶层 user_id / session_id 永远填不上**，
 * 不论本 proxy 在 model 层注入多少次。这是 langfuse 设计行为，不是 bug。
 *
 * 本 proxy 仍把 userId / sessionId 写到 metadata，但用 fallback* 前缀命名（不再用
 * langfuseUserId / langfuseSessionId 这两个被 strip 的官方保留 key），避免误以为生效。
 * fallback* 字段会保留在 generation span 的 metadata 中，作为业务 caseId / runId 反查时
 * 的辅助过滤条件。
 *
 * 裸 model 调用如果业务确实需要 trace 顶层 user/session 关联，请在调用点显式
 * `buildLangfuseTopLevelConfig()` 包成顶层 chain（这样会触发 chainStart）。
 *
 * - 不参与 nostream 豁免（统一闸口在 LangfuseSpanProcessor.shouldExportSpan）
 */

import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { RunnableConfig } from '@langchain/core/runnables'
import { buildEntityMetadata, buildEnvTags } from './_metadata'
import { getLangfuseRuntimeConfig } from './client'
import { getLangfuseContext } from './context'

const INTERCEPTED = new Set(['invoke', 'stream', 'batch', 'streamEvents'])

type ProxyConfig = Partial<RunnableConfig> & Record<string, unknown>

export function wrapWithLangfuse<M extends BaseChatModel>(model: M): M {
  // 缓存非拦截方法的 bound 版本：保留引用相等性（proxy.foo === proxy.foo），
  // 避免每次属性访问都新建 bound function 增加 GC 压力。
  const boundCache = new Map<string | symbol, Function>()
  return new Proxy(model, {
    get(target, prop, receiver) {
      const original = Reflect.get(target, prop, receiver)
      if (typeof original !== 'function') return original
      // constructor 必须保持原引用，否则 .bind() 会让 model.constructor.name 变成 'bound ChatOpenAI'
      if (prop === 'constructor') return original
      if (!INTERCEPTED.has(String(prop))) {
        const cached = boundCache.get(prop)
        if (cached) return cached
        const bound = original.bind(target)
        boundCache.set(prop, bound)
        return bound
      }

      return function (this: unknown, input: unknown, config?: ProxyConfig, ...rest: unknown[]) {
        const cfg = getLangfuseRuntimeConfig()
        const ctx = getLangfuseContext()
        const incomingTags: string[] = (config?.tags as string[] | undefined) ?? []

        const mergedConfig: ProxyConfig = {
          ...config,
          runName: config?.runName ?? ctx?.vertical,
          tags: buildEnvTags(ctx?.vertical, cfg, incomingTags),
          metadata: {
            ...(config?.metadata ?? {}),
            // ⚠️ 故意 *不用* langfuseUserId / langfuseSessionId 命名：
            // langfuse v5 会在 handleGenerationStart 把这两个 key 从 generation span
            // metadata 中 strip（它们仅在顶层 chain 的 propagateAttributes 中识别）。
            // 用 fallback* 前缀让 metadata 真正落到 generation span 上做业务反查兜底。
            fallbackUserId: ctx?.userId !== undefined ? String(ctx.userId) : undefined,
            fallbackSessionId: ctx?.sessionId,
            ...buildEntityMetadata(ctx, cfg, ctx?.vertical),
          },
        }

        return original.call(target, input, mergedConfig, ...rest)
      }
    },
  }) as M
}
