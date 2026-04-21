/**
 * 合同审查 SSE 事件发送器
 *
 * 封装 publishCustomEvent 的调用，包装成 AgentCustomEvent 形态。
 * 前端 useStreamChat.onCustomEvent(data) 接收到的 data 即此处发出的 ContractReviewEvent。
 *
 * 采用 ctx 对象 + event 两参的形态（与项目现有 tool context 模式一致，见
 * `server/services/workflow/tools/saveAnalysisResult.tool.ts:101`）。
 */
import { publishCustomEvent } from '~~/server/services/agent/agentEventBridge'
import type { ContractReviewEvent } from '#shared/types/contract'

const EVENT_NAME = 'contract_review'

/** emitter 上下文：包含 runId + sessionId，由调用方构造一次后传递 */
export interface ContractReviewEmitterCtx {
    runId: string
    sessionId: string
}

/**
 * 发送合同审查事件（fire-and-forget，失败仅记日志，不阻塞主流程）
 */
export async function emitContractReviewEvent(
    ctx: ContractReviewEmitterCtx,
    event: ContractReviewEvent,
): Promise<void> {
    try {
        await publishCustomEvent({
            type: 'custom_event',
            runId: ctx.runId,
            sessionId: ctx.sessionId,
            name: EVENT_NAME,
            data: event,
        })
    } catch (err) {
        logger.warn('emitContractReviewEvent 发送失败', {
            sessionId: ctx.sessionId,
            runId: ctx.runId,
            eventType: event.type,
            err,
        })
    }
}
