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
 * 合并去重：exact 结果优先，hybrid 结果追加
 * 去重 ID：metadata.articles_id，无 articles_id 时 fallback 到 content 前 50 字符
 */
export function mergeAndDedup(
    exactResults: RetrievalResult[],
    hybridResults: RetrievalResult[],
): RetrievalResult[] {
    const seen = new Set<string>()
    const merged: RetrievalResult[] = []

    for (const r of exactResults) {
        const id = (r.metadata.articles_id as string) || r.content.slice(0, 50)
        seen.add(id)
        merged.push(r)
    }

    for (const r of hybridResults) {
        const id = (r.metadata.articles_id as string) || r.content.slice(0, 50)
        if (!seen.has(id)) {
            seen.add(id)
            merged.push(r)
        }
    }

    return merged
}

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

    let results: RetrievalResult[] = []
    let actualMode: RetrievalMode = intent.intent

    switch (intent.intent) {
        case 'exact': {
            const isCompound = !!(intent.rewrittenQuery || intent.keywords?.length)

            if (isCompound) {
                // 复合 exact：并行 exact + hybrid
                const [exactResults, hybridRaw] = await Promise.all([
                    exactSearchService(intent),
                    hybridSearchService(intent, request),
                ])
                const hybridResults = hybridRaw.map(r => ({ ...r, retrievalMode: 'hybrid' as const }))
                results = mergeAndDedup(exactResults, hybridResults)
                actualMode = 'hybrid' // 复合查询走 rerank
            } else {
                // 纯 exact：原有逻辑不变
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
