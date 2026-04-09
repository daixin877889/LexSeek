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

    const searchText = keywords.join(' ')

    // 构建 metadata 过滤条件（从 $2 开始）
    const { filterSQL: metaSQL, filterParams: metaParams } = buildParameterizedMetadataFilter(metadataFilter, 2)

    // 构建 sourceIds 过滤条件
    const { filterSQL: sourceSQL, filterParams: sourceParams } = buildSourceIdsFilter(sourceIds, 2 + metaParams.length)

    // LIMIT 参数索引
    const limitIdx = 2 + metaParams.length + sourceParams.length

    const query = `
        SELECT text, metadata,
               ts_rank_cd(tsv, plainto_tsquery('chinese', $1)) as score
        FROM ${tableName}
        WHERE tsv @@ plainto_tsquery('chinese', $1)
          ${metaSQL}${sourceSQL}
        ORDER BY score DESC
        LIMIT $${limitIdx}
    `
    const params = [searchText, ...metaParams, ...sourceParams, k]

    const pool = getPool()
    const result = await pool.query(query, params)

    return result.rows.map(row => ({
        score: parseFloat(row.score),
        content: row.text,
        metadata: row.metadata,
    }))
}
