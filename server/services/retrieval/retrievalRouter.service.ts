/**
 * 统一检索路由器
 *
 * 根据 LLM 意图分类，将检索请求分发到对应通道（精确/混合/语义），
 * 并在结果返回后执行 Rerank 和后处理过滤。
 */

import { classifyIntentService } from './intentClassifier.service'
import { exactSearchService } from './exactSearch.service'
import { hybridSearchService } from './hybridSearch.service'
import { semanticSearchService } from './semanticSearch.service'
import { rerankAndFilterService } from './rerank.service'
import { applyPostFiltersService } from './postFilter.service'
import type { RetrievalRequest, RetrievalResult, IntentClassification, SearchResultItem, RetrievalMode } from './types'

/**
 * 统一检索路由器
 *
 * 流程：LLM 意图分类 → 分发到对应通道 → Rerank → 后处理过滤 → top-k
 * 精确通道无结果时自动降级到混合通道
 */
export async function retrievalRouterService(
    request: RetrievalRequest,
): Promise<RetrievalResult[]> {
    const intent = await classifyIntentService(request.query, request.type)
    logger.info(`检索意图分类: ${intent.intent}`, { query: request.query, type: request.type })

    let results: RetrievalResult[]
    let actualMode: RetrievalMode = intent.intent

    switch (intent.intent) {
        case 'exact': {
            results = await exactSearchService(intent)

            if (results.length === 0) {
                logger.info('精确检索无结果，降级到混合检索')
                const fallbackIntent: IntentClassification = {
                    ...intent,
                    intent: 'hybrid',
                    keywords: intent.keywords ?? [intent.legalName, intent.articleRef].filter(Boolean) as string[],
                    rewrittenQuery: intent.rewrittenQuery ?? request.query,
                }
                const searchResults = await hybridSearchService(fallbackIntent, request)
                results = searchResults.map(r => ({ ...r, retrievalMode: 'hybrid' as const }))
                actualMode = 'hybrid'
            }
            break
        }
        case 'hybrid': {
            const searchResults = await hybridSearchService(intent, request)
            results = searchResults.map(r => ({ ...r, retrievalMode: 'hybrid' as const }))
            break
        }
        case 'semantic': {
            const searchResults = await semanticSearchService(intent, request)
            results = searchResults.map(r => ({ ...r, retrievalMode: 'semantic' as const }))
            break
        }
    }

    if (actualMode !== 'exact' && results.length > 0) {
        const searchItems: SearchResultItem[] = results.map(r => ({
            score: r.score, content: r.content, metadata: r.metadata,
        }))
        const reranked = await rerankAndFilterService(request.query, searchItems, request.k, request.type)
        results = reranked.map(r => ({ ...r, retrievalMode: actualMode }))
    }

    results = applyPostFiltersService(results, request.postFilters)
    return results.slice(0, request.k)
}
