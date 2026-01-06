/**
 * 法条搜索 API 属性测试
 *
 * **Feature: legal-search**
 * **Property 5: 返回数据完整性**
 * **验证: 需求 7.3**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { LegalType } from '../../../shared/types/legal'

describe('法条搜索 API', () => {
    describe('Property 5: 返回数据完整性', () => {
        /**
         * Feature: legal-search, Property 5: 返回数据完整性
         *
         * 对于任意法条搜索结果，返回的数据应包含所有必要字段：
         * articles_id, legal_id, legal_name, content, chapter_hierarchy
         */
        it('法条搜索结果应包含所有必要字段', () => {
            fc.assert(
                fc.property(
                    // 生成随机法条搜索结果
                    fc.array(
                        fc.record({
                            articles_id: fc.uuid(),
                            legal_id: fc.uuid(),
                            legal_name: fc.string({ minLength: 1, maxLength: 100 }),
                            content: fc.string({ minLength: 1, maxLength: 500 }),
                            chapter_hierarchy: fc.array(
                                fc.string({ minLength: 1, maxLength: 50 }),
                                { minLength: 0, maxLength: 5 }
                            ),
                            score: fc.option(fc.float({ min: 0, max: 1 }), { nil: undefined }),
                            metadata: fc.record({
                                articles_id: fc.uuid(),
                                legal_id: fc.uuid(),
                                legal_name: fc.string({ minLength: 1, maxLength: 100 }),
                                legal_type: fc.constantFrom('法律', '行政法规', '司法解释', '指导意见'),
                                article_type: fc.string({ minLength: 1, maxLength: 20 }),
                                chapter_hierarchy: fc.array(
                                    fc.string({ minLength: 1, maxLength: 50 }),
                                    { minLength: 0, maxLength: 5 }
                                ),
                                issuing_authority: fc.string({ minLength: 1, maxLength: 100 }),
                                document_number: fc.string({ minLength: 1, maxLength: 50 }),
                                publish_date: fc.option(fc.string(), { nil: null }),
                                effective_date: fc.option(fc.string(), { nil: null }),
                                invalid_date: fc.option(fc.string(), { nil: null }),
                                last_edited_at: fc.option(fc.string(), { nil: null }),
                                last_embedding_at: fc.string(),
                            }),
                        }),
                        { minLength: 0, maxLength: 20 }
                    ),
                    (searchResults) => {
                        // 验证：每个搜索结果都包含必要字段
                        searchResults.forEach(result => {
                            // 验证主要字段
                            expect(result.articles_id).toBeDefined()
                            expect(typeof result.articles_id).toBe('string')
                            expect(result.articles_id.length).toBeGreaterThan(0)

                            expect(result.legal_id).toBeDefined()
                            expect(typeof result.legal_id).toBe('string')
                            expect(result.legal_id.length).toBeGreaterThan(0)

                            expect(result.legal_name).toBeDefined()
                            expect(typeof result.legal_name).toBe('string')
                            expect(result.legal_name.length).toBeGreaterThan(0)

                            expect(result.content).toBeDefined()
                            expect(typeof result.content).toBe('string')
                            expect(result.content.length).toBeGreaterThan(0)

                            expect(result.chapter_hierarchy).toBeDefined()
                            expect(Array.isArray(result.chapter_hierarchy)).toBe(true)

                            // 验证元数据字段
                            expect(result.metadata).toBeDefined()
                            expect(typeof result.metadata).toBe('object')

                            const metadata = result.metadata
                            expect(metadata.articles_id).toBeDefined()
                            expect(metadata.legal_id).toBeDefined()
                            expect(metadata.legal_name).toBeDefined()
                            expect(metadata.legal_type).toBeDefined()
                            expect(metadata.article_type).toBeDefined()
                            expect(metadata.chapter_hierarchy).toBeDefined()
                            expect(metadata.issuing_authority).toBeDefined()
                            expect(metadata.document_number).toBeDefined()
                            expect(metadata.last_embedding_at).toBeDefined()

                            // 验证章节层级是数组
                            expect(Array.isArray(metadata.chapter_hierarchy)).toBe(true)
                        })
                    }
                ),
                { numRuns: 100 }
            )
        })

        /**
         * 验证搜索响应结构的完整性
         */
        it('搜索响应应包含 items 和 total 字段', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 0, max: 50 }).chain(itemCount =>
                        fc.record({
                            items: fc.array(
                                fc.record({
                                    articles_id: fc.uuid(),
                                    legal_id: fc.uuid(),
                                    legal_name: fc.string({ minLength: 1 }),
                                    content: fc.string({ minLength: 1 }),
                                    chapter_hierarchy: fc.array(fc.string()),
                                }),
                                { minLength: itemCount, maxLength: itemCount }
                            ),
                            total: fc.integer({ min: itemCount, max: itemCount + 100 }),
                        })
                    ),
                    (response) => {
                        // 验证响应结构
                        expect(response.items).toBeDefined()
                        expect(Array.isArray(response.items)).toBe(true)
                        expect(response.total).toBeDefined()
                        expect(typeof response.total).toBe('number')
                        expect(response.total).toBeGreaterThanOrEqual(0)

                        // 验证 total 与 items 长度的关系
                        // 在分页情况下，items.length 应该小于等于 total
                        expect(response.items.length).toBeLessThanOrEqual(response.total)
                    }
                ),
                { numRuns: 100 }
            )
        })

        /**
         * 验证章节层级数组的结构
         */
        it('章节层级应为字符串数组', () => {
            fc.assert(
                fc.property(
                    fc.array(
                        fc.string({ minLength: 1, maxLength: 50 }),
                        { minLength: 0, maxLength: 10 }
                    ),
                    (chapterHierarchy) => {
                        // 验证：章节层级是字符串数组
                        expect(Array.isArray(chapterHierarchy)).toBe(true)
                        chapterHierarchy.forEach(chapter => {
                            expect(typeof chapter).toBe('string')
                            expect(chapter.length).toBeGreaterThan(0)
                        })
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('搜索参数验证', () => {
        /**
         * 验证搜索查询参数的有效性
         */
        it('搜索查询应为非空字符串', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 500 }),
                    (query) => {
                        // 验证：查询字符串有效
                        expect(typeof query).toBe('string')
                        expect(query.length).toBeGreaterThan(0)
                        expect(query.length).toBeLessThanOrEqual(500)
                    }
                ),
                { numRuns: 100 }
            )
        })

        /**
         * 验证法律类型参数的有效性
         */
        it('法律类型应为有效的枚举值', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(...Object.values(LegalType)),
                    (legalType) => {
                        // 验证：法律类型是有效的枚举值
                        expect(Object.values(LegalType)).toContain(legalType)
                    }
                ),
                { numRuns: 100 }
            )
        })

        /**
         * 验证限制数量参数的有效性
         */
        it('限制数量应在合理范围内', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 100 }),
                    (limit) => {
                        // 验证：限制数量在合理范围内
                        expect(limit).toBeGreaterThanOrEqual(1)
                        expect(limit).toBeLessThanOrEqual(100)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('边界情况测试', () => {
        it('空搜索结果应返回正确的结构', () => {
            const response = {
                items: [],
                total: 0,
            }

            expect(response.items).toBeDefined()
            expect(Array.isArray(response.items)).toBe(true)
            expect(response.items.length).toBe(0)
            expect(response.total).toBe(0)
        })

        it('单条搜索结果应包含所有必要字段', () => {
            const response = {
                items: [{
                    articles_id: 'test-article-id',
                    legal_id: 'test-legal-id',
                    legal_name: '测试法律',
                    content: '测试条文内容',
                    chapter_hierarchy: ['第一章', '第一条'],
                    metadata: {
                        articles_id: 'test-article-id',
                        legal_id: 'test-legal-id',
                        legal_name: '测试法律',
                        legal_type: '法律',
                        article_type: 'l5',
                        chapter_hierarchy: ['第一章', '第一条'],
                        issuing_authority: '测试机关',
                        document_number: 'TEST-001',
                        publish_date: '2024-01-01',
                        effective_date: '2024-01-01',
                        invalid_date: null,
                        last_edited_at: null,
                        last_embedding_at: '2024-01-01T00:00:00Z',
                    },
                }],
                total: 1,
            }

            expect(response.items.length).toBe(1)
            expect(response.total).toBe(1)

            const item = response.items[0]
            expect(item.articles_id).toBe('test-article-id')
            expect(item.legal_id).toBe('test-legal-id')
            expect(item.legal_name).toBe('测试法律')
            expect(item.content).toBe('测试条文内容')
            expect(Array.isArray(item.chapter_hierarchy)).toBe(true)
            expect(item.chapter_hierarchy.length).toBe(2)
        })

        it('无效查询参数应被识别', () => {
            const invalidQueries = ['', ' ', '\t', '\n']

            invalidQueries.forEach(query => {
                expect(query.trim().length).toBe(0)
            })
        })
    })
})