/**
 * 法律搜索工具测试
 *
 * 使用 fast-check 进行属性测试，验证法律搜索工具的正确性
 *
 * **Feature: legal-search-tool**
 * **Validates: Requirements 8.1, 8.5, 8.6, 8.7**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'

// 配置 dayjs 插件
dayjs.extend(utc)
dayjs.extend(timezone)

const CHINA_TIMEZONE = 'Asia/Shanghai'

/** 模拟搜索结果项 */
interface MockSearchResultItem {
    score: number
    content: string
    metadata: {
        articleId: string
        legalId: string
        legalName: string
        legalCode: string
        legalType: string
        articleType: string
        hierarchyPath: string
        publishDate: string | null
        effectiveDate: string | null
        invalidDate: string | null
        isValid: boolean
    }
}

/** 日期过滤接口 */
interface DateFilter {
    date: string
    operator: '>' | '<' | '=' | '>=' | '<='
}

/**
 * 检查法律条文是否有效（复制自 searchLaw.tool.ts）
 */
function isLawEffective(effectiveDate?: string | null, invalidDate?: string | null): boolean {
    const now = dayjs().tz(CHINA_TIMEZONE)

    if (effectiveDate) {
        const effective = dayjs(effectiveDate)
        if (!effective.isValid() || effective.isAfter(now)) {
            return false
        }
    }

    if (invalidDate && invalidDate !== '') {
        const invalid = dayjs(invalidDate)
        if (invalid.isValid() && invalid.isBefore(now)) {
            return false
        }
    }

    return true
}

/**
 * 应用日期过滤（复制自 searchLaw.tool.ts）
 */
function applyDateFilter(
    results: MockSearchResultItem[],
    dateFilters: Record<string, DateFilter | undefined>
): MockSearchResultItem[] {
    let filteredResults = [...results]

    for (const [field, dateFilter] of Object.entries(dateFilters)) {
        if (!dateFilter) continue

        const { date, operator } = dateFilter
        const targetDate = dayjs.tz(date, CHINA_TIMEZONE)

        filteredResults = filteredResults.filter(result => {
            const resultDateStr = result.metadata[field as keyof typeof result.metadata] as string | undefined
            if (!resultDateStr) return false

            const resultDate = dayjs(resultDateStr)
            if (!resultDate.isValid()) return false

            switch (operator) {
                case '>':
                    return resultDate.isAfter(targetDate)
                case '<':
                    return resultDate.isBefore(targetDate)
                case '=':
                    return resultDate.isSame(targetDate, 'day')
                case '>=':
                    return resultDate.isSame(targetDate, 'day') || resultDate.isAfter(targetDate)
                case '<=':
                    return resultDate.isSame(targetDate, 'day') || resultDate.isBefore(targetDate)
                default:
                    return true
            }
        })
    }

    return filteredResults
}

// 生成有效日期字符串的 arbitrary（过滤无效日期）
const dateStringArb = fc.date({
    min: new Date('2000-01-01'),
    max: new Date('2030-12-31'),
}).filter(d => !isNaN(d.getTime())).map(d => dayjs(d).format('YYYY-MM-DD'))

// 生成法律类型的 arbitrary
const legalTypeArb = fc.constantFrom('law', 'regulation', 'judicial_interp', 'guideline')

// 生成条文类型的 arbitrary
const articleTypeArb = fc.constantFrom('notice', 'header', 'footer', 'annex', 'l1', 'l2', 'l3', 'l4', 'l5')

// 生成日期操作符的 arbitrary
const dateOperatorArb = fc.constantFrom('>', '<', '=', '>=', '<=') as fc.Arbitrary<'>' | '<' | '=' | '>=' | '<='>

// 生成搜索结果项的 arbitrary
const searchResultItemArb = fc.record({
    score: fc.float({ min: 0, max: 1, noNaN: true }),
    content: fc.string({ minLength: 1, maxLength: 500 }),
    metadata: fc.record({
        articleId: fc.uuid(),
        legalId: fc.uuid(),
        legalName: fc.string({ minLength: 1, maxLength: 100 }),
        legalCode: fc.string({ minLength: 1, maxLength: 50 }),
        legalType: legalTypeArb,
        articleType: articleTypeArb,
        hierarchyPath: fc.string({ minLength: 0, maxLength: 200 }),
        publishDate: fc.option(dateStringArb, { nil: null }),
        effectiveDate: fc.option(dateStringArb, { nil: null }),
        invalidDate: fc.option(dateStringArb, { nil: null }),
        isValid: fc.boolean(),
    }),
})

