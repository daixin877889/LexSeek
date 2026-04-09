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
 * 1. 按法律名称查找 legalMain（精确优先，再包含匹配）
 * 2. 按条文编号查找 legalArticles（l5/l3 字段包含匹配）
 * 3. 并行为每条命中结果扩展 order ±2 的上下文（同 l1 层级约束）
 * 4. 去重后格式化为 RetrievalResult 返回
 */
export async function exactSearchService(
    intent: IntentClassification,
): Promise<RetrievalResult[]> {
    if (!intent.legalName) return []

    const legal = await prisma.legalMain.findFirst({
        where: {
            OR: [
                { name: intent.legalName },
                { name: { contains: intent.legalName } },
            ],
            deletedAt: null,
        },
    })

    if (!legal) return []

    const articleRefWhere = intent.articleRef
        ? { OR: [{ l5: { contains: intent.articleRef } }, { l3: { contains: intent.articleRef } }] }
        : {}

    const hitArticles = await prisma.legalArticles.findMany({
        where: { legalId: legal.id, deletedAt: null, ...articleRefWhere },
        orderBy: { order: 'asc' },
    })

    if (!hitArticles.length) return []

    // 并行扩展每条命中条文的前后 ±2 条上下文（同 l1 层级约束，避免跨大章节）
    const expandedGroups = await Promise.all(
        hitArticles.map(article =>
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

    // 按出现顺序去重
    const seenIds = new Set<string>()
    const contextArticles = expandedGroups.flat().filter(a => {
        if (seenIds.has(a.id)) return false
        seenIds.add(a.id)
        return true
    })

    return contextArticles.map(article => ({
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
    }))
}
