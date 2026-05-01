/**
 * 法律条文向量嵌入服务 - 异步函数补充测试
 *
 * 覆盖 embedLawArticle、updateLegalEmbeddings、updateEmbeddingsValidStatus、
 * embedSingleArticle、checkArticleNeedsEmbedding 等需要 mock 的异步函数
 *
 * **Feature: law-embedding-async-coverage**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { legalMain, legalArticles } from '~~/generated/prisma/client'
import { LegalType, ArticleType } from '#shared/types/legal'

// Mock Nuxt 自动导入
vi.stubGlobal('logger', {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
})

vi.stubGlobal('prisma', {
    legalMain: {
        findUnique: vi.fn(),
        update: vi.fn(),
    },
    legalArticles: {
        update: vi.fn(),
        updateMany: vi.fn(),
    },
})

// Mock vectorStore
const mockPoolQuery = vi.fn()
const mockAddDocuments = vi.fn().mockResolvedValue(undefined)
const mockDeleteEmbeddingsByMetadata = vi.fn().mockResolvedValue(0)

vi.mock('~~/server/services/legal/vectorStore.service', () => ({
    getVectorStore: vi.fn().mockResolvedValue({
        addDocuments: (...args: any[]) => mockAddDocuments(...args),
    }),
    deleteEmbeddingsByMetadata: (...args: any[]) => mockDeleteEmbeddingsByMetadata(...args),
    getPool: () => ({ query: mockPoolQuery }),
}))

// 准备测试数据
const createTestLegal = (): legalMain => ({
    id: 'legal-1',
    name: '中华人民共和国民法典',
    code: 'MFD-2020',
    type: LegalType.LAW,
    category: null,
    content: '民法典全文',
    issuingAuthority: '全国人大',
    documentNumber: '主席令第四十五号',
    publishDate: new Date('2020-05-28'),
    effectiveDate: new Date('2021-01-01'),
    invalidDate: null,
    lastEditedAt: null,
    lastEmbeddingAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
})

const createTestArticle = (overrides?: Partial<legalArticles>): legalArticles => ({
    id: 'article-1',
    legalId: 'legal-1',
    type: ArticleType.ARTICLE,
    l1: '第一编 总则',
    l2: '第一章 基本规定',
    l3: null,
    l4: null,
    l5: null,
    l1I: 1,
    l2I: 1,
    l3I: null,
    l4I: null,
    l5I: null,
    order: 1,
    content: '第一条 为了保护民事主体的合法权益，调整民事关系。',
    publishDate: new Date('2020-05-28'),
    effectiveDate: new Date('2021-01-01'),
    invalidDate: null,
    lastEditedAt: null,
    lastEmbeddingAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
})

import {
    embedLawArticle,
    deleteEmbeddingsByArticleId,
    updateLegalEmbeddings,
    updateEmbeddingsValidStatus,
    embedSingleArticle,
} from '~~/server/services/legal/lawEmbedding.service'

describe('法律条文向量嵌入服务 - 异步函数', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('embedLawArticle - 嵌入单个法律条文', () => {
        it('成功嵌入有内容的条文', async () => {
            const legal = createTestLegal()
            const article = createTestArticle()

            const result = await embedLawArticle(legal, article)

            expect(result).toBeDefined()
            expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T/)
            expect(mockAddDocuments).toHaveBeenCalled()
        })

        it('无可嵌入内容时跳过', async () => {
            const legal = createTestLegal()
            const article = createTestArticle({
                content: null,
                l1: null,
                l2: null,
                l3: null,
                l4: null,
                l5: null,
            })

            const result = await embedLawArticle(legal, article)

            expect(result).toBeUndefined()
        })

        it('content 为空字符串且无层级标题时跳过', async () => {
            const legal = createTestLegal()
            const article = createTestArticle({
                content: '   ',
                l1: null,
                l2: null,
                l3: null,
                l4: null,
                l5: null,
            })

            const result = await embedLawArticle(legal, article)

            expect(result).toBeUndefined()
        })
    })

    describe('deleteEmbeddingsByArticleId - 删除条文嵌入', () => {
        it('调用 deleteEmbeddingsByMetadata', async () => {
            mockDeleteEmbeddingsByMetadata.mockResolvedValue(3)

            const count = await deleteEmbeddingsByArticleId('article-1')

            expect(count).toBe(3)
            expect(mockDeleteEmbeddingsByMetadata).toHaveBeenCalledWith(
                'articles_id',
                'article-1',
                'law_embeddings',
            )
        })
    })

    describe('updateLegalEmbeddings - 更新法律所有条文嵌入', () => {
        it('法律不存在时抛出错误', async () => {
            ;(prisma.legalMain.findUnique as any).mockResolvedValue(null)

            await expect(updateLegalEmbeddings('nonexistent')).rejects.toThrow('法律 ID nonexistent 不存在')
        })

        it('成功更新需要嵌入的条文', async () => {
            const legal = {
                ...createTestLegal(),
                legalArticles: [
                    createTestArticle({ lastEmbeddingAt: null }), // 需要嵌入
                ],
            }
            ;(prisma.legalMain.findUnique as any).mockResolvedValue(legal)
            ;(prisma.legalArticles.updateMany as any).mockResolvedValue({ count: 1 })
            ;(prisma.legalMain.update as any).mockResolvedValue({})
            // checkArticleNeedsEmbedding: lastEmbeddingAt 为 null → 需要嵌入
            // embedLawArticle 会成功

            await updateLegalEmbeddings('legal-1')

            expect(prisma.legalArticles.updateMany).toHaveBeenCalled()
            expect(prisma.legalMain.update).toHaveBeenCalled()
        })

        it('条文已有嵌入且无变更时跳过', async () => {
            const article = createTestArticle({
                lastEmbeddingAt: new Date('2025-01-01'),
                lastEditedAt: new Date('2024-12-01'), // 编辑时间早于嵌入时间
            })
            const legal = {
                ...createTestLegal(),
                legalArticles: [article],
            }
            ;(prisma.legalMain.findUnique as any).mockResolvedValue(legal)
            ;(prisma.legalMain.update as any).mockResolvedValue({})
            // checkArticleNeedsEmbedding: 编辑时间早于嵌入时间，还需检查数据库
            mockPoolQuery.mockResolvedValue({ rows: [{ count: '5' }] })

            await updateLegalEmbeddings('legal-1')

            // 不应调用 deleteEmbeddingsByMetadata（因为不需要更新）
            expect(mockDeleteEmbeddingsByMetadata).not.toHaveBeenCalled()
        })
    })

    describe('updateEmbeddingsValidStatus - 更新嵌入失效日期', () => {
        it('传入失效日期时更新为 ISO 字符串', async () => {
            mockPoolQuery.mockResolvedValue({ rowCount: 5 })
            const invalidDate = new Date('2025-12-31')

            await updateEmbeddingsValidStatus('legal-1', invalidDate)

            expect(mockPoolQuery).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE law_embeddings'),
                expect.arrayContaining(['legal-1']),
            )
        })

        it('传入 null 时设置为 null', async () => {
            mockPoolQuery.mockResolvedValue({ rowCount: 0 })

            await updateEmbeddingsValidStatus('legal-1', null)

            expect(mockPoolQuery).toHaveBeenCalledWith(
                expect.anything(),
                ['legal-1', 'null'],
            )
        })
    })

    describe('embedSingleArticle - 嵌入单个条文', () => {
        it('条文不存在时抛出错误', async () => {
            vi.stubGlobal('prisma', {
                ...prisma,
                legalArticles: {
                    findUnique: vi.fn().mockResolvedValue(null),
                    update: vi.fn(),
                },
                legalMain: {
                    findUnique: vi.fn(),
                    update: vi.fn(),
                },
            })

            await expect(embedSingleArticle('nonexistent')).rejects.toThrow('条文 ID nonexistent 不存在或已删除')
        })

        it('成功嵌入条文并更新时间戳', async () => {
            const mockArticle = {
                ...createTestArticle(),
                legalMain: createTestLegal(),
            }
            const mockUpdate = vi.fn().mockResolvedValue({})

            vi.stubGlobal('prisma', {
                ...prisma,
                legalArticles: {
                    findUnique: vi.fn().mockResolvedValue(mockArticle),
                    update: mockUpdate,
                },
                legalMain: {
                    findUnique: vi.fn(),
                    update: vi.fn(),
                },
            })

            await embedSingleArticle('article-1')

            expect(mockUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: 'article-1' },
                }),
            )
        })
    })
})
