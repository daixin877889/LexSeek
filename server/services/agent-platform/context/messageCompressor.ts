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
import { countTokensSync } from '~~/server/utils/tokenCounter'
import { buildLangfuseTopLevelConfig } from '~~/server/lib/langfuse'
import { collectToolUsesFromContent } from '~~/server/services/workflow/repairOrphanToolUse'

/** 默认上下文窗口（tokens）：主流模型的保守默认，agent 和 compressor 统一使用 */
export const DEFAULT_CONTEXT_WINDOW = 128000

/** 压缩触发阈值为预算的 60% */
const COMPRESS_RATIO = 0.6

/** 保留最近 N 轮消息不压缩（1 轮 = AI + tool_call + tool_response） */
const KEEP_RECENT_ROUNDS = 3

/** 计算单条消息的 token 数（tiktoken cl100k_base，fallback 为字符估算） */
function countMessageTokens(msg: BaseMessage): number {
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
    return countTokensSync(content) + 10 // +10 for message overhead
}

/** 计算消息列表的总 token 数，用于判断是否需要压缩 */
export function estimateMessagesTokens(messages: BaseMessage[]): number {
    return messages.reduce((sum, m) => sum + countMessageTokens(m), 0)
}

/**
 * 根据模型配置获取上下文预算
 *
 * 返回消息压缩的 budget 和 compressThreshold
 */
export function getContextBudget(contextWindow?: number): {
    budget: number
    compressThreshold: number
} {
    const windowSize = contextWindow ?? DEFAULT_CONTEXT_WINDOW
    const budget = Math.floor(windowSize * 0.8) // 预留 20% 给输出
    const compressThreshold = Math.floor(budget * COMPRESS_RATIO)
    return { budget, compressThreshold }
}

/** 单次输出 tokens 保底值（模型未配置 maxOutputTokens 时使用） */
export const DEFAULT_MAX_OUTPUT_TOKENS = 8192

/**
 * 统一计算 Agent 上下文压缩参数
 *
 * 所有 agent 文件统一调用此函数，避免魔法数字分散在各处。
 *
 * @param contextWindow nodes 表中的 model.contextWindow（可能为 undefined/null）
 * @param maxOutputTokens 模型最大输出 tokens（可选，用于给下游 safetyTrim 预留 output 预算）
 * @returns
 *   - contextWindow     实际使用的窗口大小（含保底值）
 *   - triggerTokens     summarizationMiddleware 触发阈值（60%，下限 30k）
 *   - maxTokens         safetyTrimMiddleware 截断上限（80%）
 *   - maxOutputTokens   模型最大输出 tokens（含保底值 8192），供下游预留 output 预算
 */
export function resolveContextWindow(
    contextWindow?: number | null,
    maxOutputTokens?: number | null,
): {
    contextWindow: number
    triggerTokens: number
    maxTokens: number
    maxOutputTokens: number
} {
    const window = contextWindow || DEFAULT_CONTEXT_WINDOW
    return {
        contextWindow: window,
        triggerTokens: Math.max(Math.floor(window * 0.6), 30000),
        maxTokens: Math.floor(window * 0.8),
        maxOutputTokens: maxOutputTokens || DEFAULT_MAX_OUTPUT_TOKENS,
    }
}

/**
 * 单轮 ReAct 最多新增的消息条数（AI + 若干 tool_result + AI 结束）
 * 用于摘要缓存的"增量容忍度"——新 middle 只增加这么多条（全是之前在 recent 段里 AI 已经看过的），
 * 可以复用上一次的摘要，跳过 LLM 调用。
 */
const CACHE_REUSE_DELTA_LIMIT = KEEP_RECENT_ROUNDS * 3

/**
 * 切出"被压缩段"和"保留段"，用于摘要缓存命中判断
 *
 * 约定：压缩永远保留 system（第 1 条） + 最近 KEEP_RECENT_ROUNDS 轮。
 * middleMessages 就是被 LLM 摘要掉的那段；对其 message id 集合做比对，
 * 若相邻 ReAct 轮次里新 middleIds 是旧的严格超集且新增不多，就复用上一次的摘要，不重新调 LLM。
 *
 * @returns
 *   - systemMessage   第 1 条 system 消息（必保留）
 *   - middleMessages  被摘要的中间段
 *   - recentMessages  最近 N 轮（必保留）
 *   - middleIds       middleMessages 的 id 集合（无 id 消息会被过滤）
 */
export function sliceForCompression(messages: BaseMessage[]): {
    systemMessage: BaseMessage | undefined
    middleMessages: BaseMessage[]
    recentMessages: BaseMessage[]
    middleIds: string[]
} {
    if (messages.length <= KEEP_RECENT_ROUNDS * 3 + 2) {
        return {
            systemMessage: messages[0],
            middleMessages: [],
            recentMessages: messages.slice(1),
            middleIds: [],
        }
    }

    const systemMessage = messages[0]
    const recentCount = KEEP_RECENT_ROUNDS * 3
    // 与 compressMessages 完全一致的切点边界对齐逻辑：避免 recentMessages 以 ToolMessage 起始
    let recentStart = Math.max(1, messages.length - recentCount)
    while (recentStart > 1 && messages[recentStart]?.getType?.() === 'tool') {
        recentStart--
    }
    const recentMessages = messages.slice(recentStart)
    const middleMessages = messages.slice(1, recentStart)

    const middleIds = middleMessages
        .map(m => m.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)

    return { systemMessage, middleMessages, recentMessages, middleIds }
}

