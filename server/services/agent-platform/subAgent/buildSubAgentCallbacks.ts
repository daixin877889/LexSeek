/**
 * 构造 LangChain Callbacks 旁路转发子 Agent 内部事件到主 SSE 流。
 *
 * 与 useStreamChat.subThreadsMap 协议对齐：metadata.parentToolCallId 是分桶 key，
 * 前端按此命中并累积 messages，让 SubAgentChainOfThought 自动渲染。
 *
 * 旧 subAgentToolFactory 内联实现漏了 handleChainError，本 helper 一并补齐：
 * 子代理 chain 抛错时主流也能收到 status='failed' 让 CoT 显示红徽章。
 */
import type { CallbackHandlerMethods, HandleLLMNewTokenCallbackFields } from '@langchain/core/callbacks/base'
import { BaseMessage } from '@langchain/core/messages'
import { publishCustomEvent, publishStatusChange } from '~~/server/services/agent/agentEventBridge'
import { SSECustomEventType } from '#shared/types/agentEvent'
import { logger } from '#shared/utils/logger'

/**
 * 从 ChatGenerationChunk 提取 thinking/reasoning 增量。
 *
 * Anthropic extended thinking：chunk.message.content 是 array 含
 *   { type:'thinking', thinking:'...' } 或 { type:'reasoning', reasoning:'...' } block
 * DeepSeek-Reasoner / OpenAI o1：chunk.message.additional_kwargs.reasoning_content
 *
 * extractToken（@langchain/anthropic chat_models.js:84）三个分支都不匹配 thinking 块时
 * 返回 undefined → handleLLMNewToken 第一参数 token 是空字符串 → 思考内容完全丢失。
 * 这里从第 6 参数 fields.chunk 直接拿到完整 chunk 解析。
 */
function extractThinkingDelta(fields: HandleLLMNewTokenCallbackFields | undefined): string {
    const message = (fields?.chunk as { message?: { content?: unknown, additional_kwargs?: Record<string, unknown> } } | undefined)?.message
    if (!message) return ''
    // 路径 1：DeepSeek/o1 把 reasoning 放 additional_kwargs.reasoning_content（string 增量）
    const ak = message.additional_kwargs
    if (ak && typeof ak.reasoning_content === 'string' && ak.reasoning_content.length > 0) {
        return ak.reasoning_content
    }
    // 路径 2：Anthropic 把 thinking 放 content array 里
    if (Array.isArray(message.content)) {
        const parts: string[] = []
        for (const block of message.content as Array<Record<string, unknown>>) {
            if (!block || typeof block !== 'object') continue
            const t = block.type
            if (t === 'thinking' && typeof block.thinking === 'string') parts.push(block.thinking)
            else if (t === 'reasoning' && typeof block.reasoning === 'string') parts.push(block.reasoning)
        }
        if (parts.length > 0) return parts.join('')
    }
    return ''
}

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
        async handleLLMNewToken(
            token: string,
            _idx: unknown,
            cbRunId: string,
            _parentRunId?: string,
            _tags?: string[],
            fields?: HandleLLMNewTokenCallbackFields,
        ) {
            // 1. text 增量（不含 thinking — 见 extractThinkingDelta 注释）
            if (token) {
                await publishCustomEvent({
                    type: 'custom_event',
                    runId: mainRunId,
                    sessionId,
                    name: SSECustomEventType.SUB_AGENT_TOKEN,
                    data: undefined,
                    metadata: { ...meta, messageId: cbRunId, delta: token },
                }).catch((e: unknown) => logger.warn('publishCustomEvent(SUB_AGENT_TOKEN) failed', { e }))
            }

            // 2. thinking 增量（独立事件，前端累到 additional_kwargs.reasoning_content）
            const thinkingDelta = extractThinkingDelta(fields)
            if (thinkingDelta) {
                await publishCustomEvent({
                    type: 'custom_event',
                    runId: mainRunId,
                    sessionId,
                    name: SSECustomEventType.SUB_AGENT_THINKING_TOKEN,
                    data: undefined,
                    metadata: { ...meta, messageId: cbRunId, delta: thinkingDelta },
                }).catch((e: unknown) => logger.warn('publishCustomEvent(SUB_AGENT_THINKING_TOKEN) failed', { e }))
            }
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
            // createAgent 路径下 output 是 ToolMessage 实例；直接 JSON.stringify 会得到
            // lc_serializable 形态让前端拿不到真实结果。提取 .content 字段送给前端。
            const realOutput: unknown = output instanceof BaseMessage ? output.content : output
            await publishCustomEvent({
                type: 'custom_event',
                runId: mainRunId,
                sessionId,
                name: SSECustomEventType.SUB_AGENT_TOOL_END,
                data: { cbRunId, output: realOutput },
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
