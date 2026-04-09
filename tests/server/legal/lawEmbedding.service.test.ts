/**
 * 法律条文向量嵌入服务测试
 *
 * 验证嵌入元数据结构与旧项目兼容（snake_case 命名）
 *
 * **Feature: embedding-metadata-migration**
 * **Validates: Requirements 1.1-1.9, 2.1-2.4, 3.1-3.3, 4.1-4.4, 5.1-5.5**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import type { legalMain, legalArticles } from '~~/generated/prisma/client'
import { LegalType, ArticleType } from '#shared/types/legal'

// 导入要测试的纯函数
import {
    buildHierarchyPath,
    buildChapterHierarchy,
    buildEmbeddingText,
    buildEmbeddingMetadata,
    getLegalTypeName,
} from '~~/server/services/legal/lawEmbedding.service'

// 生成有效日期的 arbitrary（过滤无效日期）
const validDateArb = fc.date({
    min: new Date('2000-01-01'),
    max: new Date('2030-12-31'),
}).filter(d => !isNaN(d.getTime()))

// 生成模拟的 legalMain 对象
const legalMainArbitrary = fc.record({
    id: fc.uuid(),
    name: fc.string({ minLength: 1, maxLength: 100 }),
    code: fc.string({ minLength: 1, maxLength: 50 }),
    type: fc.constantFrom(...Object.values(LegalType)),
    category: fc.option(fc.string({ maxLength: 50 }), { nil: null }),
    content: fc.string({ minLength: 1, maxLength: 1000 }),
    issuingAuthority: fc.option(fc.string({ maxLength: 100 }), { nil: null }),
    documentNumber: fc.option(fc.string({ maxLength: 50 }), { nil: null }),
    publishDate: fc.option(validDateArb, { nil: null }),
    effectiveDate: fc.option(validDateArb, { nil: null }),
    invalidDate: fc.option(validDateArb, { nil: null }),
    lastEditedAt: fc.option(validDateArb, { nil: null }),
    lastEmbeddingAt: fc.option(validDateArb, { nil: null }),
    createdAt: fc.option(validDateArb, { nil: null }),
    updatedAt: fc.option(validDateArb, { nil: null }),
    deletedAt: fc.option(validDateArb, { nil: null }),
}) as fc.Arbitrary<legalMain>

// 生成模拟的 legalArticles 对象
const legalArticlesArbitrary = fc.record({
    id: fc.uuid(),
    legalId: fc.uuid(),
    type: fc.constantFrom(...Object.values(ArticleType)),
    l1: fc.option(fc.string({ maxLength: 50 }), { nil: null }),
    l1I: fc.option(fc.integer({ min: 1, max: 100 }), { nil: null }),
    l2: fc.option(fc.string({ maxLength: 50 }), { nil: null }),
    l2I: fc.option(fc.integer({ min: 1, max: 100 }), { nil: null }),
    l3: fc.option(fc.string({ maxLength: 50 }), { nil: null }),
    l3I: fc.option(fc.integer({ min: 1, max: 100 }), { nil: null }),
    l4: fc.option(fc.string({ maxLength: 50 }), { nil: null }),
    l4I: fc.option(fc.integer({ min: 1, max: 100 }), { nil: null }),
    l5: fc.option(fc.string({ maxLength: 50 }), { nil: null }),
    l5I: fc.option(fc.integer({ min: 1, max: 100 }), { nil: null }),
    order: fc.option(fc.integer({ min: 1, max: 1000 }), { nil: null }),
    content: fc.option(fc.string({ maxLength: 2000 }), { nil: null }),
    publishDate: fc.option(validDateArb, { nil: null }),
    effectiveDate: fc.option(validDateArb, { nil: null }),
    invalidDate: fc.option(validDateArb, { nil: null }),
    lastEditedAt: fc.option(validDateArb, { nil: null }),
    lastEmbeddingAt: fc.option(validDateArb, { nil: null }),
    createdAt: fc.option(validDateArb, { nil: null }),
    updatedAt: fc.option(validDateArb, { nil: null }),
    deletedAt: fc.option(validDateArb, { nil: null }),
}) as fc.Arbitrary<legalArticles>

// ISO 8601 日期格式正则表达式
const ISO_8601_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/

// 必需的 snake_case 字段列表
const REQUIRED_FIELDS = [
    'articles_id',
    'legal_id',
    'legal_name',
    'legal_type',
    'article_type',
    'chapter_hierarchy',
    'issuing_authority',
    'document_number',
    'publish_date',
    'effective_date',
    'invalid_date',
    'last_edited_at',
    'last_embedding_at',
]

// 已移除的 camelCase 字段列表
const REMOVED_FIELDS = [
    'isValid',
    'legalCode',
    'hierarchyPath',
    'articleId',
    'legalId',
    'legalName',
    'legalType',
    'articleType',
    'invalidDate',
    'publishDate',
    'effectiveDate',
]

describe('法律条文向量嵌入服务', () => {
    describe('buildChapterHierarchy', () => {
        it('应返回字符串数组', () => {
            fc.assert(
                fc.property(legalArticlesArbitrary, (article) => {
                    const hierarchy = buildChapterHierarchy(article)
                    expect(Array.isArray(hierarchy)).toBe(true)
                    hierarchy.forEach(item => {
                        expect(typeof item).toBe('string')
                    })
                }),
                { numRuns: 100 }
            )
        })

        it('应按 l1 → l5 顺序包含所有非空层级', () => {
            fc.assert(
                fc.property(legalArticlesArbitrary, (article) => {
                    const hierarchy = buildChapterHierarchy(article)
                    const expected: string[] = []
                    if (article.l1) expected.push(article.l1)
                    if (article.l2) expected.push(article.l2)
                    if (article.l3) expected.push(article.l3)
                    if (article.l4) expected.push(article.l4)
                    if (article.l5) expected.push(article.l5)
                    expect(hierarchy).toEqual(expected)
                }),
                { numRuns: 100 }
            )
        })
    })

    describe('buildHierarchyPath', () => {
        it('应正确构建层级路径字符串', () => {
            fc.assert(
                fc.property(legalArticlesArbitrary, (article) => {
                    const path = buildHierarchyPath(article)
                    expect(typeof path).toBe('string')
                    if (article.l1) expect(path).toContain(article.l1)
                    if (article.l2) expect(path).toContain(article.l2)
                    if (article.l3) expect(path).toContain(article.l3)
                    if (article.l4) expect(path).toContain(article.l4)
                    if (article.l5) expect(path).toContain(article.l5)
                }),
                { numRuns: 100 }
            )
        })
    })


    describe('Property 1: Metadata 字段命名符合 snake_case 规范', () => {
        /**
         * **Feature: embedding-metadata-migration, Property 1: Metadata 字段命名符合 snake_case 规范**
         * **Validates: Requirements 1.1-1.9**
         */
        it('对于任意法律和条文，元数据字段名应使用 snake_case', () => {
            fc.assert(
                fc.property(
                    legalMainArbitrary,
                    legalArticlesArbitrary,
                    (legal, article) => {
                        const metadata = buildEmbeddingMetadata(legal, article)
                        const keys = Object.keys(metadata)

                        // 验证所有字段名使用 snake_case（包含下划线或全小写）
                        keys.forEach(key => {
                            // snake_case 字段名不应包含大写字母
                            expect(key).not.toMatch(/[A-Z]/)
                        })
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('Property 2: Metadata 包含所有必需的旧项目字段', () => {
        /**
         * **Feature: embedding-metadata-migration, Property 2: Metadata 包含所有必需的旧项目字段**
         * **Validates: Requirements 2.1-2.4**
         */
        it('对于任意法律和条文，元数据应包含所有必需字段', () => {
            fc.assert(
                fc.property(
                    legalMainArbitrary,
                    legalArticlesArbitrary,
                    (legal, article) => {
                        const metadata = buildEmbeddingMetadata(legal, article)
                        const keys = Object.keys(metadata)

                        // 验证所有必需字段存在
                        REQUIRED_FIELDS.forEach(field => {
                            expect(keys).toContain(field)
                        })
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('必需字段值应正确映射', () => {
            fc.assert(
                fc.property(
                    legalMainArbitrary,
                    legalArticlesArbitrary,
                    (legal, article) => {
                        const metadata = buildEmbeddingMetadata(legal, article)

                        expect(metadata.articles_id).toBe(article.id)
                        expect(metadata.legal_id).toBe(legal.id)
                        expect(metadata.legal_name).toBe(legal.name)
                        expect(metadata.article_type).toBe(article.type)
                        expect(metadata.issuing_authority).toBe(legal.issuingAuthority || '')
                        expect(metadata.document_number).toBe(legal.documentNumber || '')
                        expect(Array.isArray(metadata.chapter_hierarchy)).toBe(true)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('Property 3: Metadata 不包含已移除的字段', () => {
        /**
         * **Feature: embedding-metadata-migration, Property 3: Metadata 不包含已移除的字段**
         * **Validates: Requirements 3.1-3.3**
         */
        it('对于任意法律和条文，元数据不应包含已移除的 camelCase 字段', () => {
            fc.assert(
                fc.property(
                    legalMainArbitrary,
                    legalArticlesArbitrary,
                    (legal, article) => {
                        const metadata = buildEmbeddingMetadata(legal, article)
                        const keys = Object.keys(metadata)

                        // 验证已移除字段不存在
                        REMOVED_FIELDS.forEach(field => {
                            expect(keys).not.toContain(field)
                        })
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('Property 4: legal_type 字段值为中文', () => {
        /**
         * **Feature: embedding-metadata-migration, Property 4: legal_type 字段值为中文**
         * **Validates: Requirements 4.1-4.4**
         */
        it('getLegalTypeName 应将英文枚举转换为中文', () => {
            expect(getLegalTypeName('law')).toBe('法律')
            expect(getLegalTypeName('regulation')).toBe('法规')
            expect(getLegalTypeName('judicial_interp')).toBe('司法解释')
            expect(getLegalTypeName('guideline')).toBe('指导意见')
            expect(getLegalTypeName('unknown')).toBe('其他')
        })

        it('对于任意法律类型，legal_type 应为中文', () => {
            const validChineseTypes = ['法律', '法规', '司法解释', '指导意见', '其他']

            fc.assert(
                fc.property(
                    legalMainArbitrary,
                    legalArticlesArbitrary,
                    (legal, article) => {
                        const metadata = buildEmbeddingMetadata(legal, article)
                        expect(validChineseTypes).toContain(metadata.legal_type)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('Property 5: 日期字段格式符合 ISO 8601 带时区格式', () => {
        /**
         * **Feature: embedding-metadata-migration, Property 5: 日期字段格式符合 ISO 8601 带时区格式**
         * **Validates: Requirements 5.1-5.5**
         */
        it('对于任意非空日期，应符合 YYYY-MM-DDTHH:mm:ss+08:00 格式', () => {
            fc.assert(
                fc.property(
                    legalMainArbitrary,
                    legalArticlesArbitrary,
                    (legal, article) => {
                        const metadata = buildEmbeddingMetadata(legal, article)

                        // 验证日期字段格式
                        if (metadata.publish_date !== null) {
                            expect(metadata.publish_date).toMatch(ISO_8601_REGEX)
                        }
                        if (metadata.effective_date !== null) {
                            expect(metadata.effective_date).toMatch(ISO_8601_REGEX)
                        }
                        if (metadata.invalid_date !== null) {
                            expect(metadata.invalid_date).toMatch(ISO_8601_REGEX)
                        }
                        if (metadata.last_edited_at !== null) {
                            expect(metadata.last_edited_at).toMatch(ISO_8601_REGEX)
                        }
                        // last_embedding_at 始终存在
                        expect(metadata.last_embedding_at).toMatch(ISO_8601_REGEX)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('空日期值应保持 null', () => {
            const legal = {
                id: 'legal-1',
                name: '测试法律',
                code: 'TEST-001',
                type: LegalType.LAW,
                category: null,
                content: '测试内容',
                issuingAuthority: null,
                documentNumber: null,
                publishDate: null,
                effectiveDate: null,
                invalidDate: null,
                lastEditedAt: null,
                lastEmbeddingAt: null,
                createdAt: null,
                updatedAt: null,
                deletedAt: null,
            } as legalMain

            const article = {
                id: 'article-1',
                legalId: 'legal-1',
                type: ArticleType.L1,
                l1: null, l1I: null, l2: null, l2I: null, l3: null, l3I: null,
                l4: null, l4I: null, l5: null, l5I: null,
                order: null, content: '内容',
                publishDate: null, effectiveDate: null, invalidDate: null,
                lastEditedAt: null, lastEmbeddingAt: null,
                createdAt: null, updatedAt: null, deletedAt: null,
            } as legalArticles

            const metadata = buildEmbeddingMetadata(legal, article)
            expect(metadata.publish_date).toBeNull()
            expect(metadata.effective_date).toBeNull()
            expect(metadata.invalid_date).toBeNull()
            expect(metadata.last_edited_at).toBeNull()
        })
    })

    describe('Property 6: chapter_hierarchy 为字符串数组', () => {
        /**
         * **Feature: embedding-metadata-migration, Property 6: chapter_hierarchy 为字符串数组**
         * **Validates: Requirements 1.9**
         */
        it('对于任意条文，chapter_hierarchy 应为字符串数组', () => {
            fc.assert(
                fc.property(
                    legalMainArbitrary,
                    legalArticlesArbitrary,
                    (legal, article) => {
                        const metadata = buildEmbeddingMetadata(legal, article)

                        expect(Array.isArray(metadata.chapter_hierarchy)).toBe(true)
                        metadata.chapter_hierarchy.forEach(item => {
                            expect(typeof item).toBe('string')
                        })
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('chapter_hierarchy 应按 l1 → l5 顺序包含非空层级', () => {
            fc.assert(
                fc.property(
                    legalMainArbitrary,
                    legalArticlesArbitrary,
                    (legal, article) => {
                        const metadata = buildEmbeddingMetadata(legal, article)
                        const expected: string[] = []
                        if (article.l1) expected.push(article.l1)
                        if (article.l2) expected.push(article.l2)
                        if (article.l3) expected.push(article.l3)
                        if (article.l4) expected.push(article.l4)
                        if (article.l5) expected.push(article.l5)
                        expect(metadata.chapter_hierarchy).toEqual(expected)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('所有层级为空时应返回空数组', () => {
            const legal = {
                id: 'legal-1',
                name: '测试法律',
                code: 'TEST-001',
                type: LegalType.LAW,
                category: null,
                content: '测试内容',
                issuingAuthority: null,
                documentNumber: null,
                publishDate: null,
                effectiveDate: null,
                invalidDate: null,
                lastEditedAt: null,
                lastEmbeddingAt: null,
                createdAt: null,
                updatedAt: null,
                deletedAt: null,
            } as legalMain

            const article = {
                id: 'article-1',
                legalId: 'legal-1',
                type: ArticleType.L1,
                l1: null, l1I: null, l2: null, l2I: null, l3: null, l3I: null,
                l4: null, l4I: null, l5: null, l5I: null,
                order: null, content: '内容',
                publishDate: null, effectiveDate: null, invalidDate: null,
                lastEditedAt: null, lastEmbeddingAt: null,
                createdAt: null, updatedAt: null, deletedAt: null,
            } as legalArticles

            const metadata = buildEmbeddingMetadata(legal, article)
            expect(metadata.chapter_hierarchy).toEqual([])
        })
    })

    describe('buildEmbeddingText', () => {
        it('应正确构建嵌入文本', () => {
            fc.assert(
                fc.property(
                    legalMainArbitrary,
                    legalArticlesArbitrary,
                    (legal, article) => {
                        const text = buildEmbeddingText(legal, article)
                        expect(text).toContain(legal.name)
                        expect(text).toContain('——《')
                        expect(text).toContain('》')
                    }
                ),
                { numRuns: 100 }
            )
        })
    })
})
