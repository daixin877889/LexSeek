/**
 * 法律法规检索热门词服务
 *
 * 关键词归一化、Redis NX 防刷、ZUNIONSTORE 7 天滑动窗口聚合、60s 查询缓存。
 */

const MIN_LEN = 2
const MAX_LEN = 50

/**
 * 关键词归一化：trim + 合并连续空白；长度 ∈ [2, 50] 且非纯标点才返回，否则 null
 */
export function normalizeKeywordService(raw: string): string | null {
    if (typeof raw !== 'string') return null
    const trimmed = raw.trim().replace(/\s+/g, ' ')
    if (trimmed.length < MIN_LEN || trimmed.length > MAX_LEN) return null
    if (!/[\p{L}\p{N}]/u.test(trimmed)) return null
    return trimmed
}
