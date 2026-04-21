/**
 * 安全截断中间件
 *
 * 作为 summarizationMiddleware 的兜底防线，确保消息列表不超过模型上下文预算。
 *
 * 两道防线：
 * 1. LLM 摘要压缩（compressMessages）：保留 system + 最近 N 轮，中间轮次用摘要替代
 * 2. 强制截断（safetyTrimMessages）：如果摘要压缩后仍超预算，使用 trimMessages 兜底
 *
 * 关键设计：
 * - state.messages 不含 systemPrompt、tools schema、completion 预留
 * - 本地用 tiktoken (cl100k_base) 计数，但模型实际 tokenizer 不同（DeepSeek 中文膨胀 ~1.5x）
 * - 必须对 tiktoken 估算值乘以膨胀系数的倒数，换算为"等效 tiktoken 预算"
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
    /**
     * tiktoken → 模型真实 tokenizer 的膨胀系数
     * DeepSeek: ~1.5（中文为主时 cl100k_base 比模型 tokenizer 低估约 50%）
     * OpenAI/Anthropic: ~1.0（cl100k_base 原生匹配）
     * 未配置时默认 1.5（按最保守估算）
     */
    tokenizerInflation?: number
}

/**
 * 安全截断中间件工厂
 */
export function safetyTrimMiddleware(options: SafetyTrimMiddlewareOptions) {
    const inflation = options.tokenizerInflation ?? 1.5

    // 模型真实 messages 上限 = maxTokens - completion预留(4096) - systemTokens × 膨胀系数
    // 换算为 tiktoken 等效预算：真实上限 / 膨胀系数
    const systemTokens = options.systemPrompt ? countTokensSync(options.systemPrompt) : 0
    const realBudget = Math.max(
        options.maxTokens - 4096 - Math.ceil(systemTokens * inflation),
        10000,
    )
    const tiktokenBudget = Math.floor(realBudget / inflation)

    return createMiddleware({
        name: 'safetyTrimMiddleware',
        stateSchema: z.object({
            _safetyTrimmedCount: z.number().default(0),
        }),
        beforeAgent: {
            hook: async (state: { messages: BaseMessage[] }) => {
                const estimated = estimateMessagesTokens(state.messages)
                if (estimated <= tiktokenBudget) return

                let replacement: BaseMessage[] = state.messages
                try {
                    replacement = await compressMessages(
                        state.messages,
                        tiktokenBudget,
                        options.model,
                    )
                } catch (error) {
                    logger.warn('compressMessages 抛异常（意外路径），降级到 safetyTrim', { error })
                }

                if (estimateMessagesTokens(replacement) > tiktokenBudget) {
                    replacement = await safetyTrimMessages(replacement, tiktokenBudget)
                }

                state.messages.splice(0, state.messages.length, ...replacement)

                logger.info('safetyTrimMiddleware 触发截断', {
                    before: estimated,
                    after: estimateMessagesTokens(replacement),
                    maxTokens: options.maxTokens,
                    systemTokens,
                    inflation,
                    tiktokenBudget,
                    realBudget,
                })
            },
        },
    })
}
