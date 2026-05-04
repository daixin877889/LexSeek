/**
 * Langfuse RunnableConfig helper
 *
 * 按 Langfuse 官方文档（JS/TS SDK Trace Attributes）：
 *   await chain.invoke(input, {
 *     callbacks: [langfuseHandler],
 *     runName: traceName,
 *     tags,
 *     metadata: { langfuseUserId, langfuseSessionId },
 *   })
 *
 * ## 命名解释（防误用）
 *
 * 仅 **顶层 chain 入口**（业务侧第一次调用 workflow.stream / agent.stream / agent.invoke
 * / chain.invoke 的地方，且其上没有任何父 LangChain Runnable 在跑）才允许调用本 helper。
 *
 * **子 chain 内调用本 helper 会出 bug**：`callbacks: [langfuseHandler]` 会被 LangChain
 * `ensureConfig` 视为覆盖 ALS 中的 implicit config，把父 graph 通过 ALS 注入的
 * `StreamMessagesHandler`（streamMode='messages' 时用于 emit token chunks）一并挤掉，
 * 导致前端流式输出失效（每个节点结束才一次性渲染）。详见：
 * - tests/server/langfuse/modelProxy.langgraph-stream.test.ts 的反向回归
 * - 历史 commit：runAnalysisSubAgent 修复
 *
 * **正确做法**：
 *
 * - 顶层 chain（caseAnalysisV2.executor / agent-platform runtime / moduleAgent /
 *   assistantAgent / documentMainAgent / contractReviewMainAgent / 裸 model 调用）：
 *   ```ts
 *   await chain.stream(input, {
 *     configurable: { thread_id },
 *     ...buildLangfuseTopLevelConfig({ vertical: 'case-analysis' }),
 *   })
 *   ```
 *
 * - 子 chain（在父 graph 节点函数内调子 agent，如 runAnalysisSubAgent）：
 *   **不传任何 langfuse config**。让父 graph 通过 ALS 自动传 callbacks 给子 chain。
 *   trace metadata（caseId / runId / vertical 等）由 modelProxy 在 model 层兜底注入。
 *   ```ts
 *   const response = await childAgent.invoke(input, { recursionLimit: 1000, signal })
 *   //                                                ^ 不要 spread buildLangfuseTopLevelConfig
 *   ```
 *
 * - 业务在外层用 `withLangfuseContext({ vertical, caseId, ... })` 包裹整段执行，
 *   modelProxy 从 ALS 取这些字段写到 generation span 的 metadata（trace 反查用）。
 *
 * ## 实现细节
 *
 * 业务侧通常已经在外层包了 withLangfuseContext，本 helper 直接从 ALS 取上下文即可，
 * 无需重复传 userId/sessionId/runId 等。
 */

import type { Callbacks } from '@langchain/core/callbacks/manager'
import type { RunnableConfig } from '@langchain/core/runnables'
import { getLangfuseHandler, getLangfuseRuntimeConfig } from './client'
import { getLangfuseContext } from './context'
import { deriveScope } from './types'
import type { LangfuseVertical } from './types'

export type LangfuseConfigOverride = {
  /** 强制覆盖 vertical（默认从 ALS 取；用于 ALS 上层 vertical 与本次调用的 vertical 不同的场景） */
  vertical?: LangfuseVertical
  /** 业务原有的 callbacks（如 errorTraceHandler / subAgentCallbacks），与 langfuseHandler 合并 */
  additionalCallbacks?: Callbacks
}

/**
 * 构造**顶层 chain** 的 RunnableConfig 片段：包含 callbacks (含 langfuseHandler) +
 * runName + tags + metadata。仅顶层入口调用，子 chain **禁止使用**（见文件顶部说明）。
 *
 * 用法：
 *
 * ```ts
 * await agent.stream(input, {
 *   configurable: { thread_id: ctx.sessionId },
 *   streamMode: 'messages',
 *   ...buildLangfuseTopLevelConfig({ vertical: 'case-analysis' }),
 * })
 * ```
 */
export function buildLangfuseTopLevelConfig(
  override?: LangfuseConfigOverride,
): Partial<RunnableConfig> {
  const handler = getLangfuseHandler()
  const cfg = getLangfuseRuntimeConfig()
  const ctx = getLangfuseContext()

  const vertical = override?.vertical ?? ctx?.vertical
  const tags: string[] = [vertical, cfg.environment]
    .filter((t): t is NonNullable<typeof t> => Boolean(t))
    .map(String)

  const metadata: Record<string, unknown> = {
    // 官方文档约定 camelCase；LangChain CallbackHandler 在 handleChainStart 识别这两个字段，
    // 写到 trace 顶层 user_id / session_id（仅顶层 chain 路径生效）
    langfuseUserId: ctx?.userId !== undefined ? String(ctx.userId) : undefined,
    langfuseSessionId: ctx?.sessionId,
    // 业务自由 metadata（反查 / 过滤用）
    requestId: ctx?.requestId,
    runId: ctx?.runId,
    caseId: ctx?.caseId,
    reviewId: ctx?.reviewId,
    draftId: ctx?.draftId,
    materialId: ctx?.materialId,
    businessScope: vertical ? deriveScope(vertical) : undefined,
    gitSha: cfg.gitSha,
    environment: cfg.environment,
  }
  for (const k of Object.keys(metadata)) {
    if (metadata[k] === undefined) delete metadata[k]
  }

  const extraCallbacks = override?.additionalCallbacks
  const callbacks: Callbacks = Array.isArray(extraCallbacks)
    ? [handler, ...extraCallbacks]
    : extraCallbacks
      ? [handler, extraCallbacks]
      : [handler]

  return {
    callbacks,
    runName: vertical,
    tags,
    metadata,
  }
}
