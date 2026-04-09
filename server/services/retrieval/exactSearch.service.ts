/**
 * 精确检索通道
 *
 * 基于法律名称 + 条文编号直接查询数据库，适用于用户明确指定法律和条文的场景。
 * 命中条文会扩展前后 ±2 条上下文（限制在同 l1 层级内），并对结果去重。
 */

import { buildHierarchyPath } from '../legal/lawEmbedding.service'
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

    // 3. 对每部命中法律的每条条文扩展上下文
    const allResults: RetrievalResult[] = []
    const seenIds = new Set<string>()

    for (const { legal, articles } of matched) {
        const expandedGroups = await Promise.all(
            articles.map(article =>
                article.order == null
                    ? Promise.resolve([article])
                    : prisma.legalArticles.findMany({
                          where: {
                              legalId: legal.id,
                              deletedAt: null,
                              order: { gte: article.order - 2, lte: article.order + 2 },
                              ...(article.l1 ? { l1: article.l1 } : {}),
                          },
                          orderBy: { order: 'asc' },
                      }),
            ),
        )

        for (const article of expandedGroups.flat()) {
            if (seenIds.has(article.id)) continue
            seenIds.add(article.id)
            allResults.push({
                score: 1.0,
                content: article.content || '',
                metadata: {
                    legal_name: legal.name,
                    document_number: legal.documentNumber,
                    publish_date: legal.publishDate?.toISOString(),
                    effective_date: legal.effectiveDate?.toISOString(),
                    invalid_date: legal.invalidDate?.toISOString(),
                    article_type: article.type,
                    articles_id: article.id,
                    chapter_hierarchy: buildHierarchyPath(article),
                    retrieval_mode: 'exact',
                },
                retrievalMode: 'exact' as const,
            })
        }
    }

    return allResults
}
