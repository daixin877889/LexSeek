/**
 * 法律嵌入记录数据访问层
 *
 * 提供法律嵌入记录的数据库操作，包括：
 * - 查询嵌入列表
 * - 查询单个嵌入
 * - 更新嵌入元数据
 * - 删除嵌入记录
 */

import { getPool } from './vectorStore.service'
import type { LawEmbeddingMetadata } from '#shared/types/legal'

/** 嵌入记录原始数据 */
export interface LawEmbeddingRow {
    id: string
    text: string | null
    metadata: LawEmbeddingMetadata | null
}

/**
 * 查询法律的嵌入记录列表
 * @param legalId 法律 ID
 * @param articleId 条文 ID（可选）
 * @param page 页码
 * @param pageSize 每页数量
 * @returns 嵌入记录列表和总数
 */
export async function findEmbeddingsByLegalIdDao(
    legalId: string,
    articleId?: string,
    page: number = 1,
    pageSize: number = 20
): Promise<{ list: LawEmbeddingRow[]; total: number }> {
    const pool = getPool()
    const offset = (page - 1) * pageSize

    // 构建查询条件（元数据字段使用 snake_case 命名）
    let whereClause = `metadata->>'legal_id' = $1`
    const params: (string | number)[] = [legalId]

    if (articleId) {
        whereClause += ` AND metadata->>'articles_id' = $2`
        params.push(articleId)
    }

    // 查询总数
    const countQuery = `SELECT COUNT(*) as count FROM law_embeddings WHERE ${whereClause}`
    const countResult = await pool.query(countQuery, params)
    const total = parseInt(countResult.rows[0]?.count || '0', 10)

    // 查询列表
    const listQuery = `
        SELECT id, text, metadata 
        FROM law_embeddings 
        WHERE ${whereClause}
        ORDER BY metadata->>'chapter_hierarchy' ASC, id ASC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `
    const listResult = await pool.query(listQuery, [...params, pageSize, offset])

    return {
        list: listResult.rows as LawEmbeddingRow[],
        total,
    }
}

/**
 * 查询单个嵌入记录
 * @param id 嵌入记录 ID
 * @returns 嵌入记录或 null
 */
export async function findEmbeddingByIdDao(id: string): Promise<LawEmbeddingRow | null> {
    const pool = getPool()
    const query = `SELECT id, text, metadata FROM law_embeddings WHERE id = $1`
    const result = await pool.query(query, [id])
    return result.rows[0] || null
}

/**
 * 更新嵌入记录的元数据
 * @param id 嵌入记录 ID
 * @param updates 要更新的元数据字段
 * @returns 更新后的记录
 */
export async function updateEmbeddingMetadataDao(
    id: string,
    updates: Partial<LawEmbeddingMetadata>
): Promise<LawEmbeddingRow | null> {
    const pool = getPool()

    // 构建 JSONB 更新语句
    const setClauses: string[] = []
    const params: (string | boolean | null)[] = [id]
    let paramIndex = 2

    for (const [key, value] of Object.entries(updates)) {
        if (value !== undefined) {
            setClauses.push(`metadata = jsonb_set(metadata, '{${key}}', $${paramIndex}::jsonb)`)
            // 将值转换为 JSON 字符串
            params.push(JSON.stringify(value))
            paramIndex++
        }
    }

    if (setClauses.length === 0) {
        return await findEmbeddingByIdDao(id)
    }

    const query = `
        UPDATE law_embeddings 
        SET ${setClauses.join(', ')}
        WHERE id = $1
        RETURNING id, text, metadata
    `
    const result = await pool.query(query, params)
    return result.rows[0] || null
}

/**
 * 删除嵌入记录
 * @param id 嵌入记录 ID
 * @returns 是否删除成功
 */
export async function deleteEmbeddingByIdDao(id: string): Promise<boolean> {
    const pool = getPool()
    const query = `DELETE FROM law_embeddings WHERE id = $1`
    const result = await pool.query(query, [id])
    return (result.rowCount ?? 0) > 0
}

/**
 * 统计法律的嵌入记录数量
 * @param legalId 法律 ID
 * @returns 嵌入记录数量
 */
export async function countEmbeddingsByLegalIdDao(legalId: string): Promise<number> {
    const pool = getPool()
    const query = `SELECT COUNT(*) as count FROM law_embeddings WHERE metadata->>'legal_id' = $1`
    const result = await pool.query(query, [legalId])
    return parseInt(result.rows[0]?.count || '0', 10)
}
