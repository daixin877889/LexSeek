/**
 * 后处理过滤服务
 *
 * 提供检索结果的内存后处理过滤逻辑，包括法律有效性判断和日期范围过滤。
 * 从 searchLaw.tool.ts 中提取，供统一检索路由器使用，避免循环依赖。
 */

import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import type { DateFilter, PostFilters, RetrievalResult } from './types'

dayjs.extend(utc)
dayjs.extend(timezone)

const CHINA_TIMEZONE = 'Asia/Shanghai'

/**
 * 检查法律条文是否有效
 * @param effectiveDate 生效日期
 * @param invalidDate 失效日期
 * @returns 是否有效
 */
export function isLawEffective(effectiveDate?: string | null, invalidDate?: string | null): boolean {
    const now = dayjs().tz(CHINA_TIMEZONE)

    // 检查生效日期：未生效则无效
    if (effectiveDate) {
        const effective = dayjs(effectiveDate)
        if (!effective.isValid() || effective.isAfter(now)) return false
    }

    // 检查失效日期：已失效则无效
    if (invalidDate && invalidDate !== '') {
        const invalid = dayjs(invalidDate)
        if (invalid.isValid() && invalid.isBefore(now)) return false
    }

    return true
}

/**
 * 应用日期过滤到检索结果
 * @param results 检索结果数组
 * @param dateFilters 字段名到日期过滤条件的映射
 * @returns 过滤后的结果
 */
export function applyDateFilter(
    results: RetrievalResult[],
    dateFilters: Record<string, DateFilter | undefined>,
): RetrievalResult[] {
    let filtered = [...results]

    for (const [field, dateFilter] of Object.entries(dateFilters)) {
        if (!dateFilter) continue

        const { date, operator } = dateFilter
        const targetDate = dayjs.tz(date, CHINA_TIMEZONE)

        filtered = filtered.filter(result => {
            const resultDateStr = result.metadata[field] as string | undefined
            if (!resultDateStr) return false

            const resultDate = dayjs(resultDateStr)
            if (!resultDate.isValid()) return false

            switch (operator) {
                case '>': return resultDate.isAfter(targetDate)
                case '<': return resultDate.isBefore(targetDate)
                case '=': return resultDate.isSame(targetDate, 'day')
                case '>=': return resultDate.isSame(targetDate, 'day') || resultDate.isAfter(targetDate)
                case '<=': return resultDate.isSame(targetDate, 'day') || resultDate.isBefore(targetDate)
                default: return true
            }
        })
    }

    return filtered
}

/**
 * 应用 postFilters 到检索结果
 * @param results 检索结果数组
 * @param postFilters 后处理过滤条件
 * @returns 过滤后的结果
 */
export function applyPostFiltersService(
    results: RetrievalResult[],
    postFilters?: PostFilters,
): RetrievalResult[] {
    if (!postFilters) return results

    let filtered = [...results]

    // 有效性过滤
    if (postFilters.isEffective) {
        filtered = filtered.filter(r =>
            isLawEffective(
                r.metadata.effective_date as string | undefined,
                r.metadata.invalid_date as string | undefined,
            ),
        )
    }

    // 日期过滤
    const dateFilters: Record<string, DateFilter | undefined> = {}
    if (postFilters.invalidDateFilter) dateFilters['invalid_date'] = postFilters.invalidDateFilter
    if (postFilters.publishDateFilter) dateFilters['publish_date'] = postFilters.publishDateFilter
    if (postFilters.effectiveDateFilter) dateFilters['effective_date'] = postFilters.effectiveDateFilter

    if (Object.keys(dateFilters).length > 0) {
        filtered = applyDateFilter(filtered, dateFilters)
    }

    return filtered
}
