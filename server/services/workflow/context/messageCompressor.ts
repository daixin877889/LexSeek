/**
 * 消息压缩器
 *
 * 为 innerGraph 的 callModel 节点提供上下文压缩能力
 * 所有压缩仅影响传给 LLM 的输入，不修改 state 中的消息
 *
 * 三道防线：
 * 1. 预防控制（由 toolResultTruncator 和 materialPipeline 负责）
 * 2. 动态摘要（本模块 compressMessages）
 * 3. trimMessages 兜底（本模块 safetyTrimMessages）
 */

import { trimMessages } from '@langchain/core/messages'
import { HumanMessage, type BaseMessage, isAIMessage } from '@langchain/core/messages'
import { estimateTokens } from '../../material/materialPipeline.service'

/** 默认上下文预算 100K tokens */
const DEFAULT_CONTEXT_BUDGET = 100000

/** 压缩触发阈值为预算的 60% */
const COMPRESS_RATIO = 0.6

/** 保留最近 N 轮消息不压缩（1 轮 = AI + tool_call + tool_response） */
const KEEP_RECENT_ROUNDS = 3

/**
 * 估算消息列表的总 token 数
 *
 * 用于粗判是否需要压缩（快速，基于字符估算）
 */
export function estimateMessagesTokens(messages: BaseMessage[]): number {
    return messages.reduce((sum, m) => {
        const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
        return sum + estimateTokens(content) + 10 // +10 for message overhead
    }, 0)
}

/**
 * 根据模型配置获取上下文预算
 */
export function getContextBudget(contextWindow?: number): {
    budget: number
    compressThreshold: number
} {
    const windowSize = contextWindow ?? DEFAULT_CONTEXT_BUDGET
    const budget = Math.floor(windowSize * 0.8) // 预留 20% 给输出
    const compressThreshold = Math.floor(budget * COMPRESS_RATIO)
    return { budget, compressThreshold }
}

/**
 * 压缩消息列表
 *
 * 保留 system message + 最近 N 轮消息
 * 将中间的工具调用轮次用 LLM 生成结构化摘要替代
 * 仅返回压缩后的副本，不修改原始消息
 *
 * @param messages 完整消息列表
 * @param budget 上下文 token 预算
 * @param model 用于生成摘要的模型实例（复用当前模块模型）
 */
export async function compressMessages(
    messages: BaseMessage[],
    budget: number,
    model: any,
): Promise<BaseMessage[]> {
    if (messages.length <= KEEP_RECENT_ROUNDS * 3 + 2) {
        // 消息太少，不需要压缩
        return messages
    }

    // 分离：system message, 中间消息, 最近 N 轮
    const systemMessage = messages[0]! // system prompt 始终在第一位
    const recentCount = KEEP_RECENT_ROUNDS * 3 // 每轮约 3 条消息
    const recentMessages = messages.slice(-recentCount)
    const middleMessages = messages.slice(1, -recentCount)

    if (middleMessages.length === 0) {
        return messages
    }

    // 用模型生成中间消息的摘要
    try {
        const summaryPrompt = buildSummaryPrompt(middleMessages)
        const summaryResponse = await model.invoke([
            { role: 'system', content: '你是一个信息压缩助手。请将以下工具调用和对话内容压缩为结构化摘要，保留所有关键发现和数据点。' },
            new HumanMessage(summaryPrompt),
        ])

        const summaryContent = typeof summaryResponse.content === 'string'
            ? summaryResponse.content
            : JSON.stringify(summaryResponse.content)

        const summaryMessage = new HumanMessage(
            `[以下是之前工具调用和分析过程的摘要]\n${summaryContent}`,
        )

        return [systemMessage, summaryMessage, ...recentMessages]
    } catch (error) {
        logger.warn('消息摘要压缩失败，回退到 trimMessages', { error })
        // 摘要失败，直接返回原始消息，让 safetyTrimMessages 兜底
        return messages
    }
}

/**
 * trimMessages 安全网
 *
 * 确保消息列表不超过模型上下文预算
 * 使用字符估算的 token 计数函数（ChatAnthropic 不兼容 js-tiktoken）
 */
export async function safetyTrimMessages(
    messages: BaseMessage[],
    budget: number,
): Promise<BaseMessage[]> {
    // 先粗判是否需要裁剪
    const estimate = estimateMessagesTokens(messages)
    if (estimate <= budget) return messages

    // 使用自定义 token 计数器（避免 js-tiktoken 的 Unknown model 警告）
    try {
        return await trimMessages(messages, {
            strategy: 'last',
            maxTokens: budget,
            startOn: 'human',
            endOn: ['human', 'tool'],
            tokenCounter: (msgs) => msgs.reduce((sum, m) => {
                const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
                return sum + estimateTokens(content) + 10
            }, 0),
        })
    } catch (error) {
        logger.warn('trimMessages 失败，使用字符估算裁剪', { error })
        return trimByEstimation(messages, budget)
    }
}

/** 基于字符估算的裁剪（最后兜底，始终保留 system message） */
function trimByEstimation(messages: BaseMessage[], budget: number): BaseMessage[] {
    if (messages.length === 0) return messages

    // 始终保留 system message（第一条）
    const systemMsg = messages[0]
    if (!systemMsg) return messages
    const systemContent = typeof systemMsg.content === 'string' ? systemMsg.content : JSON.stringify(systemMsg.content)
    let totalTokens = estimateTokens(systemContent) + 10
    const result: BaseMessage[] = [systemMsg]

    // 从后往前保留其余消息，确保最近的消息优先
    const rest: BaseMessage[] = []
    for (let i = messages.length - 1; i >= 1; i--) {
        const msg = messages[i]
        if (!msg) continue
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
        const tokens = estimateTokens(content) + 10
        if (totalTokens + tokens > budget && rest.length > 0) break
        rest.unshift(msg)
        totalTokens += tokens
    }

    return [...result, ...rest]
}

/** 构建摘要提示词 */
function buildSummaryPrompt(messages: BaseMessage[]): string {
    const lines: string[] = ['请将以下对话内容压缩为结构化摘要：\n']

    for (const msg of messages) {
        const type = msg.getType?.() ?? 'unknown'
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)

        if (type === 'ai' && isAIMessage(msg) && msg.tool_calls?.length) {
            lines.push(`[AI 调用工具] ${msg.tool_calls.map(tc => tc.name).join(', ')}`)
        } else if (type === 'tool') {
            // 截断过长的工具返回
            const truncated = content.length > 2000 ? content.slice(0, 2000) + '...(截断)' : content
            lines.push(`[工具返回] ${truncated}`)
        } else if (type === 'ai') {
            lines.push(`[AI 回复] ${content.slice(0, 500)}${content.length > 500 ? '...' : ''}`)
        } else {
            lines.push(`[${type}] ${content.slice(0, 300)}${content.length > 300 ? '...' : ''}`)
        }
    }

    lines.push('\n请输出结构化摘要，格式：\n[工具调用摘要] 查询了XXX，发现：（1）...（2）...')
    return lines.join('\n')
}
