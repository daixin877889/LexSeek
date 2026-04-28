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
 *
 * 关于 buildContextSegments 多段 cache_control 的兼容性（P2-M2 验证结论）：
 * - 各 agent 通过 buildContextSegments + toCachedPrompt 构造的多段 SystemMessage
 *   （含 Anthropic cache_control 1h/5m 断点）作为 createAgent({ systemPrompt }) 参数传入。
 * - LangChain ReactAgent 内部由 normalizeSystemPrompt 转为 #systemMessage 私有字段（见
 *   node_modules/langchain/dist/agents/nodes/AgentNode.js#invokeModel），调用模型时再
 *   prepend 到 messages，不写入 state.messages。
 * - beforeAgent hook 拿到的 state.messages 不含这条 SystemMessage，因此本中间件的
 *   compressMessages / safetyTrimMessages 不会触碰多段 cache_control 内容。
 * - options.systemPrompt 仅用于纯文本 token 估算（计入 budget 扣除），不会被回写或重建为
 *   传给模型的 SystemMessage。综上：本中间件与多段 cache_control 完全兼容，无需特殊处理。
 */

import { createMiddleware } from 'langchain'
import { z } from 'zod'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { BaseMessage } from '@langchain/core/messages'
import {
    compressMessages,
    safetyTrimMessages,
    estimateMessagesTokens,
} from '~~/server/services/workflow/context/messageCompressor'
import { countTokensSync } from '~~/server/utils/tokenCounter'

export interface SafetyTrimMiddlewareOptions {
    /** 用于生成摘要的模型实例（复用当前 Agent 模型） */
    model: BaseChatModel
    /** 上下文 token 预算上限（通常为 contextWindow * 0.8） */
    maxTokens: number
    /** 系统提示词文本（createAgent 的 systemPrompt）；用于从预算里扣除其 tokens */
    systemPrompt?: string
    /**
     * 模型单次调用最大输出 tokens（nodes 表模型的 maxOutputTokens）。
     * 未配置时默认 8192。safetyTrim 会从 input budget 里扣除这部分，保证 output 有足够余量。
     * 例如 deepseek-reasoner 可以到 64K，若不扣除，模型大概率因 input+output>contextWindow 被拒。
     */
    maxOutputTokens?: number
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
    const outputReserve = options.maxOutputTokens ?? 8192

    // 模型真实 messages 上限 = maxTokens - output 预留 - systemTokens × 膨胀系数
    // output 预留随模型而变：deepseek-chat=8K / deepseek-reasoner=64K / claude=64K...
    // 换算为 tiktoken 等效预算：真实上限 / 膨胀系数
    const systemTokens = options.systemPrompt ? countTokensSync(options.systemPrompt) : 0
    const realBudget = Math.max(
        options.maxTokens - outputReserve - Math.ceil(systemTokens * inflation),
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

                let afterTokens = estimateMessagesTokens(replacement)
                if (afterTokens > tiktokenBudget) {
                    replacement = await safetyTrimMessages(replacement, tiktokenBudget)
                    afterTokens = estimateMessagesTokens(replacement)
                }

                state.messages.splice(0, state.messages.length, ...replacement)

                logger.info('safetyTrimMiddleware 触发截断', {
                    before: estimated,
                    after: afterTokens,
                    maxTokens: options.maxTokens,
                    outputReserve,
                    systemTokens,
                    inflation,
                    tiktokenBudget,
                    realBudget,
                })
            },
        },
    })
}
