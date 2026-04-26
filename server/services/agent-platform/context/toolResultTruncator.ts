/**
 * 工具返回结果截断
 *
 * 在序列化之前限制每条结果的内容长度，避免破坏 JSON 格式
 * 用于防止单次工具返回超长内容导致上下文膨胀
 *
 * 使用 tiktoken 精确计算 token 数，避免字符估算对中文的 2 倍偏差
 */

import { countTokens, countTokensSync } from '~~/server/utils/tokenCounter'

/** 单条结果内容的默认最大 token 数 */
const DEFAULT_MAX_TOKENS_PER_ITEM = 8000

/** 截断提示信息 */
const TRUNCATION_HINT = '\n\n[内容过长已截断，请使用更精确的查询条件或指定 sourceId 重新检索]'

/**
 * 模块加载时预热 tiktoken 编码器
 *
 * countTokensSync 在编码器未初始化时会 fallback 到字符估算（见 server/utils/tokenCounter.ts:29-34），
 * 此处通过一次异步调用触发懒加载，确保后续同步调用走真正的 tiktoken 编码
 */
void countTokens('').catch(() => { /* 忽略预热失败 */ })

export interface TruncateOptions {
    /** 单条结果内容的最大 token 数，默认 8000 */
    maxTokensPerItem?: number
}

/**
 * 将文本精确截断到指定 token 上限
 *
 * 使用二分查找在 Unicode 码点数组上定位切分点：
 * - 码点数组（`Array.from(content)`）避免在 surrogate pair（如 emoji）中间截断
 * - 二分查找把 O(n) 次 tokenize 降到 O(log n) 次
 */
function truncateToTokenLimit(content: string, maxTokens: number): string {
    const tokens = countTokensSync(content)
    if (tokens <= maxTokens) return content

    const codePoints = Array.from(content)
    let lo = 0
    let hi = codePoints.length
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2)
        if (countTokensSync(codePoints.slice(0, mid).join('')) <= maxTokens) {
            lo = mid
        } else {
            hi = mid - 1
        }
    }
    return codePoints.slice(0, lo).join('') + TRUNCATION_HINT
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
        const truncatedContent = truncateToTokenLimit(item.content, maxTokens)
        if (truncatedContent === item.content) return item
        return { ...item, content: truncatedContent }
    })
}