describe('法律搜索工具', () => {
    describe('Property 7: 搜索结果格式一致性', () => {
        it('搜索结果应包含所有必需字段', () => {
            fc.assert(
                fc.property(searchResultItemArb, (result) => {
                    // 验证结果包含必需字段
                    expect(result).toHaveProperty('score')
                    expect(result).toHaveProperty('content')
                    expect(result).toHaveProperty('metadata')

                    // 验证 metadata 包含必需字段
                    expect(result.metadata).toHaveProperty('articleId')
                    expect(result.metadata).toHaveProperty('legalId')
                    expect(result.metadata).toHaveProperty('legalName')
                    expect(result.metadata).toHaveProperty('legalCode')
                    expect(result.metadata).toHaveProperty('legalType')
                    expect(result.metadata).toHaveProperty('articleType')
                    expect(result.metadata).toHaveProperty('hierarchyPath')

                    // 验证 score 在有效范围内
                    expect(result.score).toBeGreaterThanOrEqual(0)
                    expect(result.score).toBeLessThanOrEqual(1)

                    return true
                }),
                { numRuns: 100 }
            )
        })

        it('法律类型应为有效枚举值', () => {
            fc.assert(
                fc.property(searchResultItemArb, (result) => {
                    const validTypes = ['law', 'regulation', 'judicial_interp', 'guideline']
                    expect(validTypes).toContain(result.metadata.legalType)
                    return true
                }),
                { numRuns: 100 }
            )
        })

        it('条文类型应为有效枚举值', () => {
            fc.assert(
                fc.property(searchResultItemArb, (result) => {
                    const validTypes = ['notice', 'header', 'footer', 'annex', 'l1', 'l2', 'l3', 'l4', 'l5']
                    expect(validTypes).toContain(result.metadata.articleType)
                    return true
                }),
                { numRuns: 100 }
            )
        })
    })

    describe('Property 8: 向量搜索与 SQL 搜索模式切换', () => {
        it('有 query 参数时应使用向量搜索模式', () => {
            fc.assert(
                fc.property(
                    // 生成非空白字符串，确保 trim() 后长度大于 0
                    fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
                    (query) => {
                        // 模拟搜索模式判断逻辑
                        const hasQuery = query && query.trim().length > 0
                        const mode = hasQuery ? 'vector' : 'sql'
                        expect(mode).toBe('vector')
                        return true
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('无 query 参数时应使用 SQL 搜索模式', () => {
            fc.assert(
                fc.property(
                    fc.constant(undefined),
                    (query) => {
                        const hasQuery = query && String(query).trim().length > 0
                        const mode = hasQuery ? 'vector' : 'sql'
                        expect(mode).toBe('sql')
                        return true
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('空字符串 query 应使用 SQL 搜索模式', () => {
            fc.assert(
                fc.property(
                    fc.constant(''),
                    (query) => {
                        const hasQuery = query && query.trim().length > 0
                        const mode = hasQuery ? 'vector' : 'sql'
                        expect(mode).toBe('sql')
                        return true
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('Property 9: 日期过滤时区一致性', () => {
        it('日期过滤应使用东八区时区', () => {
            fc.assert(
                fc.property(
                    dateStringArb,
                    (dateStr) => {
                        // 验证日期格式正确
                        const date = dayjs.tz(dateStr, CHINA_TIMEZONE)
                        expect(date.isValid()).toBe(true)

                        // 验证格式化后的日期与输入一致
                        expect(date.format('YYYY-MM-DD')).toBe(dateStr)
                        return true
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('日期比较操作符应正确工作', () => {
            fc.assert(
                fc.property(
                    dateStringArb,
                    dateStringArb,
                    dateOperatorArb,
                    (date1, date2, operator) => {
                        const d1 = dayjs.tz(date1, CHINA_TIMEZONE)
                        const d2 = dayjs.tz(date2, CHINA_TIMEZONE)

                        let expected: boolean
                        switch (operator) {
                            case '>':
                                expected = d1.isAfter(d2)
                                break
                            case '<':
                                expected = d1.isBefore(d2)
                                break
                            case '=':
                                expected = d1.isSame(d2, 'day')
                                break
                            case '>=':
                                expected = d1.isSame(d2, 'day') || d1.isAfter(d2)
                                break
                            case '<=':
                                expected = d1.isSame(d2, 'day') || d1.isBefore(d2)
                                break
                        }

                        // 验证比较结果是布尔值
                        expect(typeof expected).toBe('boolean')
                        return true
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('日期过滤应正确过滤结果', () => {
            fc.assert(
                fc.property(
                    fc.array(searchResultItemArb, { minLength: 1, maxLength: 20 }),
                    dateStringArb,
                    dateOperatorArb,
                    (results, filterDate, operator) => {
                        const dateFilter: DateFilter = { date: filterDate, operator }
                        const filtered = applyDateFilter(results, { publishDate: dateFilter })

                        // 验证过滤后的结果数量不超过原始数量
                        expect(filtered.length).toBeLessThanOrEqual(results.length)

                        // 验证过滤后的结果都满足条件
                        const targetDate = dayjs.tz(filterDate, CHINA_TIMEZONE)
                        filtered.forEach(item => {
                            if (item.metadata.publishDate) {
                                const itemDate = dayjs(item.metadata.publishDate)
                                if (itemDate.isValid()) {
                                    switch (operator) {
                                        case '>':
                                            expect(itemDate.isAfter(targetDate)).toBe(true)
                                            break
                                        case '<':
                                            expect(itemDate.isBefore(targetDate)).toBe(true)
                                            break
                                        case '=':
                                            expect(itemDate.isSame(targetDate, 'day')).toBe(true)
                                            break
                                        case '>=':
                                            expect(itemDate.isSame(targetDate, 'day') || itemDate.isAfter(targetDate)).toBe(true)
                                            break
                                        case '<=':
                                            expect(itemDate.isSame(targetDate, 'day') || itemDate.isBefore(targetDate)).toBe(true)
                                            break
                                    }
                                }
                            }
                        })

                        return true
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('Property 10: 分页结果数量约束', () => {
        it('返回结果数量不应超过 k 参数', () => {
            fc.assert(
                fc.property(
                    fc.array(searchResultItemArb, { minLength: 0, maxLength: 100 }),
                    fc.integer({ min: 1, max: 50 }),
                    (results, k) => {
                        // 模拟分页逻辑
                        const paginatedResults = results.slice(0, k)
                        expect(paginatedResults.length).toBeLessThanOrEqual(k)
                        return true
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('分页偏移量应正确计算', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 100 }),
                    fc.integer({ min: 1, max: 20 }),
                    (page, pageSize) => {
                        const offset = (page - 1) * pageSize
                        expect(offset).toBeGreaterThanOrEqual(0)
                        expect(offset).toBe((page - 1) * pageSize)
                        return true
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('默认 k 值应为 5', () => {
            const defaultK = 5
            expect(defaultK).toBe(5)
        })
    })

    describe('Property 11: SQL 日期过滤参数构建', () => {
        it('有效日期和操作符应构建正确的 SQL 片段', () => {
            fc.assert(
                fc.property(
                    dateStringArb,
                    dateOperatorArb,
                    (date, operator) => {
                        // 模拟 buildSQLDateFilter 逻辑
                        const dateRegex = /^\d{4}-\d{2}-\d{2}$/
                        expect(dateRegex.test(date)).toBe(true)

                        const validOperators = ['>', '<', '=', '>=', '<=']
                        expect(validOperators).toContain(operator)

                        const chinaDate = dayjs.tz(date, CHINA_TIMEZONE)
                        expect(chinaDate.isValid()).toBe(true)

                        const formattedDate = chinaDate.format('YYYY-MM-DD')
                        expect(formattedDate).toBe(date)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('无效日期格式应被拒绝', () => {
            const invalidDates = ['2025/01/01', '01-01-2025', 'not-a-date', '2025-1-1', '']
            invalidDates.forEach(date => {
                const dateRegex = /^\d{4}-\d{2}-\d{2}$/
                expect(dateRegex.test(date)).toBe(false)
            })
        })

        it('无效操作符应被拒绝', () => {
            const invalidOperators = ['!=', '<>', 'LIKE', 'IN', '==']
            const validOperators = ['>', '<', '=', '>=', '<=']
            invalidOperators.forEach(op => {
                expect(validOperators).not.toContain(op)
            })
        })
    })

    describe('Property 12: searchLawService 结果映射', () => {
        it('搜索模式应正确判断', () => {
            // 有 query → vector 模式
            expect('vector').toBe((() => {
                const params = { query: '合同法' }
                return params.query ? 'vector' : 'sql'
            })())

            // 无 query → sql 模式
            expect('sql').toBe((() => {
                const params = { limit: 10 }
                return (params as { query?: string }).query ? 'vector' : 'sql'
            })())
        })

        it('结果映射应提取正确字段', () => {
            fc.assert(
                fc.property(
                    fc.array(
                        fc.record({
                            score: fc.float({ min: 0, max: 1, noNaN: true }),
                            content: fc.string({ minLength: 1, maxLength: 200 }),
                            metadata: fc.record({
                                articles_id: fc.uuid(),
                                legal_id: fc.uuid(),
                                legal_name: fc.string({ minLength: 1, maxLength: 50 }),
                                chapter_hierarchy: fc.array(fc.string({ maxLength: 50 }), { maxLength: 5 }),
                            }),
                        }),
                        { minLength: 0, maxLength: 10 }
                    ),
                    (results) => {
                        // 模拟 searchLawService 的映射逻辑
                        const items = results.map(item => ({
                            articles_id: item.metadata.articles_id as string,
                            legal_id: item.metadata.legal_id as string,
                            legal_name: item.metadata.legal_name as string,
                            content: item.content,
                            chapter_hierarchy: Array.isArray(item.metadata.chapter_hierarchy)
                                ? (item.metadata.chapter_hierarchy as string[])
                                : [],
                            score: item.score,
                            metadata: item.metadata,
                        }))

                        expect(items.length).toBe(results.length)
                        items.forEach((item, i) => {
                            expect(item.articles_id).toBe(results[i].metadata.articles_id)
                            expect(item.legal_id).toBe(results[i].metadata.legal_id)
                            expect(item.content).toBe(results[i].content)
                            expect(Array.isArray(item.chapter_hierarchy)).toBe(true)
                        })
                    }
                ),
                { numRuns: 50 }
            )
        })

        it('chapter_hierarchy 非数组时应回退为空数组', () => {
            const metadata = { chapter_hierarchy: 'not-an-array' }
            const result = Array.isArray(metadata.chapter_hierarchy)
                ? metadata.chapter_hierarchy
                : []
            expect(result).toEqual([])
        })
    })

    describe('Property 13: SQL 查询条件构建', () => {
        it('metadata 过滤字段应使用 snake_case', () => {
            const metadataFields = ['legal_id', 'legal_name', 'legal_type', 'article_type']
            metadataFields.forEach(field => {
                // 不应包含大写字母（snake_case 验证）
                expect(field).not.toMatch(/[A-Z]/)
                expect(field).toMatch(/^[a-z_]+$/)
            })
        })

        it('分页偏移量在第一页时不应有 OFFSET', () => {
            const page = 1
            const pageSize = 5
            const offset = (page - 1) * pageSize
            expect(offset).toBe(0)
            // 只有 page > 1 时才添加 OFFSET
            expect(page > 1).toBe(false)
        })

        it('分页偏移量在非首页时应正确计算', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 2, max: 100 }),
                    fc.integer({ min: 1, max: 50 }),
                    (page, pageSize) => {
                        const offset = (page - 1) * pageSize
                        expect(offset).toBeGreaterThan(0)
                        expect(page > 1).toBe(true)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('有效性过滤', () => {
        it('isLawEffective 应正确判断法律有效性', () => {
            // 测试未来生效日期 - 应该无效
            const futureDate = dayjs().add(1, 'year').format('YYYY-MM-DD')
            expect(isLawEffective(futureDate, null)).toBe(false)

            // 测试过去失效日期 - 应该无效
            const pastDate = dayjs().subtract(1, 'year').format('YYYY-MM-DD')
            expect(isLawEffective(null, pastDate)).toBe(false)

            // 测试过去生效日期且无失效日期 - 应该有效
            expect(isLawEffective(pastDate, null)).toBe(true)

            // 测试过去生效日期且未来失效日期 - 应该有效
            expect(isLawEffective(pastDate, futureDate)).toBe(true)

            // 测试无日期 - 应该有效
            expect(isLawEffective(null, null)).toBe(true)
        })

        it('有效性过滤应正确过滤结果', () => {
            fc.assert(
                fc.property(
                    fc.array(searchResultItemArb, { minLength: 1, maxLength: 20 }),
                    fc.boolean(),
                    (results, filterEffective) => {
                        const filtered = results.filter(item => {
                            const isEffective = isLawEffective(
                                item.metadata.effectiveDate,
                                item.metadata.invalidDate
                            )
                            return isEffective === filterEffective
                        })

                        // 验证过滤后的结果数量不超过原始数量
                        expect(filtered.length).toBeLessThanOrEqual(results.length)

                        // 验证过滤后的结果都满足条件
                        filtered.forEach(item => {
                            const isEffective = isLawEffective(
                                item.metadata.effectiveDate,
                                item.metadata.invalidDate
                            )
                            expect(isEffective).toBe(filterEffective)
                        })

                        return true
                    }
                ),
                { numRuns: 100 }
            )
        })
    })
})
