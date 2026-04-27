/**
 * 合同审查 SSE 事件发送器
 *
 * 封装 publishCustomEvent 的调用，包装成 AgentCustomEvent 形态。
 * 前端 useStreamChat.onCustomEvent(data) 接收到的 data 即此处发出的 ContractReviewEvent。
 *
 * 采用 ctx 对象 + event 两参的形态（与项目现有 tool context 模式一致，见
 * `server/services/workflow/tools/saveAnalysisResult.tool.ts:101`）。
 *
 * 阶段 4：支持平台注入 emitter（platformEmit）。当 ctx.platformEmit 存在时优先使用，
 * 否则回退到自调 publishCustomEvent（向后兼容现有测试 mock 与未接入平台的调用方）。
 */
import { publishCustomEvent } from '~~/server/services/agent/agentEventBridge'
import type { ContractReviewEvent } from '#shared/types/contract'

const EVENT_NAME = 'contract_review'

/** emitter 上下文：包含 runId + sessionId，由调用方构造一次后传递 */
export interface ContractReviewEmitterCtx {
    runId: string
    sessionId: string
    /** 阶段 4：平台注入的 emitter，存在时优先调用；不存在时 fallback 自调 publishCustomEvent */
    platformEmit?: (event: { name: string; data: unknown }) => Promise<void>
}

/**
 * 发送合同审查事件（fire-and-forget，失败仅记日志，不阻塞主流程）
 */
export async function emitContractReviewEvent(
    ctx: ContractReviewEmitterCtx,
    event: ContractReviewEvent,
): Promise<void> {
    try {
        if (ctx.platformEmit) {
            // 阶段 4：走平台 emitter，统一 SSE 桥
            await ctx.platformEmit({ name: EVENT_NAME, data: event })
            return
        }
        // 向后兼容：测试或未接平台时直接调 publishCustomEvent
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
