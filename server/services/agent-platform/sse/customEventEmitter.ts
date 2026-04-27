/**
 * 通用 customEvent emitter 工厂
 *
 * 包装 publishCustomEvent 把 runId/sessionId 绑定在闭包里，
 * 业务调用时只需给出 { name, data }，避免 6 个业务 vertical
 * 各自重复 "造 emitterCtx + 调 publishCustomEvent" 模板。
 *
 * @see docs/superpowers/plans/2026-04-27-ai-unify-stage-4-contract-platform.md Task 3
 */

import { publishCustomEvent } from '~~/server/services/agent/agentEventBridge'

export interface CustomEventEmitter {
    (event: { name: string; data: unknown }): Promise<void>
}

export interface EmitterFactoryOptions {
    runId: string | undefined
    sessionId: string
}

/**
 * 创建一个绑定 runId/sessionId 的 customEvent 发射函数。
 *
 * 失败语义：fire-and-forget，仅 log warn 不抛错（与现有 emitContractReviewEvent 一致）。
 */
export function createCustomEventEmitter(opts: EmitterFactoryOptions): CustomEventEmitter {
    const { runId, sessionId } = opts
    return async ({ name, data }) => {
        try {
            await publishCustomEvent({
                type: 'custom_event',
                runId: runId ?? 'unknown',
                sessionId,
                name,
                data,
            })
        } catch (err) {
            logger.warn('[customEventEmitter] publishCustomEvent failed', {
                name,
                runId,
                sessionId,
                err: err instanceof Error ? err.message : String(err),
            })
        }
    }
}
