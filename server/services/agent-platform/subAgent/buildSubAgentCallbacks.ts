/**
 * 构造 LangChain Callbacks 旁路转发子 Agent 内部事件到主 SSE 流。
 *
 * 与 useStreamChat.subThreadsMap 协议对齐：metadata.parentToolCallId 是分桶 key，
 * 前端按此命中并累积 messages，让 SubAgentChainOfThought 自动渲染。
 *
 * 仅负责 token / tool_start / tool_end 三类增量事件转发；
 * status_change（completed / failed）的发送由调用方在 invoke / drainStream 完成后
 * 通过 publishSubAgentStatus 显式发——callback 内的 handleChainEnd 在
 * LangGraph 多层 chain 包装下 cbParentRunId === undefined 不止匹配最外层
 * （某个 inner LLM/RunnableSequence 也是 root level chain），子代理还在跑就发
 * completed 会让前端 generatingModules 提前清空、跨标签同步丢"生成中"状态。
 */
import type { CallbackHandlerMethods, HandleLLMNewTokenCallbackFields } from '@langchain/core/callbacks/base'
import { BaseMessage } from '@langchain/core/messages'
import { publishCustomEvent } from '~~/server/services/agent/agentEventBridge'
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
        // status_change 不在 callback 内发：handleChainEnd 在 LangGraph 内部多层
        // chain 中 cbParentRunId === undefined 不止匹配最外层（subAgent 还在跑就触发
        // completed → 前端 bucket.status 提前翻 completed → generatingModules 清空 →
        // 跨标签广播 modules=[]）。所有子代理工具（subAgentToolFactory /
        // reviewContract / draftDocument）已经在 invoke / drainStream 完成后显式调
        // publishSubAgentStatus，callback 这里再发是冗余且时机错误。
    }]
}
