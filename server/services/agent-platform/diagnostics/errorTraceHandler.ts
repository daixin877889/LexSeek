/**
 * agent.stream 错误诊断 callback handler
 *
 * 背景：LangGraph 的 pregel/stream.cjs `_serializeError` 把 graph 内部抛出的错误
 *   只截取 `error.name + error.message` 写到 SSE error 帧，**丢弃 `AggregateError.errors[]`
 *   数组**（多个并行 tool/middleware 同时失败时唯一能定位到根因的字段）。结果用户和
 *   下游 runAndDrainStream 拿到的就是 "AggregateError - Multiple errors occurred during
 *   superstep N" 这种没法排查的字符串。
 *
 * 本 handler 在序列化之前命中 LangChain 标准 `handle*Error` 回调，把完整 Error 对象
 *   （含 .errors / .cause / .stack）以结构化日志写到 server logger。每条日志带
 *   sessionId 用于关联 agent_run + draft 排查。
 *
 * 用法：
 *   const tracer = createErrorTraceHandler({ sessionId, agentName: 'documentMain' })
 *   agent.stream(input, { configurable: { thread_id }, callbacks: [tracer] })
 *
 * 落点选择：仅挂在子代理 / 工具内部 invoke 上，不挂主 agent 的 SSE pipeline——主 agent
 *   错误已通过 agentWorker 写 agent_runs.error 记录；本 handler 专治"工具内 invoke 子流
 *   错误被序列化吞掉"这一类。
 */

import { BaseCallbackHandler } from '@langchain/core/callbacks/base'
import { logger } from '#shared/utils/logger'

interface SerializedError {
    name: string
    message: string
    stack?: string
    cause?: unknown
    /** AggregateError 的内层 errors 递归序列化 */
    errors?: SerializedError[]
}

/** 把任意错误（含 AggregateError 嵌套）结构化为可写 logger 的形态 */
function serialize(err: unknown, depth = 0): SerializedError {
    if (depth > 5) return { name: 'TooDeeplyNested', message: '...' }
    if (!(err instanceof Error)) {
        return { name: 'NonError', message: String(err) }
    }
    const out: SerializedError = {
        name: err.name,
        message: err.message,
        stack: err.stack?.split('\n').slice(0, 8).join('\n'),
    }
    // AggregateError 标准字段
    const errors = (err as AggregateError).errors
    if (Array.isArray(errors) && errors.length > 0) {
        out.errors = errors.map(e => serialize(e, depth + 1))
    }
    // ES2022 Error.cause 链
    const cause = (err as Error & { cause?: unknown }).cause
    if (cause !== undefined) {
        out.cause = cause instanceof Error ? serialize(cause, depth + 1) : String(cause)
    }
    return out
}

interface ErrorTraceContext {
    /** 关联的 sessionId / threadId，用于跨日志关联 */
    sessionId: string
    /** Agent 名称，区分 documentMain / contractReviewMain / 子代理工具调用等 */
    agentName: string
    /** 可选的额外业务字段（draftId / reviewId / caseId 等） */
    extra?: Record<string, unknown>
}

class ErrorTraceHandler extends BaseCallbackHandler {
    readonly name = 'ErrorTraceHandler'
    private readonly ctx: ErrorTraceContext

    constructor(ctx: ErrorTraceContext) {
        super()
        this.ctx = ctx
    }

    override handleLLMError(err: Error, runId: string, _parentRunId?: string, tags?: string[]): void {
        // 内部 LLM 调用（intentClassifier / invokeNodeJson）已带 'internal' tag，
        // 它们自己在 service 层就记过详细日志，这里跳过避免重复噪声
        if (Array.isArray(tags) && tags.includes('internal')) return
        logger.error('[ErrorTrace] LLM error', {
            ...this.ctx,
            runId,
            tags,
            error: serialize(err),
        })
    }

    override handleChainError(err: Error, runId: string, _parentRunId?: string, tags?: string[]): void {
        logger.error('[ErrorTrace] Chain error', {
            ...this.ctx,
            runId,
            tags,
            error: serialize(err),
        })
    }

    override handleToolError(err: Error, runId: string, _parentRunId?: string, tags?: string[]): void {
        logger.error('[ErrorTrace] Tool error', {
            ...this.ctx,
            runId,
            tags,
            error: serialize(err),
        })
    }
}

export function createErrorTraceHandler(ctx: ErrorTraceContext): BaseCallbackHandler {
    return new ErrorTraceHandler(ctx)
}
