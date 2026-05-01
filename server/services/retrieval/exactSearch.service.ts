/**
 * 精确检索通道
 *
 * 基于法律名称 + 条文编号直接查询数据库，适用于用户明确指定法律和条文的场景。
 * 命中条文会扩展前后 ±2 条上下文（限制在同 l1 层级内），并对结果去重。
 */

import { buildChapterHierarchy } from '../legal/lawEmbedding.service'
import type { IntentClassification, RetrievalResult } from './types'

/**
 * 精确检索服务
 *
 * 流程：
 * 1. 按法律名称查找候选法律（精确优先，再包含匹配，可能多部）
 * 2. 在每部候选法律中按条文编号查找（l5/l3 包含匹配）
 * 3. 只保留有命中条文的法律，对每条命中扩展 order ±2 上下文
 * 4. 去重后格式化为 RetrievalResult 返回
 */
export async function exactSearchService(
    intent: IntentClassification,
): Promise<RetrievalResult[]> {
    if (!intent.legalName) return []

    // 1. 查找候选法律：精确匹配优先，无结果再包含匹配（可能匹配多部）
    let candidateLegals = await prisma.legalMain.findMany({
        where: { name: intent.legalName, deletedAt: null },
    })
    if (candidateLegals.length === 0) {
        candidateLegals = await prisma.legalMain.findMany({
            where: { name: { contains: intent.legalName }, deletedAt: null },
            orderBy: { name: 'asc' },
        })
    }

    if (candidateLegals.length === 0) return []

    const articleRefWhere = intent.articleRef
        ? { OR: [{ l5: { contains: intent.articleRef } }, { l3: { contains: intent.articleRef } }] }
        : {}

    // 2. 在每部候选法律中查条文，只保留有命中的
    const legalArticlePairs = await Promise.all(
        candidateLegals.map(async (legal) => {
            const articles = await prisma.legalArticles.findMany({
                where: { legalId: legal.id, deletedAt: null, ...articleRefWhere },
                orderBy: { order: 'asc' },
            })
            return { legal, articles }
        }),
    )
    const matched = legalArticlePairs.filter(p => p.articles.length > 0)

    if (matched.length === 0) return []

    // 3. 收集直接命中条文的 ID（用于区分主命中和上下文的 score）
    const primaryHitIds = new Set(matched.flatMap(p => p.articles.map(a => a.id)))

    // 4. 对每部命中法律的每条条文扩展上下文
    const allResults: RetrievalResult[] = []
    const seenIds = new Set<string>()

    for (const { legal, articles } of matched) {
        // 单次 findMany 合并查询每条命中条文的 ±2 范围（OR 拼接），避免 N 次 round-trip
        const articlesNoOrder = articles.filter(a => a.order == null)
        const orQueries = articles
            .filter((a): a is typeof a & { order: number } => a.order != null)
            .map(a => ({
                order: { gte: a.order - 2, lte: a.order + 2 },
                ...(a.l1 ? { l1: a.l1 } : {}),
            }))
        const expanded = orQueries.length > 0
            ? await prisma.legalArticles.findMany({
                  where: { legalId: legal.id, deletedAt: null, OR: orQueries },
                  orderBy: { order: 'asc' },
              })
            : []

        for (const article of [...articlesNoOrder, ...expanded]) {
            if (seenIds.has(article.id)) continue
            seenIds.add(article.id)
            // 直接命中条文 score=1.0，上下文条文 score=0.95
            const isPrimaryHit = primaryHitIds.has(article.id)
            allResults.push({
                score: isPrimaryHit ? 1.0 : 0.95,
                content: article.content || '',
                metadata: {
                    articles_id: article.id,
                    legal_id: legal.id,
                    legal_name: legal.name,
                    legal_type: legal.type,
                    article_type: article.type,
                    chapter_hierarchy: buildChapterHierarchy(article),
                    issuing_authority: legal.issuingAuthority || '',
                    document_number: legal.documentNumber || '',
                    publish_date: legal.publishDate?.toISOString() ?? null,
                    effective_date: legal.effectiveDate?.toISOString() ?? null,
                    invalid_date: legal.invalidDate?.toISOString() ?? null,
                    retrieval_mode: 'exact',
                },
                retrievalMode: 'exact' as const,
            })
        }
    }

    // 按 score 降序排列：主命中（1.0）在前，上下文（0.95）在后
    return allResults.sort((a, b) => b.score - a.score)
}
