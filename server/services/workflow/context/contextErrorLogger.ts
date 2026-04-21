/**
 * 上下文超限错误统一识别 + 结构化日志
 *
 * 调模型失败时，若为 context-overflow 错误，打印足够排查的关键信息；
 * 其它错误原样抛出（或调用方处理）。
 *
 * 覆盖识别：
 * - Anthropic:    400 + "maximum context length" / "prompt is too long"
 * - OpenAI:       400 + "context_length_exceeded"
 * - DeepSeek:     400 + "maximum context length"
 * - 国内兼容 OpenAI 协议的供应商：错误 message 里含 "context" / "token" / "length"
 */
import type { BaseMessage } from '@langchain/core/messages'
import { countTokensSync } from '../../../utils/tokenCounter'

export interface ContextErrorCtx {
    /** 调用源头：agent 名 / service 名 / api handler 名 */
    source: string
    /** 模型名 */
    modelName?: string
    /** SDK 类型（openai / anthropic / deepseek / google 等） */
    sdkType?: string
    /** 配置的 contextWindow（tokens） */
    contextWindow?: number
    /** 系统提示词（用于计算 tokens） */
    systemPrompt?: string
    /** 参与调用的消息列表（用于计算 token 分布） */
    messages?: BaseMessage[]
    /** 额外自定义字段（sessionId / threadId / userId / caseId 等） */
    extra?: Record<string, unknown>
}

/** 判断 error 是否为上下文超限类错误 */
export function isContextOverflowError(error: unknown): boolean {
    if (!error) return false
    const msg = extractErrorMessage(error).toLowerCase()
    if (!msg) return false
    return (
        msg.includes('maximum context length')
        || msg.includes('context_length_exceeded')
        || msg.includes('context length')
        || msg.includes('prompt is too long')
        || msg.includes('context window')
        || msg.includes('too many tokens')
        || msg.includes('exceeds the limit')
        || (msg.includes('token') && msg.includes('exceed'))
    )
}

/** 提取错误信息字符串（兼容 LangChain / Anthropic SDK / 普通 Error 各种嵌套） */
function extractErrorMessage(error: unknown): string {
    if (typeof error === 'string') return error
    if (error instanceof Error) return error.message
    if (typeof error === 'object' && error !== null) {
        const anyErr = error as Record<string, unknown>
        // Anthropic / OpenAI SDK 结构：error.error.message
        const nested = (anyErr.error as Record<string, unknown> | undefined)?.message
        if (typeof nested === 'string') return nested
        if (typeof anyErr.message === 'string') return anyErr.message
        try {
            return JSON.stringify(error)
        } catch {
            return String(error)
        }
    }
    return String(error)
}

/**
 * 计算消息 token 分布摘要（top-N 最长消息）
 */
function summarizeMessages(messages: BaseMessage[]): {
    count: number
    totalTokens: number
    top: Array<{ idx: number, type: string, tokens: number, preview: string }>
} {
    const items = messages.map((msg, idx) => {
        const content = typeof msg.content === 'string'
            ? msg.content
            : JSON.stringify(msg.content)
        const tokens = countTokensSync(content)
        const type = typeof msg.getType === 'function' ? msg.getType() : (msg.constructor?.name ?? 'unknown')
        return {
            idx,
            type,
            tokens,
            preview: content.slice(0, 80).replace(/\s+/g, ' '),
        }
    })
    const totalTokens = items.reduce((sum, m) => sum + m.tokens, 0)
    const top = [...items].sort((a, b) => b.tokens - a.tokens).slice(0, 5)
    return { count: messages.length, totalTokens, top }
}

/**
 * 若 error 为上下文超限，记录结构化错误日志并返回 true；否则返回 false（调用方自行处理）
 */
export function logContextOverflow(error: unknown, ctx: ContextErrorCtx): boolean {
    if (!isContextOverflowError(error)) return false

    const errorMessage = extractErrorMessage(error)
    const systemTokens = ctx.systemPrompt ? countTokensSync(ctx.systemPrompt) : 0
    const msgSummary = ctx.messages ? summarizeMessages(ctx.messages) : undefined

    logger.error('[ContextOverflow] 模型上下文超限', {
        source: ctx.source,
        model: ctx.modelName,
        sdkType: ctx.sdkType,
        contextWindow: ctx.contextWindow,
        systemTokens,
        messagesCount: msgSummary?.count,
        messagesTotalTokens: msgSummary?.totalTokens,
        estimatedTotal: systemTokens + (msgSummary?.totalTokens ?? 0),
        longestMessages: msgSummary?.top,
        errorMessage,
        ...ctx.extra,
    })
    return true
}
