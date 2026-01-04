/**
 * 向量存储服务
 *
 * 提供 PGVectorStore 的初始化、实例缓存和基本操作
 * 使用 OpenAI 兼容的嵌入模型（如阿里云通义千问）
 */

import { PGVectorStore } from '@langchain/community/vectorstores/pgvector'
import { OpenAIEmbeddings } from '@langchain/openai'
import type { Document } from '@langchain/core/documents'
import pg from 'pg'

// 嵌入维度（text-embedding-v3 模型）
const EMBEDDING_DIMENSIONS = 1536

// 嵌入批处理并发数
const EMBEDDING_BATCH_SIZE = 5

// 全局 PGVectorStore 实例映射表，按 tableName 缓存实例
const vectorStores = new Map<string, PGVectorStore>()

// 记录正在初始化的表名，避免并发初始化同一个表
const initializingTables = new Set<string>()

// 全局嵌入模型实例（延迟加载）
let embeddingsInstance: OpenAIEmbeddings | null = null

// 全局数据库连接池
let pgPool: pg.Pool | null = null

/** PGVectorStore 配置接口 */
export interface VectorStoreConfig {
    tableName?: string
    vectorColumnName?: string
    contentColumnName?: string
    metadataColumnName?: string
}

/** 默认配置 */
const defaultConfig: Required<VectorStoreConfig> = {
    tableName: 'law_embeddings',
    vectorColumnName: 'embedding',
    contentColumnName: 'text',
    metadataColumnName: 'metadata',
}

/**
 * 获取数据库连接池
 * @returns pg.Pool 实例
 */
function getPgPool(): pg.Pool {
    if (!pgPool) {
        const databaseUrl = process.env.DATABASE_URL
        if (!databaseUrl) {
            throw new Error('DATABASE_URL 环境变量未设置')
        }
        pgPool = new pg.Pool({ connectionString: databaseUrl })
    }
    return pgPool
}

/**
 * 获取嵌入模型实例
 * @returns OpenAIEmbeddings 实例
 */
export function getEmbeddings(): OpenAIEmbeddings {
    if (!embeddingsInstance) {
        // 从环境变量获取配置
        const apiKey = process.env.NUXT_EMBEDDING_API_KEY
        const baseUrl = process.env.NUXT_EMBEDDING_BASE_URL
        const modelName = process.env.NUXT_EMBEDDING_MODEL || 'text-embedding-v3'

        if (!apiKey) {
            throw new Error('NUXT_EMBEDDING_API_KEY 环境变量未设置')
        }
        if (!baseUrl) {
            throw new Error('NUXT_EMBEDDING_BASE_URL 环境变量未设置')
        }

        embeddingsInstance = new OpenAIEmbeddings({
            apiKey,
            model: modelName,
            dimensions: EMBEDDING_DIMENSIONS,
            batchSize: EMBEDDING_BATCH_SIZE,
            configuration: {
                baseURL: baseUrl,
            },
        })

        logger.info(`嵌入模型初始化完成: ${modelName}`)
    }
    return embeddingsInstance
}

/**
 * 获取或创建 PGVectorStore 实例（按表名缓存）
 * @param config 向量存储配置
 * @returns PGVectorStore 实例
 */
export async function getVectorStore(config: VectorStoreConfig = {}): Promise<PGVectorStore> {
    const finalConfig = { ...defaultConfig, ...config }
    const tableName = finalConfig.tableName

    // 如果该表的实例已存在，直接返回
    if (vectorStores.has(tableName)) {
        return vectorStores.get(tableName)!
    }

    // 如果该表正在初始化，等待初始化完成
    if (initializingTables.has(tableName)) {
        while (initializingTables.has(tableName)) {
            await new Promise(resolve => setTimeout(resolve, 100))
        }
        // 初始化完成后，应该已经有实例了
        if (vectorStores.has(tableName)) {
            return vectorStores.get(tableName)!
        }
    }

    try {
        initializingTables.add(tableName)
        logger.info(`初始化向量存储实例 [表: ${tableName}]...`)

        const embeddings = getEmbeddings()
        const pool = getPgPool()

        const newVectorStore = await PGVectorStore.initialize(embeddings, {
            pool,
            tableName: finalConfig.tableName,
            columns: {
                vectorColumnName: finalConfig.vectorColumnName,
                contentColumnName: finalConfig.contentColumnName,
                metadataColumnName: finalConfig.metadataColumnName,
            },
        })

        // 将新实例存入缓存
        vectorStores.set(tableName, newVectorStore)
        logger.info(`向量存储实例初始化完成 [表: ${tableName}]`)
        return newVectorStore
    } catch (error) {
        logger.error(`向量存储实例初始化失败 [表: ${tableName}]:`, error)
        throw error
    } finally {
        initializingTables.delete(tableName)
    }
}

