import { getEncoding } from 'js-tiktoken'

/** 全局编码实例（cl100k_base，兼容 DeepSeek V3 / GPT-4 / Qwen 等） */
let encoding: ReturnType<typeof getEncoding> | null = null

/** 获取或初始化编码实例（懒加载，同步） */
function getEncodingInstance() {
    if (!encoding) {
        encoding = getEncoding('cl100k_base')
    }
    return encoding
}

/**
 * 精确计算文本的 token 数
 * @param text 待计数的文本
 * @returns token 数量（async 签名方便未来扩展）
 */
export async function countTokens(text: string): Promise<number> {
    if (!text) return 0
    const enc = getEncodingInstance()
    return enc.encode(text).length
}

/**
 * 同步版 token 计数（编码已初始化时使用，fallback 为字符估算）
 */
export function countTokensSync(text: string): number {
    if (!text) return 0
    if (!encoding) {
        return estimateTokensFallback(text)
    }
    return encoding.encode(text).length
}

/** 字符估算 fallback（中文约 2 字符/token，英文约 4 字符/token） */
function estimateTokensFallback(text: string): number {
    const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length
    const otherChars = text.length - chineseChars
    return Math.ceil(chineseChars / 2 + otherChars / 4)
}
