/**
 * 安全截断中间件
 *
 * 作为 summarizationMiddleware 的兜底防线，确保消息列表不超过模型上下文预算。
 *
 * 两道防线：
 * 1. LLM 摘要压缩（compressMessages）：保留 system + 最近 N 轮，中间轮次用摘要替代
 * 2. 强制截断（safetyTrimMessages）：如果摘要压缩后仍超预算，使用 trimMessages 兜底
 *
 * 注意：
 * - compressMessages 不抛异常（消息过少、middle 为空、摘要失败时静默返回原消息）
 *   → 降级触发条件必须使用"压缩后是否仍超预算"而非 try-catch
 * - 使用 splice 原地修改 state.messages，对齐项目现有中间件写法（避免 Proxy 问题）
 * - state.messages 不含 createAgent 的 systemPrompt，但模型调用时 LangChain 会把
 *   systemPrompt 拼在最前；需从 maxTokens 预算里扣除 systemPrompt 的 tokens，
 *   否则截断后叠加 systemPrompt 仍会超出模型真实上限
 */

import { createMiddleware } from 'langchain'
import { z } from 'zod'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { BaseMessage } from '@langchain/core/messages'
import {
    compressMessages,
    safetyTrimMessages,
    estimateMessagesTokens,
} from '../context/messageCompressor'
import { countTokensSync } from '../../../utils/tokenCounter'

export interface SafetyTrimMiddlewareOptions {
    /** 用于生成摘要的模型实例（复用当前 Agent 模型） */
    model: BaseChatModel
    /** 上下文 token 预算上限（通常为 contextWindow * 0.8） */
    maxTokens: number
    /** 系统提示词文本（createAgent 的 systemPrompt）；用于从预算里扣除其 tokens */
    systemPrompt?: string
}

/**
 * 安全截断中间件工厂
 */
export function safetyTrimMiddleware(options: SafetyTrimMiddlewareOptions) {
    // 预计算 systemPrompt 的 tokens，从 maxTokens 里扣除；保底预算 10000 tokens
    const systemTokens = options.systemPrompt ? countTokensSync(options.systemPrompt) : 0
    const effectiveBudget = Math.max(options.maxTokens - systemTokens, 10000)

    return createMiddleware({
        name: 'safetyTrimMiddleware',
        stateSchema: z.object({
            _safetyTrimmedCount: z.number().default(0),
        }),
        beforeAgent: {
            hook: async (state: { messages: BaseMessage[] }) => {
                const estimated = estimateMessagesTokens(state.messages)
                if (estimated <= effectiveBudget) return

                let replacement: BaseMessage[] = state.messages
                try {
                    replacement = await compressMessages(
                        state.messages,
                        effectiveBudget,
                        options.model,
                    )
                } catch (error) {
                    logger.warn('compressMessages 抛异常（意外路径），降级到 safetyTrim', { error })
                }

                if (estimateMessagesTokens(replacement) > effectiveBudget) {
                    replacement = await safetyTrimMessages(replacement, effectiveBudget)
                }

                state.messages.splice(0, state.messages.length, ...replacement)

                logger.info('safetyTrimMiddleware 触发截断', {
                    before: estimated,
                    after: estimateMessagesTokens(replacement),
                    maxTokens: options.maxTokens,
                    systemTokens,
                    effectiveBudget,
                })
            },
        },
    })
}
