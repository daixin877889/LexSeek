/**
 * 案件记忆 DAO 层
 *
 * 沿用 LangChain PGVectorStore 同构约束：业务字段在 metadata JSON。
 * 所有查询用 raw SQL（prisma JSONB 操作能力受限）。
 */
import { prisma } from '~~/server/utils/db'
import type { CaseMemoryMetadata, MemorySource } from '#shared/types/memory'

export interface MemoryRow {
    id: string
    text: string
    metadata: CaseMemoryMetadata
}

/**
 * 查找指定案件 + subjectKey 的最新未失效记忆
 *
 * 用于：
 * - writeMemoryService 内部版本链（DRY 共用）
 * - afterAgent 软去重逻辑
 */
export async function findActiveMemoryBySubjectDAO(
    caseId: number,
    subjectKey: string,
): Promise<MemoryRow | null> {
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string; text: string; metadata: any }>>(
        `SELECT id, text, metadata FROM case_memories
         WHERE metadata->>'caseId' = $1
           AND metadata->>'subjectKey' = $2
           AND (metadata->>'invalidatedAt' IS NULL)
         ORDER BY metadata->>'createdAt' DESC
         LIMIT 1`,
        String(caseId),
        subjectKey,
    )
    if (rows.length === 0) return null
    return rows[0] as MemoryRow
}

export interface ListMemoriesOptions {
    source?: MemorySource
    includeInvalidated?: boolean
    cursor?: string  // 形如 "<createdAt>|<id>"，游标分页
    limit?: number   // 默认 30，最大 100
}

export interface ListMemoriesResult {
    memories: MemoryRow[]
    nextCursor?: string
}

/**
 * 案件记忆列表查询：时间倒序 + 游标分页
 *
 * 用于 GET API（前端时间线 Tab）。
 * - 默认排除失效记录（includeInvalidated=false）
 * - 游标格式 "<createdAt>|<id>"：同时间戳并列时 id 兜底保证稳定排序
 */
export async function listMemoriesDAO(
    caseId: number,
    options: ListMemoriesOptions = {},
): Promise<ListMemoriesResult> {
    const limit = Math.min(options.limit ?? 30, 100)

    const conditions: string[] = [`metadata->>'caseId' = $1`]
    const params: unknown[] = [String(caseId)]
    let nextParamIdx = 2

    if (!options.includeInvalidated) {
        conditions.push(`(metadata->>'invalidatedAt' IS NULL)`)
    }

    if (options.source) {
        conditions.push(`metadata->>'source' = $${nextParamIdx}`)
        params.push(options.source)
        nextParamIdx++
    }

    if (options.cursor) {
        const [cursorTime, cursorId] = options.cursor.split('|')
        if (cursorTime && cursorId) {
            conditions.push(
                `(metadata->>'createdAt' < $${nextParamIdx} OR (metadata->>'createdAt' = $${nextParamIdx} AND id < $${nextParamIdx + 1}::uuid))`,
            )
            params.push(cursorTime, cursorId)
            nextParamIdx += 2
        }
    }

    const sql = `SELECT id, text, metadata FROM case_memories
                 WHERE ${conditions.join(' AND ')}
                 ORDER BY metadata->>'createdAt' DESC, id DESC
                 LIMIT ${limit + 1}`  // +1 用于判断 hasMore

    const rows = await prisma.$queryRawUnsafe<Array<{ id: string; text: string; metadata: any }>>(sql, ...params)
    const hasMore = rows.length > limit
    const memories = (hasMore ? rows.slice(0, limit) : rows) as MemoryRow[]
    const nextCursor = hasMore && memories.length > 0
        ? `${memories[memories.length - 1]!.metadata.createdAt}|${memories[memories.length - 1]!.id}`
        : undefined

    return { memories, nextCursor }
}

/**
 * 软删指定记忆条（设 metadata.invalidatedAt）
 *
 * 与 LangChain 同构表对齐——不用 prisma deletedAt（表无该列）。
 * 召回链路（recallMemoryService 默认 filterInvalidated=true）自动过滤。
 */
export async function softDeleteMemoryDAO(memoryId: string): Promise<void> {
    await prisma.$executeRawUnsafe(
        `UPDATE case_memories
         SET metadata = jsonb_set(metadata, '{invalidatedAt}', to_jsonb($2::text))
         WHERE id = $1::uuid`,
        memoryId,
        new Date().toISOString(),
    )
}
