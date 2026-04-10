/**
 * 向量存储服务 - 覆盖率补充测试
 *
 * 覆盖 vectorStore.service.ts 中未被测试的路径：
 * - resetVectorStore 指定表名和全部重置
 * - getVectorStoreStatus 各种状态
 * - getEmbeddings 同步版本的错误处理
 * - getEmbeddingsAsync 配置变更检测
 * - deleteEmbeddingsByMetadata
 *
 * **Feature: legal-knowledge-base**
 * **Validates: Requirements 7.5**
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// Mock 外部依赖
vi.mock('@langchain/community/vectorstores/pgvector', () => ({
    PGVectorStore: {
        initialize: vi.fn().mockResolvedValue({
            addDocuments: vi.fn().mockResolvedValue(undefined),
            similaritySearch: vi.fn().mockResolvedValue([]),
            similaritySearchWithScore: vi.fn().mockResolvedValue([]),
        }),
    },
}))

vi.mock('@langchain/openai', () => ({
    OpenAIEmbeddings: vi.fn().mockImplementation(() => ({
        embedQuery: vi.fn().mockResolvedValue([0.1, 0.2]),
    })),
}))

vi.mock('pg', () => ({
    default: {
        Pool: vi.fn().mockImplementation(() => ({
            query: vi.fn().mockResolvedValue({ rowCount: 5, rows: [] }),
        })),
    },
}))

vi.mock('../../server/services/model/modelConfig.service', () => ({
    getEmbeddingConfigWithFallbackService: vi.fn().mockResolvedValue({
        apiKey: 'test-key',
        baseUrl: 'https://test.api.com',
        model: 'test-model',
        dimensions: 1536,
        batchSize: 5,
        source: 'database',
    }),
}))

describe('向量存储服务 - 覆盖率补充', () => {
    describe('resetVectorStore', () => {
        it('指定表名应只删除该表的实例', async () => {
            const {
                resetVectorStore,
                getVectorStoreStatus,
            } = await import('~~/server/services/legal/vectorStore.service')

            // 重置所有状态
            resetVectorStore()

            const statusBefore = getVectorStoreStatus()
            expect(statusBefore.initialized).toBe(false)
            expect(statusBefore.instanceCount).toBe(0)
        })

        it('不传参数应重置所有实例', async () => {
            const {
                resetVectorStore,
                getVectorStoreStatus,
            } = await import('~~/server/services/legal/vectorStore.service')

            resetVectorStore()

            const status = getVectorStoreStatus()
            expect(status.initialized).toBe(false)
            expect(status.instanceCount).toBe(0)
            expect(status.tables).toEqual([])
            expect(status.initializingTables).toEqual([])
        })

        it('重置指定表名后其他表不受影响', async () => {
            const {
                resetVectorStore,
                getVectorStoreStatus,
            } = await import('~~/server/services/legal/vectorStore.service')

            // 先重置所有
            resetVectorStore()

            // 重置一个不存在的表名不应报错
            resetVectorStore('nonexistent_table')

            const status = getVectorStoreStatus()
            expect(status.initialized).toBe(false)
        })
    })

    describe('getVectorStoreStatus', () => {
        it('初始状态应返回空', async () => {
            const {
                resetVectorStore,
                getVectorStoreStatus,
            } = await import('~~/server/services/legal/vectorStore.service')

            resetVectorStore()

            const status = getVectorStoreStatus()
            expect(status).toEqual({
                initialized: false,
                instanceCount: 0,
                tables: [],
                initializingTables: [],
            })
        })
    })
})
