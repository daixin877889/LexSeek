import { hybridSearchService } from '../retrieval/hybridSearch.service'
import { rerankDocuments } from './rerankerClient'
import { subjectVersionScoring } from './postProcess'
import type { MemoryHit, CaseMemoryMetadata } from '#shared/types/memory'
import type { IntentClassification, RetrievalRequest } from '../retrieval/types'

export interface RetrieveInput {
  tableName: string
  query: string
  topK: number
  metadataFilter: Record<string, string | number | boolean>
  filterInvalidated?: boolean
  enableVersionScoring?: boolean
  minScore?: number
}

const TABLE_TYPE_MAP: Record<string, 'law' | 'case_material' | 'case_memory' | 'case_analysis'> = {
  law_embeddings: 'law',
  case_memories: 'case_memory',
  case_analysis_embeddings: 'case_analysis',
}

/**
 * M3/M4 共享的召回公共入口（四阶段）：
 *   ①② Hybrid Recall → ③ pre-filter → ④ rerank → ⑤ 版本链降权
 * reranker 不可达时降级走 hybrid 分数。
 */
export async function retrieveWithReranking(input: RetrieveInput): Promise<MemoryHit[]> {
  const {
    tableName,
    query,
    topK,
    metadataFilter,
    filterInvalidated = true,
    enableVersionScoring = false,
    minScore = 0,
  } = input

  // ①② Hybrid Recall
  const intent: IntentClassification = {
    intent: 'hybrid',
    rewrittenQuery: query,
    keywords: [],
  }
  const request: RetrievalRequest = {
    type: TABLE_TYPE_MAP[tableName] ?? 'case_material',
    query,
    k: topK * 3,
    metadataFilter,
  }
  const hybridResults = await hybridSearchService(intent, request)

  // SearchResultItem → MemoryHit（id 从 metadata.id 读取）
  const hybridHits: MemoryHit[] = hybridResults.map((r, i) => {
    const meta = r.metadata as unknown as CaseMemoryMetadata
    return {
      id: meta?.id ?? String(i),
      text: r.content,
      score: r.score,
      metadata: meta,
    }
  })

  // ③ Pre-filter
  const filtered = hybridHits.filter((h) => {
    if ((h.score ?? 0) < minScore) return false
    if (filterInvalidated && h.metadata?.invalidatedAt) return false
    return true
  })
  if (filtered.length === 0) return []

  // ④ Rerank（降级：服务不可达 → 跳过）
  let reranked: MemoryHit[]
  try {
    const rerankRes = await rerankDocuments(
      query,
      filtered.slice(0, 20).map((h) => ({ id: h.id, text: h.text })),
    )
    reranked = rerankRes
      .map((r) => {
        const orig = filtered.find((h) => h.id === r.id)
        return orig ? { ...orig, score: r.score } : null
      })
      .filter((h): h is MemoryHit => h !== null)
  } catch (e) {
    logger.warn('rerankerClient 不可达，降级走 hybrid 分数', { error: e })
    reranked = filtered.slice(0, topK)
  }

  // ⑤ 版本链降权（仅 M3 场景）
  const final = enableVersionScoring ? subjectVersionScoring(reranked) : reranked

  return final.slice(0, topK)
}
