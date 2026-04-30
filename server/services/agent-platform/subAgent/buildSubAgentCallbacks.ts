/**
 * 构造 LangChain Callbacks 旁路转发子 Agent 内部事件到主 SSE 流。
 *
 * 与 useStreamChat.subThreadsMap 协议对齐：metadata.parentToolCallId 是分桶 key，
 * 前端按此命中并累积 messages，让 SubAgentChainOfThought 自动渲染。
 *
 * 旧 subAgentToolFactory 内联实现漏了 handleChainError，本 helper 一并补齐：
 * 子代理 chain 抛错时主流也能收到 status='failed' 让 CoT 显示红徽章。
 */
import type { CallbackHandlerMethods } from '@langchain/core/callbacks/base'
import { publishCustomEvent, publishStatusChange } from '~~/server/services/agent/agentEventBridge'
import { SSECustomEventType } from '#shared/types/agentEvent'
import { logger } from '#shared/utils/logger'

export interface BuildSubAgentCallbacksOptions {
    /** 主 Agent run id（agentRuns.id） */
    mainRunId: string
    /** 主 caseMain / assistantMain sessionId */
    sessionId: string
    /** 主 tool_call.id（前端按此分桶到 subThreadsMap） */
    parentToolCallId: string
    /** 子 Agent 显示名（如 'documentMain' / 'contractReviewMain' / 'evidence_expert'） */
    agentName: string
    /** 子 thread id */
    subThreadId: string
}

export function buildSubAgentCallbacks(opts: BuildSubAgentCallbacksOptions): CallbackHandlerMethods[] {
    const { mainRunId, sessionId, parentToolCallId, agentName, subThreadId } = opts
    const meta = { agentName, threadId: subThreadId, parentToolCallId }

    return [{
        async handleLLMNewToken(token: string, _idx: unknown, cbRunId: string) {
            await publishCustomEvent({
                type: 'custom_event',
                runId: mainRunId,
                sessionId,
                name: SSECustomEventType.SUB_AGENT_TOKEN,
                data: undefined,
                metadata: { ...meta, messageId: cbRunId, delta: token },
            }).catch((e: unknown) => logger.warn('publishCustomEvent(SUB_AGENT_TOKEN) failed', { e }))
        },
        async handleToolStart(
            _tool: unknown, input: string, cbRunId: string,
            _parentRunId?: string, _tags?: string[], _metadata?: Record<string, unknown>,
            runName?: string, innerToolCallId?: string,
        ) {
            const toolName: string = runName ?? 'unknown_tool'
            await publishCustomEvent({
                type: 'custom_event',
                runId: mainRunId,
                sessionId,
                name: SSECustomEventType.SUB_AGENT_TOOL_START,
                data: { innerToolCallId, input, cbRunId, toolName },
                metadata: meta,
            }).catch((e: unknown) => logger.warn('publishCustomEvent(SUB_AGENT_TOOL_START) failed', { e }))
        },
        async handleToolEnd(output: unknown, cbRunId: string) {
            await publishCustomEvent({
                type: 'custom_event',
                runId: mainRunId,
                sessionId,
                name: SSECustomEventType.SUB_AGENT_TOOL_END,
                data: { cbRunId, output },
                metadata: meta,
            }).catch((e: unknown) => logger.warn('publishCustomEvent(SUB_AGENT_TOOL_END) failed', { e }))
        },
        async handleChainEnd(_outputs: unknown, _cbRunId: string, cbParentRunId?: string) {
            // 仅 root chain（无 parent）才视为整个子流结束
            if (cbParentRunId !== undefined) return
            await publishStatusChange({
                type: 'status_change',
                runId: mainRunId,
                sessionId,
                status: 'completed',
                metadata: meta,
            }).catch((e: unknown) => logger.warn('publishStatusChange(sub completed) failed', { e }))
        },
        async handleChainError(error: Error, _cbRunId: string, cbParentRunId?: string) {
            if (cbParentRunId !== undefined) return
            // 防御：LangChain 类型签名是 Error，但运行时可能存在非 Error 值（字符串等）
            const message = error instanceof Error ? error.message : String(error)
            await publishStatusChange({
                type: 'status_change',
                runId: mainRunId,
                sessionId,
                status: 'failed',
                error: message,
                metadata: meta,
            }).catch((e: unknown) => logger.warn('publishStatusChange(sub failed) failed', { e }))
        },
    }]
}
