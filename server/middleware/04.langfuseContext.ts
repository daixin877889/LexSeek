/**
 * Langfuse 上下文中间件（在 01.requestId / 02.auth / 03.permission 之后）
 *
 * 用 enterWith 起 ALS 根上下文：requestId + userId（可空）。
 * 后续业务节点用 withLangfuseContext 增量补 sessionId / runId / 业务实体 ID / vertical。
 */

import { enterLangfuseContext } from '~~/server/lib/langfuse/context'

export default defineEventHandler((event) => {
  enterLangfuseContext({
    requestId: event.context.requestId ?? '',
    userId: event.context.auth?.user?.id,
  })
})