/**
 * 重置向量存储实例
 * @param tableName 可选，指定要重置的表名。如果不提供，则重置所有实例
 */
export function resetVectorStore(tableName?: string): void {
    if (tableName) {
        logger.info(`重置向量存储实例 [表: ${tableName}]`)
        vectorStores.delete(tableName)
    } else {
        logger.info('重置所有向量存储实例')
        vectorStores.clear()
        initializingTables.clear()
        embeddingsInstance = null
    }
}

/**
 * 获取向量存储实例状态
 * @returns 实例状态信息
 */
export function getVectorStoreStatus() {
    return {
        initialized: vectorStores.size > 0,
        instanceCount: vectorStores.size,
        tables: Array.from(vectorStores.keys()),
        initializingTables: Array.from(initializingTables),
    }
}

/**
 * 添加文档到向量存储
 * @param documents 文档数组
 * @param ids 文档 ID 数组
 * @param config 向量存储配置
 */
export async function addDocumentsToVectorStore(
    documents: Document[],
    ids: string[],
    config: VectorStoreConfig = {}
): Promise<void> {
    const store = await getVectorStore(config)
    await store.addDocuments(documents, { ids })
    logger.info(`已添加 ${documents.length} 个文档到向量存储`)
}

/**
 * 通过元数据删除嵌入记录
 * @param metadataKey 元数据键名
 * @param metadataValue 元数据值
 * @param tableName 表名
 * @returns 删除的记录数
 */
export async function deleteEmbeddingsByMetadata(
    metadataKey: string,
    metadataValue: string,
    tableName: string = defaultConfig.tableName
): Promise<number> {
    const pool = getPgPool()
    const query = `
        DELETE FROM ${tableName} 
        WHERE metadata->>'${metadataKey}' = $1
        RETURNING id
    `
    const result = await pool.query(query, [metadataValue])
    const count = result.rowCount || 0
    logger.info(`已删除 ${count} 个嵌入记录 [${metadataKey}=${metadataValue}]`)
    return count
}

/**
 * 执行向量相似度搜索
 * @param query 查询文本
 * @param k 返回结果数量
 * @param filter 元数据过滤条件
 * @param config 向量存储配置
 * @returns 搜索结果
 */
export async function similaritySearch(
    query: string,
    k: number = 10,
    filter?: Record<string, string | number | boolean>,
    config: VectorStoreConfig = {}
): Promise<Document[]> {
    const store = await getVectorStore(config)
    const results = await store.similaritySearch(query, k, filter)
    return results
}

/**
 * 执行向量相似度搜索（带分数）
 * @param query 查询文本
 * @param k 返回结果数量
 * @param filter 元数据过滤条件
 * @param config 向量存储配置
 * @returns 搜索结果（带分数）
 */
export async function similaritySearchWithScore(
    query: string,
    k: number = 10,
    filter?: Record<string, string | number | boolean>,
    config: VectorStoreConfig = {}
): Promise<[Document, number][]> {
    const store = await getVectorStore(config)
    const results = await store.similaritySearchWithScore(query, k, filter)
    return results
}

/**
 * 获取数据库连接池（供外部使用）
 * @returns pg.Pool 实例
 */
export function getPool(): pg.Pool {
    return getPgPool()
}
