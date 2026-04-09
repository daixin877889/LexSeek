/**
 * 混合检索服务
 *
 * 提供向量语义搜索、RRF 融合排序以及混合检索（BM25 + Vector + RRF）
 */

import { getPool, getEmbeddingsAsync } from '../legal/vectorStore.service'
import { buildParameterizedMetadataFilter, buildSourceIdsFilter, fullTextSearchService } from './fullTextSearch.service'
import type { IntentClassification, RetrievalRequest, SearchResultItem } from './types'
import { ALLOWED_TABLES } from './types'

/**
 * 向量语义搜索（原始 SQL，绕过 PGVectorStore 的 filter 机制）
 */
export async function vectorSearchService(
    tableName: string,
    query: string,
    k: number,
    metadataFilter?: Record<string, string | number | boolean>,
    sourceIds?: string[],
): Promise<SearchResultItem[]> {
    if (!ALLOWED_TABLES.has(tableName)) {
        throw new Error(`非法表名: ${tableName}`)
    }

    // 获取 query 的向量
    const embeddings = await getEmbeddingsAsync()
    const queryVector = await embeddings.embedQuery(query)
    const vectorStr = `[${queryVector.join(',')}]`

    // 设置 HNSW ef_search 参数
    const efSearch = parseInt(process.env.NUXT_HNSW_EF_SEARCH || '100')
    const pool = getPool()
    await pool.query(`SET hnsw.ef_search = ${efSearch}`)

    // 构建 metadata 过滤（$2 开始）
    const { filterSQL: metaSQL, filterParams: metaParams } = buildParameterizedMetadataFilter(metadataFilter, 2)
    const { filterSQL: sourceSQL, filterParams: sourceParams } = buildSourceIdsFilter(sourceIds, 2 + metaParams.length)
    const limitIdx = 2 + metaParams.length + sourceParams.length

    const sql = `
        SELECT text, metadata,
               1 - (embedding <=> $1::vector) as score
        FROM ${tableName}
        WHERE embedding IS NOT NULL
          ${metaSQL}${sourceSQL}
        ORDER BY embedding <=> $1::vector
        LIMIT $${limitIdx}
    `
    const params = [vectorStr, ...metaParams, ...sourceParams, k]
    const result = await pool.query(sql, params)

    return result.rows.map(row => ({
        score: parseFloat(row.score),
        content: row.text,
        metadata: row.metadata,
    }))
}

/**
 * 提取文档唯一标识，用于 RRF 去重
 */
export function extractDocId(item: SearchResultItem, type: 'law' | 'case_material'): string {
    if (type === 'law') {
        return (item.metadata.articles_id as string) || `${item.content.slice(0, 50)}`
    }
    return `${item.metadata.sourceId}_${item.metadata.chunkIndex ?? 0}`
}

/**
 * Reciprocal Rank Fusion 融合排序
 */
export function reciprocalRankFusion(
    bm25Results: SearchResultItem[],
    vectorResults: SearchResultItem[],
    type: 'law' | 'case_material',
    k: number = 60,
): SearchResultItem[] {
    const scoreMap = new Map<string, { score: number; item: SearchResultItem }>()

    bm25Results.forEach((item, rank) => {
        const id = extractDocId(item, type)
        const rrf = 1 / (k + rank + 1)
        const existing = scoreMap.get(id)
        if (existing) existing.score += rrf
        else scoreMap.set(id, { score: rrf, item })
    })

    vectorResults.forEach((item, rank) => {
        const id = extractDocId(item, type)
        const rrf = 1 / (k + rank + 1)
        const existing = scoreMap.get(id)
        if (existing) existing.score += rrf
        else scoreMap.set(id, { score: rrf, item })
    })

    return [...scoreMap.values()]
        .sort((a, b) => b.score - a.score)
        .map(v => ({ ...v.item, score: v.score }))
}

/**
 * 混合检索：BM25 + Vector + RRF 融合
 */
export async function hybridSearchService(
    intent: IntentClassification,
    request: RetrievalRequest,
): Promise<SearchResultItem[]> {
    const tableName = request.type === 'law' ? 'law_embeddings' : 'case_material_embeddings'
    const searchK = request.k * 3  // 粗检索取 3 倍
    const searchQuery = intent.rewrittenQuery || request.query

    // 并行执行 BM25 和 Vector 搜索
    const [bm25Results, vectorResults] = await Promise.all([
        fullTextSearchService(tableName, intent.keywords || [], searchK, request.metadataFilter, request.sourceIds),
        vectorSearchService(tableName, searchQuery, searchK, request.metadataFilter, request.sourceIds),
    ])

    // RRF 融合
    return reciprocalRankFusion(bm25Results, vectorResults, request.type)
}
