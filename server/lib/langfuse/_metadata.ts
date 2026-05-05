/**
 * Langfuse 内部 helper：metadata / tags 公共构造（不导出 barrel）
 *
 * - buildEntityMetadata: 9 个共享的实体 / 环境字段（不含 user/session 变体）
 * - buildEnvTags: [...extraTags, vertical, environment] 过滤空值
 *
 * 调用方在外面叠加自己的 user/session 变体（modelProxy 用 fallbackUserId/SessionId、
 * runnableConfig 用 langfuseUserId/SessionId）；undefined 清理由调用方按需决定。
 */

import type { LangfuseRuntimeConfig, LangfuseTraceContext, LangfuseVertical } from './types'
import { deriveScope } from './types'

export function buildEntityMetadata(
  ctx: LangfuseTraceContext | undefined,
  cfg: LangfuseRuntimeConfig,
  vertical: LangfuseVertical | undefined,
): Record<string, unknown> {
  return {
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
}

export function buildEnvTags(
  vertical: LangfuseVertical | undefined,
  cfg: LangfuseRuntimeConfig,
  extraTags: string[] = [],
): string[] {
  return [...extraTags, vertical, cfg.environment].filter((t): t is string => Boolean(t))
}
