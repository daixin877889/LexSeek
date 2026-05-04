/**
 * chatModelFactory ES Proxy 包装
 *
 * - 拦截 invoke / stream / batch / streamEvents 四个方法
 * - 从 ALS 取业务上下文，注入 RunnableConfig：
 *     - runName 顶层（trace 列表可读名）
 *     - tags 顶层（含 vertical + environment；'langfuse:nostream' 由 SpanProcessor 豁免）
 *     - metadata.langfuse{User,Session}Id camelCase
 *     - metadata 业务自由字段（runId / requestId / caseId / ... / scope / gitSha）
 *     - callbacks 追加 langfuseHandler
 * - 不参与 nostream 豁免（统一闸口在 LangfuseSpanProcessor.shouldExportSpan）
 */

import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { RunnableConfig } from '@langchain/core/runnables'
import { getLangfuseHandler, getLangfuseRuntimeConfig } from './client'
import { getLangfuseContext } from './context'
import { deriveScope } from './types'

const INTERCEPTED = new Set(['invoke', 'stream', 'batch', 'streamEvents'])

type ProxyConfig = Partial<RunnableConfig> & Record<string, unknown>

export function wrapWithLangfuse<M extends BaseChatModel>(model: M): M {
  return new Proxy(model, {
    get(target, prop, receiver) {
      const original = Reflect.get(target, prop, receiver)
      if (typeof original !== 'function') return original
      if (!INTERCEPTED.has(String(prop))) return original.bind(target)

      return function (this: unknown, input: unknown, config?: ProxyConfig, ...rest: unknown[]) {
        const handler = getLangfuseHandler()
        const cfg = getLangfuseRuntimeConfig()
        const ctx = getLangfuseContext()
        const incomingTags: string[] = (config?.tags as string[] | undefined) ?? []

        const mergedTags = [
          ...incomingTags,
          ctx?.vertical,
          cfg.environment,
        ].filter((t): t is string => Boolean(t))

        const mergedConfig: ProxyConfig = {
          ...config,
          runName: config?.runName ?? ctx?.vertical,
          tags: mergedTags,
          callbacks: [...((config?.callbacks as unknown[] | undefined) ?? []), handler],
          metadata: {
            ...(config?.metadata ?? {}),
            langfuseUserId: ctx?.userId !== undefined ? String(ctx.userId) : undefined,
            langfuseSessionId: ctx?.sessionId,
            requestId: ctx?.requestId,
            runId: ctx?.runId,
            caseId: ctx?.caseId,
            reviewId: ctx?.reviewId,
            draftId: ctx?.draftId,
            materialId: ctx?.materialId,
            scope: ctx?.vertical ? deriveScope(ctx.vertical) : undefined,
            gitSha: cfg.gitSha,
            environment: cfg.environment,
          },
        }

        return original.call(target, input, mergedConfig, ...rest)
      }
    },
  }) as M
}
