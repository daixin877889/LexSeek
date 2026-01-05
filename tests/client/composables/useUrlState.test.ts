/**
 * URL 状态管理 Composable 测试
 *
 * 使用 fast-check 进行属性测试，验证 URL 状态管理的正确性
 *
 * **Feature: legal-management-url-state**
 * **Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import {
    validateParams,
    DEFAULT_FILTER_STATE,
    type FilterState,
    type UrlStateOptions,
} from '~~/app/composables/useUrlState'

// 默认配置选项
const defaultOptions: UrlStateOptions = {
    defaultValues: DEFAULT_FILTER_STATE,
    validValues: {
        type: ['all', 'law', 'regulation', 'judicial_interp', 'guideline'],
        status: ['all', 'valid', 'invalid', 'pending'],
    },
}

// 生成有效的 type 值
const validTypeArb = fc.constantFrom('all', 'law', 'regulation', 'judicial_interp', 'guideline')

// 生成有效的 status 值
const validStatusArb = fc.constantFrom('all', 'valid', 'invalid', 'pending')

// 生成有效的 page 值（正整数）
const validPageArb = fc.integer({ min: 1, max: 1000 })

// 生成有效的 pageSize 值（10-100 之间的整数）
const validPageSizeArb = fc.integer({ min: 10, max: 100 })

// 生成有效的 keyword 值
const validKeywordArb = fc.string({ minLength: 0, maxLength: 100 })

// 生成有效的 issuingAuthority 值
const validIssuingAuthorityArb = fc.string({ minLength: 0, maxLength: 100 })

describe('URL 状态管理 Composable', () => {
    describe('validateParams - 参数验证', () => {
        describe('Property 1: 有效参数应被正确解析', () => {
            it('有效的 type 参数应被正确解析', () => {
                fc.assert(
                    fc.property(validTypeArb, (type) => {
                        const result = validateParams({ type }, defaultOptions)
                        expect(result.type).toBe(type)
                    }),
                    { numRuns: 100 }
                )
            })

            it('有效的 status 参数应被正确解析', () => {
                fc.assert(
                    fc.property(validStatusArb, (status) => {
                        const result = validateParams({ status }, defaultOptions)
                        expect(result.status).toBe(status)
                    }),
                    { numRuns: 100 }
                )
            })

            it('有效的 page 参数应被正确解析', () => {
                fc.assert(
                    fc.property(validPageArb, (page) => {
                        const result = validateParams({ page: String(page) }, defaultOptions)
                        expect(result.page).toBe(page)
                    }),
                    { numRuns: 100 }
                )
            })

            it('有效的 pageSize 参数应被正确解析', () => {
                fc.assert(
                    fc.property(validPageSizeArb, (pageSize) => {
                        const result = validateParams({ pageSize: String(pageSize) }, defaultOptions)
                        expect(result.pageSize).toBe(pageSize)
                    }),
                    { numRuns: 100 }
                )
            })

            it('有效的 keyword 参数应被正确解析', () => {
                fc.assert(
                    fc.property(validKeywordArb, (keyword) => {
                        const result = validateParams({ keyword }, defaultOptions)
                        expect(result.keyword).toBe(keyword.trim())
                    }),
                    { numRuns: 100 }
                )
            })

            it('有效的 issuingAuthority 参数应被正确解析', () => {
                fc.assert(
                    fc.property(validIssuingAuthorityArb, (issuingAuthority) => {
                        const result = validateParams({ issuingAuthority }, defaultOptions)
                        expect(result.issuingAuthority).toBe(issuingAuthority.trim())
                    }),
                    { numRuns: 100 }
                )
            })
        })

        describe('Property 2: 无效参数应使用默认值', () => {
            it('无效的 type 参数应使用默认值', () => {
                fc.assert(
                    fc.property(
                        fc.string().filter(s => !['all', 'law', 'regulation', 'judicial_interp', 'guideline'].includes(s)),
                        (invalidType) => {
                            const result = validateParams({ type: invalidType }, defaultOptions)
                            expect(result.type).toBe(DEFAULT_FILTER_STATE.type)
                        }
                    ),
                    { numRuns: 100 }
                )
            })

            it('无效的 status 参数应使用默认值', () => {
                fc.assert(
                    fc.property(
                        fc.string().filter(s => !['all', 'valid', 'invalid', 'pending'].includes(s)),
                        (invalidStatus) => {
                            const result = validateParams({ status: invalidStatus }, defaultOptions)
                            expect(result.status).toBe(DEFAULT_FILTER_STATE.status)
                        }
                    ),
                    { numRuns: 100 }
                )
            })

            it('无效的 page 参数应使用默认值', () => {
                // 测试非正整数
                const invalidPages = ['abc', '-1', '0', '1.5', '', 'null', 'undefined']
                for (const invalidPage of invalidPages) {
                    const result = validateParams({ page: invalidPage }, defaultOptions)
                    expect(result.page).toBe(DEFAULT_FILTER_STATE.page)
                }
            })

            it('无效的 pageSize 参数应使用默认值', () => {
                // 测试超出范围的值
                const invalidPageSizes = ['5', '9', '101', '200', 'abc', '-1', '0']
                for (const invalidPageSize of invalidPageSizes) {
                    const result = validateParams({ pageSize: invalidPageSize }, defaultOptions)
                    expect(result.pageSize).toBe(DEFAULT_FILTER_STATE.pageSize)
                }
            })
        })

        describe('Property 3: 缺失参数应使用默认值', () => {
            it('空参数对象应返回所有默认值', () => {
                const result = validateParams({}, defaultOptions)

                expect(result.keyword).toBe(DEFAULT_FILTER_STATE.keyword)
                expect(result.type).toBe(DEFAULT_FILTER_STATE.type)
                expect(result.status).toBe(DEFAULT_FILTER_STATE.status)
                expect(result.issuingAuthority).toBe(DEFAULT_FILTER_STATE.issuingAuthority)
                expect(result.page).toBe(DEFAULT_FILTER_STATE.page)
                expect(result.pageSize).toBe(DEFAULT_FILTER_STATE.pageSize)
            })

            it('部分参数应只覆盖对应字段', () => {
                fc.assert(
                    fc.property(
                        validTypeArb,
                        validPageArb,
                        (type, page) => {
                            const result = validateParams({ type, page: String(page) }, defaultOptions)

                            // 提供的参数应被使用
                            expect(result.type).toBe(type)
                            expect(result.page).toBe(page)

                            // 未提供的参数应使用默认值
                            expect(result.keyword).toBe(DEFAULT_FILTER_STATE.keyword)
                            expect(result.status).toBe(DEFAULT_FILTER_STATE.status)
                            expect(result.issuingAuthority).toBe(DEFAULT_FILTER_STATE.issuingAuthority)
                            expect(result.pageSize).toBe(DEFAULT_FILTER_STATE.pageSize)
                        }
                    ),
                    { numRuns: 100 }
                )
            })
        })

        describe('Property 4: 返回值结构完整性', () => {
            it('返回值应包含所有必需字段', () => {
                fc.assert(
                    fc.property(
                        fc.record({
                            keyword: fc.option(validKeywordArb, { nil: undefined }),
                            type: fc.option(validTypeArb, { nil: undefined }),
                            status: fc.option(validStatusArb, { nil: undefined }),
                            issuingAuthority: fc.option(validIssuingAuthorityArb, { nil: undefined }),
                            page: fc.option(validPageArb.map(String), { nil: undefined }),
                            pageSize: fc.option(validPageSizeArb.map(String), { nil: undefined }),
                        }),
                        (params) => {
                            const result = validateParams(params, defaultOptions)

                            // 验证所有必需字段存在
                            expect(result).toHaveProperty('keyword')
                            expect(result).toHaveProperty('type')
                            expect(result).toHaveProperty('status')
                            expect(result).toHaveProperty('issuingAuthority')
                            expect(result).toHaveProperty('page')
                            expect(result).toHaveProperty('pageSize')

                            // 验证字段类型
                            expect(typeof result.keyword).toBe('string')
                            expect(typeof result.type).toBe('string')
                            expect(typeof result.status).toBe('string')
                            expect(typeof result.issuingAuthority).toBe('string')
                            expect(typeof result.page).toBe('number')
                            expect(typeof result.pageSize).toBe('number')
                        }
                    ),
                    { numRuns: 100 }
                )
            })
        })
    })

    describe('边界情况测试', () => {
        it('应处理 null 和 undefined 参数', () => {
            const result1 = validateParams({ type: null }, defaultOptions)
            expect(result1.type).toBe(DEFAULT_FILTER_STATE.type)

            const result2 = validateParams({ type: undefined }, defaultOptions)
            expect(result2.type).toBe(DEFAULT_FILTER_STATE.type)
        })

        it('应处理数字类型的参数', () => {
            const result = validateParams({ page: 5, pageSize: 50 }, defaultOptions)
            expect(result.page).toBe(5)
            expect(result.pageSize).toBe(50)
        })

        it('应正确处理空白字符串', () => {
            const result = validateParams({
                keyword: '   ',
                issuingAuthority: '  test  ',
            }, defaultOptions)

            expect(result.keyword).toBe('')
            expect(result.issuingAuthority).toBe('test')
        })

        it('应处理自定义默认值', () => {
            const customOptions: UrlStateOptions = {
                defaultValues: {
                    keyword: '默认关键字',
                    type: 'law',
                    status: 'valid',
                    page: 2,
                    pageSize: 50,
                },
            }

            const result = validateParams({}, customOptions)

            expect(result.keyword).toBe('默认关键字')
            expect(result.type).toBe('law')
            expect(result.status).toBe('valid')
            expect(result.page).toBe(2)
            expect(result.pageSize).toBe(50)
        })

        it('应处理自定义有效值列表', () => {
            const customOptions: UrlStateOptions = {
                defaultValues: DEFAULT_FILTER_STATE,
                validValues: {
                    type: ['all', 'custom_type'],
                    status: ['all', 'custom_status'],
                },
            }

            // 自定义有效值应被接受
            const result1 = validateParams({ type: 'custom_type' }, customOptions)
            expect(result1.type).toBe('custom_type')

            // 默认有效值列表中的值应被拒绝（如果不在自定义列表中）
            const result2 = validateParams({ type: 'law' }, customOptions)
            expect(result2.type).toBe(DEFAULT_FILTER_STATE.type)
        })
    })

    describe('DEFAULT_FILTER_STATE 常量', () => {
        it('应包含所有必需字段', () => {
            expect(DEFAULT_FILTER_STATE).toHaveProperty('keyword')
            expect(DEFAULT_FILTER_STATE).toHaveProperty('type')
            expect(DEFAULT_FILTER_STATE).toHaveProperty('status')
            expect(DEFAULT_FILTER_STATE).toHaveProperty('issuingAuthority')
            expect(DEFAULT_FILTER_STATE).toHaveProperty('page')
            expect(DEFAULT_FILTER_STATE).toHaveProperty('pageSize')
        })

        it('默认值应合理', () => {
            expect(DEFAULT_FILTER_STATE.keyword).toBe('')
            expect(DEFAULT_FILTER_STATE.type).toBe('all')
            expect(DEFAULT_FILTER_STATE.status).toBe('all')
            expect(DEFAULT_FILTER_STATE.issuingAuthority).toBe('')
            expect(DEFAULT_FILTER_STATE.page).toBe(1)
            expect(DEFAULT_FILTER_STATE.pageSize).toBe(20)
        })
    })
})
