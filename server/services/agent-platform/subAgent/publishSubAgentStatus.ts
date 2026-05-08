/**
 * 子流 status_change 兜底发布
 *
 * 为什么需要：buildSubAgentCallbacks.handleChainEnd 在 LangGraph 多层 chain 包装下
 * cbParentRunId 不一定 undefined，status_change 永不触发 → 前端 CoT 卡"思考中…"
 * 且不会触发 hydrate。各子代理工具（subAgentToolFactory / draftDocument /
 * reviewContract）在 stream drain 完成后调用本函数显式补发 completed/failed。
 *
 * 必须 await（agent-platform.md 铁律：子代理 SSE 事件不可 fire-and-forget），
 * .catch 兜底仅用于防止 broker 抖动抛错冲断主流程。
 */

import { publishStatusChange } from '~~/server/services/agent/agentEventBridge'

export interface PublishSubAgentStatusOptions {
    runId: string
    sessionId: string
    status: 'completed' | 'failed'
    /** failed 时填错误描述，completed 时省略 */
    error?: string
    /** 用于前端按 parentToolCallId 路由到对应 sub bucket */
    agentName: string
    threadId: string
    parentToolCallId: string
}

export async function publishSubAgentStatus(opts: PublishSubAgentStatusOptions): Promise<void> {
    await publishStatusChange({
        type: 'status_change',
        runId: opts.runId,
        sessionId: opts.sessionId,
        status: opts.status,
        ...(opts.status === 'failed' && opts.error !== undefined ? { error: opts.error } : {}),
        metadata: {
            agentName: opts.agentName,
            threadId: opts.threadId,
            parentToolCallId: opts.parentToolCallId,
        },
    }).catch((err: unknown) => logger.warn(`publishStatusChange(sub ${opts.status}) 失败`, { err }))
}
