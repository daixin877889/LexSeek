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
 * - replacement 初始化为 state.messages 避免 null 状态，消除 TS 类型收窄问题
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

export interface SafetyTrimMiddlewareOptions {
    /** 用于生成摘要的模型实例（复用当前 Agent 模型） */
    model: BaseChatModel
    /** 上下文 token 预算上限（通常为 contextWindow * 0.8） */
    maxTokens: number
}

/**
 * 安全截断中间件工厂
 *
 * 使用 estimateMessagesTokens（同步字符估算）做快速预判，
 * 实际截断由 compressMessages / safetyTrimMessages 执行。
 */
export function safetyTrimMiddleware(options: SafetyTrimMiddlewareOptions) {
    return createMiddleware({
        name: 'safetyTrimMiddleware',
        // 使用带 `_` 前缀的私有字段，LangChain 会自动将其从 invoke 输入中过滤，
        // 避免 z.object({}) 推导出 Record<string, never> 与其他中间件 state 合并时产生矛盾
        stateSchema: z.object({
            _safetyTrimmedCount: z.number().default(0),
        }),
        beforeAgent: {
            hook: async (state: { messages: BaseMessage[] }) => {
                const estimated = estimateMessagesTokens(state.messages)
                if (estimated <= options.maxTokens) return

                // 防线一：LLM 摘要压缩
                // 初始化为原消息，避免 null 状态，使 TS 无需跨变量控制流追踪
                let replacement: BaseMessage[] = state.messages
                try {
                    replacement = await compressMessages(
                        state.messages,
                        options.maxTokens,
                        options.model,
                    )
                } catch (error) {
                    // 防御性编程：compressMessages 内部已 catch，此处仅兜底意外路径
                    logger.warn('compressMessages 抛异常（意外路径），降级到 safetyTrim', { error })
                    // replacement 保持 state.messages
                }

                // 防线二：压缩后仍超预算 → 强制截断
                if (estimateMessagesTokens(replacement) > options.maxTokens) {
                    replacement = await safetyTrimMessages(replacement, options.maxTokens)
                }

                // 使用 splice 原地替换，与项目现有中间件写法一致
                state.messages.splice(0, state.messages.length, ...replacement)

                logger.info('safetyTrimMiddleware 触发截断', {
                    before: estimated,
                    after: estimateMessagesTokens(replacement),
                    budget: options.maxTokens,
                })
            },
        },
    })
}
