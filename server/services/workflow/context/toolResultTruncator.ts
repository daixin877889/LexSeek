/**
 * 工具返回结果截断
 *
 * 在序列化之前限制每条结果的内容长度，避免破坏 JSON 格式
 * 用于防止单次工具返回超长内容导致上下文膨胀
 */

import { estimateTokens } from '../../material/materialPipeline.service'

/** 单条结果内容的默认最大 token 数 */
const DEFAULT_MAX_TOKENS_PER_ITEM = 8000

/** 截断提示信息 */
const TRUNCATION_HINT = '\n\n[内容过长已截断，请使用更精确的查询条件或指定 sourceId 重新检索]'

export interface TruncateOptions {
    /** 单条结果内容的最大 token 数，默认 8000 */
    maxTokensPerItem?: number
}

/**
 * 截断工具返回结果列表中每条内容
 *
 * 在序列化前对每条结果的 content 字段做长度控制
 * 不截断 JSON 字符串本身，确保格式完整
 */
export function truncateToolResults<T extends { content: string }>(
    results: T[],
    options: TruncateOptions = {},
): T[] {
    const maxTokens = options.maxTokensPerItem ?? DEFAULT_MAX_TOKENS_PER_ITEM

    return results.map(item => {
        const tokens = estimateTokens(item.content)
        if (tokens <= maxTokens) return item

        // 按 token 估算截断位置（中文 ~2 char/token，英文 ~4 char/token，取中间值 3）
        const maxChars = maxTokens * 3
        const truncatedContent = item.content.slice(0, maxChars) + TRUNCATION_HINT

        return { ...item, content: truncatedContent }
    })
}