/**
 * 判断"新一轮的 middleIds 是否可以复用已有摘要缓存"
 *
 * 命中条件（两个必须同时满足）：
 *   1. 旧 middleIds 全部出现在新 middleIds 中（严格超集，消息没被删/改）
 *   2. 新增条数 ≤ CACHE_REUSE_DELTA_LIMIT（约等于一轮 ReAct 产物，属于"AI 上一轮在 recent 里看过的内容"）
 *
 * 没命中时应重新调用 LLM 摘要并更新缓存。
 */
export function canReuseSummaryCache(oldMiddleIds: string[], newMiddleIds: string[]): boolean {
    if (oldMiddleIds.length === 0) return false
    if (newMiddleIds.length < oldMiddleIds.length) return false

    const delta = newMiddleIds.length - oldMiddleIds.length
    if (delta > CACHE_REUSE_DELTA_LIMIT) return false

    const newIdSet = new Set(newMiddleIds)
    return oldMiddleIds.every(id => newIdSet.has(id))
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
    // 切点边界对齐：若起点落在 ToolMessage 上，向前回退跳过它，避免拼接后
    // recentMessages 以孤立 tool_result 起始（与 Anthropic tool_use ↔ tool_result
    // 配对约束冲突，否则返回 400 invalid_request_error）。
    let recentStart = Math.max(1, messages.length - recentCount)
    while (recentStart > 1 && messages[recentStart]?.getType?.() === 'tool') {
        recentStart--
    }
    const recentMessages = messages.slice(recentStart)
    const middleMessages = messages.slice(1, recentStart)

    if (middleMessages.length === 0) {
        return messages
    }

    // 用模型生成中间消息的摘要
    try {
        const summaryPrompt = buildSummaryPrompt(middleMessages)
        // 裸 model 调用：显式注入 langfuseHandler，并通过 langfuse:nostream tag 让
        // SpanProcessor 豁免本条 generation 上报（内部上下文压缩调用不进 Langfuse trace）。
        const lfConfig = buildLangfuseTopLevelConfig()
        const summaryResponse = await model.invoke(
            [
                { role: 'system', content: '你是一个信息压缩助手。请将以下工具调用和对话内容压缩为结构化摘要，保留所有关键发现和数据点。' },
                new HumanMessage(summaryPrompt),
            ],
            { ...lfConfig, tags: [...(lfConfig.tags ?? []), 'langfuse:nostream', 'internal'] },
        )

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
    preEstimate?: number,
): Promise<BaseMessage[]> {
    // 使用预计算值或重新估算
    const estimate = preEstimate ?? estimateMessagesTokens(messages)
    if (estimate <= budget) return messages

    // 直接传入函数而非 model name，避免 js-tiktoken "Unknown model" 警告
    try {
        return await trimMessages(messages, {
            strategy: 'last',
            maxTokens: budget,
            startOn: 'human',
            endOn: ['human', 'tool'],
            tokenCounter: (msgs) => msgs.reduce((sum, m) => sum + countMessageTokens(m), 0),
        })
    } catch (error) {
        logger.warn('trimMessages 失败，使用字符估算裁剪', { error })
        return trimByEstimation(messages, budget)
    }
}

/** trimMessages 抛异常时的兜底裁剪（始终保留 system message） */
function trimByEstimation(messages: BaseMessage[], budget: number): BaseMessage[] {
    if (messages.length === 0) return messages

    const systemMsg = messages[0]
    if (!systemMsg) return messages
    let totalTokens = countMessageTokens(systemMsg)
    const result: BaseMessage[] = [systemMsg]

    // 从后往前保留其余消息（push + reverse 避免 unshift 的 O(n²)）
    const rest: BaseMessage[] = []
    for (let i = messages.length - 1; i >= 1; i--) {
        const msg = messages[i]
        if (!msg) continue
        const tokens = countMessageTokens(msg)
        if (totalTokens + tokens > budget && rest.length > 0) break
        rest.push(msg)
        totalTokens += tokens
    }
    rest.reverse()

    return [...result, ...rest]
}

/** 构建摘要提示词（总长度限制 30K 字符，避免超出摘要模型上下文） */
function buildSummaryPrompt(messages: BaseMessage[]): string {
    const MAX_PROMPT_CHARS = 30000
    const lines: string[] = ['请将以下对话内容压缩为结构化摘要：\n']
    let totalChars = 0

    for (const msg of messages) {
        const type = msg.getType?.() ?? 'unknown'
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)

        // 合并 tool_calls 字段 + content 数组里的 tool_use 块(应对 streaming + thinking 模式)
        const toolNames: string[] = []
        if (type === 'ai' && isAIMessage(msg)) {
            const seen = new Set<string>()
            if (msg.tool_calls?.length) {
                for (const tc of msg.tool_calls) {
                    if (tc.id) seen.add(tc.id)
                    if (tc.name) toolNames.push(tc.name)
                }
            }
            for (const block of collectToolUsesFromContent(msg.content, seen)) {
                if (block.name) toolNames.push(block.name)
            }
        }

        let line: string
        if (toolNames.length > 0) {
            line = `[AI 调用工具] ${toolNames.join(', ')}`
        } else if (type === 'tool') {
            const truncated = content.length > 2000 ? content.slice(0, 2000) + '...(截断)' : content
            line = `[工具返回] ${truncated}`
        } else if (type === 'ai') {
            line = `[AI 回复] ${content.slice(0, 500)}${content.length > 500 ? '...' : ''}`
        } else {
            line = `[${type}] ${content.slice(0, 300)}${content.length > 300 ? '...' : ''}`
        }

        if (totalChars + line.length > MAX_PROMPT_CHARS) {
            lines.push('...(后续消息已省略)')
            break
        }
        lines.push(line)
        totalChars += line.length
    }

    lines.push('\n请输出结构化摘要，格式：\n[工具调用摘要] 查询了XXX，发现：（1）...（2）...')
    return lines.join('\n')
}
