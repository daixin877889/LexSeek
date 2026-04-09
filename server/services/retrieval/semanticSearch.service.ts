/**
 * 语义检索服务
 *
 * 只走 Vector 搜索，不走 BM25 和 RRF，适用于语义相似度优先的场景
 */

import { vectorSearchService } from './hybridSearch.service'
import type { IntentClassification, RetrievalRequest, SearchResultItem } from './types'

/**
 * 语义检索：纯向量搜索
 */
export async function semanticSearchService(
    intent: IntentClassification,
    request: RetrievalRequest,
): Promise<SearchResultItem[]> {
    const tableName = request.type === 'law' ? 'law_embeddings' : 'case_material_embeddings'
    const searchQuery = intent.rewrittenQuery || request.query
    const searchK = request.k * 3  // 粗检索取 3 倍，后续 Rerank 精排

    return vectorSearchService(tableName, searchQuery, searchK, request.metadataFilter, request.sourceIds)
}
