/**
 * 在按 date desc 排序的利率数组中找到 target 日期对应的利率。
 *
 * 规则：返回 date <= target 中 date 最大的那一条（即"生效中"的利率）。
 */
export function findRateForDate<T extends { date: string }>(
    rates: readonly T[],
    target: string | Date,
): T | null {
    const t = typeof target === 'string' ? new Date(target) : target
    for (const r of rates) {
        if (new Date(r.date) <= t) return r
    }
    return null
}
