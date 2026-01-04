/**
 * 法律条文向量嵌入服务测试
 *
 * 验证嵌入元数据完整性和空内容跳过逻辑
 *
 * **Feature: legal-knowledge-base**
 * **Validates: Requirements 4.4, 4.6**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import type { legalMain, legalArticles } from '~~/generated/prisma/client'
import { LegalType, ArticleType } from '#shared/types/legal'

// 导入要测试的纯函数
import {
    buildHierarchyPath,
    buildEmbeddingText,
    buildEmbeddingMetadata,
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

describe('法律条文向量嵌入服务', () => {
    describe('buildHierarchyPath', () => {
        it('应正确构建层级路径', () => {
            fc.assert(
                fc.property(legalArticlesArbitrary, (article) => {
                    const path = buildHierarchyPath(article)

                    // 验证路径是字符串
                    expect(typeof path).toBe('string')

                    // 验证路径包含所有非空层级
                    if (article.l1) expect(path).toContain(article.l1)
                    if (article.l2) expect(path).toContain(article.l2)
                    if (article.l3) expect(path).toContain(article.l3)
                    if (article.l4) expect(path).toContain(article.l4)
                    if (article.l5) expect(path).toContain(article.l5)
                }),
                { numRuns: 100 }
            )
        })

        it('空层级应返回空字符串', () => {
            const article = {
                id: 'test-id',
                legalId: 'legal-id',
                type: ArticleType.L1,
                l1: null,
                l1I: null,
                l2: null,
                l2I: null,
                l3: null,
                l3I: null,
                l4: null,
                l4I: null,
                l5: null,
                l5I: null,
                order: null,
                content: null,
                publishDate: null,
                effectiveDate: null,
                invalidDate: null,
                lastEditedAt: null,
                lastEmbeddingAt: null,
                createdAt: null,
                updatedAt: null,
                deletedAt: null,
            } as legalArticles

            const path = buildHierarchyPath(article)
            expect(path).toBe('')
        })
    })

    describe('Property 4: 向量嵌入元数据完整性', () => {
        it('对于任意法律和条文，元数据应包含所有必需字段', () => {
            fc.assert(
                fc.property(
                    legalMainArbitrary,
                    legalArticlesArbitrary,
                    (legal, article) => {
                        const metadata = buildEmbeddingMetadata(legal, article)

                        // 验证所有必需字段存在
                        expect(metadata.articleId).toBe(article.id)
                        expect(metadata.legalId).toBe(legal.id)
                        expect(metadata.legalName).toBe(legal.name)
                        expect(metadata.legalCode).toBe(legal.code)
                        expect(metadata.legalType).toBe(legal.type)
                        expect(metadata.articleType).toBe(article.type)
                        expect(typeof metadata.hierarchyPath).toBe('string')
                        expect(typeof metadata.isValid).toBe('boolean')

                        // 验证日期字段格式（如果存在）
                        if (metadata.publishDate) {
                            expect(metadata.publishDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
                        }
                        if (metadata.effectiveDate) {
                            expect(metadata.effectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
                        }
                        if (metadata.invalidDate) {
                            expect(metadata.invalidDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
                        }
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('isValid 应根据失效日期正确计算', () => {
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

            // 无失效日期 -> 有效
            const articleNoInvalid = {
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

            expect(buildEmbeddingMetadata(legal, articleNoInvalid).isValid).toBe(true)

            // 失效日期在未来 -> 有效
            const futureDate = new Date()
            futureDate.setFullYear(futureDate.getFullYear() + 1)
            const articleFutureInvalid = {
                ...articleNoInvalid,
                invalidDate: futureDate,
            } as legalArticles

            expect(buildEmbeddingMetadata(legal, articleFutureInvalid).isValid).toBe(true)

            // 失效日期在过去 -> 无效
            const pastDate = new Date()
            pastDate.setFullYear(pastDate.getFullYear() - 1)
            const articlePastInvalid = {
                ...articleNoInvalid,
                invalidDate: pastDate,
            } as legalArticles

            expect(buildEmbeddingMetadata(legal, articlePastInvalid).isValid).toBe(false)
        })
    })

    describe('Property 12: 空内容跳过嵌入', () => {
        it('buildEmbeddingText 应正确构建文本', () => {
            fc.assert(
                fc.property(
                    legalMainArbitrary,
                    legalArticlesArbitrary,
                    (legal, article) => {
                        const text = buildEmbeddingText(legal, article)

                        // 验证文本包含法律名称
                        expect(text).toContain(legal.name)

                        // 验证文本包含类型标签
                        expect(text).toContain('类型：')

                        // 验证文本包含章节标签
                        expect(text).toContain('章节：')

                        // 验证文本包含内容标签
                        expect(text).toContain('内容：')
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('空内容条文的嵌入文本应只包含标题信息', () => {
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

            const articleEmpty = {
                id: 'article-1',
                legalId: 'legal-1',
                type: ArticleType.L1,
                l1: '第一编', l1I: 1, l2: null, l2I: null, l3: null, l3I: null,
                l4: null, l4I: null, l5: null, l5I: null,
                order: 1, content: null, // 空内容
                publishDate: null, effectiveDate: null, invalidDate: null,
                lastEditedAt: null, lastEmbeddingAt: null,
                createdAt: null, updatedAt: null, deletedAt: null,
            } as legalArticles

            const text = buildEmbeddingText(legal, articleEmpty)

            // 验证文本包含标题信息
            expect(text).toContain('测试法律')
            expect(text).toContain('第一编')

            // 验证内容部分为空
            expect(text).toContain('内容：')
            // 内容后面应该是空的
            const contentPart = text.split('内容：')[1]
            expect(contentPart.trim()).toBe('')
        })
    })
})
