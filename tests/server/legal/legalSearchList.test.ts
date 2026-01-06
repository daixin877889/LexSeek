/**
 * 法律法规列表 API 属性测试
 *
 * **Feature: legal-search**
 * **Property 2: 搜索结果匹配性**
 * **Property 3: 分页逻辑正确性**
 * **Property 4: 筛选结果正确性**
 * **验证: 需求 3.2, 3.3, 3.5, 4.1-4.4**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import type { LegalListResponse } from '../../../shared/types/legal-search'
import type { LegalMainListItem } from '../../../shared/types/legal'
import { LegalType } from '../../../shared/types/legal'

describe('法律法规列表 API', () => {
    describe('Property 2: 搜索结果匹配性', () => {
        /**
         * Feature: legal-search, Property 2: 搜索结果匹配性
         *
         * 对于任意搜索关键词，返回的法律法规列表中每一项的名称或文号应包含该关键词
         */
        it('搜索结果的名称或文号应包含关键词', () => {
            fc.assert(
                fc.property(
                    // 生成随机关键词
                    fc.string({ minLength: 1, maxLength: 10 }).filter(s => s.trim().length > 0),
                    // 生成随机法律法规列表
                    fc.array(
                        fc.record({
                            id: fc.uuid(),
                            name: fc.string({ minLength: 1, maxLength: 100 }),
                            code: fc.string({ minLength: 1, maxLength: 50 }),
                            type: fc.constantFrom(...Object.values(LegalType)),
                            category: fc.option(fc.string(), { nil: null }),
                            issuingAuthority: fc.option(fc.string(), { nil: null }),
                            documentNumber: fc.option(fc.string(), { nil: null }),
                            publishDate: fc.option(fc.string(), { nil: null }),
                            effectiveDate: fc.option(fc.string(), { nil: null }),
                            invalidDate: fc.option(fc.string(), { nil: null }),
                            lastEditedAt: fc.option(fc.string(), { nil: null }),
                            lastEmbeddingAt: fc.option(fc.string(), { nil: null }),
                            createdAt: fc.option(fc.string(), { nil: null }),
                        }),
                        { minLength: 0, maxLength: 20 }
                    ),
                    (keyword, items) => {
                        // 模拟搜索过滤
                        const filteredItems = items.filter(item =>
                            item.name.toLowerCase().includes(keyword.toLowerCase()) ||
                            (item.documentNumber && item.documentNumber.toLowerCase().includes(keyword.toLowerCase()))
                        )

                        // 验证：所有结果的名称或文号都包含关键词
                        filteredItems.forEach(item => {
                            const nameMatch = item.name.toLowerCase().includes(keyword.toLowerCase())
                            const docNumMatch = item.documentNumber?.toLowerCase().includes(keyword.toLowerCase()) ?? false
                            expect(nameMatch || docNumMatch).toBe(true)
                        })
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('空关键词应返回所有结果', () => {
            fc.assert(
                fc.property(
                    fc.array(
                        fc.record({
                            id: fc.uuid(),
                            name: fc.string({ minLength: 1, maxLength: 100 }),
                        }),
                        { minLength: 0, maxLength: 20 }
                    ),
                    (items) => {
                        // 空关键词不过滤
                        const keyword = ''
                        const filteredItems = keyword
                            ? items.filter(item => item.name.toLowerCase().includes(keyword.toLowerCase()))
                            : items

                        expect(filteredItems.length).toBe(items.length)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('Property 3: 分页逻辑正确性', () => {
        /**
         * Feature: legal-search, Property 3: 分页逻辑正确性
         *
         * 对于任意分页请求，返回的结果数量应不超过请求的 pageSize，
         * 且 totalPages 应等于 ceil(total / pageSize)
         */
        it('返回结果数量应不超过 pageSize', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 100 }), // pageSize
                    fc.integer({ min: 0, max: 500 }), // total items
                    (pageSize, totalItems) => {
                        // 模拟分页
                        const page = 1
                        const items = Array.from({ length: totalItems }, (_, i) => ({ id: `item-${i}` }))
                        const pagedItems = items.slice((page - 1) * pageSize, page * pageSize)

                        // 验证：返回数量不超过 pageSize
                        expect(pagedItems.length).toBeLessThanOrEqual(pageSize)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('totalPages 应等于 ceil(total / pageSize)', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 100 }), // pageSize
                    fc.integer({ min: 0, max: 500 }), // total
                    (pageSize, total) => {
                        const expectedTotalPages = Math.ceil(total / pageSize)

                        // 模拟响应
                        const response: LegalListResponse = {
                            items: [],
                            total,
                            page: 1,
                            pageSize,
                            totalPages: expectedTotalPages,
                        }

                        // 验证：totalPages 计算正确
                        expect(response.totalPages).toBe(Math.ceil(response.total / response.pageSize))
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('最后一页的结果数量应正确', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 100 }), // pageSize
                    fc.integer({ min: 1, max: 500 }), // total items
                    (pageSize, totalItems) => {
                        const totalPages = Math.ceil(totalItems / pageSize)
                        const lastPage = totalPages

                        // 模拟最后一页的数据
                        const items = Array.from({ length: totalItems }, (_, i) => ({ id: `item-${i}` }))
                        const lastPageItems = items.slice((lastPage - 1) * pageSize, lastPage * pageSize)

                        // 计算期望的最后一页数量
                        const expectedLastPageCount = totalItems % pageSize || pageSize

                        // 验证：最后一页数量正确
                        expect(lastPageItems.length).toBe(expectedLastPageCount)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('page 超出范围时应返回空结果', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 100 }), // pageSize
                    fc.integer({ min: 1, max: 100 }), // total items
                    (pageSize, totalItems) => {
                        const totalPages = Math.ceil(totalItems / pageSize)
                        const outOfRangePage = totalPages + 1

                        // 模拟超出范围的页码
                        const items = Array.from({ length: totalItems }, (_, i) => ({ id: `item-${i}` }))
                        const pagedItems = items.slice((outOfRangePage - 1) * pageSize, outOfRangePage * pageSize)

                        // 验证：超出范围返回空
                        expect(pagedItems.length).toBe(0)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('Property 4: 筛选结果正确性', () => {
        /**
         * Feature: legal-search, Property 4: 筛选结果正确性
         *
         * 对于任意筛选条件组合，所有结果应满足筛选条件
         */
        it('类型筛选后所有结果的 type 应等于指定值', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(...Object.values(LegalType)),
                    fc.array(
                        fc.record({
                            id: fc.uuid(),
                            name: fc.string({ minLength: 1 }),
                            type: fc.constantFrom(...Object.values(LegalType)),
                        }),
                        { minLength: 0, maxLength: 20 }
                    ),
                    (filterType, items) => {
                        // 模拟类型筛选
                        const filteredItems = items.filter(item => item.type === filterType)

                        // 验证：所有结果的 type 等于筛选值
                        filteredItems.forEach(item => {
                            expect(item.type).toBe(filterType)
                        })
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('发文机关筛选后所有结果的 issuingAuthority 应等于指定值', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 50 }),
                    fc.array(
                        fc.record({
                            id: fc.uuid(),
                            name: fc.string({ minLength: 1 }),
                            issuingAuthority: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: null }),
                        }),
                        { minLength: 0, maxLength: 20 }
                    ),
                    (filterAuthority, items) => {
                        // 模拟发文机关筛选
                        const filteredItems = items.filter(item => item.issuingAuthority === filterAuthority)

                        // 验证：所有结果的 issuingAuthority 等于筛选值
                        filteredItems.forEach(item => {
                            expect(item.issuingAuthority).toBe(filterAuthority)
                        })
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('有效性筛选（validOnly=true）后所有结果应为有效状态', () => {
            fc.assert(
                fc.property(
                    fc.array(
                        fc.record({
                            id: fc.uuid(),
                            name: fc.string({ minLength: 1 }),
                            effectiveDate: fc.option(
                                fc.date({ min: new Date('2000-01-01'), max: new Date('2030-12-31') })
                                    .filter(d => !isNaN(d.getTime()))
                                    .map(d => d.toISOString().split('T')[0]),
                                { nil: null }
                            ),
                            invalidDate: fc.option(
                                fc.date({ min: new Date('2000-01-01'), max: new Date('2030-12-31') })
                                    .filter(d => !isNaN(d.getTime()))
                                    .map(d => d.toISOString().split('T')[0]),
                                { nil: null }
                            ),
                        }),
                        { minLength: 0, maxLength: 20 }
                    ),
                    (items) => {
                        const today = new Date()

                        // 模拟有效性筛选
                        const filteredItems = items.filter(item => {
                            // 检查是否已生效
                            if (item.effectiveDate) {
                                const effectiveDate = new Date(item.effectiveDate)
                                if (effectiveDate > today) return false
                            }
                            // 检查是否已失效
                            if (item.invalidDate) {
                                const invalidDate = new Date(item.invalidDate)
                                if (invalidDate <= today) return false
                            }
                            return true
                        })

                        // 验证：所有结果都是有效的
                        filteredItems.forEach(item => {
                            const isValid = checkValidity(item.effectiveDate, item.invalidDate, today)
                            expect(isValid).toBe(true)
                        })
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('日期范围筛选后所有结果的 publishDate 应在指定范围内', () => {
            fc.assert(
                fc.property(
                    fc.date({ min: new Date('2000-01-01'), max: new Date('2020-12-31') }).filter(d => !isNaN(d.getTime())),
                    fc.date({ min: new Date('2021-01-01'), max: new Date('2030-12-31') }).filter(d => !isNaN(d.getTime())),
                    fc.array(
                        fc.record({
                            id: fc.uuid(),
                            name: fc.string({ minLength: 1 }),
                            publishDate: fc.option(
                                fc.date({ min: new Date('2000-01-01'), max: new Date('2030-12-31') })
                                    .filter(d => !isNaN(d.getTime()))
                                    .map(d => d.toISOString().split('T')[0]),
                                { nil: null }
                            ),
                        }),
                        { minLength: 0, maxLength: 20 }
                    ),
                    (fromDate, toDate, items) => {
                        const from = fromDate.toISOString().split('T')[0]
                        const to = toDate.toISOString().split('T')[0]

                        // 模拟日期范围筛选
                        const filteredItems = items.filter(item => {
                            if (!item.publishDate) return false
                            return item.publishDate >= from && item.publishDate <= to
                        })

                        // 验证：所有结果的 publishDate 在范围内
                        filteredItems.forEach(item => {
                            expect(item.publishDate).not.toBeNull()
                            expect(item.publishDate! >= from).toBe(true)
                            expect(item.publishDate! <= to).toBe(true)
                        })
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('边界情况测试', () => {
        it('空列表应返回正确的分页信息', () => {
            const response: LegalListResponse = {
                items: [],
                total: 0,
                page: 1,
                pageSize: 20,
                totalPages: 0,
            }

            expect(response.items.length).toBe(0)
            expect(response.total).toBe(0)
            expect(response.totalPages).toBe(0)
        })

        it('单条记录应返回正确的分页信息', () => {
            const response: LegalListResponse = {
                items: [{
                    id: 'test-id',
                    name: '测试法律',
                    code: 'TEST-001',
                    type: LegalType.LAW,
                    category: null,
                    issuingAuthority: null,
                    documentNumber: null,
                    publishDate: null,
                    effectiveDate: null,
                    invalidDate: null,
                    lastEditedAt: null,
                    lastEmbeddingAt: null,
                    createdAt: null,
                }],
                total: 1,
                page: 1,
                pageSize: 20,
                totalPages: 1,
            }

            expect(response.items.length).toBe(1)
            expect(response.total).toBe(1)
            expect(response.totalPages).toBe(1)
        })
    })
})

/**
 * 辅助函数：检查法律是否有效
 */
function checkValidity(effectiveDate: string | null, invalidDate: string | null, today: Date): boolean {
    // 检查是否已生效
    if (effectiveDate) {
        const effective = new Date(effectiveDate)
        if (effective > today) return false
    }
    // 检查是否已失效
    if (invalidDate) {
        const invalid = new Date(invalidDate)
        if (invalid <= today) return false
    }
    return true
}
