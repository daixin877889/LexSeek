/**
 * 全文搜索服务
 *
 * 使用 zhparser 中文分词扩展，基于 PostgreSQL tsv 列进行 BM25 全文搜索
 */

import { getPool } from '../legal/vectorStore.service'
import type { SearchResultItem } from './types'
import { ALLOWED_TABLES, ALLOWED_METADATA_KEYS } from './types'

/**
 * 构建参数化 metadata 过滤条件
 * 将结构化 filter 对象转为安全的参数化 SQL
 */
export function buildParameterizedMetadataFilter(
    filter: Record<string, string | number | boolean> | undefined,
    startParamIndex: number,
): { filterSQL: string; filterParams: unknown[] } {
    if (!filter || Object.keys(filter).length === 0) {
        return { filterSQL: '', filterParams: [] }
    }

    const conditions: string[] = []
    const params: unknown[] = []
    let paramIdx = startParamIndex

    for (const [key, value] of Object.entries(filter)) {
        // metadata key 白名单验证
        if (!ALLOWED_METADATA_KEYS.has(key)) {
            throw new Error(`非法 metadata 过滤字段: ${key}`)
        }
        conditions.push(`metadata->>'${key}' = $${paramIdx}`)
        params.push(String(value))
        paramIdx++
    }

    return {
        filterSQL: conditions.map(c => ` AND ${c}`).join(''),
        filterParams: params,
    }
}

/**
 * 构建 sourceId IN 条件
 * 将 sourceIds 数组转为参数化 SQL IN 条件
 */
export function buildSourceIdsFilter(
    sourceIds: string[] | undefined,
    startParamIndex: number,
): { filterSQL: string; filterParams: string[] } {
    if (!sourceIds?.length) return { filterSQL: '', filterParams: [] }

    const placeholders = sourceIds.map((_, i) => `$${startParamIndex + i}`).join(', ')
    return {
        filterSQL: ` AND metadata->>'sourceId' IN (${placeholders})`,
        filterParams: sourceIds,
    }
}

/**
 * 使用 zhparser 进行 BM25 全文搜索
 */
export async function fullTextSearchService(
    tableName: string,
    keywords: string[],
    k: number,
    metadataFilter?: Record<string, string | number | boolean>,
    sourceIds?: string[],
): Promise<SearchResultItem[]> {
    // 表名白名单验证
    if (!ALLOWED_TABLES.has(tableName)) {
        throw new Error(`非法表名: ${tableName}`)
    }

    if (!keywords.length) return []

    // 把每个 keyword 内部空格再切一次，过滤空 token；多 token 间走 OR
    // —— plainto_tsquery 单参输入会被切成 AND 查询，对中文 query 太严格
    // （如"沟通方式 偏好" 切成"沟通"&"方式"&"偏好"，缺任何一个都不命中）。
    // 改用多个 plainto_tsquery 并 || 拼接 → token 间 OR + 各 token 内部
    // 仍走 zhparser 自动分词 → 召回率显著提升。
    const tokens = keywords
        .flatMap(kw => kw.split(/\s+/))
        .map(t => t.trim())
        .filter(t => t.length > 0)

    if (tokens.length === 0) return []

    // 构建多个 plainto_tsquery 并 || 拼接 —— 占位符从 $1 开始
    const tsqueries = tokens.map((_, i) => `plainto_tsquery('chinese', $${i + 1})`).join(' || ')

    // 构建 metadata 过滤条件（从 $tokens.length+1 开始）
    const { filterSQL: metaSQL, filterParams: metaParams } = buildParameterizedMetadataFilter(
        metadataFilter,
        tokens.length + 1,
    )

    // 构建 sourceIds 过滤条件
    const { filterSQL: sourceSQL, filterParams: sourceParams } = buildSourceIdsFilter(
        sourceIds,
        tokens.length + 1 + metaParams.length,
    )

    // LIMIT 参数索引
    const limitIdx = tokens.length + 1 + metaParams.length + sourceParams.length

    const query = `
        SELECT text, metadata,
               ts_rank_cd(tsv, (${tsqueries})) as score
        FROM ${tableName}
        WHERE tsv @@ (${tsqueries})
          ${metaSQL}${sourceSQL}
        ORDER BY score DESC
        LIMIT $${limitIdx}
    `
    const params = [...tokens, ...metaParams, ...sourceParams, k]

    const pool = getPool()
    const result = await pool.query(query, params)

    return result.rows.map(row => ({
        score: parseFloat(row.score),
        content: row.text,
        metadata: row.metadata,
    }))
}
